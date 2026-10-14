'use strict';
(() => {
  const { ICONS, guessKind, escapeHtml, estimateText } = window.BT;
  const $ = (s) => document.querySelector(s);
  let state = null;

  $('#wb-min').innerHTML = ICONS.minus;
  $('#wb-close').innerHTML = ICONS.close;
  $('#btn-refresh').innerHTML = ICONS.refresh;
  $('#wb-min').addEventListener('click', () => window.api.minimizeSettings());
  $('#wb-close').addEventListener('click', () => window.api.closeSettings());
  $('#btn-bt').addEventListener('click', () => window.api.openBluetoothSettings());
  $('#btn-quit').addEventListener('click', () => window.api.quit());
  $('#btn-clear').addEventListener('click', () => window.api.clearHistory());
  $('#btn-refresh').addEventListener('click', async () => {
    const b = $('#btn-refresh'); b.classList.add('spin');
    try { await window.api.refresh(); } finally { b.classList.remove('spin'); }
  });

  // Generic bindings: every control with data-key writes straight to settings.
  for (const el of document.querySelectorAll('[data-key]')) {
    const key = el.dataset.key;
    const scale = Number(el.dataset.scale || 1);
    const isNum = el.dataset.type === 'number' || el.type === 'range' || el.type === 'number';
    const ev = el.type === 'range' || el.type === 'color' ? 'input' : 'change';
    el.addEventListener(ev, () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (isNum) v = Number(el.value) / scale;
      else v = el.value;
      if (el.type === 'range') showRangeValue(el);
      window.api.setSettings({ [key]: v });
    });
  }
  function showRangeValue(el) {
    const out = document.getElementById('v-' + el.dataset.key);
    if (out) out.textContent = `${el.value}%`;
  }
  function fillControls(s) {
    for (const el of document.querySelectorAll('[data-key]')) {
      if (document.activeElement === el) continue; // don't fight the user
      const key = el.dataset.key;
      const scale = Number(el.dataset.scale || 1);
      const v = s[key];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'range') { el.value = Math.round(Number(v) * scale); showRangeValue(el); }
      else el.value = v === null || v === undefined ? '' : String(v);
    }
    document.documentElement.style.setProperty('--accent', s.accent || '#4ade80');
    document.documentElement.style.setProperty('--accent-rgb', window.BT.hexToRgb(s.accent));
  }

  function renderDevices(st) {
    const box = $('#devices');
    const sel = new Set(st.settings.selectedIds || []);
    const devs = st.devices || [];
    if (!devs.length) {
      box.innerHTML = `<div class="hint">${st.lastPollAt ? '페어링된 Bluetooth 장치를 찾지 못했습니다.' : '장치를 검색하는 중…'}</div>`;
    } else {
      box.innerHTML = devs.map(d => {
        const kind = guessKind(d.name);
        const checked = sel.has(d.id);
        const pct = d.battery === null
          ? `<div class="p none">${d.lastKnownBattery !== null && d.lastKnownBattery !== undefined ? '마지막 ' + d.lastKnownBattery + '%' : '배터리 없음'}</div>`
          : `<div class="p">${d.battery}%</div>`;
        return `<label class="dev ${checked ? 'sel' : ''} ${d.connected ? 'on' : ''}" data-id="${escapeHtml(d.id)}">
          <input type="checkbox" ${checked ? 'checked' : ''}>
          <div class="ic">${ICONS[kind] || ICONS.bluetooth}</div>
          <div><div class="n">${escapeHtml(d.name)}</div>
            <div class="s"><b class="${d.connected ? '' : 'off'}">${d.connected ? '연결됨' : '연결 안 됨'}</b>${d.battery !== null ? ' · ' + escapeHtml(estimateText(d)) : ''}${d.le ? ' · LE' : ''}</div></div>
          ${pct}
        </label>`;
      }).join('');
      for (const el of box.querySelectorAll('.dev input')) {
        el.addEventListener('change', () => {
          const id = el.closest('.dev').dataset.id;
          const ids = new Set(state.settings.selectedIds || []);
          if (el.checked) ids.add(id); else ids.delete(id);
          window.api.setSettings({ selectedIds: [...ids] });
        });
      }
    }
    const noBat = devs.filter(d => d.battery === null && d.connected).map(d => d.name);
    $('#dev-hint').innerHTML = (sel.size === 0
      ? '아무것도 선택하지 않으면 <b>배터리를 보고하는 연결된 장치</b>가 모두 표시됩니다. '
      : `선택한 ${sel.size}개 장치만 오버레이에 표시됩니다. `)
      + (noBat.length ? `<br><b>${escapeHtml(noBat.join(', '))}</b>은(는) Windows에 배터리 정보를 보고하지 않아 % 표시가 불가능합니다. (제조사 전용 소프트웨어에서만 확인 가능)` : '');
    $('#err').textContent = st.lastError ? `오류: ${st.lastError}` : '';
  }

  function render(st) {
    state = st;
    fillControls(st.settings);
    renderDevices(st);
    $('#ver').textContent = `v${st.version}`;
  }

  window.api.onState(render);
  window.api.getState().then(render);
})();
