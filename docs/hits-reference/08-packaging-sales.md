# 08 · 단일 HTML 배포 · 판매

## 원리 한 줄
HTML·CSS·JS·이미지를 **파일 하나**로 합쳐 "더블클릭하면 열리는 프로그램"으로 만든다. 디지털 파일 판매 플랫폼(아임웹 유료 콘텐츠, 크몽, 스마트스토어, Gumroad)에 그대로 올린다.

## HITS가 이 방식으로 추정되는 이유
- 아임웹 '유료 콘텐츠(paidproduct)'는 구매 후 마이페이지에서 파일 다운로드 (같은 판매자의 다른 상품은 30일 다운로드 기간).
- 일회성 결제, 서버 없음, "웹용 프로그램".

## 빌드 방법 3가지

### A. 수동 (작은 프로젝트)
`index.html` 안에 `<style>`과 `<script>`를 인라인하고, 이미지는 data URI로 바꾼다.
```bash
# 이미지 → data URI
base64 -w0 hair1.png | sed 's/^/data:image\/png;base64,/' > hair1.txt
```
SVG 파츠는 문자열 그대로 JS 배열에 넣으면 된다 (04).

### B. Vite + singlefile 플러그인 (권장)
```bash
npm create vite@latest my-tool -- --template vanilla
npm i -D vite-plugin-singlefile
```
```js
// vite.config.js
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
export default defineConfig({ plugins: [viteSingleFile()], build: { assetsInlineLimit: 100000000, cssCodeSplit: false } });
```
`npm run build` → `dist/index.html` 하나. 이미지·폰트·JSON 전부 인라인.

### C. 간단 Node 스크립트 (의존성 없이)
```js
// build.js : src/index.html 안의 <link>와 <script src>와 <img src>를 인라인
import fs from "node:fs";
let html = fs.readFileSync("src/index.html", "utf8");
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, p) => `<style>${fs.readFileSync("src/" + p, "utf8")}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, p) => `<script>${fs.readFileSync("src/" + p, "utf8")}</script>`);
html = html.replace(/src="([^"]+\.(png|jpg|webp))"/g, (_, p, ext) => `src="data:image/${ext === "jpg" ? "jpeg" : ext};base64,${fs.readFileSync("src/" + p).toString("base64")}"`);
fs.mkdirSync("build", { recursive: true }); fs.writeFileSync("build/MyTool.html", html);
```

## 압축·난독화
```bash
npx terser src/app.js -c -m --mangle-props regex=/^_/ -o build/app.min.js
```
- 완전한 보호는 불가능 (브라우저에서 열리는 코드는 항상 읽힌다). **진입 장벽** 정도로 생각한다.
- 데이터(JSON)도 base64 또는 간단 XOR로 감싸 두면 "텍스트 에디터로 열어 소재 목록 복사"는 막힌다.

## 무단 공유 억제 (가벼운 방법)
- **구매자 워터마크**: 다운로드 파일에 구매자 이름·주문번호를 박아 둔다 (`const LICENSE = "홍길동 / 2026-10-001"`). 화면 구석에 작게 표시. 아임웹 자동화는 안 되므로 수동 발송이거나, 생략.
- **파일 안 라이선스 키 검사 없음**이 일반적 (서버가 없으니 검증 불가). 가격을 낮추고 업데이트로 재구매 가치를 만드는 쪽이 현실적.

## 업데이트 운영
- 파일 상단에 `const VERSION = "1.3.0"` 과 변경 로그.
- 업데이트는 **새 파일 재다운로드** (아임웹 공지 + 마이페이지 파일 교체). 같은 판매자의 기존 상품이 "1년 2회 무료 업데이트" 방식.
- 저장 스키마가 바뀌면 07의 `migrate()`로 구버전 프로젝트 파일 호환.

## 판매 페이지 구성 (HITS 페이지에서 보이는 패턴)
1. 로고 + 한 줄 가치 제안 ("아이디어만 있어도, 누구나 쉽게!")
2. 기능 3~5개를 아이콘·캐릭터로 시각화 (캐릭터 생성 / 스토리·컷 아이디어 / 인스타 미리보기)
3. 가격: 정가 → 할인가 (50,000 → 35,000)
4. 설명문: "○○ 작업을 도와주는 스마트한 웹용 서포터 프로그램. A부터 B까지 다양한 기능"
5. 구매 후 다운로드 안내, 환불 불가 고지, 업데이트 정책

## 체크리스트 (출시 전)
- [ ] 파일 하나로 열리는가 (`file://`), 오프라인에서 전 기능 동작
- [ ] 크롬·엣지·사파리·모바일 크롬에서 테스트
- [ ] 폰트 인라인 또는 시스템 폰트 폴백 (오프라인이면 Google Fonts 못 씀)
- [ ] 외부 URL 이미지 0개 (캔버스 오염 방지, 05)
- [ ] 저장·내보내기·불러오기 왕복 테스트
- [ ] 파일 용량 (목표 5MB 이하, SVG 파츠면 1MB 안쪽 가능)
- [ ] 사용 설명 탭 또는 첫 실행 안내
