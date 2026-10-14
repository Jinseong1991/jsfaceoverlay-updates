/*
 * 툰헬퍼 엔진 — 서버·API 없이 동작하는 인스타툰 서포터의 핵심 모듈.
 * 참조: docs/hits-reference/02 ~ 07, 09
 *
 * 외부 의존성 없음. file:// 로 열어도 동작하도록 전역(window.ToonHelper)으로 노출한다.
 * 데이터(소재 뱅크·비트 시트·파츠)는 data/*.js 에 분리되어 있다. 엔진은 데이터를 모른다.
 */
(function (global) {
  "use strict";

  const VERSION = "1.0.0";

  /* ───────────────────────── 02 조합 엔진 ───────────────────────── */

  // 시드 난수 (LCG). 같은 시드 → 같은 순서. "이 결과 다시 보기"의 기반
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 가중치 랜덤. list: [{text, w}] → 항목 객체. w 생략 시 1
  function pick(list, r) {
    if (!list || !list.length) return null;
    const total = list.reduce((a, x) => a + (x.w || 1), 0);
    let n = r() * total;
    for (const x of list) { n -= (x.w || 1); if (n < 0) return x; }
    return list[list.length - 1];
  }

  // 한국어 조사: 받침 유무로 "이/가", "을/를", "과/와", "은/는", "으로/로" 치환
  function josa(word, pair) {
    const parts = pair.split("/"); const a = parts[0], b = parts[1];
    const trimmed = String(word).replace(/[^가-힣a-zA-Z0-9]+$/, "");
    const code = trimmed.charCodeAt(trimmed.length - 1);
    const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
    // "으로/로": ㄹ 받침은 "로"
    if (pair === "으로/로" && hasBatchim && (code - 0xac00) % 28 === 8) return word + "로";
    return word + (hasBatchim ? a : b);
  }
  function applyJosa(text) {
    return text.replace(/(\S+?)\{([^}]+)\}/g, (_, w, pair) => josa(w, pair));
  }

  // 슬롯 호환성: 항목의 only(["장소/편의점", ...])가 이미 뽑힌 값과 맞는 것만 남긴다
  function compatible(list, chosen) {
    const ok = list.filter(x => {
      if (!x.only || !x.only.length) return true;
      return x.only.some(rule => {
        const i = rule.indexOf("/"); const k = rule.slice(0, i), v = rule.slice(i + 1);
        return chosen[k] == null || chosen[k] === v;
      });
    });
    return ok.length ? ok : list;
  }

  // 슬롯 템플릿 채우기 → {text, chosen}. locked: 고정된 슬롯 값
  function fill(template, slots, r, locked) {
    locked = locked || {};
    const chosen = {};
    const text = template.replace(/\[([^\]]+)\]/g, (_, key) => {
      if (locked[key] != null && locked[key] !== "") { chosen[key] = locked[key]; return locked[key]; }
      const list = slots[key];
      if (!list || !list.length) return "[" + key + "]";
      const item = pick(compatible(list, chosen), r); chosen[key] = item.text; return item.text;
    });
    return { text, chosen };
  }

  // 사용자 추가 후보를 뱅크에 합친다. extra: { 슬롯: ["문장", ...] }
  function mergeSlots(base, extra) {
    const out = {};
    Object.keys(base).forEach(k => { out[k] = base[k].slice(); });
    Object.keys(extra || {}).forEach(k => {
      out[k] = (out[k] || []).concat((extra[k] || []).filter(Boolean).map(t => ({ text: t, w: 2, user: true })));
    });
    return out;
  }

  // 소재 생성기: 중복 회피 + 슬롯 고정 + 톤별 템플릿 + 재현 좌표
  function makeTopicGenerator(data, opts) {
    opts = opts || {};
    const seed = opts.seed || 1, memory = opts.memory || 12;
    let count = opts.count || 0; const recent = [];
    return function next(locked) {
      locked = locked || {};
      const r = rng(seed * 7919 + count * 104729); const myCount = count; count++;
      const tone = locked["톤"] || (data.slots["톤"] ? pick(data.slots["톤"], r).text : "");
      const pool = data.templates.filter(t => !t.tone || t.tone === tone);
      const templates = pool.length ? pool : data.templates;
      let out, tries = 0;
      do { out = fill(pick(templates, r).text, data.slots, r, locked); tries++; }
      while (recent.indexOf(out.text) >= 0 && tries < 12);
      recent.push(out.text); if (recent.length > memory) recent.shift();
      out.text = applyJosa(out.text);
      out.tone = tone; out.chosen["톤"] = tone;
      out.id = { seed, count: myCount };
      return out;
    };
  }

  function combinationCountTopics(data) {
    return Object.keys(data.slots).reduce((a, k) => a * data.slots[k].length, 1) * data.templates.length;
  }

  /* ───────────────────────── 03 비트 시트 ───────────────────────── */

  function fillLine(text, chosen) {
    return applyJosa(text.replace(/\[([^\]]+)\]/g, (_, k) => chosen[k] != null ? chosen[k] : "[" + k + "]"));
  }

  // 소재 → 컷 수만큼의 비트(역할·샷·대사·힌트)
  function storyboard(topic, beatsData, opts) {
    opts = opts || {};
    const tone = beatsData.tones[topic.tone] || beatsData.tones[Object.keys(beatsData.tones)[0]];
    const n = opts.cuts || tone.cuts;
    const beats = beatsData[String(n)] || beatsData["4"];
    const r = rng((opts.seed || 1) * 31 + n * 7 + (opts.count || 0) * 13);
    return beats.map((b, i) => ({
      cut: i + 1, role: b.role, goal: b.goal, shot: b.shot,
      line: fillLine(pick(b.lines, r).text, topic.chosen),
      hint: i === beats.length - 1 && tone.lastHint ? b.hint + " · " + tone.lastHint : b.hint
    }));
  }

  // 한 컷의 대사만 다시 뽑기
  function rerollLine(beat, topic, beatsData, cuts, seed) {
    const list = (beatsData[String(cuts)] || []).find(b => b.role === beat.role);
    if (!list) return beat.line;
    const r = rng(seed * 97 + Date.now() % 100000);
    let line = beat.line, tries = 0;
    while (line === beat.line && tries++ < 8) line = fillLine(pick(list.lines, r).text, topic.chosen);
    return line;
  }

  // 샷 → 캐릭터 scale / y 오프셋 (05에서 사용)
  const SHOT = {
    "풀샷": { scale: 0.85, dy: 0 },
    "바스트샷": { scale: 1.5, dy: 140 },
    "클로즈업": { scale: 2.3, dy: 320 },
    "풀샷·침묵컷": { scale: 0.7, dy: 0 },
    "표지": { scale: 1.1, dy: 60 }
  };

  /* ───────────────────────── 04 캐릭터 파츠 ───────────────────────── */

  function findPart(data, layer, id) {
    const list = data.parts[layer] || [];
    return list.find(p => p.id === id) || list[0] || { svg: "" };
  }

  // 선택값 → SVG 문자열. expr로 눈·입 표정 덮어쓰기
  function characterSVG(data, choice, opts) {
    opts = opts || {};
    const body = data.layers.map(layer => {
      let part = findPart(data, layer, choice[layer]);
      if (opts.expr && (layer === "eyes" || layer === "mouth")) {
        part = (data.parts[layer] || []).find(p => p.expr === opts.expr) || part;
      }
      return part.svg || "";
    }).join("");
    const c = choice.colors || {};
    const css = "<style>.c-hair{fill:" + (c.hair || "#333") + "}.c-skin{fill:" + (c.skin || "#ffe6d5") + "}" +
      ".c-clothes{fill:" + (c.clothes || "#4e6bd1") + "}.c-accent{fill:" + (c.accent || "#f2c14e") + "}</style>";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + data.size + " " + data.size + '">' + css + body + "</svg>";
  }

  function randomCharacter(data, r) {
    const choice = { colors: {} };
    data.layers.forEach(layer => {
      const list = data.parts[layer];
      const basic = list.find(p => p.expr === "basic");          // 눈·입은 기본 표정으로. 표정은 컷마다 덮어쓴다
      choice[layer] = basic ? basic.id : list[Math.floor(r() * list.length)].id;
    });
    Object.keys(data.palettes).forEach(k => { const pal = data.palettes[k]; choice.colors[k] = pal[Math.floor(r() * pal.length)]; });
    choice.name = data.names ? data.names[Math.floor(r() * data.names.length)] : "";
    return choice;
  }

  // 특정 레이어만 이전/다음 파츠로 (±1)
  function cycleLayer(data, choice, layer, dir) {
    const list = data.parts[layer]; const i = Math.max(0, list.findIndex(p => p.id === choice[layer]));
    const n = (i + (dir || 1) + list.length) % list.length;
    return Object.assign({}, choice, { [layer]: list[n].id });
  }

  function combinationCountParts(data) {
    const parts = data.layers.reduce((a, l) => a * data.parts[l].length, 1);
    const colors = Object.keys(data.palettes).reduce((a, k) => a * data.palettes[k].length, 1);
    return parts * colors;
  }

  const svgCache = new Map();
  function svgToImage(svgString) {
    if (svgCache.has(svgString)) return Promise.resolve(svgCache.get(svgString));
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { if (svgCache.size > 200) svgCache.clear(); svgCache.set(svgString, img); res(img); };
      img.onerror = rej;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
    });
  }

  // 단색 PNG 파츠 색 치환 (작가가 PNG 파츠를 쓸 때)
  function tint(img, color, size) {
    size = size || 512;
    const c = document.createElement("canvas"); c.width = c.height = size;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, size, size);
    x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, size, size);
    return c;
  }

  /* ───────────────────────── 05 컷 캔버스 ───────────────────────── */

  const FONT_STACK = "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', 'NanumGothic', sans-serif";

  // 한글 줄바꿈: 공백 단위 우선, 긴 단어는 글자 단위
  function wrapText(ctx, text, maxW) {
    const out = []; let line = "";
    String(text).split(/\n/).forEach((para, pi) => {
      if (pi) { out.push(line.replace(/\s+$/, "")); line = ""; }
      para.split(/(\s+)/).forEach(word => {
        if (ctx.measureText(line + word).width <= maxW) { line += word; return; }
        if (line) { out.push(line.replace(/\s+$/, "")); line = ""; }
        if (ctx.measureText(word).width <= maxW) { line = word; return; }
        for (const ch of word) {
          if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
        }
      });
    });
    if (line) out.push(line.replace(/\s+$/, ""));
    return out.filter(l => l.length);
  }

  function spikyRect(ctx, x, y, w, h, n) {
    const pts = []; const per = Math.max(2, Math.ceil(n / 4)); const k = 18;
    for (let i = 0; i < per; i++) pts.push([x + (w * i) / per, y - (i % 2 ? k : 0)]);
    for (let i = 0; i < per; i++) pts.push([x + w + (i % 2 ? k : 0), y + (h * i) / per]);
    for (let i = 0; i < per; i++) pts.push([x + w - (w * i) / per, y + h + (i % 2 ? k : 0)]);
    for (let i = 0; i < per; i++) pts.push([x - (i % 2 ? k : 0), y + h - (h * i) / per]);
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
  }

  function cloudRect(ctx, x, y, w, h) {
    const r = Math.min(40, h / 2); const nx = Math.max(2, Math.round(w / 70)), ny = Math.max(1, Math.round(h / 70));
    ctx.moveTo(x, y + r);
    for (let i = 0; i < nx; i++) ctx.arc(x + (w * (i + 0.5)) / nx, y, w / nx / 2 + 4, Math.PI, 0);
    for (let i = 0; i < ny; i++) ctx.arc(x + w, y + (h * (i + 0.5)) / ny, h / ny / 2 + 4, -Math.PI / 2, Math.PI / 2);
    for (let i = nx - 1; i >= 0; i--) ctx.arc(x + (w * (i + 0.5)) / nx, y + h, w / nx / 2 + 4, 0, Math.PI);
    for (let i = ny - 1; i >= 0; i--) ctx.arc(x, y + (h * (i + 0.5)) / ny, h / ny / 2 + 4, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
  }

  // 말풍선: 텍스트 크기를 먼저 재고 그 크기로 그린다. style: round | shout | think | none
  function drawBubble(ctx, b, o) {
    o = o || {};
    const fontSize = b.fontSize || o.fontSize || 34;
    const font = (b.bold === false ? "400 " : "600 ") + fontSize + "px " + FONT_STACK;
    const pad = o.pad || Math.round(fontSize * 0.8), lineH = o.lineH || Math.round(fontSize * 1.35), radius = o.radius || 28;
    ctx.save(); ctx.font = font;
    const lines = wrapText(ctx, b.text || "", (b.maxW || 600) - pad * 2);
    if (!lines.length) { ctx.restore(); return { w: 0, h: 0 }; }
    const w = Math.max.apply(null, lines.map(l => ctx.measureText(l).width)) + pad * 2;
    const h = lines.length * lineH + pad * 2 - (lineH - fontSize);
    ctx.lineJoin = "round";
    const style = b.style || "round";
    if (style !== "none") {
      if (b.tail && style !== "think") {
        ctx.beginPath(); ctx.moveTo(b.x + w * 0.35, b.y + h - 2); ctx.lineTo(b.tail[0], b.tail[1]); ctx.lineTo(b.x + w * 0.55, b.y + h - 2);
        ctx.closePath(); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#222"; ctx.lineWidth = 5; ctx.stroke();
      }
      ctx.beginPath();
      if (style === "shout") spikyRect(ctx, b.x, b.y, w, h, 16);
      else if (style === "think") cloudRect(ctx, b.x, b.y, w, h);
      else ctx.roundRect(b.x, b.y, w, h, radius);
      ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#222"; ctx.lineWidth = 5; ctx.stroke();
      if (b.tail && style !== "think") { ctx.beginPath(); ctx.roundRect(b.x + 3, b.y + 3, w - 6, h - 6, radius); ctx.fillStyle = "#fff"; ctx.fill(); }
      if (b.tail && style === "think") {
        const [tx, ty] = b.tail; const cx = b.x + w * 0.4, cy = b.y + h;
        [0.3, 0.6, 0.85].forEach((t, i) => { ctx.beginPath(); ctx.arc(cx + (tx - cx) * t, cy + (ty - cy) * t, 14 - i * 4, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke(); });
      }
    }
    ctx.fillStyle = b.color || "#222"; ctx.textBaseline = "top"; ctx.textAlign = "left";
    lines.forEach((l, i) => ctx.fillText(l, b.x + pad, b.y + pad + i * lineH));
    ctx.restore();
    return { w, h };
  }

  function drawSpeedlines(ctx, cx, cy, o) {
    o = o || {}; const count = o.count || 48, inner = o.inner || 260, outer = o.outer || 1400;
    ctx.save(); ctx.strokeStyle = o.color || "#222"; ctx.lineWidth = o.width || 3;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (i % 3) * 0.02;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer); ctx.stroke();
    }
    ctx.restore();
  }

  // 집중선 대신 쓰는 "반짝" 효과
  function drawSparkles(ctx, cx, cy, o) {
    o = o || {}; const n = o.count || 7; const r = rng(o.seed || 3);
    ctx.save(); ctx.fillStyle = o.color || "#f2c14e";
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * (o.spread || 700), y = cy + (r() - 0.5) * (o.spread || 700), s = 14 + r() * 26;
      ctx.beginPath(); ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s);
      ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s); ctx.fill();
    }
    ctx.restore();
  }

  function drawSweat(ctx, cx, cy) {
    ctx.save(); ctx.fillStyle = "#7fc2f5"; ctx.strokeStyle = "#222"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx, cy - 40); ctx.quadraticCurveTo(cx + 34, cy + 10, cx, cy + 30); ctx.quadraticCurveTo(cx - 34, cy + 10, cx, cy - 40);
    ctx.fill(); ctx.stroke(); ctx.restore();
  }

  // 의성어·효과음 텍스트
  function drawSfx(ctx, f, W) {
    ctx.save(); ctx.translate(f.x || W / 2, f.y || 300); ctx.rotate(((f.angle || -8) * Math.PI) / 180);
    ctx.font = "900 " + (f.size || 120) + "px " + FONT_STACK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 14; ctx.strokeStyle = "#222"; ctx.lineJoin = "round"; ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = f.color || "#ffd43b"; ctx.fillText(f.text, 0, 0); ctx.restore();
  }

  // 컷 한 장 렌더. characters: {ref: choice}, bgPresets: {id: fn(ctx,W,H)}
  async function renderCut(canvas, cut, characters, partsData, bgPresets, opts) {
    opts = opts || {};
    const size = cut.size || [1080, 1350]; const W = size[0], H = size[1];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const bg = cut.bg || { type: "preset", id: "blank" };
    if (bg.type === "color") { ctx.fillStyle = bg.value; ctx.fillRect(0, 0, W, H); }
    else if (bg.type === "image" && bg.img) ctx.drawImage(bg.img, 0, 0, W, H);
    else {
      const fn = (bgPresets && bgPresets[bg.id]) || (bgPresets && bgPresets.blank);
      if (fn) fn(ctx, W, H); else { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); }
    }
    // 효과 (캐릭터 뒤)
    (cut.fx || []).forEach(f => {
      if (f.type === "speedlines") drawSpeedlines(ctx, f.cx != null ? f.cx : W / 2, f.cy != null ? f.cy : H * 0.55, f);
      if (f.type === "sparkles") drawSparkles(ctx, f.cx != null ? f.cx : W / 2, f.cy != null ? f.cy : H * 0.5, f);
    });
    // 캐릭터
    for (const c of cut.chars || []) {
      const choice = characters[c.ref]; if (!choice) continue;
      const img = await svgToImage(characterSVG(partsData, choice, { expr: c.expr }));
      const shot = SHOT[c.shot] || { scale: 1, dy: 0 };
      const s = (c.scale || shot.scale) * (W / 1080) * 1.2 * (partsData.size / 512);
      const w = partsData.size * s, h = partsData.size * s;
      const x = c.x != null ? c.x : W / 2, y = (c.y != null ? c.y : H * 0.58) + (c.dy != null ? c.dy : shot.dy);
      ctx.save(); ctx.translate(x, y); if (c.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
    }
    // 효과 (캐릭터 앞)
    (cut.fx || []).forEach(f => {
      if (f.type === "sweat") drawSweat(ctx, f.cx != null ? f.cx : W / 2 + 150, f.cy != null ? f.cy : H * 0.4);
      if (f.type === "sfx" && f.text) drawSfx(ctx, f, W);
    });
    // 말풍선
    (cut.bubbles || []).forEach(b => drawBubble(ctx, b));
    // 캡션 (하단 내레이션)
    if (cut.caption && cut.caption.text) {
      ctx.save(); ctx.font = "400 30px " + FONT_STACK; ctx.fillStyle = "#444"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      const lines = wrapText(ctx, cut.caption.text, W - 140).slice(0, 2);
      const y0 = (cut.caption.y || H - 70) - (lines.length - 1) * 40;
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * 40)); ctx.restore();
    }
    // 컷 번호
    if (cut.number) {
      ctx.save(); ctx.font = "700 28px " + FONT_STACK; ctx.fillStyle = "#222"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillText(String(cut.number), W - 40, 36); ctx.restore();
    }
    // 워터마크
    if (opts.watermark) {
      ctx.save(); ctx.font = "500 22px " + FONT_STACK; ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(opts.watermark, 30, H - 24); ctx.restore();
    }
    if (opts.guide) drawSafeGuide(ctx, W, H);
    return canvas;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(res => canvas.toBlob(res, type || "image/png", quality));
  }

  // file:// 로 연 페이지에서 blob: URL은 파일명을 잃거나 다운로드가 막히므로 data: URL로 내려받는다
  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement("a"); a.href = dataUrl; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 0);
  }

  function downloadText(text, filename, mime) {
    downloadDataUrl("data:" + (mime || "text/plain") + ";charset=utf-8," + encodeURIComponent(text), filename);
  }

  function downloadCanvas(canvas, filename) {
    downloadDataUrl(canvas.toDataURL("image/png"), filename || "cut.png");
  }

  /* ───────────────────────── 06 인스타 미리보기 ───────────────────────── */

  const IG = {
    ratios: { "4:5": [1080, 1350], "1:1": [1080, 1080], "9:16": [1080, 1920] },
    post45: [1080, 1350], post11: [1080, 1080], story: [1080, 1920],
    carouselMax: 20, captionMax: 2200, captionFold: 125, hashtagMax: 30, safe: 60,
    storyUnsafeTop: 250, storyUnsafeBottom: 250
  };

  function checkCaption(text) {
    text = text || "";
    const chars = Array.from(text);
    const hashtags = text.match(/#[^\s#]+/g) || [];
    const firstLine = text.split("\n")[0];
    return {
      length: chars.length, over: chars.length > IG.captionMax,
      folded: chars.length > IG.captionFold ? chars.slice(0, IG.captionFold).join("") : null,
      hashtags: hashtags.length, hashtagOver: hashtags.length > IG.hashtagMax,
      dupHashtags: hashtags.length - new Set(hashtags.map(h => h.toLowerCase())).size,
      firstLine: firstLine.slice(0, 40), firstLineLong: Array.from(firstLine).length > 40,
      hasQuestion: /\?|나만|여러분|댓글/.test(text)
    };
  }

  function drawSafeGuide(ctx, W, H, safe) {
    safe = safe || IG.safe;
    ctx.save(); ctx.setLineDash([12, 8]); ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,0,0,.55)"; ctx.strokeRect(safe, safe, W - safe * 2, H - safe * 2);
    if (H > W) { const top = (H - W) / 2; ctx.strokeStyle = "rgba(0,120,255,.65)"; ctx.strokeRect(0, top, W, W); }
    if (H === 1920) {
      ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(0, 0, W, IG.storyUnsafeTop); ctx.fillRect(0, H - IG.storyUnsafeBottom, W, IG.storyUnsafeBottom);
    }
    ctx.restore();
  }

  /* ───────────────────────── 07 저장 ───────────────────────── */

  function makeStore(key) {
    let t, pending = null;
    return {
      key,
      save(state) { try { localStorage.setItem(key, JSON.stringify(state)); return true; } catch (e) { return false; } },
      load(fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } },
      remove() { try { localStorage.removeItem(key); } catch (e) {} },
      autosave(state, cb) { clearTimeout(t); pending = state; t = setTimeout(() => { pending = null; const ok = this.save(state); if (cb) cb(ok); }, 400); },
      flush() { if (pending) { clearTimeout(t); const s = pending; pending = null; return this.save(s); } return true; },
      exportFile(state, name) {
        const json = JSON.stringify({ app: "toonhelper", version: 1, savedAt: new Date().toISOString(), state }, null, 2);
        downloadText(json, name || "toonhelper-project.json", "application/json");
      },
      importFile(file) {
        return new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => { try { res(migrate(JSON.parse(fr.result))); } catch (e) { rej(new Error("프로젝트 파일 형식이 아닙니다")); } };
          fr.onerror = () => rej(new Error("파일을 읽지 못했습니다")); fr.readAsText(file);
        });
      }
    };
  }
  function migrate(j) {
    if (!j || typeof j !== "object") throw new Error("bad");
    if (!j.version) return j;              // 구버전: state 그대로
    return j.state;
  }

  /* ───────────────────────── 09 AI 확장 ───────────────────────── */

  function buildStoryPrompt(topic, beats, style) {
    style = style || {};
    const cuts = style.cuts || (beats ? beats.length : 4);
    return [
      "다음 소재로 인스타툰 " + cuts + "컷 콘티를 써 주세요. 톤: " + (topic.tone || style.tone || "공감형") + ".",
      "소재: " + topic.text,
      beats && beats.length ? "역할 순서: " + beats.map(b => b.role).join(" → ") + "." : "",
      '각 컷은 반드시 한 줄로 "컷번호 | 역할 | 샷 | 대사 | 그림 지시" 형식으로 써 주세요. (샷은 풀샷/바스트샷/클로즈업 중 하나)',
      "대사는 한국어 구어체, 한 컷당 25자 이내. 마지막 컷은 댓글을 유도하는 질문으로.",
      "설명 없이 컷 줄만 출력하세요."
    ].filter(Boolean).join("\n");
  }

  function buildImagePrompt(character, cut, partsData) {
    const name = l => { const p = partsData && partsData.parts[l] ? partsData.parts[l].find(x => x.id === character[l]) : null; return p && p.label ? p.label : character[l]; };
    const c = character.colors || {};
    return "simple Korean instatoon style, 2-head chibi character, flat colors, thick clean outline, white background, " +
      "hair color " + c.hair + " (" + name("hairFront") + (character.hairBack && character.hairBack !== "hb0" ? ", " + name("hairBack") : "") + "), " +
      "skin " + c.skin + ", outfit " + name("clothes") + " in " + c.clothes + ", " +
      (character.accessory && character.accessory !== "a0" ? name("accessory") + ", " : "") +
      (cut ? (cut.expr || "neutral") + " expression, " + (cut.shot || "full shot") + ", speech bubble text \"" + (cut.line || "") + "\"" : "neutral expression, full body");
  }

  // AI 응답(컷 줄) → 비트 배열. "1 | 도입 | 풀샷 | 오늘도 편의점. | 캐릭터 1명" 형식
  function parseStoryReply(text, fallbackBeats) {
    const rows = String(text || "").split(/\n/).map(l => l.trim()).filter(l => /^\d+\s*[|\/]/.test(l) || /^컷?\s*\d+/.test(l));
    const out = rows.map((l, i) => {
      const cols = l.replace(/^컷?\s*/, "").split(/\s*[|\/]\s*/);
      const base = (fallbackBeats && fallbackBeats[i]) || {};
      return {
        cut: i + 1, role: cols[1] || base.role || "컷", shot: cols[2] || base.shot || "풀샷",
        line: cols[3] || base.line || "", hint: cols.slice(4).join(" / ") || base.hint || "", goal: base.goal || ""
      };
    });
    return out.length ? out : null;
  }

  const KEYSTORE = "toonhelper:apikey";
  function setKey(k) { try { if (k) localStorage.setItem(KEYSTORE, k); else localStorage.removeItem(KEYSTORE); } catch (e) {} }
  function getKey() { try { return localStorage.getItem(KEYSTORE) || ""; } catch (e) { return ""; } }

  // 사용자 본인의 키로 브라우저에서 직접 호출 (BYOK). 키는 이 브라우저에만 저장된다.
  async function askClaude(prompt, opts) {
    opts = opts || {};
    const key = opts.key || getKey();
    if (!key) throw new Error("API 키가 없습니다. 설정에서 키를 입력하세요.");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model: opts.model || "claude-sonnet-5-5", max_tokens: opts.maxTokens || 1024, messages: [{ role: "user", content: prompt }] })
    });
    if (!res.ok) throw new Error("API " + res.status + ": " + (await res.text()).slice(0, 300));
    const j = await res.json();
    return (j.content || []).map(c => c.text || "").join("");
  }

  /* ───────────────────────── 유틸 ───────────────────────── */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((res, rej) => {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); res(); } catch (e) { rej(e); } finally { ta.remove(); }
    });
  }

  function hashSeed(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  const api = {
    VERSION,
    rng, pick, josa, applyJosa, compatible, fill, mergeSlots, makeTopicGenerator, combinationCountTopics,
    fillLine, storyboard, rerollLine, SHOT,
    characterSVG, randomCharacter, cycleLayer, combinationCountParts, svgToImage, tint,
    FONT_STACK, wrapText, drawBubble, drawSpeedlines, drawSparkles, drawSweat, drawSfx, renderCut, canvasToBlob, downloadDataUrl, downloadText, downloadCanvas,
    IG, checkCaption, drawSafeGuide,
    makeStore, migrate,
    buildStoryPrompt, buildImagePrompt, parseStoryReply, setKey, getKey, askClaude,
    copyText, hashSeed
  };
  global.ToonHelper = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
