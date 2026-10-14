# 04 · 캐릭터 생성 (파츠 레이어 합성)

## 원리 한 줄
캐릭터를 통째로 그리지 않고 **투명 배경 파츠(몸·옷·머리·눈·입·소품)** 를 **같은 좌표계**에 겹친다. 파츠 종류의 곱이 캐릭터 수다. 색은 코드로 치환한다.

## 파츠 제작 규칙 (가장 중요)
1. **모든 파츠는 같은 캔버스 크기**로 그린다 (예: 512×512, SVG면 `viewBox="0 0 512 512"`). 얼굴 중심 좌표를 고정(예: 256, 300)하고 모든 파츠를 그 기준으로 그린다.
2. **레이어 순서**를 파일명에 박는다: `10-body`, `20-clothes`, `30-head`, `40-hair-back`… `90-accessory`. 숫자 순서가 그리는 순서.
3. **색 치환 대상은 단색**으로 그린다. SVG면 `fill="currentColor"` 또는 `class="c-hair"`로 표시. PNG면 흰색(#fff) 단색으로 그린다.
4. 머리는 **앞머리(hair-front, 눈 위)** 와 **뒷머리(hair-back, 머리 뒤)** 로 나눈다. 레이어 순서가 다르다.
5. 눈·입은 **표정 세트**로 묶는다 (기본·웃음·놀람·울상·무표정). 03의 비트 역할과 매핑하면 컷마다 표정이 자동으로 바뀐다.

## 데이터 스키마

```jsonc
// parts.json  (SVG 권장. 용량이 작고 색 치환이 쉽다)
{
  "size": 512,
  "layers": ["body", "clothes", "hairBack", "head", "eyes", "mouth", "hairFront", "accessory"],
  "parts": {
    "body":      [ { "id": "b1", "svg": "<path .../>" } ],
    "clothes":   [ { "id": "c1", "svg": "<path class='c-clothes' .../>" }, { "id": "c2", "svg": "..." } ],
    "hairBack":  [ { "id": "hb0", "svg": "" }, { "id": "hb1", "svg": "<path class='c-hair' .../>" } ],
    "head":      [ { "id": "h1", "svg": "<circle class='c-skin' cx='256' cy='300' r='130'/>" } ],
    "eyes":      [ { "id": "e-basic", "svg": "...", "expr": "basic" }, { "id": "e-smile", "svg": "...", "expr": "smile" } ],
    "mouth":     [ { "id": "m-basic", "svg": "...", "expr": "basic" }, { "id": "m-open", "svg": "...", "expr": "surprise" } ],
    "hairFront": [ { "id": "hf1", "svg": "<path class='c-hair' .../>" } ],
    "accessory": [ { "id": "a0", "svg": "" }, { "id": "a-glasses", "svg": "..." } ]
  },
  "palettes": {
    "hair":    ["#2b2b2b", "#5b3a2e", "#e0a84f", "#c45c7a", "#4e6bd1"],
    "skin":    ["#ffe6d5", "#f6d3b8", "#d9a98a"],
    "clothes": ["#4e6bd1", "#3f8f6b", "#e07a5f", "#8f8f8f"]
  },
  "exprByRole": { "도입": "basic", "전개": "smile", "반전": "surprise", "마무리": "basic" }
}
```

## 핵심 코드 (SVG 방식)

```js
// 선택값만 저장한다. 그림은 언제든 다시 조립 가능.
// choice = { body:"b1", clothes:"c2", hairBack:"hb1", head:"h1", eyes:"e-basic", mouth:"m-basic", hairFront:"hf1", accessory:"a0",
//            colors:{ hair:"#5b3a2e", skin:"#ffe6d5", clothes:"#4e6bd1" } }

export function characterSVG(data, choice, { expr } = {}) {
  const find = (layer, id) => data.parts[layer].find(p => p.id === id) || data.parts[layer][0];
  const body = data.layers.map(layer => {
    let part = find(layer, choice[layer]);
    if (expr && (layer === "eyes" || layer === "mouth")) {            // 표정 덮어쓰기
      part = data.parts[layer].find(p => p.expr === expr) || part;
    }
    return part.svg;
  }).join("");
  const css = `<style>.c-hair{fill:${choice.colors.hair}}.c-skin{fill:${choice.colors.skin}}.c-clothes{fill:${choice.colors.clothes}}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.size} ${data.size}">${css}${body}</svg>`;
}

export function randomCharacter(data, r /* 02의 rng */) {
  const choice = { colors: {} };
  for (const layer of data.layers) {
    const list = data.parts[layer]; choice[layer] = list[Math.floor(r() * list.length)].id;
  }
  for (const k of Object.keys(data.palettes)) {
    const pal = data.palettes[k]; choice.colors[k] = pal[Math.floor(r() * pal.length)];
  }
  return choice;
}

export function combinationCount(data) {
  const parts = data.layers.reduce((a, l) => a * data.parts[l].length, 1);
  const colors = Object.values(data.palettes).reduce((a, p) => a * p.length, 1);
  return parts * colors;
}

// SVG 문자열 → Image 객체 (05 캔버스에 그릴 때)
export function svgToImage(svgString) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
  });
}
```

## PNG 파츠를 쓸 때의 색 치환

```js
// 단색(흰색) PNG 파츠에 색을 입힌다. 알파는 유지된다.
export function tint(img, color, size = 512) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0, size, size);
  x.globalCompositeOperation = "source-in";   // 기존 픽셀이 있는 곳에만 칠함
  x.fillStyle = color; x.fillRect(0, 0, size, size);
  return c;   // drawImage(c, ...) 로 사용
}
// 음영이 있는 파츠는 "multiply" 레이어를 따로 두고, 단색 베이스 위에 multiply로 올린다.
```

## 자주 하는 실수
- 파츠마다 캔버스 크기나 기준점이 달라 눈이 얼굴 밖으로 나감 → 규칙 1.
- 앞머리를 눈 아래 레이어에 둬서 눈이 머리를 뚫고 나옴 → 규칙 4.
- 그림(base64)을 localStorage에 저장해 5MB 한도 초과 → 선택값만 저장 (07).
- 조합 수만 많고 "같은 캐릭터로 보이는" 변형이 많음 → 실루엣이 다른 파츠(머리형·체형) 수를 먼저 늘린다.

## 응용 가능한 곳
이모티콘 세트 생성, 아바타/프로필 생성기, 굿즈 시안, 얼굴 오버레이(기준점 고정 + 레이어 순서 원칙 동일), 게임 캐릭터 커스터마이즈.
