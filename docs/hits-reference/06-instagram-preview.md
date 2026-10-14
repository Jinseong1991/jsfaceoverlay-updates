# 06 · 인스타 미리보기 (규격 목업)

## 원리 한 줄
인스타그램 화면을 흉내 낸 **비율이 맞는 HTML 틀**에 내 이미지를 끼운다. 그림 기술이 아니라 **규격 지식**이 핵심이다.

## 규격표 (2026년 기준, 데이터 설계 시 상수로 둔다)

| 항목 | 값 | 비고 |
|---|---|---|
| 게시물 세로 | 1080×1350 (4:5) | 피드에서 가장 크게 보임. 인스타툰 표준 |
| 게시물 정사각 | 1080×1080 (1:1) | |
| 게시물 가로 | 1080×566 (1.91:1) | 인스타툰엔 거의 안 씀 |
| 스토리/릴스 | 1080×1920 (9:16) | 상단 250px·하단 250px는 UI에 가려짐 |
| 캐러셀 최대 장수 | 20 | |
| 프로필 그리드 썸네일 | 1:1 중앙 크롭 (앱 버전에 따라 3:4 표시도 있음) | 4:5 컷의 위아래가 잘림 → 이걸 보여주는 게 이 기능의 가치 |
| 캡션 | 2,200자 | 125자 이후 "더 보기"로 접힘 |
| 해시태그 | 최대 30개 | |
| 안전 영역 | 가장자리 60px | 텍스트·얼굴은 안쪽에 |

```js
export const IG = {
  post45: [1080, 1350], post11: [1080, 1080], story: [1080, 1920],
  carouselMax: 20, captionMax: 2200, captionFold: 125, hashtagMax: 30, safe: 60,
  storyUnsafeTop: 250, storyUnsafeBottom: 250
};
```

## HTML/CSS 뼈대

```html
<!-- 캐러셀 1장 미리보기 -->
<div class="ig-post">
  <div class="ig-head"><span class="avatar"></span><b>my_toon</b></div>
  <div class="ig-frame r45"><img id="pv" alt=""></div>
  <div class="ig-dots"><i class="on"></i><i></i><i></i><i></i></div>
  <div class="ig-caption"><b>my_toon</b> <span id="pvCaption"></span><a id="pvMore" hidden>… 더 보기</a></div>
</div>

<!-- 프로필 피드 3열 -->
<div class="ig-feed" id="feed"></div>
```

```css
.ig-post{width:min(100%,380px);background:#fff;color:#111;border:1px solid #ddd;border-radius:8px;font:13px/1.4 system-ui}
.ig-head{display:flex;align-items:center;gap:8px;padding:8px 10px}.avatar{width:28px;height:28px;border-radius:50%;background:#ccc}
.ig-frame{width:100%;overflow:hidden;background:#000}.ig-frame.r45{aspect-ratio:4/5}.ig-frame.r11{aspect-ratio:1/1}.ig-frame.r916{aspect-ratio:9/16}
.ig-frame img{width:100%;height:100%;object-fit:cover;display:block}
.ig-dots{display:flex;justify-content:center;gap:4px;padding:6px}.ig-dots i{width:6px;height:6px;border-radius:50%;background:#ccc}.ig-dots i.on{background:#3897f0}
.ig-caption{padding:0 10px 10px;white-space:pre-wrap}
.ig-feed{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;width:min(100%,380px)}
.ig-feed div{aspect-ratio:1/1;overflow:hidden;background:#eee}.ig-feed img{width:100%;height:100%;object-fit:cover}
```

`object-fit: cover`가 1:1 썸네일 크롭을 그대로 재현한다. 4:5 이미지를 넣으면 위아래가 잘리는 모습이 보인다.

## 핵심 코드

```js
// 캔버스(05) → 미리보기 이미지
export function canvasToPreview(canvas, imgEl) { imgEl.src = canvas.toDataURL("image/jpeg", 0.85); }

// 피드 그리드: 내 컷 + 기존 게시물 자리(회색)
export function renderFeed(container, dataUrls, total = 9) {
  container.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const cell = document.createElement("div");
    if (dataUrls[i]) { const im = new Image(); im.src = dataUrls[i]; cell.appendChild(im); }
    container.appendChild(cell);
  }
}

// 캡션 검사
export function checkCaption(text) {
  const hashtags = (text.match(/#[^\s#]+/g) || []);
  return {
    length: [...text].length, over: [...text].length > 2200,
    folded: [...text].length > 125 ? text.slice(0, 125) : null,     // "더 보기" 앞까지
    hashtags: hashtags.length, hashtagOver: hashtags.length > 30,
    firstLineHook: text.split("\n")[0].slice(0, 40)                  // 첫 줄이 후킹 문장인지 사용자가 확인
  };
}

// 안전 영역 오버레이 (캔버스 위에 가이드 그리기, 내보내기엔 포함 안 함)
export function drawSafeGuide(ctx, W, H, safe = 60) {
  ctx.save(); ctx.strokeStyle = "rgba(255,0,0,.5)"; ctx.setLineDash([12, 8]); ctx.lineWidth = 3;
  ctx.strokeRect(safe, safe, W - safe * 2, H - safe * 2);
  // 1:1 크롭 영역 (4:5일 때)
  const cropH = W; const top = (H - cropH) / 2;
  ctx.strokeStyle = "rgba(0,120,255,.6)"; ctx.strokeRect(0, top, W, cropH);
  ctx.restore();
}
```

## UI 패턴
- 비율 토글 (4:5 / 1:1 / 9:16) → 프레임 class 교체
- 캐러셀 좌우 넘기기 → 컷 배열 인덱스
- "피드에 넣어 보기" → 기존 피드 스크린샷 업로드(선택) 위에 내 컷 배치
- 캡션 입력 → 글자 수·해시태그 수·접힘 지점 실시간 표시

## 응용 가능한 곳
유튜브 썸네일(1280×720)·쇼츠 미리보기, 스마트스토어 상세페이지(860px 폭) 미리보기, 앱스토어 스크린샷, 네이버 블로그 썸네일, 카카오 채널 메시지 카드. 규격표만 바꾼다.
