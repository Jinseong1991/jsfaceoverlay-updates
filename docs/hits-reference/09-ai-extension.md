# 09 · 나중에 AI를 붙이는 법 (서버비 없이)

규칙 기반(01의 방식 A)으로 시작한 뒤 생성형 AI를 더하고 싶을 때, **개발자가 서버비를 내지 않는** 두 가지 길이 있다.

## 길 1 · 프롬프트 복사 모드 (방식 B)
프로그램이 **완성된 프롬프트**를 만들고, 사용자가 ChatGPT·Claude·미드저니 웹에 붙여넣는다.

```js
export function buildStoryPrompt(topic, beats, style = { cuts: 4, tone: "공감형" }) {
  return [
    `다음 소재로 인스타툰 ${style.cuts}컷 콘티를 써 주세요. 톤: ${style.tone}.`,
    `소재: ${topic.text}`,
    `각 컷은 "컷 번호 / 역할 / 연출(샷) / 대사 1~2줄 / 그림 지시" 형식으로.`,
    `역할 순서: ${beats.map(b => b.role).join(" → ")}.`,
    `대사는 한국어 구어체, 한 컷당 25자 이내. 마지막 컷은 댓글을 유도하는 질문으로.`
  ].join("\n");
}

export function buildImagePrompt(character, cut) {
  // 캐릭터 선택값(04)을 말로 풀어 일관성을 유지하는 "캐릭터 시트" 문장
  return `simple Korean instatoon style, 2-head chibi, flat colors, thick clean outline, white background, ` +
         `hair ${character.colors.hair} ${character.hairFront}, ${cut.expr} expression, ${cut.shot}, ` +
         `speech bubble text "${cut.line}"`;
}
```
UI: 프롬프트 미리보기 영역 + **복사** 버튼 + "ChatGPT에 붙여넣기" 링크. 결과를 다시 붙여넣는 입력창을 두면 03의 콘티 카드에 반영할 수 있다 (줄 단위 파싱).

장점: 비용 0, 구현 1시간. 단점: 복붙 수작업.

## 길 2 · BYOK (사용자 본인의 API 키)
사용자가 자기 키를 입력하면 브라우저가 **직접** AI 서비스에 요청한다. 키는 localStorage에만 둔다.

```js
const KEYSTORE = "mytool:apikey";
export function setKey(k) { try { localStorage.setItem(KEYSTORE, k); } catch (e) {} }
export function getKey() { try { return localStorage.getItem(KEYSTORE) || ""; } catch (e) { return ""; } }

// Claude Messages API 예시 (브라우저 직접 호출용 헤더 필요)
export async function askClaude(prompt, { model = "claude-sonnet-5-5", maxTokens = 1024 } = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": getKey(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"   // 브라우저 직접 호출 허용 헤더
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.content.map(c => c.text || "").join("");
}
```
- 모델 ID와 헤더는 바뀔 수 있으니 출시 전에 공식 문서로 확인 (`claude-api` 스킬 참고).
- 키 입력 UI에 "키는 이 브라우저에만 저장되며 어디에도 전송되지 않습니다(해당 AI 서비스 제외)" 문구.
- `file://`에서 fetch가 CORS로 막히는 서비스도 있다. 그 경우 사용자에게 로컬 서버로 열라고 안내하거나 길 1로 폴백.

장점: 진짜 생성, 서버비 0. 단점: 사용자가 키 발급을 해야 함 (초보자 진입 장벽).

## 길 3 · 브라우저 내 모델 (방식 C, 참고만)
- 텍스트: WebLLM (`@mlc-ai/web-llm`), transformers.js. 한국어 품질 좋은 소형 모델은 1~4GB.
- 이미지: 브라우저 Stable Diffusion은 실용성 낮음 (GPU·메모리).
- 단일 HTML 상품과는 궁합이 나쁘다 (파일 크기, 첫 로딩). 데스크톱 앱(Electron/Tauri)으로 갈 때 고려.

## 하이브리드 권장 구성
```
기본값: 규칙 기반(A) — 항상 작동, 오프라인
옵션 1: "AI로 다듬기" 버튼 → 프롬프트 복사(B)
옵션 2: 설정에서 API 키 입력 시 → 버튼이 직접 호출(BYOK)로 바뀜
```
이렇게 하면 "API 없이도 돌아간다"는 약속을 지키면서, 원하는 사용자만 AI 품질을 얻는다.
