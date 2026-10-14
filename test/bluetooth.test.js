'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseDevices, addrFromId } = require('../src/bluetooth');

const nodes = [
  { id: 'BTHENUM\\DEV_C8A3C1D4E5F6', name: 'SteelSeries Arctis Nova 5X', status: 'OK', present: true, connected: true, battery: null, address: 'c8a3c1d4e5f6', parent: 'BTHENUM\\{0000111E-...}\\7&1', root: true },
  // HFP service node carrying the battery, child of the root
  { id: 'BTHENUM\\{0000111E-0000-1000-8000-00805F9B34FB}_LOCALMFG&000F\\7&2AB&0&C8A3C1D4E5F6_C00000000', name: 'Arctis Nova 5X Hands-Free AG', status: 'OK', present: true, connected: null, battery: 43, parent: 'BTHENUM\\DEV_C8A3C1D4E5F6', root: false },
  // audio endpoint two levels down, no battery
  { id: 'BTHHFENUM\\BthHFPAudio\\8&1&0&97', name: 'Headset (Arctis)', status: 'OK', present: true, connected: null, battery: null, parent: 'BTHENUM\\{0000111E-0000-1000-8000-00805F9B34FB}_LOCALMFG&000F\\7&2AB&0&C8A3C1D4E5F6_C00000000', root: false },
  { id: 'BTHLE\\DEV_112233445566', name: 'AULA-F99Pro 5.0', status: 'Unknown', present: false, connected: false, battery: 100, address: '112233445566', parent: 'BTHUSB\\x', root: true },
  { id: 'BTHENUM\\DEV_AABBCCDDEEFF', name: 'AULA-F99Pro 3.0', status: 'OK', present: true, connected: true, battery: null, address: 'AABBCCDDEEFF', parent: 'BTHUSB\\x', root: true },
  // orphan node whose parent chain is unknown but whose id embeds the address
  { id: 'BTHLEDEVICE\\{0000180F-0000-1000-8000-00805F9B34FB}_112233445566\\9&1&0&0001', name: 'Battery Service', status: 'OK', present: true, connected: null, battery: 98, parent: null, root: false },
  { id: 'BTHUSB\\VID_8087&PID_0033\\6&1', name: 'Intel Wireless Bluetooth', status: 'OK', present: true, connected: null, battery: null, parent: 'USB\\x', root: false },
];

test('battery on a child service node is attributed to its top-level device', () => {
  const devs = parseDevices(JSON.stringify({ nodes }));
  const arctis = devs.find(d => d.name === 'SteelSeries Arctis Nova 5X');
  assert.equal(arctis.battery, 43);
  assert.match(arctis.batterySource, /Hands-Free|0000111E/);
  assert.equal(arctis.connected, true);
  assert.equal(arctis.address, 'C8A3C1D4E5F6');
  assert.equal(arctis.nodes, 3);
});

test('root battery wins and orphans are matched by address', () => {
  const devs = parseDevices(JSON.stringify({ nodes }));
  const kbd5 = devs.find(d => d.name === 'AULA-F99Pro 5.0');
  assert.equal(kbd5.battery, 100); // root value preferred over the child 98
  assert.equal(kbd5.le, true);
  assert.equal(kbd5.connected, false);
  const kbd3 = devs.find(d => d.name === 'AULA-F99Pro 3.0');
  assert.equal(kbd3.battery, null);
  assert.equal(devs.length, 3); // radio node is not a device
  assert.equal(devs[0].name, 'AULA-F99Pro 3.0'); // sorted by name
});

test('address extraction from instance ids', () => {
  assert.equal(addrFromId('BTHENUM\\DEV_AABBCCDDEEFF'), 'AABBCCDDEEFF');
  assert.equal(addrFromId('BTHENUM\\{0000111E-0000-1000-8000-00805F9B34FB}_VID&0001005D_PID&0F00\\7&2AB&0&C8A3C1D4E5F6_C00000000'), 'C8A3C1D4E5F6');
  assert.equal(addrFromId('BTHLEDEVICE\\{0000180F-0000-1000-8000-00805F9B34FB}_112233445566\\9&1&0&0001'), '112233445566');
  assert.equal(addrFromId('BTHUSB\\VID_8087&PID_0033\\6&1'), null);
});

test('legacy flat array, single object and garbage are handled', () => {
  assert.equal(parseDevices(JSON.stringify([{ id: 'BTHENUM\\DEV_1', name: 'y', battery: 200, root: true }]))[0].battery, null);
  assert.equal(parseDevices(JSON.stringify({ nodes: { id: 'BTHLE\\DEV_2', name: 'z', battery: 50, root: true } }))[0].battery, 50);
  assert.deepEqual(parseDevices(''), []);
  assert.deepEqual(parseDevices('not json'), []);
});
