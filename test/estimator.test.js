'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { addSample, estimate, formatMinutes } = require('../src/estimator');

const H = 3600000;

test('needs enough data before estimating', () => {
  let h = addSample(null, 80, 0);
  assert.equal(estimate(h, 0).status, 'estimating');
  h = addSample(h, 79, 5 * 60000); // 1% in 5 min: too little span & drop
  assert.equal(estimate(h, 5 * 60000).status, 'estimating');
});

test('estimates a steady 10 %/h drain', () => {
  let h = null;
  for (let i = 0; i <= 5; i++) h = addSample(h, 100 - i * 10, i * H);
  const e = estimate(h, 5 * H);
  assert.equal(e.status, 'ok');
  assert.ok(Math.abs(e.ratePerHour + 10) < 1e-6, `rate ${e.ratePerHour}`);
  assert.equal(e.minutes, 300); // 50 % left at 10 %/h
});

test('rising percent resets history and reports charging', () => {
  let h = null;
  for (let i = 0; i <= 3; i++) h = addSample(h, 90 - i * 10, i * H);
  h = addSample(h, 70, 4 * H);
  assert.equal(h.samples.length, 1);
  assert.equal(estimate(h, 4 * H).status, 'charging');
  // next identical reading keeps 'charging', a drop clears it
  h = addSample(h, 70, 4.5 * H);
  assert.equal(estimate(h, 4.5 * H).status, 'charging');
  h = addSample(h, 69, 5 * H);
  assert.equal(h.charging, false);
});

test('a long plateau slows the predicted drain', () => {
  let h = null;
  h = addSample(h, 50, 0);
  h = addSample(h, 40, 1 * H);
  const fast = estimate(h, 1 * H).minutes;
  h = addSample(h, 40, 3 * H); // still at 40 after two more hours
  const slow = estimate(h, 3 * H).minutes;
  assert.ok(slow > fast, `${slow} > ${fast}`);
});

test('old samples are pruned', () => {
  let h = addSample(null, 90, 0);
  h = addSample(h, 80, 20 * H);
  assert.equal(h.samples.length, 1);
  assert.equal(h.samples[0].p, 80);
});

test('formatMinutes', () => {
  assert.equal(formatMinutes(0.5), '1분 미만');
  assert.equal(formatMinutes(45), '약 45분');
  assert.equal(formatMinutes(200), '약 3시간 20분');
  assert.equal(formatMinutes(1500), '약 1일 1시간');
  assert.equal(formatMinutes(null), '');
});
