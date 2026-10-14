'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, screen, shell } = require('electron');
const path = require('node:path');
const { listDevices } = require('./bluetooth');
const { addSample, estimate } = require('./estimator');
const { JsonStore, DEFAULT_SETTINGS } = require('./store');

const OVERLAY_WIDTH = 320;
const isDev = !app.isPackaged;

let settings, history;
let overlayWin = null;
let settingsWin = null;
let tray = null;
let pollTimer = null;
let polling = false;
let lastDevices = [];
let lastError = null;
let lastPollAt = null;
const lowNotified = new Set();
let quitting = false;

// ---------------------------------------------------------------------------
// Single instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showOverlay();
    openSettings();
  });
}

app.setAppUserModelId('com.jinseong1991.btbatteryoverlay');

// ---------------------------------------------------------------------------
function assetPath(name) {
  return path.join(__dirname, '..', 'assets', name);
}

function getSettings() {
  return { ...settings.data };
}

function computeDevices() {
  const s = settings.data;
  const selected = new Set(s.selectedIds || []);
  const now = Date.now();
  return lastDevices.map(d => {
    const h = history.get(d.id) || null;
    const est = estimate(h, now);
    const lastKnown = h && h.samples && h.samples.length ? h.samples[h.samples.length - 1].p : null;
    return {
      ...d,
      lastKnownBattery: lastKnown,
      estimate: est,
      selected: selected.has(d.id),
    };
  });
}

function visibleDevices() {
  const s = settings.data;
  const all = computeDevices();
  const hasSelection = (s.selectedIds || []).length > 0;
  return all.filter(d => {
    if (hasSelection && !d.selected) return false;
    if (!s.showDisconnected && !d.connected) return false;
    if (!s.showNoBattery && d.battery === null && d.lastKnownBattery === null) return false;
    return true;
  });
}

function broadcast() {
  const payload = {
    settings: getSettings(),
    devices: computeDevices(),
    visible: visibleDevices(),
    lastPollAt,
    lastError,
    platform: process.platform,
    version: app.getVersion(),
  };
  for (const w of [overlayWin, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('state', payload);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Polling
function mockDevices() {
  // Used on non-Windows platforms (development only).
  const t = Date.now() / 60000;
  return [
    { id: 'MOCK\\HEADSET', name: 'SteelSeries Arctis Nova 5X', address: '00:11:22:33:44:55', connected: true, present: true, status: 'OK', le: false, battery: Math.max(0, Math.round(37 - (t % 60) / 3)) },
    { id: 'MOCK\\KBD', name: 'AULA-F99Pro 3.0', address: null, connected: true, present: true, status: 'OK', le: false, battery: null },
    { id: 'MOCK\\KBD5', name: 'AULA-F99Pro 5.0', address: null, connected: false, present: false, status: 'Unknown', le: true, battery: null },
    { id: 'MOCK\\BUDS', name: 'Galaxy Buds2 Pro', address: null, connected: true, present: true, status: 'OK', le: true, battery: 82 },
  ];
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const devices = process.platform === 'win32' ? await listDevices() : mockDevices();
    const now = Date.now();
    for (const d of devices) {
      if (d.battery !== null && d.connected) {
        const prev = history.get(d.id);
        history.data[d.id] = addSample(prev, d.battery, now);
      }
    }
    history.save();
    lastDevices = devices;
    lastError = null;
    lastPollAt = now;
    checkLowBattery();
  } catch (e) {
    lastError = e && e.message ? e.message : String(e);
    console.error('poll failed:', lastError, e && e.stderr ? e.stderr : '');
  } finally {
    polling = false;
    broadcast();
    updateTrayTooltip();
  }
}

function checkLowBattery() {
  const s = settings.data;
  if (!s.notifyLow || !Notification.isSupported()) return;
  for (const d of visibleDevices()) {
    if (d.battery === null) continue;
    if (d.battery <= s.lowThreshold) {
      if (!lowNotified.has(d.id)) {
        lowNotified.add(d.id);
        new Notification({
          title: `${d.name} 배터리 부족`,
          body: `남은 배터리 ${d.battery}%`,
          icon: assetPath('icon.png'),
        }).show();
      }
    } else if (d.battery > s.lowThreshold + 5) {
      lowNotified.delete(d.id);
    }
  }
}

function restartPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const sec = Math.max(10, Number(settings.data.refreshSec) || 60);
  pollTimer = setInterval(poll, sec * 1000);
}

// ---------------------------------------------------------------------------
// Overlay window
function createOverlay() {
  const s = settings.data;
  const pos = s.position;
  const display = screen.getPrimaryDisplay().workArea;
  let x = display.x + display.width - OVERLAY_WIDTH - 24;
  let y = display.y + 24;
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    // only reuse the saved position if it is still on some display
    const onScreen = screen.getAllDisplays().some(({ bounds: b }) =>
      pos.x + OVERLAY_WIDTH > b.x && pos.x < b.x + b.width && pos.y + 40 > b.y && pos.y < b.y + b.height);
    if (onScreen) { x = pos.x; y = pos.y; }
  }

  overlayWin = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: 160,
    x, y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: !!s.alwaysOnTop,
    show: false,
    title: 'BT Battery Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlayWin.setMenuBarVisibility(false);
  if (s.alwaysOnTop) overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setOpacity(clamp(Number(s.textOpacity) || 1, 0.2, 1));
  applyClickThrough();
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWin.once('ready-to-show', () => { overlayWin.show(); broadcast(); });
  overlayWin.on('moved', () => {
    if (!overlayWin) return;
    const [wx, wy] = overlayWin.getPosition();
    settings.set('position', { x: wx, y: wy });
  });
  overlayWin.on('closed', () => { overlayWin = null; });
  overlayWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function applyClickThrough() {
  if (!overlayWin) return;
  const on = !!settings.data.clickThrough;
  overlayWin.setIgnoreMouseEvents(on, { forward: true });
}

function showOverlay() {
  if (!overlayWin) createOverlay();
  else { overlayWin.show(); }
  refreshTrayMenu();
}

function toggleOverlay() {
  if (overlayWin && overlayWin.isVisible()) overlayWin.hide();
  else showOverlay();
  refreshTrayMenu();
}

// ---------------------------------------------------------------------------
// Settings window
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 440,
    minHeight: 520,
    frame: false,
    transparent: false,
    backgroundColor: '#15171c',
    title: 'BT Battery Overlay 설정',
    icon: assetPath('icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => { settingsWin.show(); broadcast(); });
  settingsWin.on('closed', () => { settingsWin = null; });
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------------------
// Tray
function createTray() {
  const img = nativeImage.createFromPath(assetPath('tray.png'));
  tray = new Tray(img);
  tray.setToolTip('BT Battery Overlay');
  tray.on('click', toggleOverlay);
  tray.on('double-click', openSettings);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const s = settings.data;
  const menu = Menu.buildFromTemplate([
    { label: overlayWin && overlayWin.isVisible() ? '오버레이 숨기기' : '오버레이 표시', click: toggleOverlay },
    { label: '설정...', click: openSettings },
    { type: 'separator' },
    { label: '지금 새로고침', click: () => poll() },
    { label: '위치 잠금', type: 'checkbox', checked: !!s.locked, click: (m) => applySettings({ locked: m.checked }) },
    { label: '클릭 통과 (마우스 무시)', type: 'checkbox', checked: !!s.clickThrough, click: (m) => applySettings({ clickThrough: m.checked }) },
    { label: '항상 위에', type: 'checkbox', checked: !!s.alwaysOnTop, click: (m) => applySettings({ alwaysOnTop: m.checked }) },
    { type: 'separator' },
    { label: '위치 초기화', click: () => { settings.set('position', null); if (overlayWin) { overlayWin.close(); createOverlay(); } } },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function updateTrayTooltip() {
  if (!tray) return;
  const lines = visibleDevices()
    .filter(d => d.battery !== null)
    .map(d => `${d.name}: ${d.battery}%`);
  tray.setToolTip(lines.length ? lines.join('\n') : 'BT Battery Overlay');
}

// ---------------------------------------------------------------------------
// Settings application
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function applySettings(patch) {
  const before = { ...settings.data };
  settings.update(patch);
  const s = settings.data;

  if (overlayWin && !overlayWin.isDestroyed()) {
    if ('alwaysOnTop' in patch) overlayWin.setAlwaysOnTop(!!s.alwaysOnTop, 'screen-saver');
    if ('textOpacity' in patch) overlayWin.setOpacity(clamp(Number(s.textOpacity) || 1, 0.2, 1));
    if ('clickThrough' in patch) applyClickThrough();
  }
  if ('refreshSec' in patch && patch.refreshSec !== before.refreshSec) restartPolling();
  if ('autoStart' in patch) {
    try {
      // For the portable build the real exe lives at PORTABLE_EXECUTABLE_FILE,
      // process.execPath points at the temporary extraction directory.
      const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
      app.setLoginItemSettings({ openAtLogin: !!s.autoStart, path: exe, args: ['--hidden-start'] });
    } catch (e) { console.error('setLoginItemSettings failed', e); }
  }
  if ('notifyLow' in patch || 'lowThreshold' in patch) lowNotified.clear();
  refreshTrayMenu();
  broadcast();
  updateTrayTooltip();
}

// ---------------------------------------------------------------------------
// IPC
ipcMain.handle('get-state', () => broadcast());
ipcMain.handle('set-settings', (_e, patch) => { applySettings(patch || {}); return getSettings(); });
ipcMain.handle('refresh', async () => { await poll(); return true; });
ipcMain.handle('open-settings', () => { openSettings(); return true; });
ipcMain.handle('hide-overlay', () => { if (overlayWin) overlayWin.hide(); refreshTrayMenu(); return true; });
ipcMain.handle('close-settings', () => { if (settingsWin) settingsWin.close(); return true; });
ipcMain.handle('minimize-settings', () => { if (settingsWin) settingsWin.minimize(); return true; });
ipcMain.handle('quit', () => { quitting = true; app.quit(); return true; });
ipcMain.handle('clear-history', () => { history.data = {}; history.save(); broadcast(); return true; });
ipcMain.handle('open-bluetooth-settings', () => { shell.openExternal('ms-settings:bluetooth'); return true; });
ipcMain.handle('overlay-resize', (_e, height) => {
  if (!overlayWin || overlayWin.isDestroyed()) return false;
  const h = clamp(Math.ceil(Number(height) || 60), 40, 900);
  const [w] = overlayWin.getSize();
  overlayWin.setSize(w, h);
  return true;
});

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  const dir = app.getPath('userData');
  settings = new JsonStore(path.join(dir, 'settings.json'), DEFAULT_SETTINGS);
  history = new JsonStore(path.join(dir, 'history.json'), {});

  createTray();
  createOverlay();
  restartPolling();
  poll();

  if (isDev) console.log('userData:', dir);
});

app.on('window-all-closed', (e) => {
  // Keep running in the tray.
  if (quitting) app.quit();
});
app.on('before-quit', () => { quitting = true; });
