/* 툰헬퍼 비트 시트 (03). 컷 수별 역할·샷·힌트·대사 템플릿.
 * lines의 [슬롯]은 소재 엔진의 chosen 값으로 채워진다. shot은 시안(05)의 캐릭터 크기를 정한다.
 */
window.TH_BEATS = {
  "4": [
    { role: "도입", goal: "상황 제시", shot: "풀샷", hint: "캐릭터 1명, 배경 1개, 대사 1줄. 썸네일이 되는 컷이라 후킹 문장",
      lines: [{ text: "오늘도 [장소]." }, { text: "[장소]에 가면 늘 이래.", w: 2 }, { text: "[장소], 평화로운 오후." }, { text: "또 [장소]이다.", w: 2 }, { text: "[인물]{과/와} [장소]에 있었다." }] },
    { role: "전개", goal: "문제·기대 발생", shot: "바스트샷", hint: "표정 변화 시작, 시선 방향으로 긴장감",
      lines: [{ text: "어? [사건]…", w: 2 }, { text: "설마 [사건]?" }, { text: "그런데 [사건]." }, { text: "잠깐, [사건]?!", w: 2 }, { text: "아… [사건]." }] },
    { role: "반전", goal: "예상 밖의 일", shot: "클로즈업", hint: "효과선, 큰 의성어, 배경 생략",
      lines: [{ text: "[반전]!!", w: 3 }, { text: "…[반전]." }, { text: "근데 [반전]?!" }, { text: "[반전]…!" }] },
    { role: "마무리", goal: "감정 한 줄로 정리", shot: "풀샷·침묵컷", hint: "여백 많이, 자조 또는 공감 한 줄",
      lines: [{ text: "[감정]." }, { text: "나만 이래…?", w: 3 }, { text: "[감정]… 다들 그렇죠?", w: 2 }, { text: "오늘의 교훈: 없음." }, { text: "그래서 [감정]{이/가} 됐다." }] }
  ],
  "6": [
    { role: "도입", goal: "상황 제시", shot: "풀샷", hint: "장소·인물 소개, 후킹 문장",
      lines: [{ text: "오늘도 [장소]." }, { text: "[장소], [인물]{과/와} 함께.", w: 2 }, { text: "[장소]에서 생긴 일." }] },
    { role: "전개1", goal: "일상 진행", shot: "풀샷", hint: "평범한 흐름, 독자가 자기 일처럼 느끼게",
      lines: [{ text: "[인물]{과/와} 평소처럼." }, { text: "아무 생각 없이 있었다.", w: 2 }, { text: "늘 하던 대로." }] },
    { role: "전개2", goal: "기대 생김", shot: "바스트샷", hint: "작은 기대 또는 불안",
      lines: [{ text: "설마 [사건]?" }, { text: "뭔가 느낌이 쎄하다.", w: 2 }, { text: "어… 잠깐만." }] },
    { role: "위기", goal: "사건 발생", shot: "바스트샷", hint: "표정 급변, 땀 효과",
      lines: [{ text: "[사건]!", w: 2 }, { text: "결국 [사건]." }, { text: "망했다. [사건]." }] },
    { role: "반전", goal: "예상 밖", shot: "클로즈업", hint: "효과선, 큰 의성어",
      lines: [{ text: "[반전]!!", w: 3 }, { text: "근데 [반전]." }] },
    { role: "마무리", goal: "정리", shot: "풀샷·침묵컷", hint: "여백, 한 줄 공감",
      lines: [{ text: "[감정]…" }, { text: "나만 이래…?", w: 2 }, { text: "[감정]. 끝." }, { text: "여러분은 어떠세요?" }] }
  ],
  "8": [
    { role: "표지", goal: "제목 장표", shot: "표지", hint: "제목 크게, 캐릭터 정면, 배경 단색. 피드에서 멈추게 하는 컷",
      lines: [{ text: "[장소]에서 [사건] 썰", w: 2 }, { text: "[감정] 주의" }, { text: "[장소] 편" }] },
    { role: "도입", goal: "상황 제시", shot: "풀샷", hint: "장소·인물 소개",
      lines: [{ text: "오늘도 [장소]." }, { text: "[인물]{과/와} [장소]에 갔다.", w: 2 }] },
    { role: "전개1", goal: "일상 진행", shot: "풀샷", hint: "평범한 흐름",
      lines: [{ text: "별일 없을 줄 알았다.", w: 2 }, { text: "평소처럼." }] },
    { role: "전개2", goal: "조짐", shot: "바스트샷", hint: "시선·표정으로 불안 암시",
      lines: [{ text: "근데 뭔가 이상했다." }, { text: "설마 [사건]?", w: 2 }] },
    { role: "위기", goal: "사건 발생", shot: "바스트샷", hint: "표정 급변, 땀 효과",
      lines: [{ text: "[사건]!!", w: 2 }, { text: "결국 [사건]." }] },
    { role: "반전", goal: "예상 밖", shot: "클로즈업", hint: "효과선, 큰 의성어",
      lines: [{ text: "[반전]!!", w: 3 }, { text: "…[반전]." }] },
    { role: "마무리", goal: "감정 정리", shot: "풀샷·침묵컷", hint: "여백, 한 줄",
      lines: [{ text: "[감정]…" }, { text: "그래서 [감정]{이/가} 됐다.", w: 2 }] },
    { role: "공감 요청", goal: "댓글·저장 유도", shot: "표지", hint: "캐릭터가 독자를 보며 질문. 저장·공유 유도 문구",
      lines: [{ text: "나만 이래…?", w: 3 }, { text: "여러분도 [장소]에서 이런 적 있나요?" }, { text: "공감되면 저장!" }] }
  ],
  "10": [
    { role: "표지", goal: "제목 장표", shot: "표지", hint: "제목 크게, 캐릭터 정면. '썰' 느낌의 제목",
      lines: [{ text: "[장소]에서 [사건] 썰.txt", w: 3 }, { text: "실화) [장소] 편" }, { text: "[감정] 주의보" }] },
    { role: "도입", goal: "상황 제시", shot: "풀샷", hint: "장소·인물 소개",
      lines: [{ text: "그날도 [장소]에 있었다.", w: 2 }, { text: "[인물]{과/와} [장소]." }] },
    { role: "전개1", goal: "일상 진행", shot: "풀샷", hint: "평범하게 시작",
      lines: [{ text: "별일 없을 줄 알았다.", w: 2 }, { text: "늘 하던 대로였다." }] },
    { role: "전개2", goal: "작은 변화", shot: "풀샷", hint: "배경에 복선 하나",
      lines: [{ text: "근데 [인물]{이/가} 좀 이상했다." }, { text: "뭔가 느낌이 쎄했다.", w: 2 }] },
    { role: "전개3", goal: "기대·불안 상승", shot: "바스트샷", hint: "표정 변화 시작",
      lines: [{ text: "설마… 아니겠지." , w: 2 }, { text: "에이, 설마 [사건]?" }] },
    { role: "전개4", goal: "결정적 행동", shot: "바스트샷", hint: "캐릭터가 뭔가를 한다",
      lines: [{ text: "그래서 그냥 했다." }, { text: "모른 척하기로 했다.", w: 2 }] },
    { role: "위기", goal: "사건 발생", shot: "바스트샷", hint: "표정 급변, 땀 효과",
      lines: [{ text: "[사건]!!", w: 3 }, { text: "결국 [사건]." }] },
    { role: "반전", goal: "예상 밖", shot: "클로즈업", hint: "효과선, 큰 의성어, 배경 생략",
      lines: [{ text: "[반전]!!", w: 3 }, { text: "…[반전]." }] },
    { role: "마무리", goal: "감정 정리", shot: "풀샷·침묵컷", hint: "여백, 한 줄",
      lines: [{ text: "[감정]…", w: 2 }, { text: "그날 이후로 [장소]{은/는} 못 간다." }] },
    { role: "공감 요청", goal: "댓글·다음 편 유도", shot: "표지", hint: "질문 또는 다음 편 예고. 요약 장표로 써도 좋다",
      lines: [{ text: "여러분도 이런 적 있나요?", w: 2 }, { text: "다음 편에 계속…", w: 2 }, { text: "공감되면 저장!" }] }
  ],
  tones: {
    "공감형": { cuts: 4, lastHint: "'나만 그런가요?' 류 질문으로 끝내 댓글 유도" },
    "자조 개그형": { cuts: 4, lastHint: "셀프 디스 한 줄로 마무리" },
    "썰 풀기형": { cuts: 10, lastHint: "다음 편 예고 또는 요약 장표" },
    "정보형": { cuts: 6, lastHint: "저장 유도 문구 + 요약 장표" },
    "잔잔한 위로형": { cuts: 6, lastHint: "'괜찮아' 류 한 줄, 여백 많이" },
    "일상 기록형": { cuts: 8, lastHint: "날짜·한 줄 소감으로 마무리" }
  },
  // 역할 → 표정 (04 exprByRole 과 맞춘다)
  exprByRole: {
    "표지": "smile", "도입": "basic", "전개": "smile", "전개1": "basic", "전개2": "smile", "전개3": "basic", "전개4": "wink",
    "위기": "sad", "반전": "surprise", "마무리": "blank", "공감 요청": "smile"
  },
  // 역할 → 기본 효과·말풍선 스타일 (05 자동 레이아웃)
  styleByRole: {
    "표지": { bubble: "none", fx: ["sparkles"], bg: "gradientWarm" },
    "도입": { bubble: "round", fx: [] },
    "전개": { bubble: "round", fx: [] }, "전개1": { bubble: "round", fx: [] }, "전개2": { bubble: "round", fx: [] },
    "전개3": { bubble: "think", fx: [] }, "전개4": { bubble: "round", fx: [] },
    "위기": { bubble: "shout", fx: ["sweat"] },
    "반전": { bubble: "shout", fx: ["speedlines"], bg: "blank" },
    "마무리": { bubble: "none", fx: [], caption: true },
    "공감 요청": { bubble: "round", fx: ["sparkles"], bg: "gradientCool" }
  }
};
