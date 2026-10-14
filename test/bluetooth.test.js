'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseDevices } = require('../src/bluetooth');

test('parses PowerShell JSON output', () => {
  const json = JSON.stringify([
    { id: 'BTHENUM\\DEV_1', name: 'SteelSeries Arctis Nova 5X', status: 'OK', present: true, connected: true, battery: 37, address: 'aabbcc', le: false },
    { id: 'BTHLE\\DEV_2', name: 'AULA-F99Pro 5.0', status: 'Unknown', present: false, connected: false, battery: null, le: true },
  ]);
  const devs = parseDevices(json);
  assert.equal(devs.length, 2);
  assert.equal(devs[0].name, 'AULA-F99Pro 5.0'); // sorted by name
  assert.equal(devs[1].battery, 37);
  assert.equal(devs[1].address, 'AABBCC');
  assert.equal(devs[0].battery, null);
});

test('single object and garbage are handled', () => {
  assert.equal(parseDevices(JSON.stringify({ id: 'x', name: 'y', battery: 200 }))[0].battery, null);
  assert.deepEqual(parseDevices(''), []);
  assert.deepEqual(parseDevices('not json'), []);
});
