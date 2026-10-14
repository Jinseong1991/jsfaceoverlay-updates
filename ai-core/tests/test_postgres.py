"""실제 Postgres+pgvector 로 공유 기억을 검증한다. AI_TEST_PG_URL 이 있을 때만 실행."""
import os

import pytest

from app.embed import HashEmbedder
from app.memory import PostgresStore

URL = os.environ.get("AI_TEST_PG_URL")
pytestmark = pytest.mark.skipif(not URL, reason="AI_TEST_PG_URL 미설정")


async def make():
    s = PostgresStore(URL, 64)
    await s.init()
    async with s.pool.acquire() as c:
        await c.execute("TRUNCATE messages, memories, kv, leases RESTART IDENTITY")
    return s


async def test_postgres_roundtrip():
    s, e = await make(), HashEmbedder(64)
    try:
        for text in ["주인은 고양이를 키운다", "파이썬 비동기 프로그래밍", "오늘 날씨가 맑다"]:
            await s.add_memory("fact", text, await e.embed_one(text), 0.5, {"url": f"u:{text}"})
        await s.add_memory("knowledge", "임베딩 없음", None)
        hits = await s.search(await e.embed_one("고양이 키우는 거"), k=1)
        assert hits[0].content == "주인은 고양이를 키운다" and hits[0].meta["url"].startswith("u:")
        assert await s.search(await e.embed_one("고양이"), kinds=["knowledge"]) == []
        missing = await s.missing_embeddings(5)
        assert [m.content for m in missing] == ["임베딩 없음"]
        await s.set_embedding(missing[0].id, await e.embed_one("x"))
        assert await s.has_source("u:오늘 날씨가 맑다")

        await s.kv_set("directives", ["반말해"])
        assert await s.kv_get("directives") == ["반말해"]
        await s.add_message("user", "hi")
        assert (await s.recent_messages(5))[0]["content"] == "hi"

        assert await s.try_lease("telegram", "n1", 60)
        assert not await s.try_lease("telegram", "n2", 60)
        assert await s.try_lease("telegram", "n1", -1)
        assert await s.try_lease("telegram", "n2", 60)

        stats = await s.stats()
        assert stats["fact"] == 3 and stats["messages"] == 1
        dump = await s.export()
        assert len(dump["memories"]) == 4 and dump["kv"]["directives"] == ["반말해"]
        assert len(await s.get_memories(await s.all_memory_ids())) == 4
    finally:
        await s.close()
