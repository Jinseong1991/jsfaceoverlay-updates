/* 툰헬퍼 UI. 모든 탭은 state 객체 하나를 읽고 쓴다 (01-overview §5). 그림은 저장하지 않고 선택값만 저장한다. */
(function () {
  "use strict";
  const K = window.ToonHelper, TOPICS = window.TH_TOPICS, BEATS = window.TH_BEATS, PARTS = window.TH_PARTS,
    PRESETS = window.TH_PRESETS, PRESET_LIST = window.TH_PRESET_LIST, BG_BY_PLACE = window.TH_BG_BY_PLACE;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // roundRect 폴리필 (구형 브라우저)
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2); this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
    };
  }

  /* ───────── 상태 ───────── */
  const SLOT_KEYS = ["장소", "인물", "사건", "감정", "반전", "톤"];
  const DEFAULT = () => ({
    v: 1, seed: 1 + Math.floor(Math.random() * 99999), topicCount: 0, storyCount: 0,
    topic: null, locks: {}, userSlots: {}, history: [],
    story: { cuts: 4, beats: [] },
    characters: [], main: 0, selChar: 0,
    cuts: [], selCut: 0,
    preview: { ratio: "4:5", caption: "", username: "my_toon", showNumber: false, guide: false },
    settings: { watermark: "", aiModel: "claude-sonnet-5-5" }
  });
  const store = K.makeStore("toonhelper:project:v1");
  const favStore = K.makeStore("toonhelper:favorites:v1");
  let state = Object.assign(DEFAULT(), store.load({}));
  state.preview = Object.assign(DEFAULT().preview, state.preview || {});
  state.settings = Object.assign(DEFAULT().settings, state.settings || {});
  state.story = Object.assign(DEFAULT().story, state.story || {});
  let favorites = favStore.load([]);
  let previewUrls = [];           // 미리보기용 캐시 (저장 안 함)

  function save() {
    store.autosave(state, ok => { const s = $("saveStatus"); s.textContent = ok ? "자동 저장됨 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "저장 실패 (저장소 차단)"; s.className = "status " + (ok ? "ok" : ""); });
  }
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 1800); }

  /* ───────── 탭 ───────── */
  function showTab(name) {
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
    document.querySelectorAll("main .tab").forEach(s => s.classList.toggle("on", s.id === "tab-" + name));
    if (name === "cut") { renderCutStrip(); renderCutEditor(); }
    if (name === "preview") refreshPreview();
    if (name === "ai") renderAi();
    if (name === "settings") renderSettings();
    if (name === "story") renderStory();
    if (name === "char") renderChars();
    try { location.hash = name; } catch (e) {}
  }
  $("tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });

  /* ───────── ① 소재 ───────── */
  let gen;
  function topicData() { return { slots: K.mergeSlots(TOPICS.slots, state.userSlots), templates: TOPICS.templates }; }
  function rebuildGen() { gen = K.makeTopicGenerator(topicData(), { seed: state.seed, count: state.topicCount }); }
  rebuildGen();

  function pickTopic() {
    const t = gen(state.locks);
    state.topicCount = t.id.count + 1;
    setTopic(t, true);
  }
  function setTopic(t, pushHistory) {
    state.topic = t;
    if (pushHistory) { state.history.unshift({ text: t.text, chosen: t.chosen, tone: t.tone, id: t.id }); state.history = state.history.slice(0, 20); }
    renderTopic(); save();
  }
  function renderTopic() {
    const t = state.topic;
    $("topicText").textContent = t ? t.text : "아래 버튼을 눌러 소재를 뽑으세요.";
    $("topicTone").textContent = t ? t.tone : "";
    $("topicId").textContent = t && t.id ? "#" + t.id.seed + "-" + t.id.count : "";
    $("topicCount").textContent = "조합 수 약 " + K.combinationCountTopics(topicData()).toLocaleString("ko-KR") + "가지";
    renderSlots(); renderHistory(); renderFavs(); renderUserSlots();
  }
  function renderSlots() {
    const box = $("slots"); box.innerHTML = "";
    const slots = topicData().slots;
    SLOT_KEYS.forEach(k => {
      const locked = state.locks[k] != null && state.locks[k] !== "";
      const cur = state.topic ? state.topic.chosen[k] : "";
      const d = el("div", "slot" + (locked ? " locked" : ""));
      const head = el("div", "k"); head.appendChild(el("span", null, k + (locked ? " 🔒" : "")));
      const lockBtn = el("button", null, locked ? "풀기" : "현재 값 고정"); lockBtn.title = "현재 값으로 고정";
      lockBtn.onclick = () => { if (locked) delete state.locks[k]; else if (cur) state.locks[k] = cur; renderSlots(); save(); };
      head.appendChild(lockBtn); d.appendChild(head);
      const sel = el("select"); sel.appendChild(new Option("— 랜덤 —" + (cur && !locked ? "  (지금: " + cur + ")" : ""), ""));
      (slots[k] || []).forEach(x => sel.appendChild(new Option(x.text + (x.user ? " ✎" : ""), x.text)));
      sel.value = locked ? state.locks[k] : "";
      sel.onchange = () => { if (sel.value) state.locks[k] = sel.value; else delete state.locks[k]; renderSlots(); save(); };
      d.appendChild(sel); box.appendChild(d);
    });
  }
  function renderHistory() {
    const ul = $("historyList"); ul.innerHTML = "";
    if (!state.history.length) ul.appendChild(el("li", "empty", "아직 없음"));
    state.history.forEach(h => {
      const li = el("li"); li.appendChild(el("span", null, h.text)); li.title = h.text;
      li.onclick = () => { setTopic(h, false); toast("소재를 불러왔습니다"); }; ul.appendChild(li);
    });
  }
  function renderFavs() {
    const ul = $("favList"); ul.innerHTML = "";
    if (!favorites.length) ul.appendChild(el("li", "empty", "☆ 버튼으로 추가"));
    favorites.forEach((f, i) => {
      const li = el("li"); li.appendChild(el("span", null, f.text)); li.title = f.text;
      const del = el("button", null, "✕"); del.onclick = e => { e.stopPropagation(); favorites.splice(i, 1); favStore.save(favorites); renderFavs(); };
      li.onclick = () => { setTopic(f, false); toast("즐겨찾기를 불러왔습니다"); }; li.appendChild(del); ul.appendChild(li);
    });
  }
  function renderUserSlots() {
    const sel = $("userSlotKey"); if (!sel.options.length) SLOT_KEYS.filter(k => k !== "톤").forEach(k => sel.appendChild(new Option(k, k)));
    const ul = $("userSlotList"); ul.innerHTML = "";
    const entries = []; Object.keys(state.userSlots).forEach(k => (state.userSlots[k] || []).forEach((t, i) => entries.push({ k, t, i })));
    if (!entries.length) ul.appendChild(el("li", "empty", "추가한 후보가 여기에 표시됩니다"));
    entries.forEach(e => {
      const li = el("li"); li.style.cursor = "default"; li.appendChild(el("span", null, "[" + e.k + "] " + e.t));
      const del = el("button", null, "✕"); del.onclick = () => { state.userSlots[e.k].splice(e.i, 1); rebuildGen(); renderTopic(); save(); };
      li.appendChild(del); ul.appendChild(li);
    });
  }
  $("bTopic").onclick = pickTopic;
  $("bTopicCopy").onclick = () => { if (state.topic) K.copyText(state.topic.text).then(() => toast("복사했습니다")); };
  $("bTopicFav").onclick = () => {
    if (!state.topic) return;
    if (favorites.some(f => f.text === state.topic.text)) return toast("이미 즐겨찾기에 있습니다");
    favorites.unshift({ text: state.topic.text, chosen: state.topic.chosen, tone: state.topic.tone, id: state.topic.id, at: Date.now() });
    favorites = favorites.slice(0, 200); favStore.save(favorites); renderFavs(); toast("즐겨찾기에 추가했습니다");
  };
  $("bTopicToStory").onclick = () => { if (!state.topic) pickTopic(); makeStory(); showTab("story"); };
  $("bLockAll").onclick = () => { if (!state.topic) return; SLOT_KEYS.forEach(k => { if (state.topic.chosen[k]) state.locks[k] = state.topic.chosen[k]; }); renderSlots(); save(); };
  $("bUnlockAll").onclick = () => { state.locks = {}; renderSlots(); save(); };
  $("bUserSlotAdd").onclick = () => {
    const k = $("userSlotKey").value, t = $("userSlotText").value.trim(); if (!t) return;
    (state.userSlots[k] = state.userSlots[k] || []).push(t); $("userSlotText").value = "";
    rebuildGen(); renderTopic(); save(); toast("[" + k + "] 후보에 추가했습니다");
  };
  $("userSlotText").addEventListener("keydown", e => { if (e.key === "Enter") $("bUserSlotAdd").onclick(); });

  /* ───────── ② 스토리 ───────── */
  function makeStory() {
    if (!state.topic) return;
    const tone = BEATS.tones[state.topic.tone];
    if (!state.story.userCuts && tone) state.story.cuts = tone.cuts;
    state.storyCount++;
    state.story.beats = K.storyboard(state.topic, BEATS, { cuts: state.story.cuts, seed: state.seed, count: state.storyCount });
    renderStory(); save();
  }
  function renderStory() {
    $("storyTopic").textContent = state.topic ? state.topic.text + "  · " + state.topic.tone : "먼저 소재를 뽑으세요.";
    document.querySelectorAll("#cutsSeg button").forEach(b => b.classList.toggle("on", +b.dataset.cuts === state.story.cuts));
    const box = $("beats"); box.innerHTML = "";
    if (!state.story.beats.length) { box.appendChild(el("p", "muted", "컷 수를 고르고 '콘티 생성'을 누르세요.")); return; }
    state.story.beats.forEach((b, i) => {
      const card = el("div", "beat");
      const head = el("div", "head"); head.appendChild(el("span", "no", String(i + 1)));
      head.appendChild(el("span", "role", b.role)); head.appendChild(el("span", "goal", b.goal || ""));
      const shot = el("select"); ["풀샷", "바스트샷", "클로즈업", "풀샷·침묵컷", "표지"].forEach(s => shot.appendChild(new Option(s, s)));
      shot.value = b.shot; shot.onchange = () => { b.shot = shot.value; syncCutFromBeat(i); save(); }; head.appendChild(shot);
      card.appendChild(head);
      const line = el("input"); line.value = b.line; line.placeholder = "대사";
      line.oninput = () => { b.line = line.value; syncCutFromBeat(i); save(); }; card.appendChild(line);
      card.appendChild(el("div", "hint", "연출: " + (b.hint || "")));
      const tools = el("div", "tools");
      const re = el("button", null, "대사 다시"); re.onclick = () => { b.line = K.rerollLine(b, state.topic, BEATS, state.story.cuts, state.seed + i); line.value = b.line; syncCutFromBeat(i); save(); };
      const up = el("button", null, "↑"); up.disabled = i === 0; up.onclick = () => moveBeat(i, -1);
      const dn = el("button", null, "↓"); dn.disabled = i === state.story.beats.length - 1; dn.onclick = () => moveBeat(i, 1);
      const cp = el("button", null, "복사"); cp.onclick = () => K.copyText(storyText()).then(() => toast("콘티 전체를 복사했습니다"));
      [re, up, dn, cp].forEach(x => tools.appendChild(x)); card.appendChild(tools);
      box.appendChild(card);
    });
  }
  function moveBeat(i, d) {
    const a = state.story.beats; const j = i + d; if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; a.forEach((b, n) => b.cut = n + 1);
    if (state.cuts[i] && state.cuts[j]) { [state.cuts[i], state.cuts[j]] = [state.cuts[j], state.cuts[i]]; }
    renderStory(); save();
  }
  function storyText() { return state.story.beats.map(b => b.cut + "컷 [" + b.role + " · " + b.shot + "] " + b.line + "\n   → " + b.hint).join("\n"); }
  function syncCutFromBeat(i) { const c = state.cuts[i]; if (!c) return; c.bubble.text = state.story.beats[i].line; c.char.shot = state.story.beats[i].shot; }
  $("cutsSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; state.story.cuts = +b.dataset.cuts; state.story.userCuts = true; if (state.topic) makeStory(); else renderStory(); });
  $("bStory").onclick = () => { if (!state.topic) { pickTopic(); } makeStory(); };
  $("bStoryToCut").onclick = () => { if (!state.story.beats.length) makeStory(); buildCutsFromStory(false); showTab("cut"); };

  /* ───────── ③ 캐릭터 ───────── */
  function ensureChars() { if (!state.characters.length) { const r = K.rng(state.seed * 13 + 7); state.characters = Array.from({ length: 8 }, () => K.randomCharacter(PARTS, r)); state.main = 0; state.selChar = 0; } }
  function renderChars() {
    ensureChars();
    $("partsCount").textContent = "조합 수 " + K.combinationCountParts(PARTS).toLocaleString("ko-KR") + "가지";
    const box = $("chars"); box.innerHTML = "";
    state.characters.forEach((c, i) => {
      const d = el("div", "c" + (i === state.selChar ? " sel" : "") + (i === state.main ? " main" : ""));
      d.innerHTML = K.characterSVG(PARTS, c); d.appendChild(el("div", null, c.name || "이름 없음"));
      d.onclick = () => { state.selChar = i; renderChars(); save(); };
      d.ondblclick = () => { state.main = i; renderChars(); save(); toast("주인공으로 지정했습니다"); };
      box.appendChild(d);
    });
    renderCharEditor();
  }
  function renderCharEditor() {
    const c = state.characters[state.selChar]; const ed = $("charEditor"); if (!c) { ed.style.display = "none"; return; } ed.style.display = "";
    $("charName").value = c.name || "";
    $("charBig").innerHTML = K.characterSVG(PARTS, c);
    const ex = $("charExprs"); ex.innerHTML = "";
    PARTS.exprs.forEach(e => { const d = el("div"); d.innerHTML = K.characterSVG(PARTS, c, { expr: e.id }); d.appendChild(el("span", null, e.label)); ex.appendChild(d); });
    const ls = $("charLayers"); ls.innerHTML = "";
    PARTS.layers.forEach(layer => {
      const row = el("div", "layer"); row.appendChild(el("b", null, PARTS.layerLabels[layer] || layer));
      const prev = el("button", null, "‹"); prev.onclick = () => { state.characters[state.selChar] = K.cycleLayer(PARTS, c, layer, -1); renderChars(); save(); };
      const part = PARTS.parts[layer].find(p => p.id === c[layer]) || PARTS.parts[layer][0];
      const name = el("span", null, part.label || part.id);
      const next = el("button", null, "›"); next.onclick = () => { state.characters[state.selChar] = K.cycleLayer(PARTS, c, layer, 1); renderChars(); save(); };
      row.appendChild(prev); row.appendChild(name); row.appendChild(next); ls.appendChild(row);
    });
    const ps = $("charPalettes"); ps.innerHTML = "";
    Object.keys(PARTS.palettes).forEach(k => {
      const row = el("div", "pal"); row.appendChild(el("b", null, PARTS.paletteLabels[k] || k));
      PARTS.palettes[k].forEach(col => { const s = el("span", "sw" + (c.colors[k] === col ? " on" : "")); s.style.background = col; s.onclick = () => { c.colors[k] = col; renderChars(); save(); }; row.appendChild(s); });
      const pick = el("input"); pick.type = "color"; pick.value = c.colors[k] || "#000000"; pick.oninput = () => { c.colors[k] = pick.value; $("charBig").innerHTML = K.characterSVG(PARTS, c); }; pick.onchange = () => { renderChars(); save(); };
      row.appendChild(pick); ps.appendChild(row);
    });
  }
  $("charName").oninput = () => { const c = state.characters[state.selChar]; if (c) { c.name = $("charName").value; save(); } };
  $("charName").onchange = renderChars;
  $("bChars").onclick = () => { const r = K.rng(Date.now() & 0xfffff); state.characters = Array.from({ length: 8 }, () => K.randomCharacter(PARTS, r)); state.main = 0; state.selChar = 0; renderChars(); save(); };
  $("bCharAdd").onclick = () => { state.characters.push(K.randomCharacter(PARTS, K.rng(Date.now() & 0xfffff))); state.selChar = state.characters.length - 1; renderChars(); save(); };
  $("bCharMain").onclick = () => { state.main = state.selChar; renderChars(); save(); toast("주인공으로 지정했습니다"); };
  $("bCharDup").onclick = () => { const c = state.characters[state.selChar]; if (!c) return; state.characters.splice(state.selChar + 1, 0, JSON.parse(JSON.stringify(c))); state.selChar++; renderChars(); save(); };
  $("bCharDel").onclick = () => {
    if (state.characters.length <= 1) return toast("최소 한 명은 필요합니다");
    state.characters.splice(state.selChar, 1); if (state.main >= state.characters.length) state.main = 0; if (state.main > state.selChar) state.main--;
    state.selChar = Math.max(0, state.selChar - 1); renderChars(); save();
  };
  $("bCharRandom").onclick = () => { const c = state.characters[state.selChar]; const n = K.randomCharacter(PARTS, K.rng(Date.now() & 0xfffff)); n.name = c.name; state.characters[state.selChar] = n; renderChars(); save(); };

  /* ───────── ④ 시안 ───────── */
  const SIZE = () => K.IG.ratios[state.preview.ratio] || K.IG.ratios["4:5"];
  function autoCut(beat, i) {
    const st = BEATS.styleByRole[beat.role] || { bubble: "round", fx: [] };
    const place = state.topic ? state.topic.chosen["장소"] : "";
    const isCover = beat.role === "표지" || beat.role === "공감 요청";
    return {
      bg: { type: "preset", id: st.bg || BG_BY_PLACE[place] || "room" },
      char: { ref: state.main, expr: BEATS.exprByRole[beat.role] || "basic", shot: beat.shot, x: 540, y: 800, scale: 0, flip: false },
      bubble: { text: beat.line, style: st.bubble || "round", x: isCover ? 80 : 90, y: isCover ? 120 : 110, fontSize: isCover ? 60 : 36, tail: st.bubble !== "none" },
      fx: { speedlines: st.fx.indexOf("speedlines") >= 0, sparkles: st.fx.indexOf("sparkles") >= 0, sweat: st.fx.indexOf("sweat") >= 0 },
      sfx: { text: beat.role === "반전" ? "헉!" : (beat.role === "위기" ? "두근" : ""), size: 140 },
      caption: st.caption && state.topic ? state.topic.text : "",
      number: i + 1
    };
  }
  function buildCutsFromStory(force) {
    ensureChars();
    if (!state.story.beats.length) { if (state.topic) makeStory(); if (!state.story.beats.length) return; }
    if (state.cuts.length && !force) {
      // 기존 편집을 보존하되 컷 수가 바뀌었으면 맞춘다
      state.cuts = state.story.beats.map((b, i) => state.cuts[i] || autoCut(b, i));
      state.cuts.forEach((c, i) => c.number = i + 1);
    } else state.cuts = state.story.beats.map(autoCut);
    state.selCut = Math.min(state.selCut, state.cuts.length - 1); save();
  }
  // state.cuts[i] → 엔진이 그리는 컷 객체
  function toEngineCut(c, guide) {
    const [W, H] = SIZE(); const sx = W / 1080, sy = H / 1350;
    const cx = Math.round(c.char.x * sx), cy = Math.round(c.char.y * sy);
    const chars = state.characters[c.char.ref] ? [{ ref: "main", expr: c.char.expr, shot: c.char.shot, x: cx, y: cy, scale: c.char.scale || undefined, flip: c.char.flip }] : [];
    const fx = [];
    if (c.fx.speedlines) fx.push({ type: "speedlines", cx, cy: cy - 60 });
    if (c.fx.sparkles) fx.push({ type: "sparkles", cx, cy: cy - 100, seed: c.number });
    if (c.fx.sweat) fx.push({ type: "sweat", cx: cx + 150, cy: cy - 220 });
    if (c.sfx && c.sfx.text) fx.push({ type: "sfx", text: c.sfx.text, size: c.sfx.size, x: Math.min(W - 160, cx + 300), y: Math.max(160, cy - 320), angle: -10 });
    const bubble = { text: c.bubble.text, style: c.bubble.style, x: Math.round(c.bubble.x * sx), y: Math.round(c.bubble.y * sy), maxW: W - Math.round(c.bubble.x * sx) - 60, fontSize: c.bubble.fontSize,
      tail: c.bubble.tail && c.bubble.style !== "none" ? [cx - 40, cy - 150] : null };
    return { size: [W, H], bg: c.bg, chars, fx, bubbles: bubble.text ? [bubble] : [], caption: { text: c.caption }, number: state.preview.showNumber ? c.number : 0 };
  }
  function charMap() { return { main: state.characters[(state.cuts[state.selCut] || {}).char ? state.cuts[state.selCut].char.ref : state.main] || state.characters[state.main] }; }
  async function renderCanvas(canvas, cut, guide) {
    const chars = { main: state.characters[cut.char.ref] || state.characters[state.main] };
    return K.renderCut(canvas, toEngineCut(cut), chars, PARTS, PRESETS, { guide, watermark: state.settings.watermark });
  }
  let renderT;
  function renderMainCanvas() {
    clearTimeout(renderT);
    renderT = setTimeout(async () => {
      const c = state.cuts[state.selCut]; if (!c) return;
      await renderCanvas($("cv"), c, state.preview.guide);
      const [W, H] = SIZE(); $("cvInfo").textContent = W + "×" + H + " (" + state.preview.ratio + ")";
      const t = document.querySelectorAll("#cutStrip .t img")[state.selCut]; if (t) t.src = $("cv").toDataURL("image/jpeg", 0.6);
    }, 40);
  }
  function renderCutStrip() {
    const s = $("cutStrip"); s.innerHTML = "";
    document.querySelectorAll("#ratioSeg button").forEach(b => b.classList.toggle("on", b.dataset.ratio === state.preview.ratio));
    $("cutGuide").checked = !!state.preview.guide; $("cutNumber").checked = !!state.preview.showNumber;
    if (!state.cuts.length) { s.appendChild(el("span", "muted small", "콘티가 있으면 '콘티에서 컷 자동 생성'을 누르세요. 콘티가 없으면 자동으로 만듭니다.")); return; }
    state.cuts.forEach((c, i) => {
      const t = el("div", "t" + (i === state.selCut ? " on" : "")); const img = new Image(); t.appendChild(img);
      t.appendChild(el("div", null, (i + 1) + " " + ((state.story.beats[i] || {}).role || "")));
      t.onclick = () => { state.selCut = i; renderCutStrip(); renderCutEditor(); save(); }; s.appendChild(t);
      const off = document.createElement("canvas"); renderCanvas(off, c, false).then(() => { img.src = off.toDataURL("image/jpeg", 0.6); });
    });
  }
  function fillSelect(sel, items, value) { sel.innerHTML = ""; items.forEach(x => sel.appendChild(new Option(x.label, x.id))); sel.value = value; }
  function renderCutEditor() {
    const c = state.cuts[state.selCut]; const ed = $("cutEditor"); if (!c) { ed.style.display = "none"; return; } ed.style.display = "";
    const beat = state.story.beats[state.selCut] || {};
    $("cutNo").textContent = state.selCut + 1; $("cutRole").textContent = beat.role ? beat.role + " · " + (beat.hint || "") : "";
    fillSelect($("cBg"), PRESET_LIST, c.bg.id);
    fillSelect($("cChar"), state.characters.map((ch, i) => ({ id: String(i), label: (ch.name || "캐릭터 " + (i + 1)) + (i === state.main ? " ★" : "") })), String(c.char.ref));
    fillSelect($("cExpr"), PARTS.exprs, c.char.expr);
    $("cShot").value = c.char.shot; $("cX").value = c.char.x; $("cY").value = c.char.y; $("cScale").value = c.char.scale || (K.SHOT[c.char.shot] || { scale: 1 }).scale; $("cFlip").checked = !!c.char.flip;
    $("cText").value = c.bubble.text; $("cStyle").value = c.bubble.style; $("cBx").value = c.bubble.x; $("cBy").value = c.bubble.y; $("cFont").value = c.bubble.fontSize; $("cTail").checked = !!c.bubble.tail;
    $("cFxSpeed").checked = !!c.fx.speedlines; $("cFxSpark").checked = !!c.fx.sparkles; $("cFxSweat").checked = !!c.fx.sweat;
    $("cSfx").value = (c.sfx && c.sfx.text) || ""; $("cSfxSize").value = (c.sfx && c.sfx.size) || 140; $("cCaption").value = c.caption || "";
    renderMainCanvas();
  }
  function bindCut(id, fn, evt) { $(id).addEventListener(evt || "input", () => { const c = state.cuts[state.selCut]; if (!c) return; fn(c, $(id)); renderMainCanvas(); save(); }); }
  bindCut("cBg", (c, e) => c.bg = { type: "preset", id: e.value }, "change");
  bindCut("cChar", (c, e) => c.char.ref = +e.value, "change");
  bindCut("cExpr", (c, e) => c.char.expr = e.value, "change");
  bindCut("cShot", (c, e) => { c.char.shot = e.value; c.char.scale = 0; $("cScale").value = (K.SHOT[e.value] || { scale: 1 }).scale; if (state.story.beats[state.selCut]) state.story.beats[state.selCut].shot = e.value; }, "change");
  bindCut("cX", (c, e) => c.char.x = +e.value); bindCut("cY", (c, e) => c.char.y = +e.value); bindCut("cScale", (c, e) => c.char.scale = +e.value);
  bindCut("cFlip", (c, e) => c.char.flip = e.checked, "change");
  bindCut("cText", (c, e) => { c.bubble.text = e.value; if (state.story.beats[state.selCut]) state.story.beats[state.selCut].line = e.value; });
  bindCut("cStyle", (c, e) => c.bubble.style = e.value, "change");
  bindCut("cBx", (c, e) => c.bubble.x = +e.value); bindCut("cBy", (c, e) => c.bubble.y = +e.value); bindCut("cFont", (c, e) => c.bubble.fontSize = +e.value);
  bindCut("cTail", (c, e) => c.bubble.tail = e.checked, "change");
  bindCut("cFxSpeed", (c, e) => c.fx.speedlines = e.checked, "change"); bindCut("cFxSpark", (c, e) => c.fx.sparkles = e.checked, "change"); bindCut("cFxSweat", (c, e) => c.fx.sweat = e.checked, "change");
  bindCut("cSfx", (c, e) => { c.sfx = c.sfx || {}; c.sfx.text = e.value; }); bindCut("cSfxSize", (c, e) => { c.sfx = c.sfx || {}; c.sfx.size = +e.value; });
  bindCut("cCaption", (c, e) => c.caption = e.value);
  $("bCutReset").onclick = () => { const b = state.story.beats[state.selCut]; if (!b) return; state.cuts[state.selCut] = autoCut(b, state.selCut); renderCutEditor(); save(); };
  $("bCutsFromStory").onclick = () => {
    if (state.cuts.length && !confirm("기존 시안 편집을 버리고 콘티대로 다시 만들까요?")) return;
    if (!state.topic) pickTopic(); buildCutsFromStory(true); renderCutStrip(); renderCutEditor(); toast(state.cuts.length + "컷을 만들었습니다");
  };
  $("ratioSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; state.preview.ratio = b.dataset.ratio; renderCutStrip(); renderMainCanvas(); save(); });
  $("cutGuide").onchange = () => { state.preview.guide = $("cutGuide").checked; renderMainCanvas(); save(); };
  $("cutNumber").onchange = () => { state.preview.showNumber = $("cutNumber").checked; renderCutStrip(); renderMainCanvas(); save(); };
  function fileName(i) { return "toonhelper_" + String(i + 1).padStart(2, "0") + ".png"; }   // 한글 파일명은 file:// 에서 버려진다
  $("bCutPng").onclick = async () => { const c = state.cuts[state.selCut]; if (!c) return; const off = document.createElement("canvas"); await renderCanvas(off, c, false); K.downloadCanvas(off, fileName(state.selCut)); };
  $("bCutPngAll").onclick = async () => {
    if (!state.cuts.length) return;
    toast(state.cuts.length + "장을 저장합니다. 브라우저가 '여러 파일 다운로드'를 물으면 허용하세요.");
    for (let i = 0; i < state.cuts.length; i++) {
      const off = document.createElement("canvas"); await renderCanvas(off, state.cuts[i], false);
      K.downloadCanvas(off, fileName(i));
      await new Promise(r => setTimeout(r, 350));
    }
  };
  $("bCutToPreview").onclick = () => showTab("preview");

  /* ───────── ⑤ 미리보기 ───────── */
  let pvIndex = 0;
  async function refreshPreview() {
    document.querySelectorAll("#pvRatioSeg button").forEach(b => b.classList.toggle("on", b.dataset.ratio === state.preview.ratio));
    $("pvUser").value = state.preview.username; $("pvUserName").textContent = $("pvUserName2").textContent = state.preview.username || "my_toon";
    $("pvAvatar").innerHTML = state.characters[state.main] ? K.characterSVG(PARTS, state.characters[state.main], { expr: "smile" }) : "";
    $("cap").value = state.preview.caption; capCheck();
    if (!state.cuts.length) buildCutsFromStory(false);
    previewUrls = [];
    for (const c of state.cuts) { const off = document.createElement("canvas"); await renderCanvas(off, c, false); previewUrls.push(off.toDataURL("image/jpeg", 0.85)); }
    pvIndex = Math.min(pvIndex, Math.max(0, previewUrls.length - 1));
    renderPost(); renderFeed();
  }
  function renderPost() {
    const f = $("pvFrame"); f.className = "ig-frame " + ({ "4:5": "r45", "1:1": "r11", "9:16": "r916" }[state.preview.ratio] || "r45");
    $("pvImg").src = previewUrls[pvIndex] || ""; $("pvCount").textContent = previewUrls.length ? (pvIndex + 1) + "/" + previewUrls.length : "";
    const dots = $("pvDots"); dots.innerHTML = ""; previewUrls.forEach((_, i) => dots.appendChild(el("i", i === pvIndex ? "on" : "")));
    $("pvPrev").style.display = $("pvNext").style.display = previewUrls.length > 1 ? "" : "none";
  }
  function renderFeed() {
    const box = $("feed"); box.innerHTML = "";
    for (let i = 0; i < 9; i++) { const cell = el("div"); if (previewUrls[i]) { const im = new Image(); im.src = previewUrls[i]; im.alt = ""; cell.appendChild(im); } box.appendChild(cell); }
  }
  function capCheck() {
    const c = K.checkCaption($("cap").value); const box = $("capInfo"); box.innerHTML = "";
    const add = (t, cls) => box.appendChild(el("span", cls || "", t));
    add("글자 " + c.length + "/" + K.IG.captionMax, c.over ? "bad" : "");
    add("해시태그 " + c.hashtags + "/" + K.IG.hashtagMax + (c.dupHashtags ? " (중복 " + c.dupHashtags + ")" : ""), c.hashtagOver || c.dupHashtags ? "bad" : "");
    add(c.folded ? "125자 이후 '더 보기'로 접힘" : "접힘 없음", c.folded ? "" : "good");
    add("첫 줄: " + (c.firstLine || "(비어 있음)") + (c.firstLineLong ? " … 길어요" : ""), c.firstLine ? "" : "bad");
    add(c.hasQuestion ? "댓글 유도 문장 있음" : "질문·댓글 유도 문장을 넣어 보세요", c.hasQuestion ? "good" : "");
    $("pvCaption").textContent = c.folded || $("cap").value; $("pvMore").hidden = !c.folded;
  }
  $("cap").oninput = () => { state.preview.caption = $("cap").value; capCheck(); save(); };
  $("pvMore").onclick = () => { $("pvCaption").textContent = $("cap").value; $("pvMore").hidden = true; };
  $("pvUser").oninput = () => { state.preview.username = $("pvUser").value; $("pvUserName").textContent = $("pvUserName2").textContent = state.preview.username || "my_toon"; save(); };
  $("pvPrev").onclick = () => { pvIndex = (pvIndex - 1 + previewUrls.length) % previewUrls.length; renderPost(); };
  $("pvNext").onclick = () => { pvIndex = (pvIndex + 1) % previewUrls.length; renderPost(); };
  $("pvRatioSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; state.preview.ratio = b.dataset.ratio; save(); refreshPreview(); });
  $("bPvRefresh").onclick = refreshPreview;
  $("bHashtag").onclick = () => {
    const tags = new Set(TOPICS.baseTags.slice(0, 5));
    if (state.topic) Object.keys(state.topic.chosen).forEach(k => (TOPICS.tags[k + "/" + state.topic.chosen[k]] || []).forEach(t => tags.add(t)));
    const r = K.rng(Date.now() & 0xffff); TOPICS.baseTags.slice(5).forEach(t => { if (r() < 0.5) tags.add(t); });
    const cur = $("cap").value.replace(/\s*$/, "");
    const have = new Set((cur.match(/#[^\s#]+/g) || []).map(h => h.slice(1).toLowerCase()));
    const line = Array.from(tags).filter(t => !have.has(t.toLowerCase())).slice(0, 20).map(t => "#" + t).join(" ");
    if (!line) return toast("추천할 새 해시태그가 없습니다");
    $("cap").value = (cur ? cur + "\n\n" : "") + line; $("cap").oninput();
  };
  $("bCapCopy").onclick = () => K.copyText($("cap").value).then(() => toast("캡션을 복사했습니다"));

  /* ───────── AI ───────── */
  function renderAi() {
    $("aiStoryPrompt").value = state.topic ? K.buildStoryPrompt(state.topic, state.story.beats, { cuts: state.story.cuts }) : "먼저 소재를 뽑으세요.";
    const ch = state.characters[state.main]; const b = state.story.beats[state.selCut] || state.story.beats[0];
    $("aiImagePrompt").value = ch ? K.buildImagePrompt(ch, b ? { expr: BEATS.exprByRole[b.role] || "basic", shot: b.shot, line: b.line } : null, PARTS) : "먼저 캐릭터를 만드세요.";
    $("aiKey").value = K.getKey(); $("aiModel").value = state.settings.aiModel;
  }
  function applyReply(text, msgEl) {
    const beats = K.parseStoryReply(text, state.story.beats);
    if (!beats) { msgEl.textContent = "컷 줄을 찾지 못했습니다. '1 | 역할 | 샷 | 대사 | 지시' 형식인지 확인하세요."; return; }
    state.story.beats = beats; state.story.cuts = beats.length; state.story.userCuts = true;
    state.cuts = []; buildCutsFromStory(true); renderStory(); save();
    msgEl.textContent = beats.length + "컷을 콘티에 반영했습니다. ② 스토리 탭에서 확인하세요."; toast("콘티에 반영했습니다");
  }
  $("bAiCopyStory").onclick = () => K.copyText($("aiStoryPrompt").value).then(() => toast("프롬프트를 복사했습니다"));
  $("bAiCopyImage").onclick = () => K.copyText($("aiImagePrompt").value).then(() => toast("프롬프트를 복사했습니다"));
  $("bAiApply").onclick = () => applyReply($("aiReply").value, $("aiApplyMsg"));
  $("bAiResultApply").onclick = () => applyReply($("aiResult").value, $("aiStatus"));
  $("bAiKeySave").onclick = () => { K.setKey($("aiKey").value.trim()); toast("키를 이 브라우저에 저장했습니다"); };
  $("bAiKeyDel").onclick = () => { K.setKey(""); $("aiKey").value = ""; toast("키를 삭제했습니다"); };
  $("aiModel").onchange = () => { state.settings.aiModel = $("aiModel").value; save(); };
  $("bAiRun").onclick = async () => {
    if (!state.topic) return toast("먼저 소재를 뽑으세요");
    const st = $("aiStatus"); st.textContent = "요청 중…"; $("bAiRun").disabled = true;
    try { $("aiResult").value = await K.askClaude($("aiStoryPrompt").value, { key: $("aiKey").value.trim(), model: state.settings.aiModel }); st.textContent = "완료. 결과를 확인하고 '콘티에 반영'을 누르세요."; }
    catch (e) { st.textContent = "실패: " + e.message; }
    finally { $("bAiRun").disabled = false; }
  };

  /* ───────── 설정 ───────── */
  function renderSettings() {
    $("sSeed").value = state.seed; $("sWatermark").value = state.settings.watermark;
    let used = 0; try { used = (localStorage.getItem(store.key) || "").length; } catch (e) {}
    $("storageInfo").textContent = "브라우저 저장 용량 사용: 약 " + Math.round(used / 1024) + "KB (한도 약 5MB)";
  }
  $("bExport").onclick = () => store.exportFile(state, "toonhelper_" + new Date().toISOString().slice(0, 10) + ".json");
  $("fImport").onchange = async () => {
    const f = $("fImport").files[0]; if (!f) return;
    try { const s = await store.importFile(f); state = Object.assign(DEFAULT(), s); rebuildGen(); renderAll(); save(); toast("프로젝트를 불러왔습니다"); }
    catch (e) { toast(e.message); }
    $("fImport").value = "";
  };
  $("bReset").onclick = () => { if (!confirm("모든 작업을 지우고 새로 시작할까요? (즐겨찾기는 남습니다)")) return; state = DEFAULT(); rebuildGen(); store.save(state); renderAll(); showTab("topic"); toast("새 프로젝트"); };
  $("bSeed").onclick = () => { state.seed = Math.max(1, +$("sSeed").value || 1); state.topicCount = 0; rebuildGen(); save(); toast("시드 " + state.seed + " 적용"); };
  $("sWatermark").oninput = () => { state.settings.watermark = $("sWatermark").value; save(); };

  /* ───────── 초기화 ───────── */
  function renderAll() { renderTopic(); renderStory(); renderChars(); renderCutStrip(); renderCutEditor(); renderSettings(); }
  $("ver").textContent = "v" + K.VERSION;
  window.addEventListener("pagehide", () => store.flush());        // 탭을 닫기 직전 대기 중인 자동 저장 반영
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") store.flush(); });
  window.addEventListener("keydown", e => {
    if (e.target.matches("input,textarea,select")) return;
    if (e.key === " " && document.querySelector("#tab-topic.on")) { e.preventDefault(); pickTopic(); }
  });
  renderAll();
  if (!state.topic) pickTopic();
  const hash = (location.hash || "").slice(1);
  showTab(["topic", "story", "char", "cut", "preview", "ai", "settings"].indexOf(hash) >= 0 ? hash : "topic");
  window.__toonhelper = { get state() { return state; }, K };   // 테스트·디버깅용
})();
