# packages/shared

빌드하지 않고 TS 소스를 직접 export한다(Next는 `transpilePackages`, 서버는 tsx로 읽음). 이 패키지 안에서는 확장자 없는 import를 쓴다. hook은 이 패키지를 import할 수 없다.

**상태 reducer** (`src/office.ts`): 이벤트 → 세션별 `SessionState`(에이전트별 상태·책상·말풍선)를 만드는 순수 함수. 서버만 실행하고 웹은 결과를 그리기만 한다. 에이전트 상태 `status`·`tool`·`file`은 `refresh()`가 세 가지에서 계산한다:
- `waiting`(손 들기)이 있으면 최우선이다. 같은 에이전트의 다음 이벤트(Notification·PermissionRequest 제외)가 오면 해제된다.
- `activeTools`는 진행 중인 도구를 toolUseId별로 담는다. 병렬 호출이 전부 끝나야 `thinking`으로 돌아가고, 말풍선은 아직 진행 중인 것 중 가장 최근 도구를 보여준다.
- 둘 다 없으면 `base`(idle/thinking/done)를 쓴다.

async hook 때문에 생기는 경우도 처리한다:
- Post가 Pre보다 먼저 도착하면 `recentDone`에 기록해 두고, 늦게 온 Pre를 무시한다.
- Stop/UserPromptSubmit 이전 시각(`resetAt`)에 찍힌 도구 이벤트는 무시한다.
- 권한을 기다리는 동안 Post 없이 새 PreToolUse가 오면 거부된 것으로 보고, 대기하던 도구를 제거한다.

`done → idle` 전환(30초)은 reducer가 아니라 웹(`office/status.ts`)이 그릴 때 계산한다.

**방과 퇴근** (같은 파일): `OfficeState = { sessions, rooms }`이고, `reduceOffice`가 세션 reducer 위에서 방을 관리한다.
- **방 키:** 세션이 처음 본 `cwd`(`session.room`)다. 나중에 cwd가 바뀌어도 방을 옮기지 않는다.
- **pod 배정:** 방의 `pods[i]`는 세션 ID다. 들어오면 가장 앞 빈칸에 앉고, 나가도 빈칸으로 남겨서 다른 팀이 자리를 옮기지 않게 한다(끝의 빈칸만 정리).
- **빈칸 정리:** 빈칸을 모두 없애는 `compactPods`는 지켜보는 클라이언트가 없는 서버 기동 직후에만 쓴다.
- **퇴근 조건:** `sweepOffDuty`가 마지막 이벤트 후 `offDutyMs`가 지난 세션을 `offDuty`로 만들고 pod를 비운다. SessionEnd가 오면 즉시 퇴근이다.
- **퇴근 예외:** 권한·질문으로 사용자를 기다리는 세션은 퇴근시키지 않는다. 단 `idle_prompt`(일을 끝내고 다음 요청 대기)는 퇴근 대상이다.
- **복귀:** 퇴근한 세션에 새 이벤트가 오면 다시 출근한다.
- **바뀐 게 없을 때:** `sweepOffDuty`는 같은 객체를 돌려준다. 서버는 이것으로 브로드캐스트 여부를 판단한다.
- **세션 상한:** 50개(`MAX_SESSIONS`)이고, 넘으면 퇴근한 세션부터 지운다. 세션이 하나도 없는 방은 사라진다.

**대화 기록 파서** (`src/transcript.ts`): Claude Code 대화 기록(`~/.claude/projects/<cwd를 -로 바꾼 이름>/<세션ID>.jsonl`, 서브에이전트는 `<세션ID>/subagents/agent-<id>.jsonl`)에서 토큰 수만 읽는다. 집계는 `apps/server/CLAUDE.md`.
- **파서:** `parseUsageLine`은 `type="assistant"` 줄에서 설계 원칙 1의 필드만 꺼낸다. 형식은 공식 스펙이 아니므로, 모르는 줄과 깨진 줄은 조용히 무시한다.
- **서브에이전트 ID:** 실제 확인 결과(Claude Code 2.1.310), hook의 `agent_id`, JSONL의 `agentId`, 파일 이름의 `agent-` 뒤가 모두 같은 17자 16진수다(접두사 없음). 문서 예시와 달라서 `normalizeAgentId`로 `agent-` 접두사를 떼고 비교한다.

**다시보기** (`src/replay.ts`): 서버 상태는 건드리지 않고, 브라우저가 받은 이벤트를 같은 reducer로 재생한다. 화면은 `apps/web/CLAUDE.md`.
- **타임라인:** `buildTimeline`이 이벤트를 `ts`로 정렬한다. 30초(`REPLAY_GAP_MS`)가 넘는 빈 구간은 재생 시간 2초로 압축하고, 마지막 이벤트 뒤에 3초 꼬리를 둔다. `toReal`/`toPlay`가 재생 시각과 실제 시각을 바꾸며, 압축 구간 안에서는 선형 보간이라 화면 시각은 실제 시각 그대로이고 그 사이 퇴근도 일어난다.
- **상태:** `officeAt(events, ts, offDutyMs)` = 처음부터 `reduceOffice` 후 `sweepOffDuty` 한 번. `Replayer`는 앞으로 갈 때 증분 적용, 뒤로 가면 처음부터 다시 계산하며 결과는 항상 `officeAt`과 같다(sweep 전 상태를 따로 들고 있음). 바뀐 게 없으면 같은 객체를 돌려줘 장면을 다시 그리지 않는다.
- **게이지:** `usageAt(records, models, ts)`가 그 시각까지의 메시지로 `UsageSnapshot`을 만든다(서버 `UsageTracker`와 같은 `addSessionUsage`를 씀).

**버전 어긋남** (`src/normalize.ts`): 웹이 서버에서 받는 모든 것(WS 메시지, `/history`, `/history/:id/events`)은 여기를 거친다. 빠진 필드는 빈 값으로 채우고, 모르는 필드는 그대로 두며, 쓸 수 없는 메시지·항목은 버린다(예외를 던지지 않음). 상태 타입에 필드를 추가하면 여기에 기본값도 넣는다. 정상 상태가 그대로 통과하는지는 `normalize.test.ts`가 확인한다.

**WS 프로토콜 타입:** `src/protocol.ts`.
