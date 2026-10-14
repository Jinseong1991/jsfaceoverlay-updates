"""장기 기억 저장소.

- PostgresStore: 여러 서버가 함께 쓰는 공유 기억 (Supabase 무료 + pgvector)
- SqliteStore: 서버 한 대 / 개발용 로컬 파일

두 저장소 모두 같은 인터페이스를 가지며, 서버 간 역할 분담을 위한 lease(임대) 기능도 제공한다.
"""
from __future__ import annotations

import asyncio
import json
import math
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

KINDS = ("chat", "fact", "knowledge", "journal")


@dataclass
class Memory:
    id: int
    kind: str
    content: str
    importance: float
    created_at: float
    meta: dict[str, Any] = field(default_factory=dict)
    similarity: float = 0.0
    score: float = 0.0


def rank(memories: list[Memory], k: int, now: float | None = None) -> list[Memory]:
    """의미 유사도 + 중요도 + 최신성으로 최종 순위를 매긴다."""
    now = now or time.time()
    for m in memories:
        age_days = max(0.0, (now - m.created_at) / 86400)
        recency = math.exp(-age_days / 30)
        m.score = 0.75 * m.similarity + 0.15 * m.importance + 0.10 * recency
    return sorted(memories, key=lambda m: m.score, reverse=True)[:k]


class Store:
    async def init(self) -> None: ...
    async def close(self) -> None: ...
    async def add_message(self, role: str, content: str, channel: str = "") -> None: ...
    async def recent_messages(self, limit: int) -> list[dict[str, Any]]: ...
    async def add_memory(self, kind: str, content: str, embedding: np.ndarray | None,
                         importance: float = 0.5, meta: dict[str, Any] | None = None) -> int: ...
    async def search(self, embedding: np.ndarray, k: int = 6, kinds: list[str] | None = None,
                     min_similarity: float = 0.0) -> list[Memory]: ...
    async def recent_memories(self, kind: str, limit: int) -> list[Memory]: ...
    async def missing_embeddings(self, limit: int) -> list[Memory]: ...
    async def all_memory_ids(self) -> list[int]: ...
    async def get_memories(self, ids: list[int]) -> list[Memory]: ...
    async def set_embedding(self, memory_id: int, embedding: np.ndarray) -> None: ...
    async def has_source(self, url: str) -> bool: ...
    async def kv_get(self, key: str, default: Any = None) -> Any: ...
    async def kv_set(self, key: str, value: Any) -> None: ...
    async def try_lease(self, name: str, node: str, ttl: float) -> bool: ...
    async def stats(self) -> dict[str, int]: ...
    async def export(self) -> dict[str, Any]: ...


# ---------------------------------------------------------------- SQLite

class SqliteStore(Store):
    def __init__(self, path: str) -> None:
        self.path = path
        self.db: sqlite3.Connection | None = None
        self.lock = asyncio.Lock()

    async def _run(self, fn, *args):
        async with self.lock:
            return await asyncio.to_thread(fn, *args)

    async def init(self) -> None:
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT, channel TEXT, created_at REAL);
            CREATE TABLE IF NOT EXISTS memories(
                id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, content TEXT, embedding BLOB,
                importance REAL, created_at REAL, meta TEXT, source TEXT);
            CREATE INDEX IF NOT EXISTS memories_kind ON memories(kind, created_at);
            CREATE INDEX IF NOT EXISTS memories_source ON memories(source);
            CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS leases(name TEXT PRIMARY KEY, node TEXT, expires_at REAL);
        """)
        self.db.commit()

    async def close(self) -> None:
        if self.db:
            self.db.close()

    def _row(self, r: sqlite3.Row, sim: float = 0.0) -> Memory:
        return Memory(r["id"], r["kind"], r["content"], r["importance"], r["created_at"],
                      json.loads(r["meta"] or "{}"), sim)

    async def add_message(self, role: str, content: str, channel: str = "") -> None:
        def fn():
            self.db.execute("INSERT INTO messages(role,content,channel,created_at) VALUES(?,?,?,?)",
                            (role, content, channel, time.time()))
            self.db.commit()
        await self._run(fn)

    async def recent_messages(self, limit: int) -> list[dict[str, Any]]:
        def fn():
            rows = self.db.execute("SELECT role,content,created_at FROM messages ORDER BY id DESC LIMIT ?",
                                   (limit,)).fetchall()
            return [dict(r) for r in reversed(rows)]
        return await self._run(fn)

    async def add_memory(self, kind, content, embedding, importance=0.5, meta=None) -> int:
        meta = meta or {}
        blob = embedding.astype(np.float32).tobytes() if embedding is not None else None

        def fn():
            cur = self.db.execute(
                "INSERT INTO memories(kind,content,embedding,importance,created_at,meta,source) VALUES(?,?,?,?,?,?,?)",
                (kind, content, blob, float(importance), time.time(), json.dumps(meta, ensure_ascii=False),
                 meta.get("url")))
            self.db.commit()
            return cur.lastrowid
        return await self._run(fn)

    async def search(self, embedding, k=6, kinds=None, min_similarity=0.0) -> list[Memory]:
        def fn():
            sql = "SELECT * FROM memories WHERE embedding IS NOT NULL"
            args: list[Any] = []
            if kinds:
                sql += f" AND kind IN ({','.join('?' * len(kinds))})"
                args += kinds
            q = embedding.astype(np.float32)
            rows = [r for r in self.db.execute(sql + " ORDER BY id DESC LIMIT 20000", args)
                    if len(r["embedding"]) == q.nbytes]  # 차원이 다른 옛 임베딩은 건너뜀
            if not rows:
                return []
            mat = np.frombuffer(b"".join(r["embedding"] for r in rows), dtype=np.float32).reshape(len(rows), -1)
            sims = mat @ q
            top = np.argsort(-sims)[: k * 4]
            return [self._row(rows[i], float(sims[i])) for i in top if sims[i] >= min_similarity]
        return rank(await self._run(fn), k)

    async def recent_memories(self, kind, limit) -> list[Memory]:
        def fn():
            rows = self.db.execute("SELECT * FROM memories WHERE kind=? ORDER BY id DESC LIMIT ?",
                                   (kind, limit)).fetchall()
            return [self._row(r) for r in rows]
        return await self._run(fn)

    async def missing_embeddings(self, limit) -> list[Memory]:
        def fn():
            rows = self.db.execute("SELECT * FROM memories WHERE embedding IS NULL LIMIT ?", (limit,)).fetchall()
            return [self._row(r) for r in rows]
        return await self._run(fn)

    async def all_memory_ids(self) -> list[int]:
        return await self._run(lambda: [r[0] for r in self.db.execute("SELECT id FROM memories ORDER BY id")])

    async def get_memories(self, ids) -> list[Memory]:
        def fn():
            rows = self.db.execute(f"SELECT * FROM memories WHERE id IN ({','.join('?' * len(ids))})", ids)
            return [self._row(r) for r in rows]
        return await self._run(fn) if ids else []

    async def set_embedding(self, memory_id, embedding) -> None:
        def fn():
            self.db.execute("UPDATE memories SET embedding=? WHERE id=?",
                            (embedding.astype(np.float32).tobytes(), memory_id))
            self.db.commit()
        await self._run(fn)

    async def has_source(self, url) -> bool:
        return await self._run(
            lambda: self.db.execute("SELECT 1 FROM memories WHERE source=? LIMIT 1", (url,)).fetchone() is not None)

    async def kv_get(self, key, default=None):
        row = await self._run(lambda: self.db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone())
        return json.loads(row[0]) if row else default

    async def kv_set(self, key, value) -> None:
        def fn():
            self.db.execute("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                            (key, json.dumps(value, ensure_ascii=False)))
            self.db.commit()
        await self._run(fn)

    async def try_lease(self, name, node, ttl) -> bool:
        def fn():
            now = time.time()
            row = self.db.execute(
                """INSERT INTO leases(name,node,expires_at) VALUES(?,?,?)
                   ON CONFLICT(name) DO UPDATE SET node=excluded.node, expires_at=excluded.expires_at
                   WHERE leases.node=excluded.node OR leases.expires_at < ?
                   RETURNING node""", (name, node, now + ttl, now)).fetchone()
            self.db.commit()
            return row is not None
        return await self._run(fn)

    async def stats(self) -> dict[str, int]:
        def fn():
            out = {k: 0 for k in KINDS}
            for kind, n in self.db.execute("SELECT kind, COUNT(*) FROM memories GROUP BY kind"):
                out[kind] = n
            out["messages"] = self.db.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
            return out
        return await self._run(fn)

    async def export(self) -> dict[str, Any]:
        def fn():
            msgs = [dict(r) for r in self.db.execute("SELECT role,content,channel,created_at FROM messages ORDER BY id")]
            mems = [dict(r) for r in self.db.execute(
                "SELECT kind,content,importance,created_at,meta FROM memories ORDER BY id")]
            kv = {r["key"]: json.loads(r["value"]) for r in self.db.execute("SELECT key,value FROM kv")}
            return {"messages": msgs, "memories": mems, "kv": kv}
        return await self._run(fn)


# ---------------------------------------------------------------- Postgres

def _vec(v: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v.tolist()) + "]"


class PostgresStore(Store):
    def __init__(self, url: str, dim: int) -> None:
        self.url = url
        self.dim = dim
        self.pool = None

    async def init(self) -> None:
        import asyncpg  # 공유 DB를 쓸 때만 필요

        # statement_cache_size=0: Supabase의 트랜잭션 풀러(6543)와도 호환
        self.pool = await asyncpg.create_pool(self.url, min_size=1, max_size=5, statement_cache_size=0)
        async with self.pool.acquire() as c:
            await c.execute("CREATE EXTENSION IF NOT EXISTS vector")
            await c.execute(f"""
                CREATE TABLE IF NOT EXISTS messages(
                    id BIGSERIAL PRIMARY KEY, role TEXT, content TEXT, channel TEXT,
                    created_at DOUBLE PRECISION);
                CREATE TABLE IF NOT EXISTS memories(
                    id BIGSERIAL PRIMARY KEY, kind TEXT, content TEXT, embedding vector({self.dim}),
                    importance REAL, created_at DOUBLE PRECISION, meta JSONB, source TEXT);
                CREATE INDEX IF NOT EXISTS memories_kind ON memories(kind, created_at);
                CREATE INDEX IF NOT EXISTS memories_source ON memories(source);
                CREATE INDEX IF NOT EXISTS memories_vec ON memories USING hnsw (embedding vector_cosine_ops);
                CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value JSONB);
                CREATE TABLE IF NOT EXISTS leases(name TEXT PRIMARY KEY, node TEXT, expires_at DOUBLE PRECISION);
            """)

    async def close(self) -> None:
        if self.pool:
            await self.pool.close()

    @staticmethod
    def _row(r, sim: float = 0.0) -> Memory:
        meta = r["meta"]
        return Memory(r["id"], r["kind"], r["content"], r["importance"], r["created_at"],
                      json.loads(meta) if isinstance(meta, str) else (meta or {}), sim)

    async def add_message(self, role, content, channel="") -> None:
        await self.pool.execute("INSERT INTO messages(role,content,channel,created_at) VALUES($1,$2,$3,$4)",
                                role, content, channel, time.time())

    async def recent_messages(self, limit) -> list[dict[str, Any]]:
        rows = await self.pool.fetch(
            "SELECT role,content,created_at FROM messages ORDER BY id DESC LIMIT $1", limit)
        return [dict(r) for r in reversed(rows)]

    async def add_memory(self, kind, content, embedding, importance=0.5, meta=None) -> int:
        meta = meta or {}
        return await self.pool.fetchval(
            """INSERT INTO memories(kind,content,embedding,importance,created_at,meta,source)
               VALUES($1,$2,$3::vector,$4,$5,$6::jsonb,$7) RETURNING id""",
            kind, content, _vec(embedding) if embedding is not None else None, float(importance),
            time.time(), json.dumps(meta, ensure_ascii=False), meta.get("url"))

    async def search(self, embedding, k=6, kinds=None, min_similarity=0.0) -> list[Memory]:
        rows = await self.pool.fetch(
            """SELECT id,kind,content,importance,created_at,meta, 1 - (embedding <=> $1::vector) AS sim
               FROM memories WHERE embedding IS NOT NULL AND ($2::text[] IS NULL OR kind = ANY($2))
               ORDER BY embedding <=> $1::vector LIMIT $3""", _vec(embedding), kinds, k * 4)
        return rank([self._row(r, float(r["sim"])) for r in rows if r["sim"] >= min_similarity], k)

    async def recent_memories(self, kind, limit) -> list[Memory]:
        rows = await self.pool.fetch(
            "SELECT id,kind,content,importance,created_at,meta FROM memories WHERE kind=$1 ORDER BY id DESC LIMIT $2",
            kind, limit)
        return [self._row(r) for r in rows]

    async def missing_embeddings(self, limit) -> list[Memory]:
        rows = await self.pool.fetch(
            "SELECT id,kind,content,importance,created_at,meta FROM memories WHERE embedding IS NULL LIMIT $1", limit)
        return [self._row(r) for r in rows]

    async def all_memory_ids(self) -> list[int]:
        return [r["id"] for r in await self.pool.fetch("SELECT id FROM memories ORDER BY id")]

    async def get_memories(self, ids) -> list[Memory]:
        rows = await self.pool.fetch(
            "SELECT id,kind,content,importance,created_at,meta FROM memories WHERE id = ANY($1::bigint[])", ids)
        return [self._row(r) for r in rows]

    async def set_embedding(self, memory_id, embedding) -> None:
        await self.pool.execute("UPDATE memories SET embedding=$1::vector WHERE id=$2", _vec(embedding), memory_id)

    async def has_source(self, url) -> bool:
        return await self.pool.fetchval("SELECT EXISTS(SELECT 1 FROM memories WHERE source=$1)", url)

    async def kv_get(self, key, default=None):
        v = await self.pool.fetchval("SELECT value FROM kv WHERE key=$1", key)
        return json.loads(v) if v is not None else default

    async def kv_set(self, key, value) -> None:
        await self.pool.execute(
            "INSERT INTO kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
            key, json.dumps(value, ensure_ascii=False))

    async def try_lease(self, name, node, ttl) -> bool:
        now = time.time()
        got = await self.pool.fetchval(
            """INSERT INTO leases(name,node,expires_at) VALUES($1,$2,$3)
               ON CONFLICT(name) DO UPDATE SET node=EXCLUDED.node, expires_at=EXCLUDED.expires_at
               WHERE leases.node=EXCLUDED.node OR leases.expires_at < $4
               RETURNING node""", name, node, now + ttl, now)
        return got is not None

    async def stats(self) -> dict[str, int]:
        out = {k: 0 for k in KINDS}
        for r in await self.pool.fetch("SELECT kind, COUNT(*) AS n FROM memories GROUP BY kind"):
            out[r["kind"]] = r["n"]
        out["messages"] = await self.pool.fetchval("SELECT COUNT(*) FROM messages")
        return out

    async def export(self) -> dict[str, Any]:
        msgs = [dict(r) for r in await self.pool.fetch(
            "SELECT role,content,channel,created_at FROM messages ORDER BY id")]
        mems = [dict(r) for r in await self.pool.fetch(
            "SELECT kind,content,importance,created_at,meta::text AS meta FROM memories ORDER BY id")]
        kv = {r["key"]: json.loads(r["value"]) for r in await self.pool.fetch("SELECT key,value::text AS value FROM kv")}
        return {"messages": msgs, "memories": mems, "kv": kv}


def make_store(database_url: str | None, sqlite_path: str, dim: int) -> Store:
    if database_url:
        return PostgresStore(database_url, dim)
    return SqliteStore(sqlite_path)
