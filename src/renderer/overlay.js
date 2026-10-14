'use strict';
(() => {
  const { ICONS, guessKind, levelClass, estimateText, escapeHtml, hexToRgb } = window.BT;
  const root = document.documentElement;
  const list = document.getElementById('list');
  const footer = document.getElementById('footer');
  const dot = document.getElementById('dot');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnSettings = document.getElementById('btn-settings');
  const btnHide = document.getElementById('btn-hide');
  btnRefresh.innerHTML = ICONS.refresh;
  btnSettings.innerHTML = ICONS.gear;
  btnHide.innerHTML = ICONS.minus;

  btnRefresh.addEventListener('click', async () => {
    btnRefresh.classList.add('spin');
    try { await window.api.refresh(); } finally { btnRefresh.classList.remove('spin'); }
  });
  btnSettings.addEventListener('click', () => window.api.openSettings());
  btnHide.addEventListener('click', () => window.api.hideOverlay());
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest('.header')) window.api.openSettings();
  });

  function applySettings(s) {
    root.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
    root.dataset.compact = s.compact ? 'true' : 'false';
    root.dataset.locked = s.locked ? 'true' : 'false';
    root.style.setProperty('--bg-alpha', String(Math.max(0, Math.min(1, Number(s.opacity)))));
    root.style.setProperty('--accent-rgb', hexToRgb(s.accent));
  }

  function renderDevice(d) {
    const kind = guessKind(d.name);
    const lvl = levelClass(d.battery);
    const charging = d.estimate && d.estimate.status === 'charging';
    const eta = estimateText(d);
    const pctHtml = d.battery === null
      ? `<div class="pct none">${d.connected ? '—' : '오프라인'}</div>`
      : `<div class="pct ${lvl}">${charging ? ICONS.bolt : ''}${d.battery}%</div>`;
    const barHtml = d.battery === null
      ? ''
      : `<div class="bar ${lvl}"><i style="width:${d.battery}%"></i></div>`;
    return `
      <div class="device ${d.connected ? '' : 'off'}" title="${escapeHtml(d.name)}${d.address ? ' · ' + escapeHtml(d.address) : ''}">
        <div class="icon">${ICONS[kind] || ICONS.bluetooth}</div>
        <div class="name">${escapeHtml(d.name)}</div>
        ${pctHtml}
        <div class="sub">${barHtml}<div class="eta ${charging ? 'charging' : ''}">${escapeHtml(eta)}</div></div>
      </div>`;
  }

  let lastHeight = 0;
  function syncHeight() {
    const h = document.getElementById('root').getBoundingClientRect().height;
    const rounded = Math.ceil(h);
    if (rounded !== lastHeight) {
      lastHeight = rounded;
      window.api.overlayResize(rounded);
    }
  }

  function render(state) {
    applySettings(state.settings);
    dot.classList.toggle('err', !!state.lastError);
    dot.title = state.lastError ? `오류: ${state.lastError}` : (state.lastPollAt ? `마지막 갱신 ${new Date(state.lastPollAt).toLocaleTimeString()}` : '');
    const devices = state.visible || [];
    if (devices.length === 0) {
      const anyDevice = (state.devices || []).length > 0;
      list.innerHTML = `<div class="empty">${
        state.lastError
          ? `<b>장치 정보를 가져오지 못했습니다.</b><br>${escapeHtml(state.lastError)}`
          : anyDevice
            ? `표시할 장치가 없습니다.<br><b>설정</b>에서 보여줄 장치를 선택하세요.`
            : state.lastPollAt
              ? `페어링된 Bluetooth 장치가 없습니다.`
              : `장치를 검색하는 중…`
      }<br><button id="btn-open-settings">설정 열기</button></div>`;
      const b = document.getElementById('btn-open-settings');
      if (b) b.addEventListener('click', () => window.api.openSettings());
    } else {
      list.innerHTML = devices.map(renderDevice).join('');
    }
    footer.textContent = state.lastPollAt ? `갱신 ${new Date(state.lastPollAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '';
    requestAnimationFrame(syncHeight);
  }

  window.api.onState(render);
  window.api.getState().then(render);
  new ResizeObserver(syncHeight).observe(document.getElementById('root'));
})();
