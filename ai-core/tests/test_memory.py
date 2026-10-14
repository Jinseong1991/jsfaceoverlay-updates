import numpy as np

from app.embed import HashEmbedder
from app.memory import SqliteStore


async def make():
    s = SqliteStore(":memory:")
    await s.init()
    return s


async def test_search_finds_related():
    s, e = await make(), HashEmbedder(256)
    for text in ["주인은 고양이를 키운다", "파이썬 비동기 프로그래밍", "오늘 날씨가 맑다"]:
        await s.add_memory("fact", text, await e.embed_one(text))
    hits = await s.search(await e.embed_one("고양이 키우는 거"), k=1)
    assert hits[0].content == "주인은 고양이를 키운다"


async def test_kind_filter_and_missing_embeddings():
    s, e = await make(), HashEmbedder(64)
    await s.add_memory("fact", "a", await e.embed_one("a"))
    await s.add_memory("knowledge", "b", None, meta={"url": "https://x"})
    assert [m.kind for m in await s.search(await e.embed_one("a"), kinds=["knowledge"])] == []
    missing = await s.missing_embeddings(10)
    assert [m.content for m in missing] == ["b"]
    await s.set_embedding(missing[0].id, np.ones(64, dtype=np.float32) / 8)
    assert await s.missing_embeddings(10) == []
    assert await s.has_source("https://x")


async def test_lease_is_exclusive_until_expiry():
    s = await make()
    assert await s.try_lease("telegram", "n1", 60)
    assert not await s.try_lease("telegram", "n2", 60)
    assert await s.try_lease("telegram", "n1", 60)  # 갱신
    assert await s.try_lease("telegram", "n2", -1) is False
    assert await s.try_lease("telegram", "n1", -1)  # 만료시킴
    assert await s.try_lease("telegram", "n2", 60)


async def test_kv_and_messages():
    s = await make()
    await s.kv_set("x", {"a": [1, "한"]})
    assert await s.kv_get("x") == {"a": [1, "한"]}
    assert await s.kv_get("none", 5) == 5
    await s.add_message("user", "hi")
    await s.add_message("assistant", "hello")
    assert [m["role"] for m in await s.recent_messages(10)] == ["user", "assistant"]
    assert (await s.stats())["messages"] == 2
