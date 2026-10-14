import json

from app.brain import Brain, pick_tier
from app.embed import HashEmbedder
from app.memory import SqliteStore
from app.persona import Persona
from app.config import ROOT


class FakeRouter:
    def __init__(self, extract):
        self.extract = extract
        self.calls = []

    async def stream(self, messages, tier="fast", **kw):
        self.calls.append((messages, tier))
        for tok in ["좋", "아"]:
            yield tok

    async def complete_json(self, messages, tier="fast", default=None, **kw):
        return self.extract


async def make(extract):
    store = SqliteStore(":memory:")
    await store.init()
    router = FakeRouter(extract)
    brain = Brain(store, router, HashEmbedder(128), Persona(ROOT / "config" / "persona.md", "Asia/Seoul"))
    return brain, store, router


async def test_chat_streams_and_remembers():
    brain, store, router = await make({"facts": [{"content": "주인은 커피를 좋아한다", "importance": 0.8}],
                                       "directives": ["항상 존댓말을 써라"], "revoke": []})
    out = "".join([t async for t in brain.chat("나 커피 좋아해. 앞으로 존댓말 써")])
    await brain.drain()
    assert out == "좋아"
    assert [m["role"] for m in await store.recent_messages(10)] == ["user", "assistant"]
    assert await brain.directives() == ["항상 존댓말을 써라"]
    facts = await store.recent_memories("fact", 10)
    assert facts[0].content == "주인은 커피를 좋아한다"

    # 다음 대화: 지시가 시스템 프롬프트 맨 앞쪽에, 기억도 함께 들어간다
    _ = [t async for t in brain.chat("커피 추천해줘")]
    system = router.calls[-1][0][0]["content"]
    assert "주인의 지시" in system and "항상 존댓말을 써라" in system
    assert system.index("주인의 지시") < system.index("## 지금")
    assert "커피를 좋아한다" in system
    assert router.calls[-1][0][-1] == {"role": "user", "content": "커피 추천해줘"}
    assert router.calls[-1][0][1]["role"] == "user"  # 대화 기록이 이어진다


async def test_revoke_directive():
    brain, store, _ = await make({"facts": [], "directives": [], "revoke": [1]})
    await brain.set_directives(["반말해", "짧게 말해"])
    _ = [t async for t in brain.chat("이제 반말 안 해도 돼")]
    await brain.drain()
    assert await brain.directives() == ["짧게 말해"]


def test_pick_tier():
    assert pick_tier("안녕") == "fast"
    assert pick_tier("이 코드 왜 안 돼?") == "smart"
    assert pick_tier("가" * 300) == "smart"


def test_persona_name():
    p = Persona(ROOT / "config" / "persona.md", "Asia/Seoul")
    assert p.name == "Jinyu"
