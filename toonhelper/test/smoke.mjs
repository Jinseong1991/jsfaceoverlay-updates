/* 브라우저 스모크 테스트: 빌드된 단일 HTML을 file:// 로 열어 모든 탭을 돌리고 캔버스가 그려지는지 확인.
 * playwright 가 전역 설치되어 있어야 한다: `npm run smoke`  (CI 전용, 제품 사용에는 불필요)
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist", "툰헬퍼.html");
if (!fs.existsSync(dist)) { console.error("먼저 npm run build"); process.exit(1); }
const outDir = process.env.SMOKE_OUT || os.tmpdir();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto(pathToFileURL(dist).href);
await page.waitForFunction(() => window.__toonhelper && window.__toonhelper.state.topic);
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

// ① 소재
const t1 = await page.textContent("#topicText");
await page.click("#bTopic");
const t2 = await page.textContent("#topicText");
check(t1 && t2 && t1 !== t2, "다시 뽑기로 소재가 바뀌어야 함");
await page.selectOption("#slots .slot:nth-child(1) select", "편의점");
await page.click("#bTopic");
check((await page.textContent("#topicText")).includes("편의점"), "장소 고정이 반영되어야 함");
await page.click("#bUnlockAll");
await page.fill("#userSlotText", "테스트 장소"); await page.click("#bUserSlotAdd");
check((await page.textContent("#userSlotList")).includes("테스트 장소"), "사용자 후보 추가");
await page.click("#bTopicFav");
check((await page.textContent("#favList")).includes(await page.textContent("#topicText")), "즐겨찾기 추가");

// ② 스토리
await page.click("#bTopicToStory");
await page.waitForSelector("#tab-story.on");
check((await page.$$(".beat")).length >= 4, "콘티 카드가 생성되어야 함");
await page.click("#cutsSeg button[data-cuts='6']");
check((await page.$$(".beat")).length === 6, "6컷 선택 시 카드 6장");
await page.click(".beat:nth-child(2) .tools button");   // 대사 다시

// ③ 캐릭터
await page.click("#tabs button[data-tab='char']");
check((await page.$$("#chars .c")).length === 8, "캐릭터 8명");
await page.click("#chars .c:nth-child(3)"); await page.click("#bCharMain");
check(await page.$eval("#chars .c:nth-child(3)", e => e.classList.contains("main")), "주인공 지정");
await page.click("#charLayers .layer:nth-child(7) button:last-child");   // 앞머리 다음
check((await page.$$("#charExprs svg")).length === 7, "표정 7종 미리보기");

// ④ 시안
await page.click("#tabs button[data-tab='cut']");
await page.waitForSelector("#tab-cut.on");
await page.click("#bCutsFromStory");
await page.waitForFunction(() => document.querySelectorAll("#cutStrip .t").length === 6);
await page.waitForTimeout(400);
const nonWhite = await page.evaluate(() => {
  const cv = document.getElementById("cv"); const ctx = cv.getContext("2d");
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) n++;
  return n;
});
check(nonWhite > 50, "캔버스에 무언가 그려져야 함 (" + nonWhite + ")");
await page.click("#cutStrip .t:nth-child(5)");            // 반전 컷
await page.fill("#cText", "스모크 테스트 대사!!");
await page.click("#ratioSeg button[data-ratio='1:1']");
await page.waitForTimeout(300);
check(await page.$eval("#cv", c => c.width === 1080 && c.height === 1080), "1:1 비율 캔버스");
await page.click("#ratioSeg button[data-ratio='4:5']");
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, "smoke-cut.png") });

// PNG 저장은 다운로드 이벤트로 확인
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#bCutPng")]);
check(/\.png$/.test(dl.suggestedFilename()), "PNG 다운로드 파일명: " + dl.suggestedFilename());

// ⑤ 미리보기
await page.click("#bCutToPreview");
await page.waitForFunction(() => document.querySelectorAll("#pvDots i").length === 6);
check((await page.$$("#feed img")).length === 6, "피드 그리드에 컷 6장");
await page.fill("#cap", "오늘도 편의점. 나만 이래? #인스타툰 #일상툰");
check((await page.textContent("#capInfo")).includes("해시태그 2/30"), "캡션 검사");
await page.click("#bHashtag");
check((await page.inputValue("#cap")).includes("#인스타툰"), "해시태그 추천");
await page.click("#pvNext");
check((await page.textContent("#pvCount")) === "2/6", "캐러셀 넘기기");
await page.screenshot({ path: path.join(outDir, "smoke-preview.png") });

// AI (프롬프트 모드만)
await page.click("#tabs button[data-tab='ai']");
check((await page.inputValue("#aiStoryPrompt")).includes("콘티"), "콘티 프롬프트 생성");
await page.fill("#aiReply", "1 | 도입 | 풀샷 | 테스트 대사 1 | 지시\n2 | 전개 | 바스트샷 | 테스트 대사 2 | 지시\n3 | 반전 | 클로즈업 | 테스트 대사 3 | 지시\n4 | 마무리 | 풀샷 | 테스트 대사 4 | 지시");
await page.click("#bAiApply");
check((await page.textContent("#aiApplyMsg")).includes("4컷"), "AI 응답 반영");

// 설정: 내보내기 → 새로고침 후 상태 유지
await page.click("#tabs button[data-tab='settings']");
const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#bExport")]);
check(/\.json$/.test(dl2.suggestedFilename()), "프로젝트 내보내기");
await page.reload();
await page.waitForFunction(() => window.__toonhelper && window.__toonhelper.state.topic);
const persisted = await page.evaluate(() => window.__toonhelper.state.story.beats.length);
check(persisted === 4, "새로고침 후 상태 유지 (4컷 콘티): " + persisted);

await browser.close();
const all = fails.concat(errors);
if (all.length) { console.error("스모크 실패:\n - " + all.join("\n - ")); process.exit(1); }
console.log("스모크 통과 (스크린샷: " + outDir + "/smoke-*.png)");
