# 비서 (Secretary)

모든 Claude Code 세션(PC 로컬 + 클라우드)에서 내가 한 말을 모아, 내 말투·선호·비선호·감정·요청 방식과
**내가 원하는 것(니즈)** 을 파악하고, 폰에서 보고 결정할 수 있게 하는 시스템이다.

**읽기와 분석에는 토큰을 쓰지 않는다.** 전부 `tools/collector.py`(표준 라이브러리 Python)가 한다.
Claude는 세 군데에서만 토큰을 쓴다: 내가 "계획 세워줘"를 누른 니즈의 계획, 하루 최대 3개의 제안, 내가 "해줘"를 누른 제안의 실행.

## 구성

| 파일 | 역할 | 누가 쓰나 |
| --- | --- | --- |
| `tools/collector.py` | 수집·분석·렌더 프로그램 | 사람/훅/스케줄러가 실행 |
| `inbox/<기기>/messages.jsonl` | 원본 발화 (기기별, uuid로 중복 제거) | collector |
| `inbox/phone/*.json` | 폰 앱에서 보낸 결정·피드백·기록 | 폰 앱 (GitHub 커넥터) 또는 sync 스킬 |
| `signals.jsonl` | 규칙이 찾은 근거 (매번 재생성) | collector |
| `profile.json` | 자동 프로필 + 수동 규칙 `how_to_apply` | collector / `collector.py rule` |
| `needs.json` | 파악한 니즈 (점수순) | collector |
| `needs-state.json` | 니즈별 내 결정과 계획 | 폰 앱 → collector / `collector.py plan` |
| `feedback.json` | 프로필 항목에 대한 맞아/틀렸어 | 폰 앱 → collector |
| `suggestions.json` | 제안과 상태 | `collector.py suggest/resolve`, 폰 앱 |
| `logs.jsonl` | 폰에서 남긴 기분/메모 | 폰 앱 → collector |
| `PROFILE.md` | 사람이 읽는 요약. CLAUDE.md가 세션마다 읽게 한다 | collector |
| `app/data.json` | 폰 앱이 읽는 전체 데이터 | collector |
| `app/index.html` | 폰 앱 소스 (claude.ai 아티팩트로 게시) | |
| `config.json` | 앱 URL, 저장소/브랜치 | |
| `SETUP-PC.md` | PC에 수집기 설치하는 법 | |

## 데이터 흐름

```
PC 로컬 세션 (~/.claude/projects/**/*.jsonl) ─┐
클라우드 세션 (컨테이너의 같은 경로)          ─┤─ collector.py ingest ─▶ inbox/ ─▶ 분석 ─▶ profile / needs / PROFILE.md / app/data.json
폰 앱 결정·기록 (inbox/phone/*.json)          ─┘                                                        │
                                                                                                      ▼
                                              폰 앱 ◀── GitHub 커넥터로 data.json 직접 읽기 (토큰 0) ──┘
                                              폰 앱 ──▶ 결정은 inbox/phone/ 에 파일로 (토큰 0)
아침 Routine (토큰 조금) ──▶ "계획 세워줘" 니즈에 계획 작성, 제안 최대 3개, "해줘" 제안 실행
```

## 자주 쓰는 명령

```bash
python3 secretary/tools/collector.py ingest --push   # 세션 전부 읽고 분석하고 푸시
python3 secretary/tools/collector.py analyze         # inbox만 다시 분석
python3 secretary/tools/collector.py status
python3 secretary/tools/collector.py rule "결론부터 말한다"
python3 secretary/tools/collector.py suggest --title "..." --why "..." --action "..."
python3 secretary/tools/collector.py resolve sg-xxxxxx --status done --note "..."
python3 secretary/tools/collector.py plan n-xxxxxx --file plan.json
```

## 분석 규칙

`collector.py`의 `PATTERNS`가 전부다. 정규식 하나가 근거 하나를 만든다. 같은 추론이 5번 이상이면 high, 2번 이상이면 medium.
니즈는 "~했으면 좋겠다/원해/필요/만들어" 같은 문장을 뽑아 키워드가 겹치는 것끼리 묶은 것이다.
규칙을 고치고 싶으면 그 목록을 고치고 `analyze`를 다시 돌리면 된다. 과거 데이터에 즉시 반영된다.

## 원칙

- 추론에는 항상 근거(실제 발화)가 붙는다.
- 앱에서 "틀렸어"라고 한 항목은 `rejected`가 되어 다시 나오지 않는다.
- 제안은 하루 3개 이하. 거절된 종류는 다시 하지 않는다.
- 개인 데이터는 이 저장소와 아티팩트 DB에만 있다.
