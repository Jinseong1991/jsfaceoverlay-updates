#!/usr/bin/env python3
"""비서(secretary) 데이터베이스 CLI.

표준 라이브러리만 사용한다. 모든 데이터는 secretary/ 아래의 파일이다.

  profile.json      정리된 프로필 (카테고리별 선호/비선호/말투/감정/요청방식/...)
  signals.jsonl     근거 로그 (append-only). 프로필 항목은 여기의 signal id를 참조한다.
  suggestions.json  비서가 먼저 제안한 것들과 그 상태
  sync-state.json   세션/소스별 마지막 동기화 지점
  config.json       앱(아티팩트) URL 등 설정
  PROFILE.md        사람이 읽는 요약. CLAUDE.md가 이 파일을 읽으라고 지시한다.

사용 예:
  secretary.py add-signal --category 말투 --statement "..." --evidence "..." \
      --source session --ref session_xxx --when 2026-10-10T12:00:00Z --confidence high
  secretary.py upsert-pref --category 말투 --statement "..." --confidence high --signals s-0001,s-0002
  secretary.py suggest --title "..." --why "..." --action "..."
  secretary.py resolve sg-0001 --status accepted
  secretary.py render            # PROFILE.md 재생성
  secretary.py export-db DIR     # 앱 DB로 올릴 JSON 문서 생성
  secretary.py import-db DIR     # 앱 DB에서 내려받은 logs/feedback 반영
  secretary.py status
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "profile.json"
SIGNALS = ROOT / "signals.jsonl"
SUGGESTIONS = ROOT / "suggestions.json"
SYNC = ROOT / "sync-state.json"
CONFIG = ROOT / "config.json"
PROFILE_MD = ROOT / "PROFILE.md"

CATEGORIES = ["말투", "선호", "비선호", "감정", "요청방식", "작업습관", "관심사", "일상"]
CONFIDENCES = ["high", "medium", "low"]
SUGGESTION_STATUS = ["pending", "accepted", "declined", "done", "expired"]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path, default):
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def load_signals() -> list[dict]:
    if not SIGNALS.exists():
        return []
    out = []
    with SIGNALS.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def next_id(prefix: str, existing: list[str]) -> str:
    n = 0
    for e in existing:
        if e.startswith(prefix + "-"):
            try:
                n = max(n, int(e.split("-", 1)[1]))
            except ValueError:
                pass
    return f"{prefix}-{n + 1:04d}"


def empty_profile() -> dict:
    return {
        "version": 1,
        "updated_at": now_iso(),
        "owner": {"language": "ko", "timezone": "Asia/Seoul"},
        "categories": {c: [] for c in CATEGORIES},
        "how_to_apply": [],
    }


# ---------------------------------------------------------------- commands

def cmd_add_signal(a):
    signals = load_signals()
    sid = next_id("s", [s["id"] for s in signals])
    rec = {
        "id": sid,
        "when": a.when or now_iso(),
        "recorded_at": now_iso(),
        "source": a.source,
        "ref": a.ref,
        "category": a.category,
        "statement": a.statement,
        "evidence": a.evidence,
        "confidence": a.confidence,
    }
    if a.profile:
        rec["profile_id"] = a.profile
    with SIGNALS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(sid)


def cmd_upsert_pref(a):
    profile = load_json(PROFILE, empty_profile())
    cat = profile["categories"].setdefault(a.category, [])
    signals = {s["id"]: s for s in load_signals()}
    sig_ids = [s for s in (a.signals or "").split(",") if s]
    for s in sig_ids:
        if s not in signals:
            sys.exit(f"unknown signal {s}")
    all_ids = [p["id"] for c in profile["categories"].values() for p in c]
    entry = None
    if a.id:
        entry = next((p for p in cat if p["id"] == a.id), None)
        if entry is None:
            sys.exit(f"unknown profile entry {a.id} in {a.category}")
    else:
        entry = next((p for p in cat if p["statement"] == a.statement), None)
    if entry is None:
        entry = {
            "id": next_id("p", all_ids),
            "statement": a.statement,
            "confidence": a.confidence,
            "evidence": [],
            "first_seen": None,
            "last_seen": None,
            "status": "active",
        }
        cat.append(entry)
    if a.statement:
        entry["statement"] = a.statement
    if a.confidence:
        entry["confidence"] = a.confidence
    if a.status:
        entry["status"] = a.status
    for s in sig_ids:
        if s not in entry["evidence"]:
            entry["evidence"].append(s)
    whens = sorted(signals[s]["when"] for s in entry["evidence"] if s in signals)
    if whens:
        entry["first_seen"], entry["last_seen"] = whens[0], whens[-1]
    profile["updated_at"] = now_iso()
    save_json(PROFILE, profile)
    print(entry["id"])


def cmd_set_rule(a):
    profile = load_json(PROFILE, empty_profile())
    rules = profile.setdefault("how_to_apply", [])
    if a.remove:
        rules[:] = [r for r in rules if r != a.rule]
    elif a.rule not in rules:
        rules.append(a.rule)
    profile["updated_at"] = now_iso()
    save_json(PROFILE, profile)


def cmd_suggest(a):
    data = load_json(SUGGESTIONS, {"items": []})
    sid = next_id("sg", [s["id"] for s in data["items"]])
    rec = {
        "id": sid,
        "created_at": now_iso(),
        "title": a.title,
        "why": a.why,
        "action": a.action,
        "based_on": [s for s in (a.based_on or "").split(",") if s],
        "status": "pending",
        "resolved_at": None,
        "note": None,
    }
    data["items"].append(rec)
    save_json(SUGGESTIONS, data)
    print(sid)


def cmd_resolve(a):
    data = load_json(SUGGESTIONS, {"items": []})
    item = next((s for s in data["items"] if s["id"] == a.id), None)
    if item is None:
        sys.exit(f"unknown suggestion {a.id}")
    item["status"] = a.status
    item["resolved_at"] = now_iso()
    if a.note:
        item["note"] = a.note
    save_json(SUGGESTIONS, data)
    # 거절/수락 자체가 선호 신호다.
    cat = "비선호" if a.status == "declined" else "선호"
    if a.status in ("accepted", "declined"):
        signals = load_signals()
        sid = next_id("s", [s["id"] for s in signals])
        rec = {
            "id": sid,
            "when": now_iso(),
            "recorded_at": now_iso(),
            "source": "suggestion",
            "ref": a.id,
            "category": cat,
            "statement": f"제안 '{item['title']}'을(를) {'수락' if a.status == 'accepted' else '거절'}함",
            "evidence": a.note or "",
            "confidence": "medium",
        }
        with SIGNALS.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(sid)


def cmd_sync_mark(a):
    state = load_json(SYNC, {"sources": {}})
    state["sources"][a.ref] = {"last_seen": a.last_seen, "synced_at": now_iso(), "note": a.note}
    save_json(SYNC, state)


def render_md() -> str:
    profile = load_json(PROFILE, empty_profile())
    signals = {s["id"]: s for s in load_signals()}
    sugg = load_json(SUGGESTIONS, {"items": []})["items"]
    lines = ["# 비서 프로필 (자동 생성, 직접 편집하지 말 것)", ""]
    lines.append(f"갱신: {profile.get('updated_at')} · 근거 {len(signals)}건 · 제안 {len(sugg)}건")
    lines.append("")
    rules = profile.get("how_to_apply", [])
    if rules:
        lines.append("## 세션에서 바로 적용할 규칙")
        lines.append("")
        for r in rules:
            lines.append(f"- {r}")
        lines.append("")
    for cat in CATEGORIES:
        items = [p for p in profile["categories"].get(cat, []) if p.get("status") == "active"]
        if not items:
            continue
        lines.append(f"## {cat}")
        lines.append("")
        for p in items:
            ev = p.get("evidence", [])
            quote = ""
            for sid in reversed(ev):
                s = signals.get(sid)
                if s and s.get("evidence"):
                    q = s["evidence"].replace("\n", " ").strip()
                    if len(q) > 80:
                        q = q[:77] + "..."
                    quote = f' · 근거: "{q}"'
                    break
            lines.append(f"- [{p['confidence']}] {p['statement']} ({len(ev)}건{quote})")
        lines.append("")
    pending = [s for s in sugg if s["status"] == "pending"]
    if pending:
        lines.append("## 아직 답 안 한 제안")
        lines.append("")
        for s in pending:
            lines.append(f"- {s['id']} {s['title']} — {s['why']}")
        lines.append("")
    rejected = [p for c in profile["categories"].values() for p in c if p.get("status") == "rejected"]
    if rejected:
        lines.append("## 사용자가 틀렸다고 한 추론 (다시 추론하지 말 것)")
        lines.append("")
        for p in rejected:
            lines.append(f"- {p['statement']}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def cmd_render(a):
    PROFILE_MD.write_text(render_md(), encoding="utf-8")
    print(PROFILE_MD)


def cmd_export_db(a):
    """앱 DB에 올릴 문서를 디렉토리에 쓴다. 경로 = <collection>/<doc_id>.json"""
    out = Path(a.dir)
    profile = load_json(PROFILE, empty_profile())
    signals = {s["id"]: s for s in load_signals()}
    sugg = load_json(SUGGESTIONS, {"items": []})["items"]
    (out / "profile").mkdir(parents=True, exist_ok=True)
    cats = []
    for cat in CATEGORIES:
        items = []
        for p in profile["categories"].get(cat, []):
            quotes = [signals[s]["evidence"] for s in p.get("evidence", []) if s in signals and signals[s].get("evidence")]
            items.append({
                "id": p["id"],
                "statement": p["statement"],
                "confidence": p["confidence"],
                "count": len(p.get("evidence", [])),
                "last_seen": p.get("last_seen"),
                "status": p.get("status", "active"),
                "quotes": quotes[-3:],
            })
        if items:
            cats.append({"name": cat, "items": items})
    save_json(out / "profile" / "current.json", {
        "updated_at": profile.get("updated_at"),
        "rules": profile.get("how_to_apply", []),
        "categories": cats,
        "signal_count": len(signals),
    })
    (out / "suggestions").mkdir(parents=True, exist_ok=True)
    for s in sugg:
        save_json(out / "suggestions" / f"{s['id']}.json", s)
    print(out)


def cmd_import_db(a):
    """앱에서 내려받은 문서(ArtifactData out_dir 형식)를 반영한다.

    logs/<id>.json      사용자가 폰에서 남긴 기록 -> signals (source=phone)
    feedback/<id>.json  프로필 항목에 대한 '틀렸어' -> status=rejected
    suggestions/<id>.json 상태 변경 -> suggestions.json 반영
    """
    src = Path(a.dir)
    signals = load_signals()
    known_refs = {(s.get("source"), s.get("ref")) for s in signals}
    added = 0
    for f in sorted((src / "logs").glob("*.json")) if (src / "logs").exists() else []:
        doc = load_json(f, {})
        ref = f"log:{f.stem}"
        if ("phone", ref) in known_refs:
            continue
        sid = next_id("s", [s["id"] for s in signals])
        rec = {
            "id": sid,
            "when": doc.get("at") or now_iso(),
            "recorded_at": now_iso(),
            "source": "phone",
            "ref": ref,
            "category": doc.get("category") or "일상",
            "statement": doc.get("text", "").strip()[:200],
            "evidence": doc.get("text", ""),
            "confidence": "high",
            "mood": doc.get("mood"),
        }
        signals.append(rec)
        with SIGNALS.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        added += 1
    profile = load_json(PROFILE, empty_profile())
    rejected = 0
    for f in sorted((src / "feedback").glob("*.json")) if (src / "feedback").exists() else []:
        doc = load_json(f, {})
        pid = doc.get("profile_id")
        for c in profile["categories"].values():
            for p in c:
                if p["id"] == pid and doc.get("verdict") == "wrong" and p.get("status") != "rejected":
                    p["status"] = "rejected"
                    p["rejected_note"] = doc.get("note")
                    rejected += 1
    if rejected:
        profile["updated_at"] = now_iso()
        save_json(PROFILE, profile)
    sugg = load_json(SUGGESTIONS, {"items": []})
    changed = 0
    for f in sorted((src / "suggestions").glob("*.json")) if (src / "suggestions").exists() else []:
        doc = load_json(f, {})
        item = next((s for s in sugg["items"] if s["id"] == doc.get("id")), None)
        if item and doc.get("status") in SUGGESTION_STATUS and doc["status"] != item["status"]:
            item["status"] = doc["status"]
            item["resolved_at"] = doc.get("resolved_at") or now_iso()
            item["note"] = doc.get("note")
            changed += 1
    if changed:
        save_json(SUGGESTIONS, sugg)
    print(f"logs+{added} rejected+{rejected} suggestions~{changed}")


def cmd_status(a):
    profile = load_json(PROFILE, empty_profile())
    signals = load_signals()
    sugg = load_json(SUGGESTIONS, {"items": []})["items"]
    state = load_json(SYNC, {"sources": {}})
    print(f"profile updated: {profile.get('updated_at')}")
    for cat in CATEGORIES:
        n = len([p for p in profile["categories"].get(cat, []) if p.get("status") == "active"])
        if n:
            print(f"  {cat}: {n}")
    print(f"signals: {len(signals)}")
    by_src = {}
    for s in signals:
        by_src[s.get("source")] = by_src.get(s.get("source"), 0) + 1
    for k, v in sorted(by_src.items()):
        print(f"  {k}: {v}")
    print("suggestions: " + ", ".join(f"{st}={len([s for s in sugg if s['status']==st])}" for st in SUGGESTION_STATUS))
    print("synced sources:")
    for ref, v in state.get("sources", {}).items():
        print(f"  {ref}: last_seen={v.get('last_seen')} at={v.get('synced_at')}")


def cmd_validate(a):
    profile = load_json(PROFILE, empty_profile())
    signals = {s["id"]: s for s in load_signals()}
    errors = []
    for s in signals.values():
        if s["category"] not in CATEGORIES:
            errors.append(f"{s['id']}: bad category {s['category']}")
        if s["confidence"] not in CONFIDENCES:
            errors.append(f"{s['id']}: bad confidence")
    seen = set()
    for cat, items in profile["categories"].items():
        for p in items:
            if p["id"] in seen:
                errors.append(f"duplicate profile id {p['id']}")
            seen.add(p["id"])
            for e in p.get("evidence", []):
                if e not in signals:
                    errors.append(f"{p['id']}: unknown signal {e}")
    for e in errors:
        print(e)
    if errors:
        sys.exit(1)
    print("ok")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add-signal")
    p.add_argument("--category", required=True, choices=CATEGORIES)
    p.add_argument("--statement", required=True)
    p.add_argument("--evidence", default="")
    p.add_argument("--source", required=True, help="session|phone|gmail|drive|manual|suggestion")
    p.add_argument("--ref", default="", help="session id, message id, etc.")
    p.add_argument("--when", default=None)
    p.add_argument("--confidence", default="medium", choices=CONFIDENCES)
    p.add_argument("--profile", default=None)
    p.set_defaults(fn=cmd_add_signal)

    p = sub.add_parser("upsert-pref")
    p.add_argument("--category", required=True, choices=CATEGORIES)
    p.add_argument("--statement", default=None)
    p.add_argument("--id", default=None)
    p.add_argument("--confidence", default=None, choices=CONFIDENCES)
    p.add_argument("--signals", default="")
    p.add_argument("--status", default=None, choices=["active", "rejected"])
    p.set_defaults(fn=cmd_upsert_pref)

    p = sub.add_parser("set-rule")
    p.add_argument("rule")
    p.add_argument("--remove", action="store_true")
    p.set_defaults(fn=cmd_set_rule)

    p = sub.add_parser("suggest")
    p.add_argument("--title", required=True)
    p.add_argument("--why", required=True)
    p.add_argument("--action", required=True)
    p.add_argument("--based-on", default="")
    p.set_defaults(fn=cmd_suggest)

    p = sub.add_parser("resolve")
    p.add_argument("id")
    p.add_argument("--status", required=True, choices=SUGGESTION_STATUS)
    p.add_argument("--note", default=None)
    p.set_defaults(fn=cmd_resolve)

    p = sub.add_parser("sync-mark")
    p.add_argument("ref")
    p.add_argument("--last-seen", required=True)
    p.add_argument("--note", default=None)
    p.set_defaults(fn=cmd_sync_mark)

    sub.add_parser("render").set_defaults(fn=cmd_render)
    p = sub.add_parser("export-db")
    p.add_argument("dir")
    p.set_defaults(fn=cmd_export_db)
    p = sub.add_parser("import-db")
    p.add_argument("dir")
    p.set_defaults(fn=cmd_import_db)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("validate").set_defaults(fn=cmd_validate)

    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
