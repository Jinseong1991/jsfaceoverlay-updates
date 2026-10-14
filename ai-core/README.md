# Jinyu: 나만의 독립 AI

이름은 만든 사람 진성의 '진'과 자유(Freedom)의 '유'에서 따왔어요.

여러 곳의 무료 두뇌(API)를 빌려 쓰고, 인격과 기억은 내 것으로 갖는 개인 전용 AI예요.
서버 여러 대에 나눠 띄우면 서로 역할을 나누고, 한 대가 죽어도 계속 살아 있어요.

> 처음이라면 **[SETUP.md](SETUP.md)** 부터 보세요. 직접 하셔야 할 일만 순서대로 정리되어 있어요.

## 구조

```
        나 ── 텔레그램 / 웹 채팅 (주인 전용 인증)
                    │
   ┌────────────────┼───────────────────────────────┐
   │  서버 1 (Oracle 무료)      서버 2 (예비, 선택)   │  같은 코드, 설정만 다름
   │  코어 + 자체 두뇌           코어                  │  lease로 역할 자동 분담·인계
   └────────┬───────────────────────┬────────────────┘
            │                       │
   [모델 라우터] ── 가장 빠른 두뇌로 스트리밍, 막히면 다음 두뇌로
     ├ 내 PC (에이전트를 켜뒀을 때, 최우선)
     ├ Groq · Cerebras (초고속 무료)
     ├ Gemini · OpenRouter (무료)
     ├ Claude (유료, 선택)
     └ 자체 두뇌 llama.cpp (최후의 보루)
            │
   [공유 기억] Supabase Postgres + pgvector
     대화 · 주인에 대한 사실 · 배운 지식 · 일기 · 주인의 지시 · 자기 노트
            │
   [자율 루프] 혼자 있을 때
     공개 문서 입력 → 기술/뉴스/논문 읽고 요약 → 돌아보고 일기 쓰기 → 필요하면 먼저 말 걸기
            │
   [GitHub Actions] 30분마다 깨우기 · 매일 암호화 백업
```

## 속도를 위한 설계
- **스트리밍:** 첫 글자가 나오자마자 텔레그램과 웹에 보여줘요.
- **헤징:** 1.2초 안에 첫 글자가 안 오면 다음 두뇌도 동시에 출발시켜 먼저 답한 쪽을 써요.
- **속도 학습:** 두뇌마다 실제 첫 응답 시간을 계속 재서, 가장 빠른 곳부터 시도해요.
- **난이도 분류:** 짧은 잡담은 소형 초고속 모델, 생각이 필요한 질문은 대형 모델로 보내요.
- **늦으면 건너뛰기:** 기억 검색이 1초 넘게 걸리면 기억 없이 바로 대답하고, 기억 정리는 대답이 끝난 뒤 백그라운드에서 해요.
- **프롬프트 캐시:** 잘 안 바뀌는 인격을 맨 앞에 둬서 provider 캐시가 잘 맞게 했어요.
- **연결 재사용:** HTTP keep-alive로 매번 새로 연결하는 지연을 없앴어요.
- **장애 대응:** 429(한도 초과)나 오류가 난 두뇌는 잠시 쉬게 하고 자동으로 다른 두뇌로 넘어가요.

## 인격과 지시
- `config/persona.md`: 이름, 성격, 말투, 원칙. 고치면 재시작 없이 바로 반영돼요.
- **주인의 지시가 최우선:** 대화 중에 "앞으로 ~해"라고 하면 지시 목록에 영구 저장돼 매 대화의 최우선 규칙이 돼요. 텔레그램 `/rules` 로 보고 `/forget_rule 번호` 로 지울 수 있어요.
- **자기 노트:** 회고할 때마다 AI가 스스로 자신에 대한 이해를 고쳐 써요.

## 학습
- `config/knowledge_sources.txt`: 처음에 통째로 읽어 넣을 공개 문서 목록(Claude 헌법, 공개 시스템 프롬프트, 프롬프트 엔지니어링 가이드 등). 주소만 추가하면 돼요.
- `config/seed_topics.txt`: 처음 공부할 기술 주제. 다 읽으면 읽으면서 생긴 새 궁금증으로 이어가요.
- 피드: GeekNews, Hacker News, arXiv(AI·언어모델·머신러닝), GitHub Changelog, BBC, 연합뉴스. `.env` 의 `LEARN_FEEDS` 로 바꿀 수 있어요.
- 모델 자체를 재학습하는 게 아니라, 읽은 내용을 의미 검색이 되는 기억으로 쌓아 대화 때 꺼내 쓰는 방식(RAG)이에요.

## 명령어
```bash
python -m app.main serve        # 서버 실행
python -m app.main chat         # 터미널에서 바로 대화
python -m app.main check        # 두뇌별 응답 속도 점검
python -m app.main learn        # 지금 바로 공부 한 번
python -m app.main reembed      # 임베딩 방식을 바꾼 뒤 기억 다시 계산
python -m app.main import 파일   # 백업 복원
```
Docker를 쓰는 서버에서는 앞에 `sudo docker compose exec core` 를 붙이세요.

## 웹 API (모두 `Authorization: Bearer OWNER_TOKEN` 필요, `/health` 만 공개)
| 경로 | 설명 |
|---|---|
| `GET /` | 웹 채팅 화면 |
| `POST /chat` `{"message": "..."}` | 대화 (스트리밍 텍스트) |
| `GET /status` | 두뇌, 기억, 역할, PC 연결 상태 |
| `POST /tick?job=learn` | 자율 작업 재촉 / 특정 작업 즉시 실행 |
| `GET /export` | 기억 전체 내보내기 (백업) |
| `WS /pc` | PC 에이전트 연결 (`PC_TOKEN`) |

## 파일 구성
```
app/
  router.py     모델 라우터 (헤징, 속도 학습, 장애 전환)
  brain.py      대화: 기억 떠올리기 → 인격 → 스트리밍 → 기억 정리, 주인의 지시 관리
  memory.py     기억 저장소 (Postgres+pgvector / SQLite) + 서버 간 lease
  embed.py      임베딩 (Gemini / OpenAI 호환 / 해싱)
  persona.py    시스템 프롬프트 조립
  learner.py    인터넷 학습, 공개 문서 입력
  autonomy.py   자율 루프 (입력, 학습, 회고, 먼저 말 걸기, 임베딩 복구)
  telegram.py   텔레그램 봇 (주인 전용, 스트리밍 답장)
  pc_bridge.py  PC 자원 연결 통로
  runtime.py    노드 실행, 역할 분담
  server.py     웹 API
config/         인격, 두뇌 목록, 학습 목록
pc_agent/       내 PC에서 실행하는 에이전트
deploy/         서버 설치 스크립트
tests/          자동 테스트
```

## 개발
```bash
pip install -r requirements-dev.txt
python -m pytest -q
```
