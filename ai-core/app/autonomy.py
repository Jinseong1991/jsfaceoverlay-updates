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

    async def learn(self) -> int:
        return await self.learner.run_cycle()