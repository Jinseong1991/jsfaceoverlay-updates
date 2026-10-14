"""노드 하나의 실행 단위. 같은 코드를 여러 서버에 띄우면 lease로 역할을 나눠 가진다.

- 'telegram' lease: 텔레그램 메시지 수신 담당 (한 대만)
- 'autonomy' lease: 학습/회고 담당 (한 대만)
담당 서버가 죽으면 LEASE_TTL 안에 다른 서버가 자동으로 이어받는다.
"""
from __future__ import annotations

import asyncio
import logging
import os

import httpx

from .autonomy import Autonomy
from .brain import Brain
from .config import Settings
from .embed import make_embedder
from .learner import Learner
from .memory import make_store
from .pc_bridge import PcBridge
from .persona import Persona
from .router import Router, load_models
from .telegram import TelegramBot

log = logging.getLogger(__name__)

LEASE_TTL = 60
LEASE_RENEW = 20
AUTONOMY_CHECK = 60


def read_topics(path) -> list[str]:
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return [x.strip() for x in lines if x.strip() and not x.startswith("#")]


class Runtime:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0),
                                      limits=httpx.Limits(max_keepalive_connections=20, keepalive_expiry=120))
        self.store = make_store(settings.database_url, settings.sqlite_path, settings.embed_dim)
        self.embedder = make_embedder(settings.embed_provider, settings.embed_dim, self.http,
                                      gemini_key=os.environ.get("GEMINI_API_KEY"), url=settings.embed_url,
                                      model=settings.embed_model, api_key=os.environ.get("EMBED_API_KEY"))
        self.router = Router(load_models(settings.models_path), hedge_ms=settings.hedge_ms,
                             max_parallel=settings.max_parallel, client=self.http)
        self.pc = PcBridge(os.environ.get("PC_TOKEN"))
        for m in self.router.models:
            if m.provider.kind == "pc":
                m.provider.bridge = self.pc
        self.persona = Persona(settings.persona_path, settings.timezone)
        self.brain = Brain(self.store, self.router, self.embedder, self.persona, private=settings.private_mode)
        self.learner = Learner(self.brain, self.http, settings.feeds, read_topics(settings.seed_topics_path),
                               read_topics(settings.sources_path))
        self.telegram = (TelegramBot(settings.telegram_token, settings.telegram_owner_id, self.brain, None, self.http)
                         if settings.telegram_token else None)
        self.autonomy = Autonomy(settings, self.brain, self.learner,
                                 self.telegram.notify_owner if self.telegram else None)
        if self.telegram:
            self.telegram.autonomy = self.autonomy
        self.held: dict[str, bool] = {}
        self.tasks: list[asyncio.Task] = []

    async def init(self) -> None:
        await self.store.init()
        current = f"{self.embedder.name}:{self.settings.embed_dim}"
        previous = await self.store.kv_get("embedder")
        if previous and previous != current:
            log.warning("임베딩 방식이 바뀜 (%s → %s). `python -m app.main reembed` 를 실행하세요.", previous, current)
        elif not previous:
            await self.store.kv_set("embedder", current)
        log.info("노드 %s 시작: 역할=%s, 두뇌 %d개 (%s), 임베딩=%s", self.settings.node_id,
                 ",".join(sorted(self.settings.roles)), len(self.router.models),
                 ", ".join(m.id for m in self.router.models) or "없음", current)
        if not self.router.models:
            log.error("사용 가능한 두뇌가 없습니다. .env 에 API 키를 하나 이상 넣으세요.")

    async def start(self) -> None:
        await self.init()
        self.tasks.append(asyncio.create_task(self._lease_loop()))
        if self.telegram and self.settings.has_role("telegram"):
            self.tasks.append(asyncio.create_task(self.telegram.run(lambda: self.held.get("telegram", False))))
        if self.settings.has_role("autonomy"):
            self.tasks.append(asyncio.create_task(self._autonomy_loop()))

    async def _lease_loop(self) -> None:
        wanted = [r for r in ("telegram", "autonomy") if self.settings.has_role(r)]
        while True:
            for name in wanted:
                try:
                    got = await self.store.try_lease(name, self.settings.node_id, LEASE_TTL)
                except Exception as e:  # noqa: BLE001 - DB가 잠깐 끊겨도 계속 시도
                    log.warning("lease 확인 실패: %s", e)
                    got = False
                if got != self.held.get(name):
                    log.info("역할 '%s' %s", name, "담당 시작" if got else "대기")
                self.held[name] = got
            await asyncio.sleep(LEASE_RENEW)

    async def _autonomy_loop(self) -> None:
        await asyncio.sleep(10)
        while True:
            if self.held.get("autonomy"):
                ran = await self.autonomy.run_due()
                if ran:
                    log.info("자율 작업 완료: %s", ", ".join(ran))
            await asyncio.sleep(AUTONOMY_CHECK)

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await self.brain.drain()
        await self.store.close()
        await self.http.aclose()
