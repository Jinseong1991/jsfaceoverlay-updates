/* 툰헬퍼 배경 프리셋 (05). 코드로 그리는 배경 — 외부 이미지 0개 (캔버스 오염 방지).
 * 각 함수는 (ctx, W, H)를 받아 전체를 채운다. 작가가 그린 배경 PNG는 bg:{type:"image"}로 추가한다.
 */
(function () {
  function floor(ctx, W, H, top, color) { ctx.fillStyle = color; ctx.fillRect(0, H * top, W, H); }
  function stripes(ctx, W, H, color, gap, angle) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.translate(W / 2, H / 2); ctx.rotate(angle || 0);
    for (let x = -W; x < W; x += gap) { ctx.beginPath(); ctx.moveTo(x, -H); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.restore();
  }
  const P = {
    blank: { label: "흰 배경", draw: (ctx, W, H) => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); } },
    cream: { label: "크림", draw: (ctx, W, H) => { ctx.fillStyle = "#fbf6ec"; ctx.fillRect(0, 0, W, H); } },
    room: { label: "방 안", draw: (ctx, W, H) => {
      ctx.fillStyle = "#f4efe6"; ctx.fillRect(0, 0, W, H); floor(ctx, W, H, 0.62, "#e3d8c6");
      ctx.fillStyle = "#d9e6f2"; ctx.fillRect(W * 0.62, H * 0.16, W * 0.26, H * 0.22);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 10; ctx.strokeRect(W * 0.62, H * 0.16, W * 0.26, H * 0.22);
      ctx.beginPath(); ctx.moveTo(W * 0.75, H * 0.16); ctx.lineTo(W * 0.75, H * 0.38); ctx.moveTo(W * 0.62, H * 0.27); ctx.lineTo(W * 0.88, H * 0.27); ctx.stroke();
      ctx.fillStyle = "#c9b79c"; ctx.fillRect(W * 0.08, H * 0.5, W * 0.3, H * 0.14); ctx.fillStyle = "#b7a284"; ctx.fillRect(W * 0.1, H * 0.64, W * 0.04, H * 0.08); ctx.fillRect(W * 0.32, H * 0.64, W * 0.04, H * 0.08);
    } },
    street: { label: "거리", draw: (ctx, W, H) => {
      ctx.fillStyle = "#dfeefc"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#c7d3df"; [0.05, 0.3, 0.6, 0.8].forEach((x, i) => ctx.fillRect(W * x, H * (0.28 + (i % 2) * 0.1), W * 0.18, H * 0.45));
      floor(ctx, W, H, 0.7, "#9aa7b5"); ctx.fillStyle = "#fff"; for (let x = 0; x < W; x += 140) ctx.fillRect(x, H * 0.84, 80, 16);
    } },
    cafe: { label: "카페", draw: (ctx, W, H) => {
      ctx.fillStyle = "#f3e7d8"; ctx.fillRect(0, 0, W, H); floor(ctx, W, H, 0.64, "#b98a62");
      ctx.fillStyle = "#e8d6c0"; ctx.fillRect(0, H * 0.1, W, H * 0.04);
      ctx.fillStyle = "#7a4e2d"; ctx.fillRect(W * 0.06, H * 0.52, W * 0.34, H * 0.05); ctx.fillRect(W * 0.1, H * 0.57, W * 0.03, H * 0.1);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(W * 0.16, H * 0.45, W * 0.07, H * 0.06, 10); ctx.fill();
      ctx.fillStyle = "#d9b99a"; ctx.beginPath(); ctx.arc(W * 0.8, H * 0.3, W * 0.09, 0, Math.PI * 2); ctx.fill();
    } },
    office: { label: "사무실", draw: (ctx, W, H) => {
      ctx.fillStyle = "#eef1f5"; ctx.fillRect(0, 0, W, H); floor(ctx, W, H, 0.66, "#cfd5dd");
      ctx.fillStyle = "#dfe5ec"; for (let x = 0; x < W; x += W / 4) ctx.fillRect(x + 20, H * 0.12, W / 4 - 40, H * 0.3);
      ctx.fillStyle = "#b9c2cc"; ctx.fillRect(W * 0.55, H * 0.5, W * 0.4, H * 0.04); ctx.fillStyle = "#333"; ctx.fillRect(W * 0.68, H * 0.38, W * 0.16, H * 0.11);
    } },
    subway: { label: "지하철", draw: (ctx, W, H) => {
      ctx.fillStyle = "#e9eef2"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#cfd8e0"; ctx.fillRect(0, H * 0.14, W, H * 0.26); ctx.fillStyle = "#b8c4ce"; for (let x = 20; x < W; x += W / 3) ctx.fillRect(x, H * 0.16, W / 3 - 40, H * 0.22);
      floor(ctx, W, H, 0.62, "#9fb0bf"); ctx.fillStyle = "#4e6bd1"; ctx.fillRect(0, H * 0.56, W, H * 0.06);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 8; for (let x = W * 0.1; x < W; x += W * 0.25) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H * 0.14); ctx.stroke(); }
    } },
    night: { label: "밤", draw: (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#1d2440"); g.addColorStop(1, "#3b4a7a"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff"; for (let i = 0; i < 40; i++) { const x = (i * 97) % W, y = (i * 173) % (H * 0.6); ctx.fillRect(x, y, 4, 4); }
      ctx.fillStyle = "#ffe9a8"; ctx.beginPath(); ctx.arc(W * 0.8, H * 0.18, 60, 0, Math.PI * 2); ctx.fill();
      floor(ctx, W, H, 0.72, "#222b4a");
    } },
    park: { label: "공원", draw: (ctx, W, H) => {
      ctx.fillStyle = "#dff3ff"; ctx.fillRect(0, 0, W, H); floor(ctx, W, H, 0.6, "#a8d672");
      ctx.fillStyle = "#6fb24a"; [0.12, 0.5, 0.85].forEach(x => { ctx.beginPath(); ctx.arc(W * x, H * 0.5, W * 0.12, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = "#8a5a2b"; [0.12, 0.5, 0.85].forEach(x => ctx.fillRect(W * x - 14, H * 0.55, 28, H * 0.1));
      ctx.fillStyle = "#fff"; [0.2, 0.65].forEach(x => { ctx.beginPath(); ctx.ellipse(W * x, H * 0.15, 110, 40, 0, 0, Math.PI * 2); ctx.fill(); });
    } },
    gradientWarm: { label: "따뜻한 그라데이션", draw: (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#ffe0c2"); g.addColorStop(1, "#ffb3a7"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } },
    gradientCool: { label: "시원한 그라데이션", draw: (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#d6e8ff"); g.addColorStop(1, "#c9b8ff"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } },
    dots: { label: "도트 패턴", draw: (ctx, W, H) => {
      ctx.fillStyle = "#fff8ef"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#f3d9c4";
      for (let y = 30; y < H; y += 70) for (let x = 30 + ((y / 70) % 2) * 35; x < W; x += 70) { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); }
    } },
    lines: { label: "사선 패턴", draw: (ctx, W, H) => { ctx.fillStyle = "#eef7f2"; ctx.fillRect(0, 0, W, H); stripes(ctx, W, H, "#cfe6da", 48, Math.PI / 4); } },
    focus: { label: "집중 배경", draw: (ctx, W, H) => {
      const g = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, H * 0.8); g.addColorStop(0, "#fff"); g.addColorStop(1, "#ffd8d8"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } }
  };
  // 엔진이 쓰는 {id: fn} 형태와 UI용 라벨을 함께 노출
  window.TH_PRESETS = {};
  window.TH_PRESET_LIST = [];
  Object.keys(P).forEach(id => { window.TH_PRESETS[id] = P[id].draw; window.TH_PRESET_LIST.push({ id, label: P[id].label }); });
  // 장소 → 어울리는 배경
  window.TH_BG_BY_PLACE = {
    "편의점": "street", "새벽 편의점 앞": "night", "지하철": "subway", "버스 맨 뒷자리": "subway", "회사 탕비실": "office", "회의실": "office", "줌 회의 화면": "office",
    "카페 구석 자리": "cafe", "자취방 침대 위": "room", "엄마 집": "room", "친구 집 거실": "room", "공원 벤치": "park", "놀이터": "park", "출근길 횡단보도": "street",
    "헬스장": "lines", "단톡방": "dots", "화장실 거울 앞": "cream", "회식 자리": "night", "택시 안": "night"
  };
})();
