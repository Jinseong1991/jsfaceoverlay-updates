"""인격: 고정된 뿌리(persona.md) + 스스로 써 내려가는 자기 노트 + 떠오른 기억으로 시스템 프롬프트를 만든다.

변하지 않는 부분(persona.md)을 맨 앞에 두어 provider의 프롬프트 캐시가 잘 맞도록 한다 → 응답이 빨라진다.
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .memory import Memory

KIND_LABEL = {"fact": "주인에 대해", "knowledge": "내가 배운 것", "journal": "내 일기", "chat": "지난 대화"}


class Persona:
    def __init__(self, path: Path, timezone: str) -> None:
        self.path = path
        self.tz = ZoneInfo(timezone)
        self._core = ""
        self._mtime = 0.0

    @property
    def core(self) -> str:
        # 파일을 고치면 재시작 없이 바로 반영
        mtime = self.path.stat().st_mtime
        if mtime != self._mtime:
            self._core = self.path.read_text(encoding="utf-8").strip()
            self._mtime = mtime
        return self._core

    @property
    def name(self) -> str:
        m = re.search(r"이름은\s*\*\*(.+?)\*\*", self.core)
        return m.group(1).strip() if m else "AI"

    def now(self) -> datetime:
        return datetime.now(self.tz)

    def system_prompt(self, *, directives: str = "", self_notes: str = "",
                      memories: list[Memory] | None = None, extra: str = "") -> str:
        # 순서: 잘 안 바뀌는 것 → 자주 바뀌는 것 (프롬프트 캐시 적중률)
        parts = [self.core]
        if directives:
            parts.append(directives)
        if self_notes:
            parts.append("## 자기 노트 (내가 스스로 깨닫고 적어둔 것)\n" + self_notes.strip())
        parts.append(f"## 지금\n{self.now():%Y-%m-%d (%a) %H:%M}")
        if memories:
            lines = [f"- [{KIND_LABEL.get(m.kind, m.kind)}] {m.content.strip()[:600]}" for m in memories]
            parts.append("## 떠오르는 기억 (관련 있을 때만 자연스럽게 활용)\n" + "\n".join(lines))
        if extra:
            parts.append(extra)
        return "\n\n".join(parts)
