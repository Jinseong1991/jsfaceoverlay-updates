'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Minimal JSON file store with atomic writes. */
class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = { ...defaults, ...this._read() };
  }
  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }
  get(key) { return this.data[key]; }
  set(key, value) { this.data[key] = value; this.save(); }
  update(patch) { Object.assign(this.data, patch); this.save(); }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('store save failed', e);
    }
  }
}

const DEFAULT_SETTINGS = {
  selectedIds: [],         // device InstanceIds to show; empty = show all with battery
  opacity: 0.55,           // panel background alpha 0..1
  textOpacity: 1,          // whole-window opacity 0.2..1
  refreshSec: 60,
  alwaysOnTop: true,
  clickThrough: false,
  locked: false,
  showDisconnected: false,
  showNoBattery: false,
  lowThreshold: 20,
  notifyLow: true,
  compact: false,
  theme: 'dark',           // 'dark' | 'light'
  accent: '#4ade80',
  position: null,          // {x,y}
  autoStart: false,
};

module.exports = { JsonStore, DEFAULT_SETTINGS };
