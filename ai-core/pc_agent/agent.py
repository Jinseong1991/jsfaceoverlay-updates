"""PC 에이전트: 내 PC의 GPU를 AI 서버에 빌려준다. 켜둔 동안에만 쓰이고, 끄면(Ctrl+C) 바로 멈춘다.

준비:
  1) Ollama 설치 후 모델 받기:  ollama pull qwen2.5:7b
  2) pip install websockets httpx
  3) python agent.py --server https://내서버주소 --token PC_TOKEN값 --model qwen2.5:7b

이 프로그램은 서버가 보낸 '대화 생성' 요청을 내 PC의 로컬 모델에 전달하고 결과만 돌려준다.
서버는 이 연결로 내 PC의 파일을 읽거나 명령을 실행할 수 없다.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import socket
from datetime import datetime

import httpx
import websockets

log = logging.getLogger("pc-agent")


def ws_url(server: str) -> str:
    server = server.rstrip("/")
    if server.startswith("https://"):
        return "wss://" + server[len("https://"):] + "/pc"
    if server.startswith("http://"):
        return "ws://" + server[len("http://"):] + "/pc"
    return server


def within_hours(hours: tuple[int, int] | None) -> bool:
    if not hours:
        return True
    start, end = hours
    h = datetime.now().hour
    return start <= h < end if start <= end else (h >= start or h < end)


class Agent:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.sem = asyncio.Semaphore(args.max_jobs)
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=5.0))
        self.hours = tuple(int(x) for x in args.hours.split("-")) if args.hours else None

    async def run_server(self, server: str) -> None:
        backoff = 2
        while True:
            try:
                async with websockets.connect(ws_url(server), max_size=8 * 1024 * 1024,
                                              ping_interval=20) as ws:
                    await ws.send(json.dumps({"token": self.args.token, "name": self.args.name,
                                              "model": self.args.model, "max_jobs": self.args.max_jobs}))
                    reply = json.loads(await ws.recv())
                    if not reply.get("ok"):
                        raise RuntimeError("서버가 연결을 거부함")
                    log.info("연결됨: %s (모델 %s)", server, self.args.model)
                    backoff = 2
                    await self.serve(ws)
            except websockets.ConnectionClosedError as e:
                if e.rcvd and e.rcvd.code == 4401:
                    log.error("토큰이 틀렸습니다 (%s). PC_TOKEN을 확인하세요.", server)
                    return
                log.info("연결 끊김: %s", e)
            except Exception as e:  # noqa: BLE001
                log.info("연결 실패 %s: %s", server, e)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    async def serve(self, ws) -> None:
        jobs: dict[str, asyncio.Task] = {}
        send_lock = asyncio.Lock()

        async def send(msg: dict) -> None:
            async with send_lock:
                await ws.send(json.dumps(msg, ensure_ascii=False))

        async def job(job_id: str, payload: dict) -> None:
            try:
                if not within_hours(self.hours):
                    await send({"id": job_id, "error": "PC 사용 허용 시간이 아님", "status": 503})
                    return
                async with self.sem:
                    await self.generate(job_id, payload, send)
            except asyncio.CancelledError:
                pass
            except Exception as e:  # noqa: BLE001
                await send({"id": job_id, "error": str(e)[:300]})
            finally:
                jobs.pop(job_id, None)

        try:
            async for raw in ws:
                msg = json.loads(raw)
                job_id = msg.get("id")
                if not job_id:
                    continue
                if msg.get("cancel"):
                    task = jobs.get(job_id)
                    if task:
                        task.cancel()
                elif "payload" in msg:
                    jobs[job_id] = asyncio.create_task(job(job_id, msg["payload"]))
        finally:
            for t in jobs.values():
                t.cancel()

    async def generate(self, job_id: str, payload: dict, send) -> None:
        # 허용하는 필드만 골라 로컬 모델로 전달한다
        body = {k: payload[k] for k in ("messages", "max_tokens", "temperature") if k in payload}
        body.update(model=self.args.model, stream=True)
        async with self.http.stream("POST", f"{self.args.llm.rstrip('/')}/chat/completions", json=body) as r:
            if r.status_code != 200:
                text = (await r.aread()).decode("utf-8", "replace")[:300]
                await send({"id": job_id, "error": f"로컬 모델 오류: {text}", "status": r.status_code})
                return
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                for choice in obj.get("choices") or []:
                    delta = (choice.get("delta") or {}).get("content")
                    if delta:
                        await send({"id": job_id, "delta": delta})
        await send({"id": job_id, "done": True})


async def main() -> None:
    p = argparse.ArgumentParser(description="내 PC 자원을 AI 서버에 빌려주는 에이전트")
    p.add_argument("--server", action="append", required=True,
                   help="AI 서버 주소 (여러 대면 여러 번 지정)")
    p.add_argument("--token", required=True, help="서버의 PC_TOKEN 값")
    p.add_argument("--llm", default="http://localhost:11434/v1", help="로컬 모델 주소 (기본: Ollama)")
    p.add_argument("--model", default="qwen2.5:7b", help="로컬 모델 이름")
    p.add_argument("--max-jobs", type=int, default=1, help="동시에 처리할 최대 요청 수")
    p.add_argument("--hours", default=None, help="PC 사용을 허용할 시간대, 예: 9-23")
    p.add_argument("--name", default=socket.gethostname())
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    agent = Agent(args)
    log.info("PC 자원 공유 시작 (Ctrl+C로 중지)")
    await asyncio.gather(*(agent.run_server(s) for s in args.server))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nPC 자원 공유를 멈췄습니다.")
