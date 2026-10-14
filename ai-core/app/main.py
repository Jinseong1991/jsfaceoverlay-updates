"""실행 진입점.

  python -m app.main serve        서버 실행 (기본)
  python -m app.main chat         터미널에서 바로 대화 (테스트용)
  python -m app.main check        모든 두뇌에 짧게 말 걸어 응답 속도 점검
  python -m app.main learn        지금 바로 공부 한 번
  python -m app.main reembed      임베딩 방식을 바꾼 뒤 기억 전체 다시 계산
  python -m app.main import FILE  /export 로 받은 백업을 새 DB에 복원
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import time

from .config import Settings
from .runtime import Runtime


async def cmd_chat(rt: Runtime) -> None:
    await rt.init()
    print(f"{rt.persona.name}와 대화 (종료: Ctrl+C)\n")
    try:
        while True:
            text = await asyncio.to_thread(input, "나> ")
            if not text.strip():
                continue
            print(f"{rt.persona.name}> ", end="", flush=True)
            async for tok in rt.brain.chat(text, channel="cli"):
                print(tok, end="", flush=True)
            print("\n")
    except (KeyboardInterrupt, EOFError):
        pass


async def cmd_check(rt: Runtime) -> None:
    await rt.init()
    if not rt.router.models:
        print("두뇌가 하나도 없습니다. .env 에 API 키를 넣으세요.")
        return
    msgs = [{"role": "user", "content": "한 단어로 인사해줘."}]
    for m in rt.router.models:
        if not m.provider.available:
            print(f"{m.id:24s} -  (연결 안 됨)")
            continue
        start = time.monotonic()
        first = None
        try:
            out = ""
            async for tok in rt.router._stream_one(m, {"messages": msgs, "max_tokens": 30}):
                first = first or time.monotonic() - start
                out += tok
            print(f"{m.id:24s} OK  첫 응답 {first:.2f}초  → {out.strip()[:30]!r}")
        except Exception as e:  # noqa: BLE001
            print(f"{m.id:24s} 실패  {str(e)[:120]}")


async def cmd_reembed(rt: Runtime) -> None:
    await rt.init()
    ids = await rt.store.all_memory_ids()
    for i in range(0, len(ids), 32):
        batch = await rt.store.get_memories(ids[i:i + 32])
        vectors = await rt.embedder.embed([m.content for m in batch])
        for m, v in zip(batch, vectors):
            await rt.store.set_embedding(m.id, v)
        print(f"{min(i + 32, len(ids))}/{len(ids)}")
    await rt.store.kv_set("embedder", f"{rt.embedder.name}:{rt.settings.embed_dim}")


async def cmd_import(rt: Runtime, path: str) -> None:
    await rt.init()
    data = json.loads(open(path, encoding="utf-8").read())
    for m in data.get("messages", []):
        await rt.store.add_message(m["role"], m["content"], m.get("channel") or "")
    for m in data.get("memories", []):
        meta = m.get("meta") or {}
        meta = json.loads(meta) if isinstance(meta, str) else meta
        await rt.brain.remember(m["kind"], m["content"], m.get("importance", 0.5), meta)
    for k, v in data.get("kv", {}).items():
        if not k.startswith("job:"):
            await rt.store.kv_set(k, v)
    print(f"복원 완료: 대화 {len(data.get('messages', []))}, 기억 {len(data.get('memories', []))}")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = Settings.from_env()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"

    if cmd == "serve":
        import uvicorn

        from .server import create_app

        uvicorn.run(create_app(Runtime(settings)), host="0.0.0.0", port=settings.port, log_level="warning")
        return

    async def run() -> None:
        rt = Runtime(settings)
        try:
            if cmd == "chat":
                await cmd_chat(rt)
            elif cmd == "check":
                await cmd_check(rt)
            elif cmd == "learn":
                await rt.init()
                print(f"문서 입력 {await rt.autonomy.ingest()}개, 학습 {await rt.autonomy.learn()}개")
            elif cmd == "reembed":
                await cmd_reembed(rt)
            elif cmd == "import" and len(sys.argv) > 2:
                await cmd_import(rt, sys.argv[2])
            else:
                print(__doc__)
        finally:
            await rt.stop()

    asyncio.run(run())


if __name__ == "__main__":
    main()
