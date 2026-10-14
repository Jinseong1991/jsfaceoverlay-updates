"""웹 API + 간단한 웹 채팅 화면. 모든 기능은 OWNER_TOKEN이 있어야 쓸 수 있다."""
from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, WebSocket
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from .runtime import Runtime

WEB = Path(__file__).parent / "web.html"


class ChatIn(BaseModel):
    message: str


def create_app(runtime: Runtime) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await runtime.start()
        yield
        await runtime.stop()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def auth(authorization: str | None) -> None:
        token = runtime.settings.owner_token
        if not token:
            raise HTTPException(503, "OWNER_TOKEN이 설정되지 않아 비활성화됨")
        given = (authorization or "").removeprefix("Bearer ").strip()
        if not hmac.compare_digest(given.encode(), token.encode()):
            raise HTTPException(401, "인증 실패")

    @app.get("/health")
    async def health():
        # 공개 엔드포인트: 살아있는지만 알려준다 (깨우기 핑용)
        return {"ok": True, "node": runtime.settings.node_id}

    @app.get("/", response_class=HTMLResponse)
    async def index():
        return WEB.read_text(encoding="utf-8")

    @app.post("/chat")
    async def chat(body: ChatIn, authorization: str | None = Header(None)):
        auth(authorization)
        if not runtime.settings.has_role("chat"):
            raise HTTPException(404)
        text = body.message.strip()
        if not text:
            raise HTTPException(400, "빈 메시지")
        return StreamingResponse(runtime.brain.chat(text, channel="web"), media_type="text/plain; charset=utf-8",
                                 headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})

    @app.get("/status")
    async def status(authorization: str | None = Header(None)):
        auth(authorization)
        return {"node": runtime.settings.node_id, "roles": sorted(runtime.settings.roles), "held": runtime.held,
                "memory": await runtime.store.stats(), "brains": runtime.router.status(),
                "directives": await runtime.brain.directives(),
                "pc": runtime.pc.info if runtime.pc.connected else None}

    @app.post("/tick")
    async def tick(authorization: str | None = Header(None), job: str | None = None):
        """GitHub Actions 등 외부 시계가 주기적으로 깨운다. 담당 서버일 때만 실제 작업을 한다."""
        auth(authorization)
        if not runtime.held.get("autonomy") and not job:
            return {"ran": [], "leader": False}
        runtime.brain.background(runtime.autonomy.run_due(force=job))
        return {"started": True, "leader": runtime.held.get("autonomy", False)}

    @app.websocket("/pc")
    async def pc(ws: WebSocket):
        """주인 PC의 에이전트가 연결해 자원(GPU)을 빌려주는 통로."""
        await runtime.pc.serve(ws)

    @app.get("/export")
    async def export(authorization: str | None = Header(None)):
        auth(authorization)
        return await runtime.store.export()

    return app
