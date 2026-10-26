# hooks/

필드 추가·이벤트 버전·유출 테스트 규칙은 루트 CLAUDE.md의 설계 원칙과 아키텍처를 따른다.

**팀장/직원 구분:** hook 입력에 `agent_id`가 있으면 서브에이전트 안에서 실행된 것이다. 이를 `agent: {kind:"sub", id, type}`으로, 없으면 `{kind:"main"}`으로 바꾼다. async hook은 도착 순서가 바뀔 수 있으니 순서가 필요하면 `ts`(hook 실행 시각)로 정렬한다.

**대화 기록 경로:** hook은 `transcript_path`(SubagentStop은 `agent_transcript_path`)를 경로로만 보낸다(`OfficeEvent.transcript`). 내용은 읽지 않는다.

**상태 줄 스크립트** (`limits.mjs`, `ai-office-statusline.mjs`): 선택 설치한다.
- 터미널에 `모델 · ctx % · 5h % (남은 시간) · 주간 % (초기화 시각)` 한 줄을 출력하고, `POST /limits`로 `PlanLimits {v, ts, fiveHour?, sevenDay?}`(시각은 epoch ms)를 보낸다.
- hook과 같은 규칙(1.5초 강제 종료, fetch 300ms, 항상 exit 0)을 따르되, stdout은 상태 줄 표시용이라 쓴다.
- 갱신은 Claude Code의 이벤트와 `refreshInterval: 60`초다. 계정 전체 값이지만 세션마다 자기 마지막 API 응답 시점의 값을 보내고, 쉬는 세션도 옛 값을 새 `ts`로 다시 보낸다(서버가 합친다, `apps/server/CLAUDE.md`).
- 설치: `statusLine`은 하나뿐이라, 다른 상태 줄이 있으면 `--replace` 없이는 멈춘다. 제거는 command에 `ai-office-statusline.mjs`가 있을 때만 한다.
