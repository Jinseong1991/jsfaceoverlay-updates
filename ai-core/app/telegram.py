"""텔레그램 봇: 주인 전용 대화 창구. 롱폴링이라 서버에 공개 주소가 없어도 된다.

여러 서버 중 'telegram' lease를 가진 한 대만 메시지를 받는다(중복 응답 방지).
답장은 생성되는 대로 메시지를 고쳐 쓰며 보여준다(스트리밍).
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from .autonomy import Autonomy
    from .brain import Brain

log = logging.getLogger(__name__)

LIMIT = 4000
EDIT_INTERVAL = 1.0

HELP = """/status - 두뇌와 기억 상태
/rules - 내가 지키고 있는 주인의 지시 목록
/forget_rule 번호 - 지시 하나 지우기
/learn - 지금 바로 인터넷에서 공부하기
/reflect - 지금 바로 돌아보고 일기 쓰기"""


class TelegramBot:
    def __init__(self, token: str, owner_id: int | None, brain: "Brain", autonomy: "Autonomy | None",
                 client: httpx.AsyncClient) -> None:
        self.base = f"https://api.telegram.org/bot{token}"
        self.owner_id = owner_id
        self.brain = brain
        self.autonomy = autonomy
        self.client = client

    async def api(self, method: str, *, http_timeout: float = 30, **params: Any) -> Any:
        r = await self.client.post(f"{self.base}/{method}", json=params, timeout=http_timeout)
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"telegram {method}: {data.get('description')}")
        return data["result"]

    async def send(self, chat_id: int, text: str) -> int:
        msg = await self.api("sendMessage", chat_id=chat_id, text=text[:LIMIT] or "…")
        return msg["message_id"]

    async def edit(self, chat_id: int, message_id: int, text: str) -> None:
        try:
            await self.api("editMessageText", chat_id=chat_id, message_id=message_id, text=text[:LIMIT] or "…")
        except RuntimeError as e:
            if "not modified" not in str(e):
                log.info("메시지 수정 실패: %s", e)

    async def notify_owner(self, text: str) -> bool:
        if not self.owner_id:
            return False
        try:
            await self.send(self.owner_id, text)
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("주인에게 메시지 전송 실패: %s", e)
            return False

    # ---------- 수신 ----------

    async def run(self, is_leader: Callable[[], bool]) -> None:
        offset = await self.brain.store.kv_get("telegram_offset", 0)
        while True:
            if not is_leader():
                await asyncio.sleep(5)
                offset = await self.brain.store.kv_get("telegram_offset", offset)
                continue
            try:
                updates = await self.api("getUpdates", http_timeout=40, timeout=25, offset=offset,
                                         allowed_updates=["message"])
            except Exception as e:  # noqa: BLE001 - 네트워크 끊김, 리더 교대(409) 등
                log.info("텔레그램 수신 대기: %s", e)
                await asyncio.sleep(5)
                continue
            for upd in updates:
                offset = upd["update_id"] + 1
                await self.brain.store.kv_set("telegram_offset", offset)
                try:
                    await self.handle(upd)
                except Exception:  # noqa: BLE001
                    log.exception("메시지 처리 실패")

    async def handle(self, upd: dict[str, Any]) -> None:
        msg = upd.get("message") or {}
        chat_id = (msg.get("chat") or {}).get("id")
        user_id = (msg.get("from") or {}).get("id")
        if chat_id is None:
            return
        if self.owner_id is None:
            await self.send(chat_id, f"아직 주인이 설정되지 않았어요.\n당신의 ID: {user_id}\n"
                                     f"이 숫자를 서버 설정의 TELEGRAM_OWNER_ID에 넣고 다시 시작하세요.")
            return
        if user_id != self.owner_id:
            await self.send(chat_id, "이 AI는 주인 전용이에요.")
            return
        text = (msg.get("text") or "").strip()
        if not text:
            await self.send(chat_id, "아직은 글자만 읽을 수 있어.")
            return
        if text.startswith("/"):
            await self.command(chat_id, text)
            return
        await self.reply_streaming(chat_id, text)

    async def reply_streaming(self, chat_id: int, text: str) -> None:
        self.brain.background(self._typing(chat_id))
        message_id: int | None = None
        current = ""
        last_edit = 0.0
        async for tok in self.brain.chat(text, channel="telegram"):
            current += tok
            if len(current) > LIMIT:  # 텔레그램 한 메시지 한도 → 앞부분 확정 후 새 메시지
                cut = current.rfind("\n", 0, LIMIT)
                cut = cut if cut > LIMIT // 2 else LIMIT
                head, current = current[:cut], current[cut:].lstrip()
                if message_id is None:
                    await self.send(chat_id, head)
                else:
                    await self.edit(chat_id, message_id, head)
                message_id = None
            now = time.monotonic()
            if current.strip() and now - last_edit >= EDIT_INTERVAL:
                last_edit = now
                if message_id is None:
                    message_id = await self.send(chat_id, current)
                else:
                    await self.edit(chat_id, message_id, current)
        if current.strip():
            if message_id is None:
                await self.send(chat_id, current)
            else:
                await self.edit(chat_id, message_id, current)

    async def _typing(self, chat_id: int) -> None:
        try:
            await self.api("sendChatAction", chat_id=chat_id, action="typing")
        except Exception:  # noqa: BLE001
            pass

    async def command(self, chat_id: int, text: str) -> None:
        cmd, _, arg = text.partition(" ")
        cmd = cmd.split("@")[0].lower()
        if cmd in ("/start", "/help"):
            await self.send(chat_id, f"나는 {self.brain.persona.name}. 그냥 말 걸면 돼.\n\n{HELP}")
        elif cmd == "/status":
            stats = await self.brain.store.stats()
            lines = [f"기억: 대화 {stats['messages']} / 사실 {stats['fact']} / 지식 {stats['knowledge']} / "
                     f"일기 {stats['journal']}", "", "두뇌:"]
            for m in self.brain.router.status():
                state = f"쉬는 중 {m['cooldown']}초" if m["cooldown"] else "준비됨"
                ttft = f"{m['ttft']}초" if m["ttft"] else "-"
                lines.append(f"- {m['id']}: {state}, 첫 응답 {ttft}, 성공 {m['ok']} / 실패 {m['fail']}")
            await self.send(chat_id, "\n".join(lines))
        elif cmd == "/rules":
            rules = await self.brain.directives()
            body = "\n".join(f"{i}. {r}" for i, r in enumerate(rules, 1)) or "(아직 없음)"
            await self.send(chat_id, "내가 지키고 있는 지시:\n" + body)
        elif cmd == "/forget_rule":
            rules = await self.brain.directives()
            if arg.strip().isdigit() and 1 <= int(arg) <= len(rules):
                removed = rules.pop(int(arg) - 1)
                await self.brain.set_directives(rules)
                await self.send(chat_id, f"지웠어: {removed}")
            else:
                await self.send(chat_id, "사용법: /forget_rule 번호  (/rules 로 번호 확인)")
        elif cmd in ("/learn", "/reflect") and self.autonomy:
            await self.send(chat_id, "알았어, 지금 할게.")
            ran = await self.autonomy.run_due(force=cmd[1:])
            await self.send(chat_id, "끝났어." if ran else "하다가 문제가 생겼어. 서버 로그를 봐줘.")
        else:
            await self.send(chat_id, HELP)
