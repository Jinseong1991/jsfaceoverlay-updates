---
name: secretary-brief
description: 비서 브리핑. collector.py가 파악해 둔 니즈 중 사용자가 폰에서 "계획 세워줘"를 누른 것에 계획을 써 주고, 프로필과 미완 작업을 바탕으로 오늘 먼저 챙겨줄 제안을 최대 3개 만들어 앱에 올린다. 토큰은 계획·제안을 쓰는 데만 쓴다. "/secretary-brief", "오늘 브리핑", "뭐 챙겨줄 거 있어?" 요청 시 또는 아침 Routine에서 secretary-sync 다음에 사용.
---

# secretary-brief

읽는 것: `secretary/PROFILE.md` 전체, `secretary/needs.json`, `secretary/suggestions.json`. 발화 원문(inbox)은 읽지 않는다.

## 1. 계획 요청에 답하기

`needs.json`에서 `status == "plan_requested"`인 니즈마다:

1. `title`, `tags`, `evidence`(최근 문장 4개)만 보고 계획을 쓴다. 3~6단계, 각 단계는 한 문장, 첫 단계는 오늘 바로 할 수 있는 것.
2. JSON 파일로 저장: `{"summary": "<한 문장>", "steps": ["...", "..."]}`
3. `python3 secretary/tools/collector.py plan <need_id> --file <그 파일>`

프로필의 말투 규칙을 따른다 (결론 먼저, 경로는 전체 경로, 빈 약속 없음).

## 2. 승인된 니즈 실행 제안

`status == "approved"`이고 `plan`이 있는 니즈는 첫 미완 단계를 제안으로 만든다:

```bash
python3 secretary/tools/collector.py suggest --need <need_id> \
  --title "<첫 단계를 한 문장으로>" --why "<니즈 제목> 승인됨, 계획 1단계" --action "<내가 실제로 할 일>"
```

## 3. 그 밖의 제안 (하루 합계 최대 3개)

재료: `list_sessions`의 지난 24시간 세션 `post_turn_summary`(끝내지 못한 일), 이 저장소의 열린 PR과 실패한 CI.
조건: 프로필 항목이나 니즈와 연결되고, 내가 실행할 수 있고, 최근 14일 안에 `declined`된 종류가 아닐 것.
없으면 만들지 않는다.

## 4. 올리기

1. `python3 secretary/tools/collector.py analyze` (data.json 재생성)
2. `ArtifactData` `set` `app/data` ← `secretary/app/data.json` (`if_version` 필수)
3. `ArtifactData` `set` `briefs/<YYYY-MM-DD KST>` ← `{"date", "summary"(세 문장 이내), "suggestion_ids", "generated_at"}`
4. 커밋·푸시.

## 5. 폰에서 '해줘'를 누른 제안

`suggestions.json`에서 `status == "accepted"`이고 `done`이 아닌 것은 이번 세션에서 실행한다.
끝나면 `collector.py resolve <id> --status done --note "<한 일>"`. 이 환경에서 못 하면 note에 이유를 적고 status는 둔다.
