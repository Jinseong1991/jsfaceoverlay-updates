# 02 · 소재 추천 (조합 엔진)

## 원리 한 줄
문장을 **템플릿 + 슬롯**으로 나누고, 슬롯마다 후보 배열에서 **가중치 랜덤**으로 뽑아 채운다. **시드 난수**로 재현 가능하게 하고, **최근 결과를 기억**해 반복을 막는다.

## 데이터 스키마

```jsonc
// topics.json
{
  "slots": {
    "장소": [ { "text": "편의점", "w": 3 }, { "text": "지하철", "w": 3 }, { "text": "회사 탕비실", "w": 2 }, { "text": "헬스장" } ],
    "인물": [ { "text": "나", "w": 4 }, { "text": "친구", "w": 2 }, { "text": "직장 상사" }, { "text": "고양이" } ],
    "사건": [ { "text": "아는 사람을 못 본 척했다", "w": 2 }, { "text": "혼잣말을 들켰다", "w": 2 }, { "text": "핸드폰을 두고 왔다" } ],
    "감정": [ { "text": "민망함", "w": 3 }, { "text": "억울함", "w": 2 }, { "text": "귀찮음", "w": 2 }, { "text": "설렘" } ],
    "반전": [ { "text": "알고 보니 내 착각이었다", "w": 3 }, { "text": "상대도 똑같이 생각하고 있었다", "w": 2 } ],
    "톤":   [ { "text": "공감형", "w": 3 }, { "text": "썰 풀기형", "w": 2 }, { "text": "자조 개그형", "w": 2 } ]
  },
  "templates": [
    { "text": "[장소]에서 [인물]이(가) [사건]. 감정은 [감정]. 반전: [반전]", "w": 3 },
    { "text": "[인물]과(와) [장소]에 갔다가 [사건]. [감정]을 느꼈는데, [반전]", "w": 2 },
    { "text": "[장소] 편. [사건] → [감정] → [반전]" }
  ],
  "tags": { "장소/편의점": ["일상", "알바"], "감정/현타": ["직장"] }   // 선택: 카테고리 필터용
}
```

- `w` 생략 시 1. 자주 먹히는 소재에 2~4를 준다.
- 슬롯은 **6개 내외, 후보는 슬롯당 30개 이상**이어야 반복이 눈에 띄지 않는다. 6슬롯 × 30개 = 7.3억 조합.
- 조사 "이(가)", "과(와)"는 데이터에서 양쪽을 다 써 두거나, 아래 `josa()`로 자동 처리.

## 핵심 코드

```js
// 1) 시드 난수 (LCG). 같은 시드 → 같은 순서. "이 결과 다시 보기"의 기반
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 2) 가중치 랜덤
export function pick(list, r) {
  const total = list.reduce((a, x) => a + (x.w || 1), 0);
  let n = r() * total;
  for (const x of list) { n -= (x.w || 1); if (n < 0) return x; }
  return list[list.length - 1];
}

// 3) 슬롯 템플릿 채우기. 선택값도 함께 돌려줘서 저장·재현에 쓴다
export function fill(template, slots, r) {
  const chosen = {};
  const text = template.replace(/\[([^\]]+)\]/g, (_, key) => {
    const item = pick(slots[key], r); chosen[key] = item.text; return item.text;
  });
  return { text, chosen };
}

// 4) 한국어 조사 자동 처리 (받침 유무)
export function josa(word, pair /* "이/가", "을/를", "과/와", "은/는" */) {
  const [a, b] = pair.split("/");
  const code = word.charCodeAt(word.length - 1);
  const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return word + (hasBatchim ? a : b);
}
// 템플릿에서는 "[인물]{이/가}" 처럼 쓰고, fill 후 후처리:
export function applyJosa(text) {
  return text.replace(/(\S+?)\{([^}]+)\}/g, (_, w, pair) => josa(w, pair));
}

// 5) 중복 회피 + 고정(lock) 지원 생성기
export function makeTopicGenerator(data, { seed = 1, memory = 8 } = {}) {
  let count = 0; const recent = [];
  return function next(locked = {}) {
    const r = rng(seed * 7919 + count * 104729); count++;
    let out, tries = 0;
    do {
      const tpl = pick(data.templates, r).text;
      out = fill(tpl, data.slots, r);
      for (const k of Object.keys(locked)) {             // 고정된 슬롯은 덮어쓰기
        out.chosen[k] = locked[k];
        out.text = out.text.replace(new RegExp(`\\[${k}\\]`), locked[k]);
      }
      tries++;
    } while (recent.includes(out.text) && tries < 10);
    recent.push(out.text); if (recent.length > memory) recent.shift();
    out.text = applyJosa(out.text);
    out.tone = pick(data.slots.톤, r).text;
    out.id = { seed, count: count - 1 };               // 재현용 좌표
    return out;
  };
}
```

## 사용 예

```js
const gen = makeTopicGenerator(topicsData, { seed: 42 });
const t1 = gen();                               // 랜덤
const t2 = gen({ 장소: "편의점" });             // 장소 고정, 나머지 랜덤
// t1.id = {seed:42, count:0} → 같은 시드·카운트로 다시 만들면 동일 결과
```

## UI 패턴 (HITS류 프로그램에서 흔한 것)
- **다시 뽑기** 버튼 (count 증가)
- **슬롯 고정** 토글 (마음에 드는 장소만 두고 나머지 다시)
- **복사** 버튼 (`navigator.clipboard.writeText`)
- **즐겨찾기** (chosen 객체를 localStorage 배열에 push, 07 참조)
- **카테고리 필터** (tags로 후보 배열을 미리 걸러서 slots를 재구성)

## 응용 가능한 곳
같은 엔진으로 제목 추천, 해시태그 추천, 대사 추천, 색 조합 추천, 릴스 후킹 문장, 블로그 제목, 상품 설명 문구 생성이 된다. 데이터 파일만 바꾸면 된다.

## 품질을 올리는 요령
- 슬롯 간 **호환성 규칙**: `사건`에 `only: ["장소/편의점","장소/지하철"]` 같은 제한을 두면 "헬스장에서 계산이 잘못 나왔다" 같은 어색한 조합을 막는다. 구현은 pick 전에 필터.
- **2단계 생성**: 먼저 `톤`을 뽑고, 톤별로 다른 템플릿 집합을 쓰면 결과 결이 일정해진다.
- **사용자 데이터 추가**: 사용자가 자기 슬롯 후보를 추가할 수 있게 하면(localStorage) 반복 문제가 거의 사라진다.
