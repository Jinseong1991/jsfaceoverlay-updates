# 05 · 시안 컷 생성 (Canvas 합성)

## 원리 한 줄
한 컷 = **배경 + 캐릭터(들) + 말풍선 + 대사 + 효과**. Canvas 2D에 순서대로 그리면 러프 시안이 되고, `toBlob`으로 PNG가 된다.

## 규격 원칙
- 작업 캔버스는 **1080×1350 (4:5)** 로 고정. 화면 표시는 CSS로 축소 (`canvas { width: 100%; height: auto }`).
- 1:1(1080×1080)이나 9:16(1080×1920)은 같은 코드에 크기만 바꾼다.
- 고해상도 내보내기가 필요하면 캔버스를 2배(2160×2700)로 만들고 `ctx.scale(2,2)`.

## 컷 데이터 스키마

```jsonc
{
  "size": [1080, 1350],
  "bg": { "type": "preset", "id": "room" },            // 또는 { "type":"color", "value":"#fff" }, { "type":"image", "src": "..." }
  "chars": [ { "ref": "main", "x": 540, "y": 820, "scale": 1.0, "flip": false, "expr": "surprise" } ],
  "bubbles": [ { "text": "알고 보니 내 착각이었다!!", "x": 120, "y": 140, "maxW": 600, "tail": [420, 520], "style": "shout" } ],
  "fx": [ { "type": "speedlines", "cx": 540, "cy": 700 } ],
  "caption": { "text": "", "y": 1280 }
}
```

- `chars[].ref`는 04의 캐릭터 선택값 키. `scale`은 03의 `shot`에서 자동 결정: 풀샷 0.8, 바스트샷 1.4(y를 내려서 상반신만), 클로즈업 2.2.
- `expr`은 03의 역할 → 04의 `exprByRole`로 자동.

## 핵심 코드

```js
import { characterSVG, svgToImage } from "./04";

// 1) 한글 줄바꿈: 글자 단위로 자르되 공백이 있으면 단어 우선
export function wrapText(ctx, text, maxW) {
  const out = []; let line = "";
  for (const word of text.split(/(\s+)/)) {
    if (ctx.measureText(line + word).width <= maxW) { line += word; continue; }
    if (line) { out.push(line.trimEnd()); line = ""; }
    if (ctx.measureText(word).width <= maxW) { line = word; continue; }
    for (const ch of word) {                           // 긴 단어는 글자 단위
      if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
    }
  }
  if (line) out.push(line.trimEnd());
  return out;
}

// 2) 말풍선: 텍스트 크기를 먼저 재고 그 크기로 그린다
export function drawBubble(ctx, b, { font = "600 34px 'Noto Sans KR', sans-serif", pad = 28, lineH = 46, radius = 28 } = {}) {
  ctx.save(); ctx.font = font;
  const lines = wrapText(ctx, b.text, (b.maxW || 600) - pad * 2);
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lineH + pad * 2 - (lineH - 34);
  // 꼬리
  if (b.tail) {
    ctx.beginPath(); ctx.moveTo(b.x + w * 0.35, b.y + h); ctx.lineTo(b.tail[0], b.tail[1]); ctx.lineTo(b.x + w * 0.5, b.y + h);
    ctx.closePath(); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#222"; ctx.lineWidth = 5; ctx.stroke();
  }
  // 몸통 (shout 스타일이면 뾰족 테두리)
  ctx.beginPath();
  if (b.style === "shout") spikyRect(ctx, b.x, b.y, w, h, 14); else ctx.roundRect(b.x, b.y, w, h, radius);
  ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#222"; ctx.lineWidth = 5; ctx.stroke();
  // 꼬리 이음새 가리기
  if (b.tail) { ctx.beginPath(); ctx.roundRect(b.x + 3, b.y + 3, w - 6, h - 6, radius); ctx.fillStyle = "#fff"; ctx.fill(); }
  ctx.fillStyle = "#222"; ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, b.x + pad, b.y + pad + i * lineH));
  ctx.restore();
  return { w, h };
}
function spikyRect(ctx, x, y, w, h, n) {
  const pts = []; const per = Math.ceil(n / 4);
  for (let i = 0; i < per; i++) pts.push([x + (w * i) / per, y - (i % 2 ? 18 : 0)]);
  for (let i = 0; i < per; i++) pts.push([x + w + (i % 2 ? 18 : 0), y + (h * i) / per]);
  for (let i = 0; i < per; i++) pts.push([x + w - (w * i) / per, y + h + (i % 2 ? 18 : 0)]);
  for (let i = 0; i < per; i++) pts.push([x - (i % 2 ? 18 : 0), y + h - (h * i) / per]);
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath();
}

// 3) 효과선
export function drawSpeedlines(ctx, cx, cy, { count = 48, inner = 260, outer = 1400 } = {}) {
  ctx.save(); ctx.strokeStyle = "#222"; ctx.lineWidth = 3;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (i % 3) * 0.02;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer); ctx.stroke();
  }
  ctx.restore();
}

// 4) 컷 전체 렌더
export async function renderCut(canvas, cut, characters /* {ref: choice} */, partsData, presets) {
  const [W, H] = cut.size || [1080, 1350];
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  // 배경
  if (cut.bg?.type === "color") { ctx.fillStyle = cut.bg.value; ctx.fillRect(0, 0, W, H); }
  else if (cut.bg?.type === "preset") presets[cut.bg.id]?.(ctx, W, H);
  else { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); }
  // 효과 (캐릭터 뒤)
  for (const f of cut.fx || []) if (f.type === "speedlines") drawSpeedlines(ctx, f.cx, f.cy);
  // 캐릭터
  for (const c of cut.chars || []) {
    const img = await svgToImage(characterSVG(partsData, characters[c.ref], { expr: c.expr }));
    const s = (c.scale || 1) * (W / 1080) * 1.2 * (partsData.size / 512);
    const w = partsData.size * s, h = partsData.size * s;
    ctx.save(); ctx.translate(c.x, c.y); if (c.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
  }
  // 말풍선
  for (const b of cut.bubbles || []) drawBubble(ctx, b);
  // 캡션
  if (cut.caption?.text) { ctx.font = "400 30px 'Noto Sans KR'"; ctx.fillStyle = "#444"; ctx.textAlign = "center"; ctx.fillText(cut.caption.text, W / 2, cut.caption.y || H - 70); }
}

// 5) 내보내기
export function downloadCanvas(canvas, filename = "cut.png") {
  canvas.toBlob(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, "image/png");
}
```

## 배경 프리셋 (코드로 그리는 배경)
```js
export const presets = {
  room:   (ctx, W, H) => { ctx.fillStyle = "#f4efe6"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#e3d8c6"; ctx.fillRect(0, H * 0.62, W, H); },
  street: (ctx, W, H) => { ctx.fillStyle = "#dfeefc"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#9aa7b5"; ctx.fillRect(0, H * 0.7, W, H); },
  blank:  (ctx, W, H) => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); }
};
```
작가가 그린 배경 PNG를 쓰려면 `{type:"image", src:"data:..."}`로 두고 `drawImage(img,0,0,W,H)`.

## 주의
- **폰트 로딩 전에 그리면 기본 폰트로 나온다.** `await document.fonts.load("600 34px 'Noto Sans KR'")` 뒤에 렌더.
- 외부 URL 이미지를 그리면 캔버스가 "오염"되어 `toBlob`이 실패한다. 파츠·배경은 **data URI 또는 같은 파일 안**에 둔다 (08의 단일 HTML과 맞물림).
- 화면 표시용 캔버스와 내보내기용 캔버스를 분리하면 미리보기가 빨라진다.

## 응용 가능한 곳
카드뉴스 생성기, 유튜브 썸네일 생성기, 명함·스티커·굿즈 시안, 밈 생성기, 상품 상세 이미지 자동화.
