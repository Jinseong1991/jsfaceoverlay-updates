#!/usr/bin/env node
/* 툰헬퍼 빌드: src/ 의 HTML·CSS·JS를 파일 하나(dist/툰헬퍼.html)로 합친다. (docs/hits-reference/08 방식 C)
 * 의존성 없음. `node build.js` 또는 `npm run build`.
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "src");
const DIST = path.join(__dirname, "dist");
const OUT = path.join(DIST, "툰헬퍼.html");

let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
const read = p => fs.readFileSync(path.join(SRC, p), "utf8");
const safeScript = s => s.replace(/<\/script/gi, "<\\/script");   // 인라인 스크립트 조기 종료 방지

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, p) => "<style>\n" + read(p) + "\n</style>");
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, p) => "<script>\n" + safeScript(read(p)) + "\n</script>");
html = html.replace(/src="([^"]+\.(png|jpg|jpeg|webp))"/g, (_, p, ext) => {
  const file = path.join(SRC, p); if (!fs.existsSync(file)) return `src="${p}"`;
  return `src="data:image/${ext === "jpg" ? "jpeg" : ext};base64,${fs.readFileSync(file).toString("base64")}"`;
});
html = html.replace("</head>", `<meta name="generator" content="toonhelper-build ${new Date().toISOString().slice(0, 10)}">\n</head>`);

if (/<script src=|<link rel="stylesheet" href=/.test(html)) { console.error("인라인되지 않은 외부 참조가 남아 있습니다"); process.exit(1); }

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(OUT, html);
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`빌드 완료: ${path.relative(process.cwd(), OUT)} (${kb}KB)`);
