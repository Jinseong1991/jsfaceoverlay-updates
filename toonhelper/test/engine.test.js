/* 엔진 순수 함수 테스트. `npm test` (node --test) */
const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.window = globalThis;            // data/*.js 가 window.TH_* 에 붙인다
const K = require("../src/engine.js");
require("../src/data/topics.js");
require("../src/data/beats.js");
require("../src/data/parts.js");
const TOPICS = globalThis.TH_TOPICS, BEATS = globalThis.TH_BEATS, PARTS = globalThis.TH_PARTS;

test("rng: 같은 시드는 같은 순서", () => {
  const a = K.rng(42), b = K.rng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const v = K.rng(7)(); assert.ok(v >= 0 && v < 1);
});

test("pick: 가중치 0인 항목은 나오지 않고 합계가 맞는다", () => {
  const list = [{ text: "a", w: 1 }, { text: "b", w: 3 }];
  const r = K.rng(1); const count = { a: 0, b: 0 };
  for (let i = 0; i < 2000; i++) count[K.pick(list, r).text]++;
  assert.ok(count.b > count.a * 2, "b가 a보다 약 3배 많아야 함: " + JSON.stringify(count));
  assert.equal(K.pick([], r), null);
});

test("josa: 받침 유무에 따라 조사 선택", () => {
  assert.equal(K.josa("편의점", "이/가"), "편의점이");
  assert.equal(K.josa("친구", "이/가"), "친구가");
  assert.equal(K.josa("고양이", "과/와"), "고양이와");
  assert.equal(K.josa("지하철", "으로/로"), "지하철로");      // ㄹ 받침
  assert.equal(K.josa("집", "으로/로"), "집으로");
  assert.equal(K.applyJosa("[인물]{이/가}".replace("[인물]", "엄마") + " 왔다"), "엄마가 왔다");
});

test("fill: 슬롯 고정과 호환 규칙", () => {
  const slots = { "장소": [{ text: "편의점" }, { text: "헬스장" }], "사건": [{ text: "계산이 잘못 나왔다", only: ["장소/편의점"] }, { text: "운동했다", only: ["장소/헬스장"] }] };
  for (let s = 1; s < 30; s++) {
    const out = K.fill("[장소]에서 [사건]", slots, K.rng(s), { "장소": "헬스장" });
    assert.equal(out.chosen["장소"], "헬스장");
    assert.equal(out.chosen["사건"], "운동했다");
  }
});

test("makeTopicGenerator: 재현 가능, 고정값 반영, 톤 포함", () => {
  const g1 = K.makeTopicGenerator(TOPICS, { seed: 42 }), g2 = K.makeTopicGenerator(TOPICS, { seed: 42 });
  const a = g1(), b = g2();
  assert.equal(a.text, b.text); assert.deepEqual(a.id, { seed: 42, count: 0 });
  assert.ok(a.tone && a.chosen["톤"] === a.tone);
  const locked = g1({ "장소": "편의점", "톤": "공감형" });
  assert.equal(locked.chosen["장소"], "편의점"); assert.equal(locked.tone, "공감형");
  assert.ok(!/\[[^\]]+\]/.test(locked.text), "빈 슬롯이 남으면 안 됨: " + locked.text);
  assert.ok(!/\{[^}]+\}/.test(locked.text), "조사 마커가 남으면 안 됨: " + locked.text);
  // count 이어가기
  const g3 = K.makeTopicGenerator(TOPICS, { seed: 42, count: 1 });
  assert.equal(g3().id.count, 1);
});

test("데이터 품질: 모든 템플릿의 슬롯이 존재하고 후보가 충분하다", () => {
  const keys = new Set();
  TOPICS.templates.forEach(t => (t.text.match(/\[([^\]]+)\]/g) || []).forEach(m => keys.add(m.slice(1, -1))));
  keys.forEach(k => assert.ok(TOPICS.slots[k] && TOPICS.slots[k].length, "슬롯 없음: " + k));
  ["장소", "사건"].forEach(k => assert.ok(TOPICS.slots[k].length >= 30, k + " 후보 30개 이상"));
  ["인물", "감정", "반전"].forEach(k => assert.ok(TOPICS.slots[k].length >= 20, k + " 후보 20개 이상"));
  // only 규칙이 실제 값을 가리키는지
  Object.keys(TOPICS.slots).forEach(k => TOPICS.slots[k].forEach(x => (x.only || []).forEach(rule => {
    const [sk, sv] = [rule.slice(0, rule.indexOf("/")), rule.slice(rule.indexOf("/") + 1)];
    assert.ok(TOPICS.slots[sk].some(y => y.text === sv), "존재하지 않는 규칙 대상: " + rule);
  })));
  assert.ok(K.combinationCountTopics(TOPICS) > 1e8);
});

test("storyboard: 컷 수만큼, 대사에 슬롯이 채워진다", () => {
  const topic = K.makeTopicGenerator(TOPICS, { seed: 3 })();
  [4, 6, 8, 10].forEach(n => {
    const beats = K.storyboard(topic, BEATS, { cuts: n, seed: 3 });
    assert.equal(beats.length, n);
    beats.forEach((b, i) => { assert.equal(b.cut, i + 1); assert.ok(b.role && b.shot && b.line); assert.ok(!/\[[^\]]+\]/.test(b.line), "빈 슬롯: " + b.line); assert.ok(K.SHOT[b.shot], "알 수 없는 샷: " + b.shot); });
    assert.ok(beats[n - 1].hint.includes("·"), "마지막 컷에 톤 힌트");
  });
  Object.keys(BEATS.tones).forEach(t => assert.ok(BEATS[String(BEATS.tones[t].cuts)], "톤 " + t + "의 컷 수 비트 시트 존재"));
  const roles = new Set(); [4, 6, 8, 10].forEach(n => BEATS[String(n)].forEach(b => roles.add(b.role)));
  roles.forEach(r => assert.ok(BEATS.exprByRole[r], "표정 매핑 없음: " + r));
});

test("characterSVG / randomCharacter / cycleLayer", () => {
  const c = K.randomCharacter(PARTS, K.rng(9));
  PARTS.layers.forEach(l => assert.ok(PARTS.parts[l].some(p => p.id === c[l]), "레이어 " + l));
  Object.keys(PARTS.palettes).forEach(k => assert.ok(/^#[0-9a-f]{6}$/i.test(c.colors[k])));
  const svg = K.characterSVG(PARTS, c, { expr: "surprise" });
  assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"));
  assert.ok(svg.includes(".c-hair{fill:" + c.colors.hair + "}"));
  assert.ok(svg.includes(PARTS.parts.eyes.find(p => p.expr === "surprise").svg));
  const next = K.cycleLayer(PARTS, c, "hairFront", 1);
  assert.notEqual(next.hairFront, c.hairFront); assert.equal(next.colors, c.colors);
  assert.ok(K.combinationCountParts(PARTS) > 1e6);
  PARTS.exprs.forEach(e => { assert.ok(PARTS.parts.eyes.some(p => p.expr === e.id), "눈 표정 " + e.id); assert.ok(PARTS.parts.mouth.some(p => p.expr === e.id), "입 표정 " + e.id); });
});

test("checkCaption: 글자 수·해시태그·접힘", () => {
  const c = K.checkCaption("오늘도 편의점 #인스타툰 #일상툰 #인스타툰");
  assert.equal(c.hashtags, 3); assert.equal(c.dupHashtags, 1); assert.equal(c.folded, null);
  const long = K.checkCaption("가".repeat(200) + "\n" + "#t ".repeat(31));
  assert.ok(long.folded && Array.from(long.folded).length === 125); assert.ok(long.hashtagOver);
  assert.ok(K.checkCaption("나만 이래?").hasQuestion);
});

test("buildStoryPrompt / parseStoryReply 왕복", () => {
  const topic = K.makeTopicGenerator(TOPICS, { seed: 5 })();
  const beats = K.storyboard(topic, BEATS, { cuts: 4, seed: 5 });
  const prompt = K.buildStoryPrompt(topic, beats);
  assert.ok(prompt.includes(topic.text) && prompt.includes("4컷"));
  const reply = "안내문\n1 | 도입 | 풀샷 | 오늘도 편의점. | 캐릭터 1명\n2 | 전개 | 바스트샷 | 어? | 표정\n3 / 반전 / 클로즈업 / 헉!! / 효과선\n컷 4 | 마무리 | 풀샷 | 나만 이래? | 여백";
  const parsed = K.parseStoryReply(reply, beats);
  assert.equal(parsed.length, 4); assert.equal(parsed[2].line, "헉!!"); assert.equal(parsed[3].role, "마무리");
  assert.equal(K.parseStoryReply("아무 내용", beats), null);
});

test("buildImagePrompt: 파츠 라벨과 색이 들어간다", () => {
  const c = K.randomCharacter(PARTS, K.rng(11)); c.accessory = "a-glasses";
  const p = K.buildImagePrompt(c, { expr: "smile", shot: "풀샷", line: "안녕" }, PARTS);
  assert.ok(p.includes(c.colors.hair) && p.includes("동그란 안경") && p.includes('"안녕"'));
});

test("migrate: 구버전과 신버전 프로젝트 파일", () => {
  assert.deepEqual(K.migrate({ version: 1, state: { a: 1 } }), { a: 1 });
  assert.deepEqual(K.migrate({ a: 2 }), { a: 2 });
  assert.throws(() => K.migrate(null));
});
