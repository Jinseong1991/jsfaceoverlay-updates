'use strict';

/**
 * Battery drain estimator.
 *
 * Keeps a short history of (timestamp, percent) samples per device and
 * derives a discharge rate (%/hour) with a least-squares fit. From the rate
 * it predicts how long the device will last until it hits 0 %.
 *
 * History rules:
 *  - a sample is only stored when the percent actually changes (or the
 *    history is empty) so that polling frequency does not skew the fit;
 *  - when the percent rises the device is assumed to be charging and the
 *    discharge history is reset;
 *  - samples older than MAX_AGE_MS are dropped.
 */

const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 h
const MAX_SAMPLES = 120;
const MIN_SPAN_MS = 10 * 60 * 1000;     // need >= 10 min of data before estimating
const MIN_DROP = 2;                     // need >= 2 % of drop before estimating

function pruneSamples(samples, now) {
  const cutoff = now - MAX_AGE_MS;
  let out = samples.filter(s => s.t >= cutoff);
  if (out.length > MAX_SAMPLES) out = out.slice(out.length - MAX_SAMPLES);
  return out;
}

/**
 * Add a new reading to a device's history.
 * @param {{samples: Array<{t:number,p:number}>, charging?: boolean}} history
 * @param {number} percent 0..100
 * @param {number} now epoch ms
 * @returns the updated history object (new object, input untouched)
 */
function addSample(history, percent, now = Date.now()) {
  const samples = pruneSamples((history && history.samples) || [], now);
  const last = samples[samples.length - 1];
  if (!last) {
    return { samples: [{ t: now, p: percent }], charging: false };
  }
  if (percent > last.p) {
    // Battery went up -> charging. Restart history from this point.
    return { samples: [{ t: now, p: percent }], charging: true };
  }
  if (percent === last.p) {
    // Nothing changed: keep history, but note the device is still alive at
    // this level by remembering the latest "seen" time for the last sample.
    const copy = samples.slice();
    copy[copy.length - 1] = { ...last, seen: now };
    return { samples: copy, charging: history.charging === true && samples.length === 1 };
  }
  // percent < last.p: discharging
  return { samples: [...samples, { t: now, p: percent }], charging: false };
}

/**
 * Least-squares slope of percent over time, in %/hour (negative = draining).
 */
function drainRatePerHour(samples) {
  if (!samples || samples.length < 2) return null;
  const n = samples.length;
  const t0 = samples[0].t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const s of samples) {
    const x = (s.t - t0) / 3600000; // hours
    const y = s.p;
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

/**
 * Estimate the remaining time in minutes (null when not enough data).
 * @returns {{minutes:number|null, ratePerHour:number|null, status:'charging'|'estimating'|'ok'|'unknown'}}
 */
function estimate(history, now = Date.now()) {
  if (!history || !history.samples || history.samples.length === 0) {
    return { minutes: null, ratePerHour: null, status: 'unknown' };
  }
  if (history.charging) {
    return { minutes: null, ratePerHour: null, status: 'charging' };
  }
  const samples = history.samples;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = (last.seen || last.t) - first.t;
  const drop = first.p - last.p;
  if (samples.length < 2 || span < MIN_SPAN_MS || drop < MIN_DROP) {
    return { minutes: null, ratePerHour: null, status: 'estimating' };
  }
  // Use the fit but include the "seen" time of the last sample as an extra
  // anchor so a long plateau at the current level slows the predicted drain.
  const fitSamples = last.seen && last.seen > last.t
    ? [...samples.slice(0, -1), { t: last.t, p: last.p }, { t: last.seen, p: last.p }]
    : samples;
  const rate = drainRatePerHour(fitSamples);
  if (rate === null || rate >= 0) {
    return { minutes: null, ratePerHour: rate, status: 'estimating' };
  }
  const hoursLeft = last.p / -rate;
  return {
    minutes: Math.max(0, Math.round(hoursLeft * 60)),
    ratePerHour: rate,
    status: 'ok',
  };
}

/** Format minutes as a short Korean duration string, e.g. "약 3시간 20분". */
function formatMinutes(min) {
  if (min === null || min === undefined || !Number.isFinite(min)) return '';
  if (min < 1) return '1분 미만';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = Math.round(min % 60);
  const parts = [];
  if (d) parts.push(`${d}일`);
  if (h) parts.push(`${h}시간`);
  if (!d && m) parts.push(`${m}분`);
  return `약 ${parts.join(' ')}`;
}

module.exports = { addSample, estimate, drainRatePerHour, formatMinutes, MAX_AGE_MS, MIN_SPAN_MS, MIN_DROP };
