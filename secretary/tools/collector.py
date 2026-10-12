#!/usr/bin/env python3
"""비서 수집기. 토큰을 전혀 쓰지 않는다. 표준 라이브러리만 사용한다.

모든 Claude Code 세션(PC 로컬 + 클라우드)의 사용자 발화를 모아 규칙 기반으로 분석하고,
프로필·니즈·근거를 secretary/ 아래 파일과 폰 앱용 data.json으로 만든다.

  collector.py ingest [--push]      ~/.claude/projects 의 모든 세션 jsonl 을 읽어 inbox 에 쌓고 분석
  collector.py hook                  Claude Code Stop 훅용. stdin 의 transcript_path 하나만 읽고 분석 (조용히 종료)
  collector.py analyze               inbox 만 다시 분석해 profile/needs/signals/PROFILE.md/app/data.json 생성
  collector.py add-cloud FILE --session ID   {created_at,text} jsonl 을 inbox/cloud 에 추가
  collector.py import-events DIR     앱 DB 에서 내려받은 events/*.json 을 inbox/phone 으로 복사
  collector.py rule "..." [--remove] 세션에 바로 적용할 규칙 한 줄 추가/삭제
  collector.py suggest --title ... --why ... --action ... [--need n-xxxxxx]
  collector.py resolve sg-xxxx --status accepted|declined|done|expired [--note ...]
  collector.py plan n-xxxxxx --file plan.json   니즈에 계획(단계 목록) 붙이기
  collector.py status

데이터 (모두 secretary/ 아래):
  inbox/<host>/messages.jsonl  원본 발화 (uuid 로 중복 제거)
  inbox/phone/*.json           폰 앱에서 보낸 결정/기록/피드백
  signals.jsonl                규칙이 찾은 근거 (analyze 때마다 재생성)
  profile.json                 자동 프로필 + 수동 규칙(how_to_apply)
  needs.json                   파악한 니즈 (자동) + 사용자 결정/계획(needs-state.json 과 합침)
  needs-state.json             니즈별 사용자 결정, 계획
  feedback.json                프로필 항목에 대한 맞아/틀렸어
  suggestions.json             제안과 상태
  logs.jsonl                   폰에서 남긴 기분/메모
  PROFILE.md                   사람이 읽는 요약 (CLAUDE.md 가 읽게 함)
  app/data.json                폰 앱이 읽는 전체 데이터
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
INBOX = ROOT / "inbox"
SIGNALS = ROOT / "signals.jsonl"
PROFILE = ROOT / "profile.json"
NEEDS = ROOT / "needs.json"
NEEDS_STATE = ROOT / "needs-state.json"
FEEDBACK = ROOT / "feedback.json"
SUGGESTIONS = ROOT / "suggestions.json"
LOGS = ROOT / "logs.jsonl"
PROFILE_MD = ROOT / "PROFILE.md"
DATA_JSON = ROOT / "app" / "data.json"
CONFIG = ROOT / "config.json"

KST = timezone(timedelta(hours=9))
CATEGORIES = ["말투", "선호", "비선호", "감정", "요청방식", "작업습관", "관심사", "일상"]
HOST = re.sub(r"[^A-Za-z0-9_-]", "_", socket.gethostname() or "local")[:40]


# ----------------------------------------------------------------- utils

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def read_jsonl(path: Path) -> list[dict]:
    out = []
    if not path.exists():
        return out
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


def append_jsonl(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def short_id(prefix: str, *parts: str) -> str:
    return prefix + "-" + hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:6]


def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


# ------------------------------------------------------- message extraction

SKIP_PREFIXES = ("<", "[Request interrupted", "Stop hook feedback", "Caveat:", "This session is being continued")


def text_of(content) -> str | None:
    """사용자가 직접 친 텍스트만. tool_result, 시스템 리마인더, 명령 태그는 버린다."""
    if isinstance(content, str):
        t = content
    elif isinstance(content, list):
        parts = []
        for b in content:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_result":
                return None
            if b.get("type") == "text":
                parts.append(b.get("text", ""))
        t = "\n".join(parts)
    else:
        return None
    t = re.sub(r"<system-reminder>.*?</system-reminder>", "", t, flags=re.S)
    t = re.sub(r"<[a-z_-]+-stdout>.*?</[a-z_-]+-stdout>", "", t, flags=re.S)
    t = t.strip()
    if not t or t.startswith(SKIP_PREFIXES):
        return None
    if re.match(r"^/[a-z]", t):  # /슬래시 명령
        return None
    if len(t) > 4000:  # 긴 붙여넣기(로그, 보고서)는 앞부분만 근거로 쓴다
        t = t[:4000]
    return t


def extract_from_transcript(path: Path) -> list[dict]:
    rows = []
    for d in read_jsonl(path):
        if d.get("type") != "user" or d.get("isSidechain") or d.get("isMeta"):
            continue
        t = text_of((d.get("message") or {}).get("content"))
        if t is None:
            continue
        rows.append({
            "uuid": d.get("uuid") or short_id("m", str(d.get("timestamp")), t),
            "at": d.get("timestamp"),
            "session": d.get("sessionId") or path.stem,
            "cwd": d.get("cwd"),
            "text": t,
            "source": "local",
        })
    return rows


def claude_project_dirs() -> list[Path]:
    dirs = []
    for base in (Path.home() / ".claude" / "projects",):
        if base.is_dir():
            dirs.append(base)
    extra = os.environ.get("SECRETARY_PROJECT_DIRS")
    if extra:
        for p in extra.split(os.pathsep):
            if p and Path(p).is_dir():
                dirs.append(Path(p))
    return dirs


def ingest_paths(paths: list[Path], host: str) -> int:
    target = INBOX / host / "messages.jsonl"
    known = {r.get("uuid") for r in read_jsonl(target)}
    new = []
    for p in paths:
        for r in extract_from_transcript(p):
            if r["uuid"] in known:
                continue
            known.add(r["uuid"])
            new.append(r)
    new.sort(key=lambda r: r.get("at") or "")
    append_jsonl(target, new)
    return len(new)


def all_messages() -> list[dict]:
    rows = []
    if INBOX.is_dir():
        for host_dir in sorted(INBOX.iterdir()):
            f = host_dir / "messages.jsonl"
            if f.exists():
                for r in read_jsonl(f):
                    r.setdefault("host", host_dir.name)
                    rows.append(r)
    seen = set()
    out = []
    for r in sorted(rows, key=lambda r: r.get("at") or ""):
        if r.get("uuid") in seen:
            continue
        seen.add(r.get("uuid"))
        out.append(r)
    return out


# ----------------------------------------------------------- phone events

def apply_phone_events() -> int:
    """inbox/phone/*.json → needs-state / feedback / suggestions / logs. 처리한 파일은 .done 으로 바꾼다."""
    d = INBOX / "phone"
    if not d.is_dir():
        return 0
    state = load_json(NEEDS_STATE, {})
    fb = load_json(FEEDBACK, {})
    sugg = load_json(SUGGESTIONS, {"items": []})
    n = 0
    for f in sorted(d.glob("*.json")):
        ev = load_json(f, None)
        if not isinstance(ev, dict):
            continue
        kind = ev.get("kind")
        at = ev.get("at") or now_iso()
        if kind == "need" and ev.get("need_id"):
            s = state.setdefault(ev["need_id"], {})
            s["status"] = ev.get("status", s.get("status"))
            s["at"] = at
            if ev.get("note"):
                s["note"] = ev["note"]
        elif kind == "feedback" and ev.get("profile_id"):
            fb[ev["profile_id"]] = {"verdict": ev.get("verdict"), "at": at, "note": ev.get("note")}
        elif kind == "suggestion" and ev.get("id"):
            for it in sugg["items"]:
                if it["id"] == ev["id"]:
                    it["status"] = ev.get("status", it["status"])
                    it["resolved_at"] = at
                    it["note"] = ev.get("note")
        elif kind == "log":
            append_jsonl(LOGS, [{"at": at, "text": ev.get("text", ""), "mood": ev.get("mood"), "category": ev.get("category")}])
        else:
            continue
        f.rename(f.with_suffix(".done"))
        n += 1
    save_json(NEEDS_STATE, state)
    save_json(FEEDBACK, fb)
    save_json(SUGGESTIONS, sugg)
    return n


# --------------------------------------------------------------- analysis

# (카테고리, 추론 문장, 정규식). 한 발화가 여러 개에 걸릴 수 있다.
PATTERNS = [
    ("요청방식", "원하는 결과를 '~했으면 좋겠다'로 서술하고 구현은 맡긴다", r"(했으면|됐으면|됬으면|있었으면|좋겠)"),
    ("요청방식", "'~해줄래' 식의 부드러운 요청을 쓴다", r"(줄래|줄 수 있|줄수있|해주라)"),
    ("요청방식", "직접 명령형('~해줘')으로 요청한다", r"(해줘|해주세요|해 줘|만들어줘|만들어 줘|보여줘|알려줘)"),
    ("요청방식", "가능한지 먼저 묻는다", r"(가능한가|가능한지|가능해|가능할까|가능하냐|할수있|할 수 있(어|나|을까|냐))"),
    ("요청방식", "여러 요구를 '그리고'로 이어 붙인다", r"그리고"),
    ("요청방식", "'내가 원하는 건'으로 의도를 다시 못박는다", r"(원하는\s*건|원하는건|원하는 것은|원하는거)"),
    ("비선호", "의도와 다른 결과를 '~가 아니고/말고'로 거부한다", r"(아니고|아니라|말고|가 아냐|이 아냐)"),
    ("비선호", "안 되는 것을 짧게 지적한다", r"(안됨|안돼|안되|안나옴|안나와|안 됨|안 돼|안 나옴|안됐|안 됐|않네|않음)"),
    ("비선호", "이상하거나 불편한 UI를 지적한다", r"(이상하|이상함|불편|직관적이지|비직관|엉망|이상해)"),
    ("비선호", "하지 말라고 직접 지시한다", r"(하지\s*마|하지말|빼줘|빼고|없애|지워|삭제해)"),
    ("비선호", "질문을 건너뛰거나 멋대로 진행하는 것을 싫어한다", r"(스킵|건너뛰|멋대로|마음대로|물어보고)"),
    ("감정", "답답함이나 짜증을 드러낸다", r"(짜증|답답|화나|미치겠|아놔|환장|ㅠ|ㅜ|하\.\.\.|에휴)"),
    ("감정", "급함을 드러낸다", r"(빨리|급해|급하|당장|지금 바로|서둘|얼른)"),
    ("감정", "피로를 드러낸다", r"(피곤|졸려|힘들|지친|지쳤|쉬고)"),
    ("감정", "만족이나 긍정을 짧게 표현한다", r"(잘나옴|잘 나옴|잘됨|잘 됨|잘되|좋아|좋다|좋네|좋음|괜찮|완벽|굿|고마워|고맙|감사|오 |오오|됐다|된다|되네)"),
    ("감정", "승부욕과 목표의식을 드러낸다", r"(이기고|이길|최고|무조건|반드시|꼭 |1등|이겨)"),
    ("선호", "구체적이고 자세한 설명을 원한다", r"(구체적|자세히|상세|정확히|하나하나|단계별)"),
    ("선호", "파일 경로와 위치를 명시해 주길 원한다", r"(경로|어디로|어디서|어디에|위치|폴더)"),
    ("선호", "결과를 눈으로 확인하길 원한다 (시안, 스크린샷, 미리보기)", r"(시안|예시|미리보기|스크린샷|보여줘|보여 줘|캡처)"),
    ("선호", "짧고 바로 쓸 수 있는 답을 원한다", r"(간단히|짧게|요약|한줄|한 줄|바로|그냥)"),
    ("작업습관", "오류 로그를 가공 없이 그대로 붙여넣는다", r"(error CS\d+|Exception|Traceback|error:|Error:|\(\d+,\d+\): error|NullReference|at [A-Za-z_.]+\()"),
    ("작업습관", "세션 간 인계 문서와 정리를 원한다", r"(인계|핸드오프|handoff|다른 세션|이어서|이어갈|이어 갈|정리해|문서로|참조할)"),
    ("작업습관", "단계마다 확인과 승인을 원한다", r"(확인하고|확인 후|물어봐|물어보|승인|허락|먼저 보여)"),
    ("작업습관", "설치·실행 명령을 그대로 입력한다", r"^(uv |pip |npm |npx |git |python|brew |apt |dotnet |cargo |go |curl )"),
    ("관심사", "Unity / VRChat 아바타 툴링", r"(유니티|unity|vrchat|아바타|avatar|poiyomi|셰이더|shader|애니메이터|animator|fx레이어|fx 레이어|modular avatar|unitypackage)"),
    ("관심사", "경쟁 제품과 판매 전략", r"(부스|booth|경쟁|상품|판매|가격|전략|시장|마케팅)"),
    ("관심사", "AI 비서와 자동화", r"(비서|자동화|자동으로|알아서|루틴|routine|스케줄|매일)"),
    ("일상", "식사·수면·건강·일정 같은 생활을 언급한다", r"(밥|점심|저녁|아침|잠|자야|자고|병원|운동|가족|주말|약속|출근|퇴근|회사|여행|휴가|생일|감기|아파)"),
]
SHORT_OK = re.compile(r"^(ㅇㅇ|ㅇㅋ|응|넵|네|예|시작해|시작|괜찮아|괜찮|좋아|진행|진행해|고|ok|okay|오케이|오키|다시 시도|다시|해봐|해|해줘|ㄱㄱ|가자|그래|맞아|맞음|아니|아님|ㄴㄴ)[.!~ ]*$", re.I)

STOP = set("""그리고 그래서 그런데 근데 하지만 그냥 이거 그거 저거 이건 그건 그게 이게 뭔가 좀 더 또 다시 지금 아까 거기 여기 이렇게 그렇게 저렇게
너 나 내 네 우리 너가 니가 내가 우리가 거 것 수 때 뭐 왜 어디 어떻게 어떤 무슨 어느 하나 둘 등 중 안 못 잘 잘못 같아 같은 같이 처럼 해줘 해줄래 해서 하고 하는 하면 할 한 했다 했어 했는데
있어 있는 있게 있으면 없어 없는 없이 되는 되게 되면 된다 됐다 됐으면 됬으면 됐으면좋겠어 좋겠어 좋겠음 좋겠네 좋겠고 싶어 싶은 싶다 원해 필요 가능 가능하면 가능하다면 다 또는 및 대해 대한 때문 통해 위해 부터 까지
파일 폴더 경로 설명 문제 상태 작업 기능 세션 부분 방법 내용 결과 정도 이번 다음 이전 오늘 어제 내일 모든 전부 하나하나 기본 기본적으로 추가 수정 변경 확인 진행 시작 다시
the a an to of in on for and or is are it this that with from by as be at""".split())
VERBISH = re.compile(r"(게|게끔|면|고|지|해|줘|래|음|함|되|된|는데|니까|해서|라면|으면|했|겠|어|네|요|다|까|야|죠|만약|는지|은지|하|있|없|싶|좋겠|모르|같|라던지|든지|이던|거나)$|(좋겠|싶|모르겠|있었|해줬|해줄|됬으|됐으|같은데|가능)")
PARTICLE = re.compile(r"(은|는|이|가|을|를|도|로|으로|에|에서|의|와|과|랑|이랑|만|까지|부터|에게|한테|처럼|보다|마다|조차|밖에|든지|이나|나|요|들|쪽|용)$")
NEED_RE = re.compile(r"(했으면|됐으면|됬으면|있었으면|좋겠|원해|원함|하고싶|하고 싶|싶어|싶다|필요|만들어|추가|넣어|들어갔으면|되게|가능하|해줬으면|있게|해줄래|해줘|되야|돼야|해야)")
FEATURE_RE = re.compile(r"(유니티|unity|아바타|기능|앱|툴|버튼|메뉴|저장|옷장|패키지|렌더|화면|상품|비서|시스템|자동|데이터|애니메|셰이더|쉐이더|프리팹|인스펙터|프로젝트창|오버레이|부스|booth|판매|전략|경쟁)", re.I)
SENT_SPLIT = re.compile(r"(?:\n|(?<=[.!?])\s+|\s+그리고\s+|\s+그리고(?=[가-힣])|,\s+)")


def tokens(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[가-힣A-Za-z0-9_.]+", text):
        w = w.strip("._")
        if not w:
            continue
        base = w.lower()
        if re.match(r"^[가-힣]+$", base):
            base2 = PARTICLE.sub("", base)
            if len(base2) >= 2:
                base = base2
        if len(base) < 2 or base in STOP or base.isdigit():
            continue
        if len(base) >= 3 and VERBISH.search(base):
            continue
        out.append(base)
    return out


def analyze(messages: list[dict]) -> tuple[list[dict], dict, list[dict]]:
    signals = []
    agg: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for m in messages:
        t = m["text"]
        meta = {"when": m.get("at"), "ref": m.get("session"), "host": m.get("host"), "uuid": m.get("uuid")}
        ev = t.replace("\n", " ").strip()
        if len(ev) > 110:
            ev = ev[:107] + "..."
        hits = []
        if len(t) <= 8 and SHORT_OK.match(t.strip()):
            hits.append(("요청방식", "승인·진행 지시는 한 마디로 한다"))
        else:
            for cat, st, rx in PATTERNS:
                if st.startswith("만족") and len(t) > 60:
                    continue
                if re.search(rx, t, flags=re.I):
                    hits.append((cat, st))
        for cat, st in hits:
            sig = {"id": short_id("s", m.get("uuid", ""), cat, st), "category": cat, "statement": st, "evidence": ev, **meta}
            signals.append(sig)
            agg[(cat, st)].append(sig)

    # 말투·습관 통계
    texts = [m["text"] for m in messages]
    n = max(len(texts), 1)
    formal = sum(1 for t in texts if re.search(r"(요|니다|세요|습니까|죠)[.!? ]*$", t.strip()))
    dbl = sum(1 for t in texts if "  " in t)
    period = sum(1 for t in texts if re.search(r"[.!?]\s*$", t.strip()))
    emoji = sum(1 for t in texts if re.search(r"[\U0001F300-\U0001FAFF☀-➿]", t))
    avg_len = sum(len(t) for t in texts) / n
    eng = sum(1 for t in texts if re.fullmatch(r"[A-Za-z0-9 _./:\\\-]+", t.strip()))
    hours = Counter()
    bursts = 0
    prev = None
    for m in messages:
        d = parse_ts(m.get("at"))
        if d:
            hours[d.astimezone(KST).hour] += 1
            if prev and (d - prev).total_seconds() <= 90:
                bursts += 1
            prev = d
    top_hours = [h for h, _ in hours.most_common(4)]
    stats = {
        "messages": len(texts), "formal_ratio": round(formal / n, 2), "double_space_ratio": round(dbl / n, 2),
        "period_ratio": round(period / n, 2), "emoji_ratio": round(emoji / n, 2), "avg_chars": round(avg_len),
        "english_only_ratio": round(eng / n, 2), "burst_ratio": round(bursts / n, 2),
        "active_hours_kst": sorted(top_hours), "hour_histogram": {str(h): hours[h] for h in sorted(hours)},
        "sessions": len({m.get("session") for m in messages}), "hosts": sorted({m.get("host") or "?" for m in messages}),
    }
    style = []
    if texts:
        style.append(("반말·구어체 위주" if stats["formal_ratio"] < 0.3 else "존댓말 위주") + f" (존댓말 비율 {int(stats['formal_ratio']*100)}%)")
        if stats["double_space_ratio"] > 0.25:
            style.append("띄어쓰기가 불규칙하고 이중 공백이 잦다. 맞춤법보다 뜻을 읽어야 한다")
        if stats["period_ratio"] < 0.3:
            style.append("마침표를 거의 쓰지 않는다")
        if stats["emoji_ratio"] < 0.05:
            style.append("이모지를 쓰지 않는다. 답변에도 이모지를 넣지 않는 편이 맞다")
        style.append(f"메시지 평균 {stats['avg_chars']}자. " + ("짧게 던지는 편" if avg_len < 60 else "길게 설명하는 편"))
        if stats["burst_ratio"] > 0.2:
            style.append("짧은 메시지를 연달아 보낸다. 몇 개를 모아서 하나의 작업 목록으로 처리해야 한다")
        if top_hours:
            style.append("주 활동 시간대(한국): " + ", ".join(f"{h}시" for h in sorted(top_hours)))

    # 프로필 항목
    fb = load_json(FEEDBACK, {})
    categories = {c: [] for c in CATEGORIES}
    for (cat, st), sigs in agg.items():
        pid = short_id("p", cat, st)
        cnt = len(sigs)
        conf = "high" if cnt >= 5 else "medium" if cnt >= 2 else "low"
        whens = sorted(s["when"] for s in sigs if s.get("when"))
        entry = {
            "id": pid, "statement": st, "confidence": conf, "count": cnt,
            "first_seen": whens[0] if whens else None, "last_seen": whens[-1] if whens else None,
            "quotes": [s["evidence"] for s in sigs[-3:]],
            "status": "rejected" if fb.get(pid, {}).get("verdict") == "wrong" else "active",
            "confirmed": fb.get(pid, {}).get("verdict") == "right",
        }
        categories[cat].append(entry)
    for i, s in enumerate(style):
        pid = short_id("p", "말투", s[:20])
        categories["말투"].append({"id": pid, "statement": s, "confidence": "high", "count": len(texts), "first_seen": None, "last_seen": None, "quotes": [],
                                  "status": "rejected" if fb.get(pid, {}).get("verdict") == "wrong" else "active", "confirmed": fb.get(pid, {}).get("verdict") == "right"})
    for c in categories.values():
        c.sort(key=lambda e: (-e["count"], e["statement"]))
    # 관심사: 상위 키워드
    kw = Counter()
    for t in texts:
        for w in set(tokens(t)):
            kw[w] += 1
    top_kw = [{"word": w, "count": c} for w, c in kw.most_common(25) if c >= 2]

    old = load_json(PROFILE, {})
    profile = {
        "version": 2, "updated_at": now_iso(), "owner": old.get("owner", {"language": "ko", "timezone": "Asia/Seoul"}),
        "how_to_apply": old.get("how_to_apply", []), "stats": stats, "keywords": top_kw, "categories": categories,
    }
    needs = extract_needs(messages)
    return signals, profile, needs


def extract_needs(messages: list[dict]) -> list[dict]:
    """희망·요구 문장을 뽑아 키워드로 묶는다. 묶음 = 니즈."""
    cands = []
    for m in messages:
        for sent in SENT_SPLIT.split(m["text"]):
            s = sent.strip(" ,.")
            if len(s) < 6 or not NEED_RE.search(s):
                continue
            if SHORT_OK.match(s):
                continue
            toks = tokens(s)
            if len(toks) < 1:
                continue
            cands.append({"text": s[:160], "tokens": set(toks), "when": m.get("at"), "session": m.get("session"), "uuid": m.get("uuid")})
    clusters: list[dict] = []
    for c in sorted(cands, key=lambda c: c["when"] or ""):
        best, best_score = None, 0.0
        for cl in clusters:
            inter = len(c["tokens"] & cl["tokens"])
            if inter == 0:
                continue
            score = inter / len(c["tokens"] | cl["tokens"])
            if (inter >= 2 or (inter >= 1 and score >= 0.2)) and score > best_score:
                best, best_score = cl, score
        if best is None:
            clusters.append({"tokens": set(c["tokens"]), "items": [c], "kw": Counter(c["tokens"])})
        else:
            best["items"].append(c)
            best["tokens"] |= c["tokens"]
            best["kw"].update(c["tokens"])
    state = load_json(NEEDS_STATE, {})
    needs = []
    newest = max((c["when"] or "" for c in cands), default="")
    for cl in clusters:
        top = [w for w, _ in cl["kw"].most_common(5)]
        nid = short_id("n", *sorted(top[:3]))
        items = sorted(cl["items"], key=lambda c: c["when"] or "")
        joined = " ".join(c["text"] for c in items)
        kind = "feature" if FEATURE_RE.search(joined) else "request"
        # 제목: 군집 키워드를 가장 많이 담은 문장. 같으면 짧은 것.
        def rep(c):
            return (-len(c["tokens"] & set(top)), len(c["text"]))
        title = sorted(items, key=rep)[0]["text"]
        title = re.sub(r"\s{2,}", " ", title)
        if len(title) > 60:
            title = title[:57] + "..."
        last = items[-1]["when"] or ""
        days_old = 0
        if last and newest:
            d1, d2 = parse_ts(last), parse_ts(newest)
            if d1 and d2:
                days_old = (d2 - d1).days
        score = len(items) * (1.0 if days_old <= 3 else 0.7 if days_old <= 14 else 0.4)
        st = state.get(nid, {})
        needs.append({
            "id": nid, "title": title, "tags": top, "kind": kind, "mentions": len(items), "score": round(score, 2),
            "first_seen": items[0]["when"], "last_seen": last,
            "sessions": sorted({c["session"] for c in items if c.get("session")}),
            "evidence": [c["text"] for c in items[-4:]],
            "status": st.get("status", "proposed"), "note": st.get("note"), "plan": st.get("plan"), "decided_at": st.get("at"),
        })
    needs.sort(key=lambda n: (-n["score"], n["last_seen"] or ""), reverse=False)
    return needs


# ---------------------------------------------------------------- render

def render_md(profile: dict, needs: list[dict], signals: list[dict]) -> str:
    sugg = load_json(SUGGESTIONS, {"items": []})["items"]
    L = ["# 비서 프로필 (collector.py 가 자동 생성, 직접 편집하지 말 것)", ""]
    st = profile.get("stats", {})
    L.append(f"갱신 {profile['updated_at']} · 발화 {st.get('messages', 0)}건 · 세션 {st.get('sessions', 0)}개 · 근거 {len(signals)}건 · 기기 {', '.join(st.get('hosts', []))}")
    L.append("")
    if profile.get("how_to_apply"):
        L += ["## 세션에서 바로 적용할 규칙", ""] + [f"- {r}" for r in profile["how_to_apply"]] + [""]
    active_needs = [n for n in needs if n["status"] not in ("rejected", "done")][:8]
    if active_needs:
        L += ["## 파악한 니즈 (점수순)", ""]
        for n in active_needs:
            flag = {"approved": "승인됨", "plan_requested": "계획 요청됨", "in_progress": "진행 중"}.get(n["status"], "")
            L.append(f"- [{n['id']}] {n['title']} — {n['mentions']}회 언급 · {', '.join(n['tags'])}{(' · ' + flag) if flag else ''}")
            if n.get("plan"):
                for i, step in enumerate(n["plan"].get("steps", []), 1):
                    L.append(f"  - 계획 {i}. {step}")
        L.append("")
    for cat in CATEGORIES:
        items = [p for p in profile["categories"].get(cat, []) if p["status"] == "active"]
        if not items:
            continue
        L += [f"## {cat}", ""]
        for p in items[:12]:
            q = f' · 예: "{p["quotes"][-1]}"' if p.get("quotes") else ""
            L.append(f"- [{p['confidence']}] {p['statement']} ({p['count']}건{q})")
        L.append("")
    if profile.get("keywords"):
        L += ["## 자주 나오는 말", "", ", ".join(f"{k['word']}({k['count']})" for k in profile["keywords"][:20]), ""]
    rejected = [p for c in profile["categories"].values() for p in c if p["status"] == "rejected"]
    if rejected:
        L += ["## 사용자가 틀렸다고 한 추론 (다시 쓰지 말 것)", ""] + [f"- {p['statement']}" for p in rejected] + [""]
    pending = [s for s in sugg if s["status"] == "pending"]
    if pending:
        L += ["## 답 기다리는 제안", ""] + [f"- {s['id']} {s['title']}" for s in pending] + [""]
    return "\n".join(L).rstrip() + "\n"


def build_data(profile: dict, needs: list[dict], signals: list[dict]) -> dict:
    sugg = load_json(SUGGESTIONS, {"items": []})["items"]
    logs = read_jsonl(LOGS)[-30:]
    cats = [{"name": c, "items": profile["categories"][c]} for c in CATEGORIES if profile["categories"].get(c)]
    return {
        "generated_at": profile["updated_at"], "stats": profile.get("stats", {}), "rules": profile.get("how_to_apply", []),
        "keywords": profile.get("keywords", []), "categories": cats, "needs": needs, "suggestions": sugg,
        "logs": list(reversed(logs)), "signal_count": len(signals),
    }


def run_analyze() -> dict:
    applied = apply_phone_events()
    msgs = all_messages()
    signals, profile, needs = analyze(msgs)
    SIGNALS.parent.mkdir(parents=True, exist_ok=True)
    with SIGNALS.open("w", encoding="utf-8") as f:
        for s in signals:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
    save_json(PROFILE, profile)
    save_json(NEEDS, {"updated_at": profile["updated_at"], "items": needs})
    PROFILE_MD.write_text(render_md(profile, needs, signals), encoding="utf-8")
    save_json(DATA_JSON, build_data(profile, needs, signals))
    return {"messages": len(msgs), "signals": len(signals), "needs": len(needs), "phone_events": applied}


# ------------------------------------------------------------------- git

def git(*args: str, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, check=check)


def git_push(message: str) -> str:
    if git("rev-parse", "--is-inside-work-tree").returncode != 0:
        return "not a git repo"
    git("add", "--", str(ROOT))
    if git("diff", "--cached", "--quiet").returncode == 0:
        return "nothing to commit"
    c = git("-c", "user.name=secretary", "-c", "user.email=secretary@local", "commit", "-q", "-m", message)
    if c.returncode != 0:
        return "commit failed: " + c.stderr.strip()[:200]
    branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    git("pull", "--rebase", "-q", "origin", branch)
    p = git("push", "-q", "-u", "origin", branch)
    return "pushed" if p.returncode == 0 else "push failed: " + p.stderr.strip()[:200]


# -------------------------------------------------------------- commands

def cmd_ingest(a):
    paths = []
    for base in claude_project_dirs():
        for p in base.glob("*/*.jsonl"):
            if "subagents" in p.parts:
                continue
            paths.append(p)
    n = ingest_paths(paths, a.host or HOST)
    r = run_analyze()
    print(f"ingested {n} new messages from {len(paths)} transcripts; {r}")
    if a.push:
        print(git_push(f"secretary: ingest {datetime.now(KST).strftime('%Y-%m-%d %H:%M')} ({a.host or HOST})"))


def cmd_hook(a):
    """Claude Code Stop 훅. stdin: {"session_id":..., "transcript_path":...}. 항상 0 으로 끝난다."""
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        tp = payload.get("transcript_path")
        paths = [Path(tp)] if tp and Path(tp).exists() else []
        if not paths:
            return
        ingest_paths(paths, a.host or HOST)
        run_analyze()
        if a.push:
            git_push(f"secretary: hook {datetime.now(KST).strftime('%Y-%m-%d %H:%M')} ({a.host or HOST})")
    except Exception as e:  # 훅은 세션을 방해하면 안 된다
        sys.stderr.write(f"secretary hook: {e}\n")


def cmd_analyze(a):
    print(run_analyze())


def cmd_add_cloud(a):
    rows = []
    for r in read_jsonl(Path(a.file)):
        t = r.get("text") or ""
        if not t.strip():
            continue
        rows.append({"uuid": r.get("uuid") or short_id("m", a.session, r.get("created_at", ""), t), "at": r.get("created_at") or r.get("at"),
                     "session": a.session, "cwd": r.get("cwd"), "text": t.strip(), "source": "cloud"})
    target = INBOX / "cloud" / "messages.jsonl"
    known = {r.get("uuid") for r in read_jsonl(target)}
    new = [r for r in rows if r["uuid"] not in known]
    append_jsonl(target, new)
    print(f"added {len(new)}")


def cmd_import_events(a):
    src = Path(a.dir)
    n = 0
    for f in sorted(src.rglob("*.json")):
        ev = load_json(f, None)
        if not isinstance(ev, dict) or not ev.get("kind"):
            continue
        dest = INBOX / "phone" / (f.stem + ".json")
        if dest.exists() or dest.with_suffix(".done").exists():
            continue
        save_json(dest, ev)
        n += 1
    print(f"imported {n} events")


def cmd_rule(a):
    p = load_json(PROFILE, {"how_to_apply": []})
    rules = p.setdefault("how_to_apply", [])
    if a.remove:
        rules[:] = [r for r in rules if r != a.rule]
    elif a.rule not in rules:
        rules.append(a.rule)
    save_json(PROFILE, p)
    print(len(rules))


def cmd_suggest(a):
    d = load_json(SUGGESTIONS, {"items": []})
    sid = "sg-" + hashlib.sha1((a.title + now_iso()).encode()).hexdigest()[:6]
    d["items"].append({"id": sid, "created_at": now_iso(), "title": a.title, "why": a.why, "action": a.action, "need": a.need,
                       "status": "pending", "resolved_at": None, "note": None})
    save_json(SUGGESTIONS, d)
    print(sid)


def cmd_resolve(a):
    d = load_json(SUGGESTIONS, {"items": []})
    for it in d["items"]:
        if it["id"] == a.id:
            it["status"] = a.status
            it["resolved_at"] = now_iso()
            it["note"] = a.note
            save_json(SUGGESTIONS, d)
            print("ok")
            return
    sys.exit("unknown suggestion " + a.id)


def cmd_plan(a):
    plan = load_json(Path(a.file), None)
    if not isinstance(plan, dict) or not isinstance(plan.get("steps"), list):
        sys.exit("plan file must be {\"summary\": str, \"steps\": [str, ...]}")
    state = load_json(NEEDS_STATE, {})
    s = state.setdefault(a.need, {})
    s["plan"] = {"summary": plan.get("summary", ""), "steps": plan["steps"], "written_at": now_iso()}
    if s.get("status") in (None, "proposed", "plan_requested"):
        s["status"] = "planned"
    save_json(NEEDS_STATE, state)
    print("ok")


def cmd_status(a):
    msgs = all_messages()
    p = load_json(PROFILE, {})
    n = load_json(NEEDS, {"items": []})["items"]
    s = load_json(SUGGESTIONS, {"items": []})["items"]
    print(f"messages {len(msgs)} across {len({m.get('session') for m in msgs})} sessions, hosts {sorted({m.get('host') for m in msgs})}")
    print(f"profile updated {p.get('updated_at')} rules {len(p.get('how_to_apply', []))}")
    for c in CATEGORIES:
        k = len([e for e in p.get("categories", {}).get(c, []) if e.get("status") == "active"])
        if k:
            print(f"  {c}: {k}")
    print(f"needs {len(n)}: " + ", ".join(f"{st}={len([x for x in n if x['status']==st])}" for st in sorted({x['status'] for x in n})))
    print("suggestions: " + ", ".join(f"{st}={len([x for x in s if x['status']==st])}" for st in ("pending", "accepted", "declined", "done", "expired")))
    pend = list((INBOX / "phone").glob("*.json")) if (INBOX / "phone").is_dir() else []
    print(f"phone events waiting {len(pend)}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ingest"); p.add_argument("--push", action="store_true"); p.add_argument("--host", default=None); p.set_defaults(fn=cmd_ingest)
    p = sub.add_parser("hook"); p.add_argument("--push", action="store_true"); p.add_argument("--host", default=None); p.set_defaults(fn=cmd_hook)
    sub.add_parser("analyze").set_defaults(fn=cmd_analyze)
    p = sub.add_parser("add-cloud"); p.add_argument("file"); p.add_argument("--session", required=True); p.set_defaults(fn=cmd_add_cloud)
    p = sub.add_parser("import-events"); p.add_argument("dir"); p.set_defaults(fn=cmd_import_events)
    p = sub.add_parser("rule"); p.add_argument("rule"); p.add_argument("--remove", action="store_true"); p.set_defaults(fn=cmd_rule)
    p = sub.add_parser("suggest"); p.add_argument("--title", required=True); p.add_argument("--why", required=True); p.add_argument("--action", required=True); p.add_argument("--need", default=None); p.set_defaults(fn=cmd_suggest)
    p = sub.add_parser("resolve"); p.add_argument("id"); p.add_argument("--status", required=True, choices=["pending", "accepted", "declined", "done", "expired"]); p.add_argument("--note", default=None); p.set_defaults(fn=cmd_resolve)
    p = sub.add_parser("plan"); p.add_argument("need"); p.add_argument("--file", required=True); p.set_defaults(fn=cmd_plan)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
