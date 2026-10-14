import httpx

from app.learner import Learner, html_to_text
from app.telegram import TelegramBot
from test_brain import make


class RecordingBot(TelegramBot):
    def __init__(self, owner_id, brain):
        super().__init__("t", owner_id, brain, None, httpx.AsyncClient())
        self.sent = []

    async def api(self, method, *, http_timeout=30, **params):
        self.sent.append((method, params))
        return {"message_id": len(self.sent)}


def upd(user_id, text):
    return {"update_id": 1, "message": {"chat": {"id": user_id}, "from": {"id": user_id}, "text": text}}


async def test_only_owner_can_talk():
    brain, store, _ = await make({})
    bot = RecordingBot(42, brain)
    await bot.handle(upd(7, "안녕"))
    assert "주인 전용" in bot.sent[-1][1]["text"]
    assert await store.recent_messages(5) == []

    await bot.handle(upd(42, "안녕"))
    await brain.drain()
    texts = [p.get("text") for m, p in bot.sent if m in ("sendMessage", "editMessageText")]
    assert texts[-1] == "좋아"


async def test_unconfigured_owner_shows_id():
    brain, _, _ = await make({})
    bot = RecordingBot(None, brain)
    await bot.handle(upd(1234, "hi"))
    assert "1234" in bot.sent[-1][1]["text"]


async def test_rules_commands():
    brain, _, _ = await make({})
    await brain.set_directives(["반말해", "짧게"])
    bot = RecordingBot(42, brain)
    await bot.handle(upd(42, "/forget_rule 1"))
    assert await brain.directives() == ["짧게"]


async def test_ingest_document_once():
    html = "<html><title>문서</title><script>x()</script><body>" + "가나다라 문장입니다. " * 300 + "</body></html>"

    async def handler(request):
        return httpx.Response(200, text=html, headers={"content-type": "text/html"})
    brain, store, _ = await make({})
    learner = Learner(brain, httpx.AsyncClient(transport=httpx.MockTransport(handler)), [])
    n = await learner.ingest_url("https://doc.test/a")
    assert n > 1
    assert await learner.ingest_url("https://doc.test/a") == 0  # 중복 입력 안 함
    mems = await store.recent_memories("knowledge", 100)
    assert len(mems) == n and all(m.content.startswith("[문서]") for m in mems)
    assert "x()" not in html_to_text(html)
