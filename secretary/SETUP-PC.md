# PC 설정 (Windows)

PC에서 돌린 Claude Code 세션은 클라우드에서 못 읽는다. 대신 PC에 있는 수집기가 세션 파일을 직접 읽어
저장소에 밀어 넣는다. 토큰은 전혀 쓰지 않는다. 필요한 건 Python 3.10 이상과 git뿐이다.

로컬 세션 파일 위치: `C:\Users\<사용자>\.claude\projects\<프로젝트>\<세션>.jsonl`
이 안의 `type: "user"` 줄에서 직접 친 메시지만 뽑는다. 도구 결과, 시스템 메시지는 버린다.

## 1. 저장소 받기

```powershell
cd C:\Users\LeeJinSeong\Documents
git clone https://github.com/Jinseong1991/jsfaceoverlay-updates.git
cd jsfaceoverlay-updates
git checkout claude/funny-gauss-v07n1x
```

이미 받아 둔 폴더가 있으면 그 폴더에서 `git pull`만 하면 된다.

## 2. 한 번 돌려 보기

```powershell
python secretary\tools\collector.py ingest
python secretary\tools\collector.py status
```

`ingest`는 `~/.claude/projects` 아래 모든 프로젝트의 모든 세션을 읽는다. 처음 한 번은 몇 초 걸린다.
결과는 `secretary\PROFILE.md`와 `secretary\app\data.json`에 쓰인다. 열어서 내용이 맞는지 본다.

## 3. 자동으로 돌리기 (둘 중 하나, 또는 둘 다)

### A. Claude Code 훅 (세션이 끝날 때마다)

`C:\Users\<사용자>\.claude\settings.json`에 추가한다. 이미 `hooks`가 있으면 `Stop` 항목만 넣는다.
경로는 1번에서 받은 폴더로 바꾼다.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python C:\\Users\\LeeJinSeong\\Documents\\jsfaceoverlay-updates\\secretary\\tools\\collector.py hook --push",
            "timeout": 90
          }
        ]
      }
    ]
  }
}
```

이러면 PC에서 어떤 프로젝트를 작업하든, Claude가 답을 마칠 때마다 그 세션의 새 발화가 수집되고 분석되어 푸시된다.
`--push`를 빼면 로컬에만 쌓인다.

### B. 작업 스케줄러 (하루 한 번)

`Win + R` → `taskschd.msc` → 기본 작업 만들기

- 이름: 비서 수집
- 트리거: 매일, 원하는 시간 (예: 오전 10:30. 아침 브리핑 Routine이 10:47에 돈다)
- 동작: 프로그램 시작
  - 프로그램: `python`
  - 인수: `secretary\tools\collector.py ingest --push`
  - 시작 위치: `C:\Users\LeeJinSeong\Documents\jsfaceoverlay-updates`

## 4. 폰 앱

https://claude.ai/artifact/PkT87MSizJeuGabTuSpMtx

앱은 저장소의 `secretary/app/data.json`을 GitHub에서 직접 읽는다. claude.ai에 GitHub 커넥터가 연결돼 있으면
토큰 없이 항상 최신 데이터가 보인다. 커넥터가 없으면 아침 Routine이 올려 둔 사본을 보여 준다.

앱에서 누르는 결정("맞아/틀렸어", 니즈 승인, "계획 세워줘", 기록)은 `secretary/inbox/phone/`에 파일로 들어가고,
다음 수집 때 반영된다.

## 5. 문제가 있을 때

- `python`이 없다고 하면: Microsoft Store에서 Python 3 설치, 또는 `py` 명령으로 바꿔 쓴다.
- push가 실패하면: 그 폴더에서 `git push`를 한 번 손으로 해서 로그인 창을 통과시킨다.
- 훅이 안 도는 것 같으면: `claude` 실행 후 `/hooks`로 등록 여부를 본다.
- 다른 PC나 맥을 추가하려면: 같은 설정을 반복하면 된다. 기기마다 `secretary/inbox/<호스트명>/`에 따로 쌓인다.
