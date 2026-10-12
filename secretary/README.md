# 비서 (Secretary)

내가 말하는 방식, 좋아하는 것, 싫어하는 것, 감정, 부탁하는 뉘앙스를 세션과 폰 기록에서 모아
데이터베이스로 쌓고, 그걸 바탕으로 먼저 제안하는 시스템이다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `profile.json` | 정리된 프로필. 카테고리별 추론 항목과 근거 signal id |
| `signals.jsonl` | 근거 로그. 세션 발화, 폰 기록, 제안 수락/거절이 한 줄씩 쌓인다 |
| `suggestions.json` | 비서가 먼저 꺼낸 제안과 상태 (pending/accepted/declined/done) |
| `sync-state.json` | 어떤 세션을 어디까지 읽었는지 |
| `config.json` | 폰 앱(아티팩트) URL |
| `PROFILE.md` | 사람이 읽는 요약. `secretary.py render`가 만든다. 직접 편집 금지 |
| `tools/secretary.py` | 위 파일들을 다루는 CLI (표준 라이브러리만) |
| `app/index.html` | 폰 앱 소스. claude.ai 아티팩트로 게시되어 있다 |

## 데이터 흐름

```
Claude Code 세션들 ──(secretary-sync 스킬)──▶ signals.jsonl ──▶ profile.json ──▶ PROFILE.md
폰 앱 기록/피드백  ──(ArtifactData import)──▶                               │
                                                                            ▼
                                             CLAUDE.md가 모든 세션에 PROFILE.md를 읽게 함
                                                                            │
매일 아침 Routine ──(secretary-brief 스킬)──▶ suggestions.json ──▶ 폰 앱 + 푸시 알림
```

## 자주 쓰는 명령

```bash
python3 secretary/tools/secretary.py status
python3 secretary/tools/secretary.py add-signal --category 말투 --statement "..." --evidence "..." --source session --ref session_xxx --when 2026-10-10T00:00:00Z --confidence high
python3 secretary/tools/secretary.py upsert-pref --category 말투 --statement "..." --confidence high --signals s-0001,s-0002
python3 secretary/tools/secretary.py suggest --title "..." --why "..." --action "..."
python3 secretary/tools/secretary.py resolve sg-0001 --status accepted
python3 secretary/tools/secretary.py render
python3 secretary/tools/secretary.py validate
```

## 카테고리

말투 · 선호 · 비선호 · 감정 · 요청방식 · 작업습관 · 관심사 · 일상

## 원칙

- 추론에는 항상 근거(실제 발화 인용)가 붙는다. 근거 없는 항목은 만들지 않는다.
- 사용자가 앱에서 "틀렸어"라고 한 항목은 `rejected`가 되고 다시 추론하지 않는다.
- 제안은 하루 3개 이하. 거절된 종류의 제안은 다시 하지 않는다.
- 개인 데이터는 이 저장소와 아티팩트 DB에만 있다. 외부 서비스로 보내지 않는다.
