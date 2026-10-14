"""환경변수 기반 설정. 모든 서버(노드)는 같은 코드를 쓰고 설정만 다르게 준다."""
from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path) -> None:
    """의존성 없이 .env 파일을 읽는다. 이미 설정된 환경변수는 덮어쓰지 않는다."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _int(name: str, default: int) -> int:
    return int(_env(name, str(default)))


def _float(name: str, default: float) -> float:
    return float(_env(name, str(default)))


def _bool(name: str, default: bool) -> bool:
    return (_env(name, "1" if default else "0") or "").lower() in ("1", "true", "yes", "on")


def _list(name: str, default: str) -> list[str]:
    return [x.strip() for x in (_env(name, default) or "").split(",") if x.strip()]


def _quiet_hours(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    start, _, end = value.partition("-")
    return int(start), int(end)


DEFAULT_FEEDS = ",".join([
    # 기술
    "https://news.hada.io/rss/news",          # GeekNews (한국어 기술 뉴스)
    "https://hnrss.org/frontpage",            # Hacker News
    "https://export.arxiv.org/rss/cs.AI",     # 최신 AI 논문
    "https://export.arxiv.org/rss/cs.CL",     # 언어 모델 논문
    "https://export.arxiv.org/rss/cs.LG",     # 머신러닝 논문
    "https://github.blog/changelog/feed/",    # 개발 도구 변화
    # 세상 소식
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.yna.co.kr/rss/news.xml",
])


@dataclass
class Settings:
    node_id: str
    roles: set[str]
    port: int
    owner_token: str | None
    database_url: str | None
    sqlite_path: str
    telegram_token: str | None
    telegram_owner_id: int | None
    timezone: str
    quiet_hours: tuple[int, int] | None
    hedge_ms: int
    max_parallel: int
    private_mode: bool
    embed_provider: str
    embed_dim: int
    embed_url: str | None
    embed_model: str | None
    learn_interval_h: float
    reflect_interval_h: float
    proactive_min_gap_h: float
    persona_path: Path
    seed_topics_path: Path
    sources_path: Path
    models_path: Path
    feeds: list[str] = field(default_factory=list)

    def has_role(self, role: str) -> bool:
        return role in self.roles

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(ROOT / ".env")
        owner = _env("TELEGRAM_OWNER_ID")
        return cls(
            node_id=_env("NODE_ID", socket.gethostname()),
            roles=set(_list("NODE_ROLES", "chat,telegram,autonomy")),
            port=_int("PORT", 8080),
            owner_token=_env("OWNER_TOKEN"),
            database_url=_env("DATABASE_URL"),
            sqlite_path=_env("SQLITE_PATH", str(ROOT / "data" / "mind.db")),
            telegram_token=_env("TELEGRAM_BOT_TOKEN"),
            telegram_owner_id=int(owner) if owner else None,
            timezone=_env("TZ_NAME", "Asia/Seoul"),
            quiet_hours=_quiet_hours(_env("QUIET_HOURS", "1-8")),
            hedge_ms=_int("HEDGE_MS", 1200),
            max_parallel=_int("MAX_PARALLEL", 2),
            private_mode=_bool("PRIVATE_MODE", False),
            embed_provider=_env("EMBED_PROVIDER", "auto"),
            embed_dim=_int("EMBED_DIM", 768),
            embed_url=_env("EMBED_URL"),
            embed_model=_env("EMBED_MODEL"),
            learn_interval_h=_float("LEARN_INTERVAL_HOURS", 3),
            reflect_interval_h=_float("REFLECT_INTERVAL_HOURS", 12),
            proactive_min_gap_h=_float("PROACTIVE_MIN_GAP_HOURS", 8),
            persona_path=Path(_env("PERSONA_PATH", str(ROOT / "config" / "persona.md"))),
            seed_topics_path=Path(_env("SEED_TOPICS_PATH", str(ROOT / "config" / "seed_topics.txt"))),
            sources_path=Path(_env("KNOWLEDGE_SOURCES_PATH", str(ROOT / "config" / "knowledge_sources.txt"))),
            models_path=Path(_env("MODELS_PATH", str(ROOT / "config" / "models.toml"))),
            feeds=_list("LEARN_FEEDS", DEFAULT_FEEDS),
        )
