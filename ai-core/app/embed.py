"""임베딩: 기억을 의미 기반으로 찾기 위해 글을 벡터로 바꾼다.

- gemini: 무료 Gemini 임베딩 API (품질 좋음, 추천)
- openai: OpenAI 호환 /embeddings (예: 자체 llama.cpp 서버)
- hash: 외부 호출 없는 글자 n-gram 해싱 (항상 동작, 품질은 낮음)

임베딩 방식을 바꾸면 `python -m app.main reembed`로 기존 기억을 다시 계산해야 한다.
"""
from __future__ import annotations

import zlib

import httpx
import numpy as np


def normalize(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


class Embedder:
    name = "base"

    def __init__(self, dim: int) -> None:
        self.dim = dim

    async def embed(self, texts: list[str], *, query: bool = False) -> list[np.ndarray]:
        raise NotImplementedError

    async def embed_one(self, text: str, *, query: bool = False) -> np.ndarray:
        return (await self.embed([text], query=query))[0]


class HashEmbedder(Embedder):
    name = "hash"

    async def embed(self, texts: list[str], *, query: bool = False) -> list[np.ndarray]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        s = " ".join(text.lower().split())
        for n in (1, 2, 3):
            for i in range(len(s) - n + 1):
                h = zlib.crc32(f"{n}:{s[i:i + n]}".encode())
                v[h % self.dim] += 1.0 if (h >> 31) & 1 else -1.0
        return normalize(v)


class GeminiEmbedder(Embedder):
    name = "gemini"
    MODEL = "gemini-embedding-001"

    def __init__(self, dim: int, api_key: str, client: httpx.AsyncClient) -> None:
        super().__init__(dim)
        self.api_key = api_key
        self.client = client

    async def embed(self, texts: list[str], *, query: bool = False) -> list[np.ndarray]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.MODEL}:batchEmbedContents"
        task = "RETRIEVAL_QUERY" if query else "RETRIEVAL_DOCUMENT"
        body = {"requests": [{
            "model": f"models/{self.MODEL}",
            "content": {"parts": [{"text": t[:8000]}]},
            "taskType": task,
            "outputDimensionality": self.dim,
        } for t in texts]}
        r = await self.client.post(url, json=body, headers={"x-goog-api-key": self.api_key}, timeout=15)
        r.raise_for_status()
        return [normalize(np.asarray(e["values"], dtype=np.float32)) for e in r.json()["embeddings"]]


class OpenAIEmbedder(Embedder):
    name = "openai"

    def __init__(self, dim: int, url: str, model: str, api_key: str | None, client: httpx.AsyncClient) -> None:
        super().__init__(dim)
        self.url = url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.client = client

    async def embed(self, texts: list[str], *, query: bool = False) -> list[np.ndarray]:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        r = await self.client.post(f"{self.url}/embeddings", json={"model": self.model, "input": texts},
                                   headers=headers, timeout=30)
        r.raise_for_status()
        out = []
        for item in sorted(r.json()["data"], key=lambda d: d["index"]):
            v = np.asarray(item["embedding"], dtype=np.float32)[: self.dim]
            if v.shape[0] < self.dim:
                v = np.pad(v, (0, self.dim - v.shape[0]))
            out.append(normalize(v))
        return out


def make_embedder(provider: str, dim: int, client: httpx.AsyncClient, *, gemini_key: str | None,
                  url: str | None, model: str | None, api_key: str | None = None) -> Embedder:
    if provider == "auto":
        provider = "gemini" if gemini_key else ("openai" if url else "hash")
    if provider == "gemini":
        if not gemini_key:
            raise ValueError("EMBED_PROVIDER=gemini 인데 GEMINI_API_KEY가 없음")
        return GeminiEmbedder(dim, gemini_key, client)
    if provider == "openai":
        if not url:
            raise ValueError("EMBED_PROVIDER=openai 인데 EMBED_URL이 없음")
        return OpenAIEmbedder(dim, url, model or "default", api_key, client)
    return HashEmbedder(dim)
