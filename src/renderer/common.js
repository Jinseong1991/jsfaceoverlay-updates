'use strict';
// Shared helpers for overlay and settings renderers (loaded via <script>).

const ICONS = {
  headset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="13" width="4" height="7" rx="1.5"/><rect x="17" y="13" width="4" height="7" rx="1.5"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>',
  mouse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6"/></svg>',
  earbuds: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3 3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/><path d="M7 12v6a2 2 0 0 1-2 2"/><path d="M17 4a3 3 0 0 0-3 3v2a3 3 0 0 0 3 3 3 3 0 0 0 3-3V7a3 3 0 0 0-3-3z"/><path d="M17 12v6a2 2 0 0 0 2 2"/></svg>',
  controller: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12a4 4 0 0 1 4 4v3a3 3 0 0 1-5.4 1.8L15 15H9l-1.6 1.8A3 3 0 0 1 2 15v-3a4 4 0 0 1 4-4z"/><path d="M7 12h3M8.5 10.5v3M16 11h.01M18 13h.01"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="7" r="1"/></svg>',
  bluetooth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 7 10 10-5 5V2l5 5L7 17"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
};

function guessKind(name) {
  const n = (name || '').toLowerCase();
  if (/arctis|headset|headphone|wh-\d|xm\d|quietcomfort|qc\d|hyperx cloud|g\d{3}|logi.*(zone|pro x)/.test(n)) return 'headset';
  if (/buds|airpods|freebuds|earbud|wf-\d|tws|pods/.test(n)) return 'earbuds';
  if (/keyboard|kbd|f99|k\d{2,3}|mx keys|aula|keychron|nuphy|leopold|varmilo|ducky|rk\d/.test(n)) return 'keyboard';
  if (/mouse|mx master|mx anywhere|g pro|superlight|razer (viper|deathadder|basilisk)|m\d{3}/.test(n)) return 'mouse';
  if (/controller|xbox|dualsense|dualshock|wireless controller|joy-con|pro controller|gamepad/.test(n)) return 'controller';
  if (/galaxy s|iphone|pixel|phone|watch/.test(n)) return 'phone';
  if (/speaker|soundbar|flip|charge|boom|sound/.test(n)) return 'speaker';
  return 'bluetooth';
}

function levelClass(p) {
  if (p === null || p === undefined) return 'none';
  if (p <= 15) return 'crit';
  if (p <= 35) return 'low';
  if (p <= 65) return 'mid';
  return 'high';
}

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

function estimateText(d) {
  const e = d.estimate || {};
  if (d.battery === null) return d.lastKnownBattery !== null && d.lastKnownBattery !== undefined ? `마지막 ${d.lastKnownBattery}%` : '배터리 정보 없음';
  if (!d.connected) return '연결 끊김';
  switch (e.status) {
    case 'ok': return `${formatMinutes(e.minutes)} 남음`;
    case 'charging': return '충전 중';
    case 'estimating': return '남은 시간 계산 중';
    default: return '';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '74,222,128';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

window.BT = { ICONS, guessKind, levelClass, formatMinutes, estimateText, escapeHtml, hexToRgb };
