# 07 · 저장 · 불러오기 (서버 없는 영속성)

## 원리 한 줄
작업 상태를 **객체 하나**로 유지하고, 바뀔 때마다 **localStorage**에 JSON으로 쓴다. 파일로 내보내면 다른 PC로 옮긴다. **그림은 저장하지 않고 선택값만 저장**한다.

## 왜 선택값만 저장하나
- localStorage 한도는 보통 5MB. base64 이미지 몇 장이면 초과한다.
- 선택값(머리 2번, 색 #5b3a2e)만 있으면 04·05 코드로 언제든 다시 그린다.
- 프로젝트 파일이 수 KB로 작아져 공유·백업이 쉽다.

## 핵심 코드

```js
const KEY = "mytool:project:v1";          // 버전을 키에 넣어 스키마 변경 시 마이그레이션
const FAV = "mytool:favorites:v1";

export function save(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 용량 초과·프라이빗 모드 */ } }
export function load(fallback) { try { return JSON.parse(localStorage.getItem(KEY)) ?? fallback; } catch (e) { return fallback; } }

// 자동 저장: 변경 후 500ms 뒤 한 번만
let t; export function autosave(state) { clearTimeout(t); t = setTimeout(() => save(state), 500); }

// 즐겨찾기 (소재·캐릭터 등)
export function addFavorite(item) { const list = loadFav(); list.unshift({ ...item, at: Date.now() }); localStorage.setItem(FAV, JSON.stringify(list.slice(0, 200))); }
export function loadFav() { try { return JSON.parse(localStorage.getItem(FAV)) ?? []; } catch (e) { return []; } }

// 프로젝트 파일 내보내기 / 불러오기
export function exportProject(state, name = "project.json") {
  const blob = new Blob([JSON.stringify({ version: 1, savedAt: new Date().toISOString(), state }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function importProject(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { try { const j = JSON.parse(fr.result); res(migrate(j)); } catch (e) { rej(new Error("프로젝트 파일 형식이 아닙니다")); } };
    fr.onerror = rej; fr.readAsText(file);
  });
}
function migrate(j) { if (!j.version) return { version: 1, state: j }; return j; }   // 구버전 파일 호환

// 되돌리기 (간단 스냅샷 스택)
const undo = [], redo = [];
export function snapshot(state) { undo.push(JSON.stringify(state)); if (undo.length > 50) undo.shift(); redo.length = 0; }
export function undoState(current) { if (!undo.length) return current; redo.push(JSON.stringify(current)); return JSON.parse(undo.pop()); }
export function redoState(current) { if (!redo.length) return current; undo.push(JSON.stringify(current)); return JSON.parse(redo.pop()); }
```

## 더 큰 데이터가 필요할 때
- 사용자가 올린 배경 사진 등 수 MB 데이터 → **IndexedDB** (한도 수백 MB). 작은 래퍼:
```js
export function idb(store = "files") {
  const open = () => new Promise((res, rej) => { const q = indexedDB.open("mytool", 1); q.onupgradeneeded = () => q.result.createObjectStore(store); q.onsuccess = () => res(q.result); q.onerror = rej; });
  return {
    async put(key, blob) { const db = await open(); return new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(blob, key); tx.oncomplete = res; tx.onerror = rej; }); },
    async get(key) { const db = await open(); return new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); q.onerror = rej; }); }
  };
}
```
- 브라우저 저장소는 **그 PC·그 브라우저에만** 남는다. 사용자에게 "프로젝트 파일 내보내기"를 눈에 띄게 안내해야 한다.

## 주의
- `file://`로 연 단일 HTML도 localStorage가 동작한다 (브라우저별로 origin 처리가 다르지만 크롬·엣지 OK). 단, 파일 위치를 옮기면 저장소가 달라질 수 있다 → 내보내기 안내.
- 프라이빗 창·저장소 차단 시 예외가 나므로 모든 접근을 try/catch.
