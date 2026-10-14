import asyncio
import json

import httpx
import pytest

from app.router import ModelSpec, NoBrainAvailable, Provider, Router, ThinkStripper, extract_json
from conftest import sse


def spec(id, tiers=("fast",), priority=1, ttft=0.5, trains=False):
    return ModelSpec(id, Provider(id, f"https://{id}.test/v1", "k", trains), id, list(tiers), priority, ttft)


def make_router(handlers, **kw):
    async def handler(request: httpx.Request):
        name = request.url.host.split(".")[0]
        return await handlers[name](request)
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return Router([spec(n, **kw.pop(n, {})) for n in handlers], client=client, **kw)


async def ok(*chunks, delay=0.0):
    async def h(request):
        await asyncio.sleep(delay)
        return httpx.Response(200, content=sse(*chunks))
    return h


async def test_streams_from_fastest():
    r = make_router({"a": await ok("안", "녕"), "b": await ok("x")}, b={"priority": 3})
    assert await r.complete([{"role": "user", "content": "hi"}]) == "안녕"
    assert r.state["a"].successes == 1 and r.state["b"].successes == 0


async def test_falls_back_on_429_and_cools_down():
    async def limited(request):
        return httpx.Response(429, headers={"retry-after": "30"}, text="rate limited")
    r = make_router({"a": limited, "b": await ok("ok")}, b={"priority": 3})
    assert await r.complete([{"role": "user", "content": "hi"}]) == "ok"
    assert r.state["a"].cooldown_until > r.clock() + 25
    # 쿨다운 중이면 후보에서 빠진다
    assert [m.id for m in r.candidates("fast")] == ["b"]


async def test_hedging_picks_first_token():
    r = make_router({"slow": await ok("느림", delay=1.0), "fast": await ok("빠름")},
                    hedge_ms=100, fast={"priority": 5})
    start = asyncio.get_running_loop().time()
    assert await r.complete([{"role": "user", "content": "hi"}]) == "빠름"
    assert asyncio.get_running_loop().time() - start < 0.8


async def test_all_fail_raises():
    async def boom(request):
        return httpx.Response(500, text="err")
    r = make_router({"a": boom, "b": boom})
    with pytest.raises(NoBrainAvailable):
        await r.complete([{"role": "user", "content": "hi"}])


async def test_private_mode_excludes_training_providers():
    r = make_router({"a": await ok("x"), "b": await ok("y")}, a={"trains": True})
    assert [m.id for m in r.candidates("fast", private=True)] == ["b"]


async def test_tier_preference_then_fallback():
    r = make_router({"s": await ok("x"), "f": await ok("y")}, s={"tiers": ("smart",)})
    assert [m.id for m in r.candidates("smart")] == ["s", "f"]
    assert [m.id for m in r.candidates("fast")] == ["f", "s"]


async def test_params_and_model_sent():
    seen = {}

    async def h(request):
        seen.update(json.loads(request.content))
        return httpx.Response(200, content=sse("ok"))
    r = make_router({"a": h})
    r.models[0].params = {"reasoning_effort": "low"}
    await r.complete([{"role": "user", "content": "hi"}], max_tokens=5)
    assert seen["model"] == "a" and seen["stream"] is True and seen["reasoning_effort"] == "low"
    assert seen["max_tokens"] == 5


def test_think_stripper_across_chunks():
    s = ThinkStripper()
    out = "".join(s.feed(c) for c in ["앞<thi", "nk>숨김</th", "ink>뒤", "<"]) + s.flush()
    assert out == "앞뒤<"


def test_extract_json():
    assert extract_json('설명 ```json\n{"a": [1, "}"]}\n``` 끝') == {"a": [1, "}"]}
    assert extract_json("[1,2]") == [1, 2]
    with pytest.raises(ValueError):
        extract_json("없음")
