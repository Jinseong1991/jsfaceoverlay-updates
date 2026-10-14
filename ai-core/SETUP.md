# 직접 하셔야 할 일 (체크리스트)

코드는 전부 준비되어 있어요. 아래는 **가입, 키 발급, 서버 만들기**처럼 본인 계정으로만 할 수 있는 일이에요.
위에서부터 순서대로 하시면 되고, 필수만 하면 약 1시간이면 끝나요.

| 순서 | 할 일 | 필수 | 예상 시간 |
|---|---|---|---|
| 1 | 텔레그램 봇 만들기 | 필수 | 3분 |
| 2 | 두뇌 API 키 발급 (무료) | 필수 (최소 1개, 추천 3개 이상) | 10분 |
| 3 | Supabase 공유 기억 DB 만들기 | 서버 2대 이상이면 필수 | 5분 |
| 4 | Oracle Cloud 무료 서버 만들고 실행 | 필수 | 30분 |
| 5 | 무료 도메인 연결 (HTTPS) | 웹 채팅·PC 연결 시 필요 | 10분 |
| 6 | 두 번째 서버 (예비) | 선택 | 20분 |
| 7 | GitHub 자동 깨우기·백업 설정 | 추천 | 5분 |
| 8 | 내 PC 자원 빌려주기 | 선택 | 10분 |

진행하다 막히면 그 화면이나 오류 메시지를 그대로 알려주세요. 이어서 도와드릴게요.

---

## 1. 텔레그램 봇 만들기
1. 텔레그램에서 **@BotFather** 를 검색해 대화를 시작
2. `/newbot` 입력 → 봇 이름과 아이디(`..._bot` 으로 끝나야 함) 입력
3. 받은 토큰(`123456:ABC...`)을 메모 → `.env` 의 `TELEGRAM_BOT_TOKEN`
4. `TELEGRAM_OWNER_ID` 는 비워두고 서버를 먼저 띄운 뒤, 내 봇에게 아무 말이나 보내면 **내 숫자 ID를 알려줍니다**. 그 숫자를 넣고 서버를 재시작하면 그때부터 나만 쓸 수 있어요.

## 2. 두뇌 API 키 발급 (전부 무료)
많이 넣을수록 빠르고, 한 곳이 막혀도 다른 곳으로 자동 전환돼요.

| 서비스 | 발급 주소 | `.env` 항목 | 특징 |
|---|---|---|---|
| Groq | https://console.groq.com/keys | `GROQ_API_KEY` | 매우 빠름 (추천) |
| Cerebras | https://cloud.cerebras.ai | `CEREBRAS_API_KEY` | 매우 빠름 (추천) |
| Google Gemini | https://aistudio.google.com/apikey | `GEMINI_API_KEY` | 기억 검색(임베딩)에도 쓰임 (추천) |
| OpenRouter | https://openrouter.ai/keys | `OPENROUTER_API_KEY` | 예비용 |
| Claude (유료, 선택) | https://console.anthropic.com | `ANTHROPIC_API_KEY` | 가장 똑똑함, 사용량만큼 과금 |

- 서비스마다 **계정은 하나만** 쓰세요. 여러 개를 만들어 한도를 늘리면 약관 위반으로 정지될 수 있어요.
- Gemini 무료 플랜은 입력이 Google 학습에 쓰일 수 있어요. 싫으면 `.env` 에서 `PRIVATE_MODE=true` 로 바꾸면 대화가 Gemini로 가지 않아요(임베딩은 계속 사용).

## 3. Supabase 공유 기억 DB
서버를 여러 대 쓰려면 모든 서버가 같은 기억을 봐야 하므로 필요해요. 서버 1대만 쓰면 건너뛰어도 돼요(서버 안의 파일에 저장).
1. https://supabase.com 가입 → **New project** (지역: Northeast Asia (Seoul)), DB 비밀번호 설정 후 메모
2. 프로젝트 상단의 **Connect** 클릭 → **Session pooler** 연결 문자열 복사
3. `[YOUR-PASSWORD]` 부분을 비밀번호로 바꿔서 `.env` 의 `DATABASE_URL` 에 넣기
4. 테이블과 벡터 검색 설정은 서버가 처음 켜질 때 자동으로 만들어요.

## 4. Oracle Cloud 무료 서버 (메인 서버)
1. https://www.oracle.com/cloud/free 가입. 카드 인증이 있지만 **Always Free** 범위에서는 과금되지 않아요. 홈 지역은 Seoul 또는 Chuncheon 추천.
2. **Compute → Instances → Create instance**
   - Image: **Ubuntu 24.04**
   - Shape: **Ampere (VM.Standard.A1.Flex)**, OCPU 4 / 메모리 24GB (무료 한도)
   - SSH 키: "Generate a key pair" → **개인 키 다운로드** (잃어버리면 접속 불가)
   - 자리가 없다고 나오면(Out of capacity) 몇 시간 뒤 다시 시도하거나 OCPU 2 / 12GB로 줄이기
3. 인스턴스의 **Subnet → Security List → Add Ingress Rules**: 소스 `0.0.0.0/0`, TCP 포트 `80,443` 추가
4. 내 PC에서 접속: `ssh -i 다운받은키 ubuntu@서버공인IP`
5. 서버에서 실행:
   ```bash
   git clone https://github.com/Jinseong1991/jsfaceoverlay-updates.git
   cd jsfaceoverlay-updates && git checkout claude/hopeful-turing-08jab7   # main에 합친 뒤엔 생략
   cd ai-core
   bash deploy/oracle-setup.sh      # 처음엔 .env 만 만들고 멈춤
   openssl rand -hex 32             # OWNER_TOKEN 용 (한 번 더 실행해서 PC_TOKEN 용도)
   nano .env                        # 1~3에서 받은 값들 채우기, 저장: Ctrl+O, 종료: Ctrl+X
   bash deploy/oracle-setup.sh      # 실제 실행
   ```
   저장소가 비공개라면 clone할 때 GitHub 아이디와 [개인 액세스 토큰](https://github.com/settings/tokens)을 물어봐요.
6. 확인:
   ```bash
   sudo docker compose logs -f core                     # "노드 server1 시작 ... 두뇌 N개" 가 보이면 성공
   sudo docker compose exec core python -m app.main check   # 두뇌별 응답 속도 점검
   ```
7. 텔레그램에서 내 봇에게 말 걸기 → 1단계 4번대로 `TELEGRAM_OWNER_ID` 설정 → `sudo docker compose up -d` 로 재시작

**자체 두뇌(선택):** 외부 API가 전부 막혀도 생각할 수 있게 서버 CPU로 작은 모델을 돌려요. `.env` 에서 `LOCAL_LLM_URL` 줄의 `#` 을 지우고 `bash deploy/oracle-setup.sh` 를 다시 실행하면 돼요. 처음 실행할 때 모델(약 2GB)을 내려받아요.

## 5. 무료 도메인 연결 (HTTPS)
웹 채팅 화면과 PC 에이전트 연결에는 `https://` 주소가 필요해요. 텔레그램만 쓸 거면 건너뛰어도 돼요.
1. https://www.duckdns.org 로그인 → 원하는 이름(예: `jinyu-ai`) 만들고 IP 칸에 **서버 공인 IP** 입력
2. `.env` 에 `DOMAIN=jinyu-ai.duckdns.org` 넣고 `bash deploy/oracle-setup.sh` 다시 실행
3. 브라우저에서 `https://jinyu-ai.duckdns.org` 접속 → 처음 보낼 때 `OWNER_TOKEN` 입력

## 6. 두 번째 서버 (예비, 선택)
메인 서버가 죽으면 텔레그램 응답과 학습을 자동으로 이어받아요. **3번 Supabase 설정이 필수**예요.
- **방법 A: Google Cloud 무료 VM** (e2-micro, 미국 리전 us-west1/us-central1/us-east1). 4번과 같은 방법으로 설치하되 `.env` 에서 `NODE_ID=server2` 로 바꾸고, 자체 두뇌는 끄세요(메모리 1GB).
- **방법 B: Hugging Face Space** (무료 CPU)
  1. https://huggingface.co/new-space → SDK **Docker**, 공개 범위 **Private**
  2. `ai-core` 폴더 내용(app, config, Dockerfile, requirements.txt)을 업로드
  3. Space의 README.md 맨 위에 `app_port: 8080` 줄 추가
  4. Settings → **Variables and secrets** 에 `.env` 값들을 Secret으로 등록 (`NODE_ID=server3`)

## 7. GitHub 자동 깨우기·백업
무료 서버가 잠들지 않게 30분마다 깨우고, 매일 기억을 암호화해 백업해요.
1. 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   - `AI_NODE_URLS`: 서버 주소들, 쉼표로 구분 (예: `https://jinyu-ai.duckdns.org,https://xxx.hf.space`)
   - `AI_OWNER_TOKEN`: `.env` 의 `OWNER_TOKEN` 과 같은 값
   - `AI_BACKUP_PASSPHRASE`: 백업 암호 (잃어버리면 백업을 못 열어요)
2. GitHub 예약 실행은 **기본 브랜치(main)에 있는 워크플로만** 동작해요. 작업 브랜치를 main에 합쳐야 시작돼요(원하시면 PR을 만들어 드릴게요).

## 8. 내 PC 자원 빌려주기 (선택)
PC를 켜고 에이전트를 실행해 둔 동안에는 PC의 GPU를 최우선 두뇌로 써요. 빠르고, 대화가 외부 회사로 나가지 않아요. 끄면 자동으로 클라우드 두뇌로 돌아가요.
1. https://ollama.com 에서 Ollama 설치 → 명령창에서 `ollama pull qwen2.5:7b`
   (그래픽 메모리 기준: 8GB면 `qwen2.5:7b`, 16GB 이상이면 `qwen2.5:14b`)
2. https://www.python.org 에서 Python 설치 → `pip install websockets httpx`
3. 저장소의 `ai-core/pc_agent/agent.py` 를 내려받아 실행:
   ```bash
   python agent.py --server https://jinyu-ai.duckdns.org --token PC_TOKEN값 --model qwen2.5:7b
   ```
   - 허용 시간 제한: `--hours 9-23` (밤에는 PC를 안 씀)
   - 서버가 여러 대면 `--server` 를 여러 번 쓰기
   - 이 프로그램은 대화 생성 요청만 처리해요. 서버가 PC의 파일을 읽거나 명령을 실행할 수 없어요.

## 다 끝났으면 확인
- 텔레그램에서 `/status` → 두뇌 상태와 기억 개수
- `/rules` → 내가 시킨 지시 목록 ("앞으로 이렇게 해"라고 말하면 자동으로 추가돼요)
- `/learn`, `/reflect` → 지금 바로 공부하기, 돌아보기
- 인격을 바꾸려면 서버의 `ai-core/config/persona.md` 를 고치면 재시작 없이 바로 반영돼요.
