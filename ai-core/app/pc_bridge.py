"""PC 브리지: 주인이 허락한 PC의 자원(GPU)을 두뇌로 빌려 쓴다.

PC 에이전트(pc_agent/agent.py)가 서버로 먼저 웹소켓 연결을 맺는다 → 공유기 포트 개방 불필요.
연결된 동안에만 라우터 후보에 올라가고, 연결이 끊기면 자동으로 클라우드 두뇌로 넘어간다.
PC 쪽은 '대화 생성' 요청만 처리하며, 서버가 PC의 파일이나 명령을 건드릴 수 없다.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from .router import ProviderError

log = logging.getLogger(__name__)

JOB_TIMEOUT = 120


class PcBridge:
    def __init__(self, token: str | None) -> None:
        self.token = token
        self.ws = None
        self.info: dict[str, Any] = {}
        self.pending: dict[str, asyncio.Queue] = {}
        self.send_lock = asyncio.Lock()

    @property
    def connected(self) -> bool:
        return self.ws is not None

    async def _send(self, msg: dict[str, Any]) -> None:
        ws = self.ws
        if ws is None:
            return
        async with self.send_lock:
            await ws.send_json(msg)

    async def _send_quiet(self, msg: dict[str, Any]) -> None:
        try:
            await self._send(msg)
        except Exception:  # noqa: BLE001
            pass

    async def serve(self, ws) -> None:
        """웹소켓 하나를 맡아 처리한다. 첫 메시지로 토큰을 확인한다."""
        await ws.accept()
        try:
            hello = await asyncio.wait_for(ws.receive_json(), 10)
        except Exception:  # noqa: BLE001
            await ws.close(code=4400)
            return
        if not self.token or not hmac.compare_digest(str(hello.get("token", "")).encode(), self.token.encode()):
            await ws.close(code=4401)
            return
        if self.ws is not None:
            try:
                await self.ws.close(code=4000)  # 새 연결이 이전 연결을 대체
            except Exception:  # noqa: BLE001
                pass
        self.ws = ws
        self.info = {k: hello.get(k) for k in ("name", "model", "max_jobs")}
        log.info("PC 연결됨: %s", self.info)
        await ws.send_json({"ok": True})
        try:
            while True:
                msg = await ws.receive_json()
                q = self.pending.get(msg.get("id", ""))
                if q:
                    q.put_nowait(msg)
        except Exception as e:  # noqa: BLE001 - 끊김
            log.info("PC 연결 끊김: %s", e)
        finally:
            if self.ws is ws:
                self.ws = None
                for q in self.pending.values():
                    q.put_nowait({"error": "PC 연결 끊김"})

    async def stream(self, body: dict[str, Any]) -> AsyncIterator[str]:
        if self.ws is None:
            raise ProviderError(503, "PC가 연결되어 있지 않음")
        job_id = uuid.uuid4().hex
        q: asyncio.Queue = asyncio.Queue()
        self.pending[job_id] = q
        finished = False
        try:
            await self._send({"id": job_id, "payload": body})
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), JOB_TIMEOUT)
                except asyncio.TimeoutError:
                    raise ProviderError(504, "PC 응답 시간 초과") from None
                if "delta" in msg:
                    yield msg["delta"]
                elif msg.get("done"):
                    finished = True
                    return
                elif "error" in msg:
                    finished = True
                    raise ProviderError(msg.get("status"), str(msg["error"]))
        finally:
            self.pending.pop(job_id, None)
            if not finished:
                # 헤징에서 진 경우 등: PC에 작업 중단을 알려 GPU를 놓아준다
                asyncio.get_running_loop().create_task(self._send_quiet({"id": job_id, "cancel": True}))
