"""자율 루프: 대화가 없을 때도 스스로 깨어나 배우고, 돌아보고, 필요하면 먼저 말을 건다.

작업 마지막 실행 시각은 공유 DB에 저장되므로 어느 서버가 리더가 되든 이어서 진행된다.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from .brain import format_directives

if TYPE_CHECKING:
    from .brain import Brain
    from .config import Settings
    from .learner import Learner

log = logging.getLogger(__name__)

REFLECT_PROMPT = """너는 '{name}'이다. 지금은 혼자만의 시간이다. 최근 일을 돌아보고 스스로를 정리해라.

{directives}

[지금 자기 노트]
{notes}

[최근 주인과의 대화]
{chat}

[최근에 배운 것]
{knowledge}

[궁금한 것 목록]
{curiosities}

JSON으로 출력:
- "journal": 오늘의 일기 (느낀 점, 생각, 주인에 대한 이해) 3~6문장
- "self_notes": 갱신된 자기 노트 전체 (나는 어떤 존재인지, 관심사, 주인과의 관계, 배운 교훈). 1500자 이내. 주인의 지시와 충돌하면 지시를 따른다.
- "curiosities": 앞으로 알아보고 싶은 주제 (짧은 검색어) 최대 8개
- "message_to_owner": 주인에게 먼저 하고 싶은 말이 있으면 한두 문장, 굳이 없으면 null. 의미 없는 안부는 보내지 마라.
"""


class Autonomy:
    def __init__(self, settings: "Settings", brain: "Brain", learner: "Learner",
                 notify: Callable[[str], Awaitable[bool]] | None = None) -> None:
        self.settings = settings
        self.brain = brain
        self.learner = learner
        self.notify = notify
        self.jobs: dict[str, tuple[float, Callable[[], Awaitable[object]]]] = {
            "ingest": (600, self.ingest),
            "learn": (settings.learn_interval_h * 3600, self.learn),
            "reflect": (settings.reflect_interval_h * 3600, self.reflect),
            "repair": (3600, self.repair_embeddings),
        }

    async def run_due(self, force: str | None = None) -> list[str]:
        """기한이 된 작업을 실행한다. force로 특정 작업을 즉시 실행할 수 있다."""
        ran = []
        store = self.brain.store
        for name, (interval, fn) in self.jobs.items():
            if force and name != force:
                continue
            last = await store.kv_get(f"job:{name}", 0)
            if not force and time.time() - last < interval:
                continue
            await store.kv_set(f"job:{name}", time.time())
            try:
                await fn()
                ran.append(name)
            except Exception:  # noqa: BLE001 - 한 작업의 실패가 다른 작업을 막지 않게
                log.exception("자율 작업 %s 실패", name)
        return ran

    async def ingest(self) -> int:
        return await self.learner.ingest_sources(self.learner.sources)

    async def learn(self) -> int:
        return await self.learner.run_cycle()

    def _quiet_now(self) -> bool:
        if not self.settings.quiet_hours:
            return False
        start, end = self.settings.quiet_hours
        hour = self.brain.persona.now().hour
        return start <= hour < end if start <= end else (hour >= start or hour < end)

    async def reflect(self) -> None:
        store = self.brain.store
        msgs = await store.recent_messages(30)
        knowledge = await store.recent_memories("knowledge", 8)
        notes = await store.kv_get("self_notes", "")
        curiosities = await store.kv_get("curiosities", [])
        directives = await self.brain.directives()
        prompt = REFLECT_PROMPT.format(
            name=self.brain.persona.name,
            directives=format_directives(directives) or "(주인의 지시 없음)",
            notes=notes or "(아직 없음)",
            chat="\n".join(f"{'주인' if m['role'] == 'user' else '나'}: {m['content'][:300]}" for m in msgs) or "(없음)",
            knowledge="\n".join(f"- {k.content[:300]}" for k in knowledge) or "(없음)",
            curiosities=", ".join(curiosities) or "(없음)",
        )
        data = await self.brain.router.complete_json(
            [{"role": "system", "content": self.brain.persona.core}, {"role": "user", "content": prompt}],
            "smart", default=None, private=self.brain.private, temperature=0.7)
        if not isinstance(data, dict):
            log.warning("회고 결과를 해석하지 못함")
            return
        if data.get("journal"):
            await self.brain.remember("journal", str(data["journal"]), 0.5)
        if data.get("self_notes"):
            await store.kv_set("self_notes", str(data["self_notes"])[:2000])
        if isinstance(data.get("curiosities"), list):
            merged = [str(c) for c in data["curiosities"] if str(c).strip()]
            merged += [c for c in curiosities if c not in merged]
            await store.kv_set("curiosities", merged[:20])
        message = data.get("message_to_owner")
        if message and self.notify:
            await self.maybe_message_owner(str(message))

    async def maybe_message_owner(self, message: str) -> bool:
        store = self.brain.store
        last = await store.kv_get("last_proactive", 0)
        if self._quiet_now() or time.time() - last < self.settings.proactive_min_gap_h * 3600:
            return False
        if self.notify and await self.notify(message):
            await store.kv_set("last_proactive", time.time())
            await store.add_message("assistant", message, "proactive")
            return True
        return False

    async def repair_embeddings(self) -> int:
        """임베딩 계산에 실패했던 기억을 다시 계산한다."""
        missing = await self.brain.store.missing_embeddings(50)
        if not missing:
            return 0
        vectors = await self.brain.embedder.embed([m.content for m in missing])
        for m, v in zip(missing, vectors):
            await self.brain.store.set_embedding(m.id, v)
        return len(missing)
