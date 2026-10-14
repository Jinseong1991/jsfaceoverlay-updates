/*
 * instatoon-kit.js — HITS류 "API 없는" 인스타툰 서포터 프로그램의 핵심 모듈 모음.
 * 참조 문서: ../02-topic-engine.md ~ ../07-storage-export.md
 *
 * 외부 의존성 없음. file:// 로 열어도 동작하도록 일반 스크립트(전역 InstatoonKit)로 제공.
 * ES 모듈이 필요하면 맨 아래 export 블록의 주석을 풀고 window 할당을 지우면 된다.
 */
(function (global) {
  "use strict";

  /* ───────────────────────── 02 조합 엔진 ───────────────────────── */

  // 시드 난수 (LCG). 같은 시드 → 같은 순서
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 가중치 랜덤. list: [{text, w}] → 항목 객체
  function pick(list, r) {
    const total = list.reduce((a, x) => a + (x.w || 1), 0);
    let n = r() * total;
    for (const x of list) { n -= (x.w || 1); if (n < 0) return x; }
    return list[list.length - 1];
  }

  // 한국어 조사: "[인물]{이/가}" 형태를 받침 유무로 치환
  function josa(word, pair) {
    const parts = pair.split("/"); const a = parts[0], b = parts[1];
    const code = word.charCodeAt(word.length - 1);
    const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
    return word + (hasBatchim ? a : b);
  }
  function applyJosa(text) {
    return text.replace(/(\S+?)\{([^}]+)\}/g, (_, w, pair) => josa(w, pair));
  }

  // 슬롯 템플릿 채우기 → {text, chosen}
  function fill(template, slots, r, locked) {
    locked = locked || {};
    const chosen = {};
    const text = template.replace(/\[([^\]]+)\]/g, (_, key) => {
      if (locked[key] != null) { chosen[key] = locked[key]; return locked[key]; }
      const list = slots[key];
      if (!list || !list.length) return "[" + key + "]";
      const item = pick(list, r); chosen[key] = item.text; return item.text;
    });
    return { text, chosen };
  }

  // 소재 생성기: 중복 회피 + 슬롯 고정 + 재현 좌표
  function makeTopicGenerator(data, opts) {
    opts = opts || {};
    const seed = opts.seed || 1, memory = opts.memory || 8;
    let count = 0; const recent = [];
    return function next(locked) {
      const r = rng(seed * 7919 + count * 104729); const myCount = count; count++;
      let out, tries = 0;
      do { out = fill(pick(data.templates, r).text, data.slots, r, locked); tries++; }
      while (recent.indexOf(out.text) >= 0 && tries < 10);
      recent.push(out.text); if (recent.length > memory) recent.shift();
      out.text = applyJosa(out.text);
      out.tone = data.slots["톤"] ? pick(data.slots["톤"], r).text : "";
      out.id = { seed, count: myCount };
      return out;
    };
  }

  function combinationCountTopics(data) {
    return Object.keys(data.slots).reduce((a, k) => a * data.slots[k].length, 1) * data.templates.length;
  }

  /* ───────────────────────── 03 비트 시트 ───────────────────────── */

  function storyboard(topic, beatsData, opts) {
    opts = opts || {};
    const tone = beatsData.tones[topic.tone] || beatsData.tones[Object.keys(beatsData.tones)[0]];
    const n = opts.cuts || tone.cuts;
    const beats = beatsData[String(n)] || beatsData["4"];
    const r = rng((opts.seed || 1) * 31 + n);
    return beats.map((b, i) => {
      const raw = pick(b.lines, r).text.replace(/\[([^\]]+)\]/g, (_, k) => topic.chosen[k] != null ? topic.chosen[k] : "[" + k + "]");
      return {
        cut: i + 1, role: b.role, goal: b.goal, shot: b.shot, line: applyJosa(raw),
        hint: i === beats.length - 1 && tone.lastHint ? b.hint + " · " + tone.lastHint : b.hint
      };
    });
  }

  // 샷 → 캐릭터 scale/y 오프셋 (05에서 사용)
  const SHOT = {
    "풀샷": { scale: 0.85, dy: 0 }, "바스트샷": { scale: 1.5, dy: 120 }, "클로즈업": { scale: 2.3, dy: 300 }, "풀샷·침묵컷": { scale: 0.7, dy: 0 }
  };

  /* ───────────────────────── 04 캐릭터 파츠 ───────────────────────── */

  function findPart(data, layer, id) {
    const list = data.parts[layer] || [];
    return list.find(p => p.id === id) || list[0] || { svg: "" };
  }

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
    const css = "<style>.c-hair{fill:" + (c.hair || "#333") + "}.c-skin{fill:" + (c.skin || "#ffe6d5") + "}.c-clothes{fill:" + (c.clothes || "#4e6bd1") + "}</style>";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + data.size + " " + data.size + '">' + css + body + "</svg>";
  }

  function randomCharacter(data, r) {
    const choice = { colors: {} };
    data.layers.forEach(layer => { const list = data.parts[layer]; choice[layer] = list[Math.floor(r() * list.length)].id; });
    Object.keys(data.palettes).forEach(k => { const pal = data.palettes[k]; choice.colors[k] = pal[Math.floor(r() * pal.length)]; });
    return choice;
  }

  function combinationCountParts(data) {
    const parts = data.layers.reduce((a, l) => a * data.parts[l].length, 1);
    const colors = Object.keys(data.palettes).reduce((a, k) => a * data.palettes[k].length, 1);
    return parts * colors;
  }

  function svgToImage(svgString) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = rej;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
    });
  }

  // 단색 PNG 파츠 색 치환
  function tint(img, color, size) {
    size = size || 512;
    const c = document.createElement("canvas"); c.width = c.height = size;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, size, size);
    x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, size, size);
    return c;
  }

  /* ───────────────────────── 05 컷 캔버스 ───────────────────────── */

  function wrapText(ctx, text, maxW) {
    const out = []; let line = "";
    text.split(/(\s+)/).forEach(word => {
      if (ctx.measureText(line + word).width <= maxW) { line += word; return; }
      if (line) { out.push(line.replace(/\s+$/, "")); line = ""; }
      if (ctx.measureText(word).width <= maxW) { line = word; return; }
      for (const ch of word) {
        if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
      }
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

  function drawBubble(ctx, b, o) {
    o = o || {};
    const font = o.font || "600 34px 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
    const pad = o.pad || 28, lineH = o.lineH || 46, radius = o.radius || 28;
    ctx.save(); ctx.font = font;
    const lines = wrapText(ctx, b.text, (b.maxW || 600) - pad * 2);
    const w = Math.max.apply(null, lines.map(l => ctx.measureText(l).width)) + pad * 2;
    const h = lines.length * lineH + pad * 2 - (lineH - 34);
    ctx.lineJoin = "round";
    if (b.tail) {
      ctx.beginPath(); ctx.moveTo(b.x + w * 0.35, b.y + h - 2); ctx.lineTo(b.tail[0], b.tail[1]); ctx.lineTo(b.x + w * 0.5, b.y + h - 2);
      ctx.closePath(); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#222"; ctx.lineWidth = 5; ctx.stroke();
    }
    ctx.beginPath();
    if (b.style === "shout") spikyRect(ctx, b.x, b.y, w, h, 16); else ctx.roundRect(b.x, b.y, w, h, radius);
    ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#222"; ctx.lineWidth = 5; ctx.stroke();
    if (b.tail) { ctx.beginPath(); ctx.roundRect(b.x + 3, b.y + 3, w - 6, h - 6, radius); ctx.fillStyle = "#fff"; ctx.fill(); }
    ctx.fillStyle = "#222"; ctx.textBaseline = "top"; ctx.textAlign = "left";
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

  const presets = {
    room: (ctx, W, H) => { ctx.fillStyle = "#f4efe6"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#e3d8c6"; ctx.fillRect(0, H * 0.62, W, H); },
    street: (ctx, W, H) => { ctx.fillStyle = "#dfeefc"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#9aa7b5"; ctx.fillRect(0, H * 0.7, W, H); },
    blank: (ctx, W, H) => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); }
  };

  async function renderCut(canvas, cut, characters, partsData, bgPresets) {
    bgPresets = bgPresets || presets;
    const size = cut.size || [1080, 1350]; const W = size[0], H = size[1];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const bg = cut.bg || { type: "preset", id: "blank" };
    if (bg.type === "color") { ctx.fillStyle = bg.value; ctx.fillRect(0, 0, W, H); }
    else if (bg.type === "image" && bg.img) ctx.drawImage(bg.img, 0, 0, W, H);
    else (bgPresets[bg.id] || presets.blank)(ctx, W, H);
    (cut.fx || []).forEach(f => { if (f.type === "speedlines") drawSpeedlines(ctx, f.cx, f.cy, f); });
    for (const c of cut.chars || []) {
      const choice = characters[c.ref]; if (!choice) continue;
      const img = await svgToImage(characterSVG(partsData, choice, { expr: c.expr }));
      const shot = SHOT[c.shot] || { scale: 1, dy: 0 };
      const s = (c.scale || shot.scale) * (W / 1080) * 1.2 * (partsData.size / 512);
      const w = partsData.size * s, h = partsData.size * s;
      ctx.save(); ctx.translate(c.x, c.y + (c.dy != null ? c.dy : shot.dy)); if (c.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
    }
    (cut.bubbles || []).forEach(b => drawBubble(ctx, b));
    if (cut.caption && cut.caption.text) {
      ctx.font = "400 30px 'Noto Sans KR', sans-serif"; ctx.fillStyle = "#444"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      const lines = wrapText(ctx, cut.caption.text, W - 120).slice(0, 2);        // 최대 2줄
      const y0 = (cut.caption.y || H - 70) - (lines.length - 1) * 40;
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * 40));
    }
    return canvas;
  }

  function downloadCanvas(canvas, filename) {
    canvas.toBlob(b => {
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = filename || "cut.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  }

  /* ───────────────────────── 06 인스타 미리보기 ───────────────────────── */

  const IG = {
    post45: [1080, 1350], post11: [1080, 1080], story: [1080, 1920],
    carouselMax: 20, captionMax: 2200, captionFold: 125, hashtagMax: 30, safe: 60,
    storyUnsafeTop: 250, storyUnsafeBottom: 250
  };

  function checkCaption(text) {
    const chars = Array.from(text || "");
    const hashtags = (text || "").match(/#[^\s#]+/g) || [];
    return {
      length: chars.length, over: chars.length > IG.captionMax,
      folded: chars.length > IG.captionFold ? chars.slice(0, IG.captionFold).join("") : null,
      hashtags: hashtags.length, hashtagOver: hashtags.length > IG.hashtagMax,
      firstLine: (text || "").split("\n")[0].slice(0, 40)
    };
  }

  function renderFeed(container, dataUrls, total) {
    total = total || 9; container.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      if (dataUrls[i]) { const im = new Image(); im.src = dataUrls[i]; im.alt = ""; cell.appendChild(im); }
      container.appendChild(cell);
    }
  }

  function drawSafeGuide(ctx, W, H, safe) {
    safe = safe || IG.safe;
    ctx.save(); ctx.setLineDash([12, 8]); ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,0,0,.5)"; ctx.strokeRect(safe, safe, W - safe * 2, H - safe * 2);
    const top = (H - W) / 2; ctx.strokeStyle = "rgba(0,120,255,.6)"; ctx.strokeRect(0, top, W, W);
    ctx.restore();
  }

  /* ───────────────────────── 07 저장 ───────────────────────── */

  function makeStore(key) {
    key = key || "instatoon:project:v1";
    let t;
    return {
      save(state) { try { localStorage.setItem(key, JSON.stringify(state)); return true; } catch (e) { return false; } },
      load(fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } },
      autosave(state) { clearTimeout(t); t = setTimeout(() => this.save(state), 500); },
      exportFile(state, name) {
        const blob = new Blob([JSON.stringify({ version: 1, savedAt: new Date().toISOString(), state }, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name || "project.json"; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      importFile(file) {
        return new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => { try { const j = JSON.parse(fr.result); res(j.version ? j.state : j); } catch (e) { rej(new Error("프로젝트 파일 형식이 아닙니다")); } };
          fr.onerror = rej; fr.readAsText(file);
        });
      }
    };
  }

  /* ───────────────────────── 샘플 데이터 (교체해서 쓸 것) ───────────────────────── */

  const SAMPLE_TOPICS = {
    slots: {
      "장소": [{ text: "편의점", w: 3 }, { text: "지하철", w: 3 }, { text: "회사 탕비실", w: 2 }, { text: "헬스장" }, { text: "미용실" }, { text: "엄마 집" }, { text: "카페 구석 자리", w: 2 }],
      "인물": [{ text: "나", w: 4 }, { text: "친구", w: 2 }, { text: "직장 상사" }, { text: "고양이" }, { text: "배달 기사님" }, { text: "옛 연인" }],
      "사건": [{ text: "아는 사람을 못 본 척했다", w: 2 }, { text: "계산이 잘못 나왔다" }, { text: "혼잣말을 들켰다", w: 2 }, { text: "핸드폰을 두고 왔다" }, { text: "칭찬을 받았는데 어색했다" }, { text: "갑자기 울컥했다" }, { text: "줄을 잘못 섰다" }],
      "감정": [{ text: "민망함", w: 3 }, { text: "뿌듯함" }, { text: "억울함", w: 2 }, { text: "귀찮음", w: 2 }, { text: "설렘" }, { text: "현타" }],
      "반전": [{ text: "알고 보니 내 착각이었다", w: 3 }, { text: "상대도 똑같이 생각하고 있었다", w: 2 }, { text: "그걸 다 보고 있던 사람이 있었다" }, { text: "결국 아무 일도 안 일어났다", w: 2 }, { text: "다음 날 또 반복됐다" }],
      "톤": [{ text: "공감형", w: 3 }, { text: "썰 풀기형", w: 2 }, { text: "자조 개그형", w: 2 }, { text: "잔잔한 위로형" }]
    },
    templates: [
      { text: "[장소]에서 [인물]{이/가} [사건]. 감정은 [감정]. 반전: [반전]", w: 3 },
      { text: "[인물]{과/와} [장소]에 갔다가 [사건]. [감정]{을/를} 느꼈는데, [반전]", w: 2 },
      { text: "[장소] 편. [사건] → [감정] → [반전]" }
    ]
  };

  const SAMPLE_BEATS = {
    "4": [
      { role: "도입", goal: "상황 제시", shot: "풀샷", hint: "캐릭터 1명, 배경 1개, 대사 1줄", lines: [{ text: "오늘도 [장소]." }, { text: "[장소]에 가면 늘 이래.", w: 2 }] },
      { role: "전개", goal: "문제·기대 발생", shot: "바스트샷", hint: "표정 변화 시작", lines: [{ text: "어? [사건]…" }, { text: "설마 [사건]?" }] },
      { role: "반전", goal: "예상 밖의 일", shot: "클로즈업", hint: "효과선, 큰 의성어, 배경 생략", lines: [{ text: "[반전]!!" }, { text: "…[반전]." }] },
      { role: "마무리", goal: "감정 한 줄 정리", shot: "풀샷·침묵컷", hint: "여백 많이, 자조 또는 공감 한 줄", lines: [{ text: "[감정]." }, { text: "나만 이래…?", w: 2 }] }
    ],
    "6": [
      { role: "도입", goal: "상황 제시", shot: "풀샷", hint: "장소·인물 소개", lines: [{ text: "오늘도 [장소]." }] },
      { role: "전개1", goal: "일상 진행", shot: "풀샷", hint: "평범한 흐름", lines: [{ text: "[인물]{과/와} 평소처럼." }] },
      { role: "전개2", goal: "기대 생김", shot: "바스트샷", hint: "작은 기대 또는 불안", lines: [{ text: "설마 [사건]?" }] },
      { role: "위기", goal: "사건 발생", shot: "바스트샷", hint: "표정 급변", lines: [{ text: "[사건]!" }] },
      { role: "반전", goal: "예상 밖", shot: "클로즈업", hint: "효과선, 큰 의성어", lines: [{ text: "[반전]!!" }] },
      { role: "마무리", goal: "정리", shot: "풀샷·침묵컷", hint: "여백, 한 줄 공감", lines: [{ text: "[감정]…" }, { text: "나만 이래…?", w: 2 }] }
    ],
    tones: {
      "공감형": { cuts: 4, lastHint: "'나만 그런가요?' 류 질문으로 끝내 댓글 유도" },
      "썰 풀기형": { cuts: 6, lastHint: "다음 편 예고 또는 요약 장표" },
      "자조 개그형": { cuts: 4, lastHint: "셀프 디스 한 줄로 마무리" },
      "잔잔한 위로형": { cuts: 4, lastHint: "저장 유도 문구" }
    }
  };

  // 512 좌표계, 얼굴 중심 (256, 300). 실제 제품에서는 작가가 그린 파츠로 교체.
  const SAMPLE_PARTS = {
    size: 512,
    layers: ["body", "clothes", "hairBack", "head", "eyes", "mouth", "hairFront", "accessory"],
    parts: {
      body: [{ id: "b1", svg: '<rect class="c-skin" x="216" y="400" width="80" height="60" rx="20"/>' }],
      clothes: [
        { id: "c1", svg: '<path class="c-clothes" d="M150 512 L170 430 Q256 400 342 430 L362 512 Z"/>' },
        { id: "c2", svg: '<path class="c-clothes" d="M160 512 L180 440 Q256 420 332 440 L352 512 Z"/><rect x="236" y="440" width="40" height="72" fill="#fff" opacity=".6"/>' }
      ],
      hairBack: [
        { id: "hb0", svg: "" },
        { id: "hb1", svg: '<path class="c-hair" d="M110 300 Q110 150 256 150 Q402 150 402 300 L402 470 L110 470 Z"/>' }
      ],
      head: [{ id: "h1", svg: '<circle class="c-skin" cx="256" cy="300" r="130"/><ellipse cx="176" cy="330" rx="20" ry="12" fill="#f7b3b3" opacity=".8"/><ellipse cx="336" cy="330" rx="20" ry="12" fill="#f7b3b3" opacity=".8"/>' }],
      eyes: [
        { id: "e-basic", expr: "basic", svg: '<circle cx="206" cy="290" r="14" fill="#222"/><circle cx="306" cy="290" r="14" fill="#222"/>' },
        { id: "e-smile", expr: "smile", svg: '<path d="M186 294 Q206 272 226 294" stroke="#222" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M286 294 Q306 272 326 294" stroke="#222" stroke-width="10" fill="none" stroke-linecap="round"/>' },
        { id: "e-surprise", expr: "surprise", svg: '<circle cx="206" cy="290" r="22" fill="#fff" stroke="#222" stroke-width="6"/><circle cx="206" cy="290" r="9" fill="#222"/><circle cx="306" cy="290" r="22" fill="#fff" stroke="#222" stroke-width="6"/><circle cx="306" cy="290" r="9" fill="#222"/>' }
      ],
      mouth: [
        { id: "m-basic", expr: "basic", svg: '<path d="M232 356 Q256 376 280 356" stroke="#222" stroke-width="9" fill="none" stroke-linecap="round"/>' },
        { id: "m-smile", expr: "smile", svg: '<path d="M222 350 Q256 392 290 350 Z" fill="#222"/>' },
        { id: "m-open", expr: "surprise", svg: '<ellipse cx="256" cy="362" rx="18" ry="26" fill="#222"/>' }
      ],
      hairFront: [
        { id: "hf1", svg: '<path class="c-hair" d="M126 300 Q126 170 256 170 Q386 170 386 300 Q330 230 256 240 Q182 230 126 300 Z"/>' },
        { id: "hf2", svg: '<path class="c-hair" d="M120 320 Q120 160 256 160 Q392 160 392 320 L392 250 Q350 200 256 210 Q162 200 120 250 Z"/><circle class="c-hair" cx="140" cy="280" r="34"/><circle class="c-hair" cx="372" cy="280" r="34"/>' },
        { id: "hf3", svg: '<path class="c-hair" d="M126 300 Q140 150 256 160 Q372 150 386 300 L386 260 Q320 190 300 250 Q270 200 220 250 Q190 200 126 260 Z"/>' }
      ],
      accessory: [
        { id: "a0", svg: "" },
        { id: "a-glasses", svg: '<circle cx="206" cy="292" r="34" fill="none" stroke="#333" stroke-width="7"/><circle cx="306" cy="292" r="34" fill="none" stroke="#333" stroke-width="7"/><path d="M240 292 L272 292" stroke="#333" stroke-width="7"/>' }
      ]
    },
    palettes: {
      hair: ["#2b2b2b", "#5b3a2e", "#e0a84f", "#c45c7a", "#4e6bd1", "#8f8f8f"],
      skin: ["#ffe6d5", "#f6d3b8", "#d9a98a"],
      clothes: ["#4e6bd1", "#3f8f6b", "#e07a5f", "#8f8f8f", "#f2c14e"]
    },
    exprByRole: { "도입": "basic", "전개": "smile", "전개1": "basic", "전개2": "smile", "위기": "surprise", "반전": "surprise", "마무리": "basic" }
  };

  const api = {
    rng, pick, josa, applyJosa, fill, makeTopicGenerator, combinationCountTopics,
    storyboard, SHOT,
    characterSVG, randomCharacter, combinationCountParts, svgToImage, tint,
    wrapText, drawBubble, drawSpeedlines, presets, renderCut, downloadCanvas,
    IG, checkCaption, renderFeed, drawSafeGuide,
    makeStore,
    SAMPLE_TOPICS, SAMPLE_BEATS, SAMPLE_PARTS
  };
  global.InstatoonKit = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
