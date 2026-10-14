"""모델 라우터: 여러 무료 두뇌(API)를 하나처럼 쓴다.

속도를 위한 설계:
- 모든 provider는 OpenAI 호환 스트리밍 API로 통일 → 첫 글자가 나오자마자 전달
- 모델별 첫 토큰 지연(TTFT)을 지수이동평균으로 학습해 가장 빠른 곳부터 시도
- 헤징: HEDGE_MS 안에 첫 토큰이 안 오면 다음 후보를 동시에 출발시켜 먼저 오는 쪽을 채택
- 429/오류가 난 곳은 쿨다운 동안 제외하고 자동으로 다음 후보로 넘어감
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import tomllib
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger(__name__)


@dataclass
class Provider:
    name: str
    base_url: str
    api_key: str | None = None
    trains_on_data: bool = False


@dataclass
class ModelSpec:
    id: str
    provider: Provider
    model: str
    tiers: list[str]
    priority: int = 5
    expected_ttft: float = 0.8
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ModelState:
    ttft: float | None = None
    cooldown_until: float = 0.0
    consecutive_failures: int = 0
    successes: int = 0
    failures: int = 0
    last_error: str | None = None


class ProviderError(Exception):
    def __init__(self, status: int | None, message: str, retry_after: float | None = None):
        super().__init__(f"{status}: {message}" if status else message)
        self.status = status
        self.retry_after = retry_after


class NoBrainAvailable(Exception):
    pass


class StreamInterrupted(Exception):
    """응답 도중 두뇌 연결이 끊김 (이미 일부 글자는 전달됨)."""


def load_models(path: Path, env: dict[str, str] | None = None) -> list[ModelSpec]:
    """models.toml을 읽는다. 키가 없는 provider의 모델은 자동으로 빠진다."""
    env = dict(os.environ) if env is None else env
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    providers: dict[str, Provider] = {}
    for name, cfg in data.get("providers", {}).items():
        base_url = cfg.get("base_url") or env.get(cfg.get("base_url_env", ""), "")
        if not base_url:
            continue
        key = None
        if "key_env" in cfg:
            key = env.get(cfg["key_env"])
            if not key:
                continue
        providers[name] = Provider(name, base_url.rstrip("/"), key, bool(cfg.get("trains_on_data", False)))

    models = []
    for m in data.get("models", []):
        provider = providers.get(m["provider"])
        if provider is None:
            continue
        models.append(ModelSpec(
            id=m["id"], provider=provider, model=m["model"], tiers=list(m.get("tiers", ["fast"])),
            priority=int(m.get("priority", 5)), expected_ttft=float(m.get("expected_ttft", 0.8)),
            params=dict(m.get("params", {})),
        ))
    return models


class ThinkStripper:
    """<think>...</think> 추론 블록을 스트림에서 걸러낸다 (청크 경계를 넘어가도 처리)."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self.buf = ""
        self.inside = False

    def feed(self, chunk: str) -> str:
        self.buf += chunk
        out = []
        while self.buf:
            tag = self.CLOSE if self.inside else self.OPEN
            idx = self.buf.find(tag)
            if idx >= 0:
                if not self.inside:
                    out.append(self.buf[:idx])
                self.buf = self.buf[idx + len(tag):]
                self.inside = not self.inside
                continue
            # 태그 일부가 끝에 걸쳐 있을 수 있으니 그만큼은 남겨둔다
            keep = 0
            for k in range(min(len(tag) - 1, len(self.buf)), 0, -1):
                if tag.startswith(self.buf[-k:]):
                    keep = k
                    break
            if not self.inside:
                out.append(self.buf[:len(self.buf) - keep])
            self.buf = self.buf[len(self.buf) - keep:] if keep else ""
            break
        return "".join(out)

    def flush(self) -> str:
        rest = "" if self.inside else self.buf
        self.buf = ""
        return rest


def extract_json(text: str) -> Any:
    """모델 출력에서 첫 JSON 객체/배열을 꺼낸다."""
    text = re.sub(r"```(?:json)?", "", text)
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        while start >= 0:
            depth, in_str, esc = 0, False, False
            for i in range(start, len(text)):
                ch = text[i]
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                elif ch == '"':
                    in_str = True
                elif ch == opener:
                    depth += 1
                elif ch == closer:
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(text[start:i + 1])
                        except json.JSONDecodeError:
                            break
            start = text.find(opener, start + 1)
    raise ValueError("JSON을 찾지 못함")


class Router:
    def __init__(
        self,
        models: list[ModelSpec],
        *,
        hedge_ms: int = 1200,
        max_parallel: int = 2,
        client: httpx.AsyncClient | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.models = models
        self.state = {m.id: ModelState() for m in models}
        self.hedge_s = hedge_ms / 1000
        self.max_parallel = max(1, max_parallel)
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=5.0),
            limits=httpx.Limits(max_keepalive_connections=20, keepalive_expiry=120),
        )
        self.clock = clock

    # ---------- 후보 선택 ----------

    def _estimate(self, m: ModelSpec) -> float:
        st = self.state[m.id]
        ttft = st.ttft if st.ttft is not None else m.expected_ttft
        return ttft + 0.3 * m.priority

    def candidates(self, tier: str, private: bool = False) -> list[ModelSpec]:
        eligible = [m for m in self.models if not (private and m.provider.trains_on_data)]
        now = self.clock()
        ready = [m for m in eligible if self.state[m.id].cooldown_until <= now]
        primary = sorted((m for m in ready if tier in m.tiers), key=self._estimate)
        rest = sorted((m for m in ready if tier not in m.tiers), key=self._estimate)
        cands = primary + rest
        if not cands:
            # 전부 쿨다운 중이면 가장 먼저 풀리는 것부터라도 시도
            cands = sorted(eligible, key=lambda m: self.state[m.id].cooldown_until)[:2]
        return cands

    # ---------- 상태 기록 ----------

    def _record_ttft(self, m: ModelSpec, seconds: float) -> None:
        st = self.state[m.id]
        st.ttft = seconds if st.ttft is None else 0.7 * st.ttft + 0.3 * seconds

    def _record_success(self, m: ModelSpec) -> None:
        st = self.state[m.id]
        st.successes += 1
        st.consecutive_failures = 0

    def _record_failure(self, m: ModelSpec, err: Exception) -> None:
        st = self.state[m.id]
        st.failures += 1
        st.consecutive_failures += 1
        st.last_error = str(err)[:200]
        n = st.consecutive_failures
        status = getattr(err, "status", None)
        if status == 429:
            wait = getattr(err, "retry_after", None) or min(60 * 2 ** (n - 1), 3600)
        elif status in (401, 403):
            wait = 3600
        elif status == 404:
            wait = 6 * 3600
        else:
            wait = min(20 * n, 300)
        st.cooldown_until = self.clock() + wait
        log.warning("두뇌 %s 실패 (%s), %.0f초 쉼", m.id, st.last_error, wait)

    def status(self) -> list[dict[str, Any]]:
        now = self.clock()
        out = []
        for m in self.models:
            st = self.state[m.id]
            out.append({
                "id": m.id, "tiers": m.tiers, "ttft": round(st.ttft, 3) if st.ttft else None,
                "cooldown": max(0, round(st.cooldown_until - now)), "ok": st.successes,
                "fail": st.failures, "last_error": st.last_error,
            })
        return out

    # ---------- 실제 호출 ----------

    async def _stream_one(self, m: ModelSpec, payload: dict[str, Any]) -> AsyncIterator[str]:
        headers = {"Content-Type": "application/json"}
        if m.provider.api_key:
            headers["Authorization"] = f"Bearer {m.provider.api_key}"
        body = {**payload, **m.params, "model": m.model, "stream": True}
        stripper = ThinkStripper()
        try:
            async with self.client.stream(
                "POST", f"{m.provider.base_url}/chat/completions", json=body, headers=headers
            ) as r:
                if r.status_code != 200:
                    text = (await r.aread()).decode("utf-8", "replace")[:300]
                    ra = r.headers.get("retry-after")
                    retry = float(ra) if ra and ra.replace(".", "", 1).isdigit() else None
                    raise ProviderError(r.status_code, text, retry)
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
                    if obj.get("error"):
                        raise ProviderError(None, str(obj["error"])[:300])
                    for choice in obj.get("choices") or []:
                        content = (choice.get("delta") or {}).get("content")
                        if content:
                            visible = stripper.feed(content)
                            if visible:
                                yield visible
                tail = stripper.flush()
                if tail:
                    yield tail
        except httpx.HTTPError as e:
            raise ProviderError(None, f"{type(e).__name__}: {e}") from e

    async def _attempt(self, idx: int, m: ModelSpec, payload: dict[str, Any], q: asyncio.Queue) -> None:
        start = self.clock()
        got_any = False
        try:
            async for tok in self._stream_one(m, payload):
                if not got_any:
                    got_any = True
                    self._record_ttft(m, self.clock() - start)
                await q.put((idx, "tok", tok))
            if not got_any:
                raise ProviderError(None, "빈 응답")
            self._record_success(m)
            await q.put((idx, "done", None))
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - 어떤 실패든 다음 후보로 넘긴다
            self._record_failure(m, e)
            await q.put((idx, "err", e))

    async def stream(
        self,
        messages: list[dict[str, str]],
        tier: str = "fast",
        *,
        private: bool = False,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> AsyncIterator[str]:
        cands = self.candidates(tier, private)
        if not cands:
            raise NoBrainAvailable("사용 가능한 두뇌가 없음 (API 키를 확인하세요)")
        payload: dict[str, Any] = {"messages": messages}
        if max_tokens:
            payload["max_tokens"] = max_tokens
        if temperature is not None:
            payload["temperature"] = temperature

        q: asyncio.Queue = asyncio.Queue()
        tasks: dict[int, asyncio.Task] = {}
        active: set[int] = set()
        errors: list[str] = []
        next_i = 0
        winner: int | None = None

        def launch() -> None:
            nonlocal next_i
            i = next_i
            next_i += 1
            active.add(i)
            tasks[i] = asyncio.create_task(self._attempt(i, cands[i], payload, q))

        launch()
        try:
            while True:
                can_hedge = winner is None and next_i < len(cands) and len(active) < self.max_parallel
                try:
                    idx, kind, data = await asyncio.wait_for(q.get(), self.hedge_s if can_hedge else None)
                except asyncio.TimeoutError:
                    launch()  # 첫 토큰이 늦음 → 다음 후보를 동시에 출발
                    continue
                if kind == "tok":
                    if winner is None:
                        winner = idx
                        for j, t in tasks.items():
                            if j != idx:
                                t.cancel()
                                active.discard(j)
                    if idx == winner:
                        yield data
                elif kind == "done":
                    if idx == winner:
                        return
                elif kind == "err":
                    active.discard(idx)
                    errors.append(f"{cands[idx].id}: {data}")
                    if idx == winner:
                        raise StreamInterrupted(str(data))
                    if winner is None:
                        if next_i < len(cands):
                            launch()
                        elif not active:
                            raise NoBrainAvailable("모든 두뇌 실패: " + " | ".join(errors))
        finally:
            for t in tasks.values():
                t.cancel()

    async def complete(self, messages: list[dict[str, str]], tier: str = "fast", **kw: Any) -> str:
        parts = [tok async for tok in self.stream(messages, tier, **kw)]
        return "".join(parts).strip()

    async def complete_json(self, messages: list[dict[str, str]], tier: str = "fast", default: Any = None, **kw: Any) -> Any:
        for _ in range(2):
            try:
                return extract_json(await self.complete(messages, tier, **kw))
            except ValueError:
                continue
        return default

    async def aclose(self) -> None:
        await self.client.aclose()
