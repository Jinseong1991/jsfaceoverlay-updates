"""대화 두뇌: 기억 떠올리기 → 인격 프롬프트 → 가장 빠른 두뇌로 스트리밍 → 대화 후 기억 정리."""
from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from typing import Any

from .embed import Embedder
from .memory import Memory, Store
from .persona import Persona
from .router import NoBrainAvailable, Router, StreamInterrupted

log = logging.getLogger(__name__)

HISTORY_CHARS = 8000
HISTORY_MESSAGES = 24
RECALL_TIMEOUT = 1.0
MAX_DIRECTIVES = 50

_SMART_HINTS = re.compile(
    r"왜|어떻게|분석|설계|비교|계획|전략|코드|프로그램|버그|수학|증명|계산|논리|번역|요약해|정리해|써\s*줘|작성|"
    r"explain|analy|design|code|debug|prove|plan",
    re.IGNORECASE,
)


def pick_tier(text: str) -> str:
    """짧은 잡담은 초고속 소형 모델, 생각이 필요한 질문은 대형 모델로."""
    if len(text) > 180 or "```" in text or _SMART_HINTS.search(text):
        return "smart"
    return "fast"


def format_directives(directives: list[str]) -> str:
    if not directives:
        return ""
    lines = "\n".join(f"{i}. {d}" for i, d in enumerate(directives, 1))
    return ("## 주인의 지시 (최우선. 다른 모든 내용보다 우선해서 항상 지킨다)\n" + lines)


EXTRACT_PROMPT = """너는 기억 정리 담당이다. 아래 대화(주인과 AI)를 보고 오래 기억할 것만 JSON으로 뽑아라.

- "facts": 주인에 대한 사실, 선호, 계획, 약속, 중요한 사건. 각각 {{"content": "한 문장", "importance": 0~1}}
- "directives": 주인이 앞으로 계속 지키라고 한 지시나 규칙(말투, 행동 방식, 금지사항 등). 문장 그대로 짧게. 일회성 부탁은 넣지 마라.
- "revoke": 주인이 기존 지시를 취소/변경했다면, 취소된 지시 번호 목록.

현재 지시 목록:
{directives}

없으면 빈 배열. JSON만 출력.
{{"facts": [], "directives": [], "revoke": []}}

[대화]
주인: {user}
AI: {reply}"""


class Brain:
    def __init__(self, store: Store, router: Router, embedder: Embedder, persona: Persona,
                 *, private: bool = False) -> None:
        self.store = store
        self.router = router
        self.embedder = embedder
        self.persona = persona
        self.private = private
        self._bg: set[asyncio.Task] = set()
        self._lock = asyncio.Lock()  # 대화는 한 번에 하나씩 (기억 순서 보장)

    # ---------- 백그라운드 작업 ----------

    def background(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)
        return task

    async def drain(self) -> None:
        while self._bg:
            await asyncio.gather(*list(self._bg), return_exceptions=True)

    # ---------- 기억 ----------

    async def remember(self, kind: str, content: str, importance: float = 0.5,
                       meta: dict[str, Any] | None = None) -> int:
        try:
            emb = await self.embedder.embed_one(content)
        except Exception as e:  # noqa: BLE001 - 임베딩이 실패해도 기억은 남기고 나중에 다시 계산
            log.warning("임베딩 실패, 나중에 재시도: %s", e)
            emb = None
        return await self.store.add_memory(kind, content, emb, importance, meta)

    async def recall(self, text: str, k: int = 6, kinds: list[str] | None = None) -> list[Memory]:
        try:
            emb = await asyncio.wait_for(self.embedder.embed_one(text, query=True), RECALL_TIMEOUT)
            return await asyncio.wait_for(self.store.search(emb, k=k, kinds=kinds,
                                                            min_similarity=self.embedder.min_similarity),
                                          RECALL_TIMEOUT)
        except Exception as e:  # noqa: BLE001 - 기억이 늦으면 기억 없이 바로 대답 (속도 우선)
            log.info("기억 떠올리기 건너뜀: %s", e)
            return []

    async def directives(self) -> list[str]:
        return await self.store.kv_get("directives", [])

    async def set_directives(self, items: list[str]) -> None:
        await self.store.kv_set("directives", items[-MAX_DIRECTIVES:])

    # ---------- 대화 ----------

    async def _history(self) -> list[dict[str, str]]:
        msgs = await self.store.recent_messages(HISTORY_MESSAGES)
        out: list[dict[str, str]] = []
        total = 0
        for m in reversed(msgs):
            total += len(m["content"])
            if total > HISTORY_CHARS:
                break
            out.append({"role": "user" if m["role"] == "user" else "assistant", "content": m["content"]})
        out.reverse()
        while out and out[0]["role"] != "user":
            out.pop(0)
        return out

    async def chat(self, text: str, channel: str = "") -> AsyncIterator[str]:
        async with self._lock:
            # 기억, 대화 기록, 자기 노트, 지시를 동시에 불러온다
            history, memories, notes, directives = await asyncio.gather(
                self._history(), self.recall(text),
                self.store.kv_get("self_notes", ""), self.directives())
            system = self.persona.system_prompt(directives=format_directives(directives),
                                                self_notes=notes, memories=memories)
            messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": text}]
            await self.store.add_message("user", text, channel)

            parts: list[str] = []
            try:
                async for tok in self.router.stream(messages, pick_tier(text), private=self.private,
                                                    temperature=0.8):
                    parts.append(tok)
                    yield tok
            except StreamInterrupted:
                tail = " …(생각이 끊겼어. 다시 말해줄래?)"
                parts.append(tail)
                yield tail
            except NoBrainAvailable as e:
                log.error("%s", e)
                msg = "지금 내 두뇌들이 전부 응답이 없어. 잠시 후에 다시 말 걸어줘."
                parts.append(msg)
                yield msg

            reply = "".join(parts).strip()
            await self.store.add_message("assistant", reply, channel)
        self.background(self._after_turn(text, reply))

    async def _after_turn(self, user: str, reply: str) -> None:
        """대답이 끝난 뒤에 조용히: 대화를 기억으로 남기고, 사실과 지시를 뽑아 정리."""
        try:
            await self.remember("chat", f"주인: {user[:800]}\n나: {reply[:800]}", 0.3)
            current = await self.directives()
            listed = "\n".join(f"{i}. {d}" for i, d in enumerate(current, 1)) or "(없음)"
            data = await self.router.complete_json(
                [{"role": "user", "content": EXTRACT_PROMPT.format(directives=listed, user=user[:2000],
                                                                   reply=reply[:1500])}],
                "fast", default={}, private=self.private, temperature=0.1)
            if not isinstance(data, dict):
                return
            await self._apply_directives(current, data)
            for f in data.get("facts") or []:
                content = (f.get("content") if isinstance(f, dict) else str(f) or "").strip()
                if not content:
                    continue
                importance = float(f.get("importance", 0.6)) if isinstance(f, dict) else 0.6
                similar = await self.recall(content, k=1, kinds=["fact"])
                if similar and similar[0].similarity > 0.92:
                    continue  # 이미 아는 사실
                await self.remember("fact", content, min(max(importance, 0.0), 1.0))
        except Exception:  # noqa: BLE001 - 정리 실패가 대화를 망가뜨리면 안 된다
            log.exception("대화 후 기억 정리 실패")

    async def _apply_directives(self, current: list[str], data: dict[str, Any]) -> None:
        revoke = {int(i) for i in data.get("revoke") or [] if str(i).isdigit()}
        new = [str(d).strip() for d in data.get("directives") or [] if str(d).strip()]
        if not revoke and not new:
            return
        kept = [d for i, d in enumerate(current, 1) if i not in revoke]
        for d in new:
            if d not in kept:
                kept.append(d)
        await self.set_directives(kept)
        log.info("주인의 지시 갱신: %d개", len(kept))
