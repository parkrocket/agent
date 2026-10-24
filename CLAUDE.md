# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

Claude Code 세션을 3D 사무실 건물로 실시간 시각화하는 "AI 오피스". 메인 에이전트는 팀장, 서브에이전트는 직원 캐릭터다. 프로젝트(cwd)마다 방이 하나씩 있고, 캐릭터는 엘리베이터로 출퇴근하며 도구를 쓰는 모습, 손 들기(승인 대기), 컨텍스트 사용량 게이지로 상태를 보여준다. 단계별 진행은 아래 "진행 상황"을 본다.

환경은 Windows WSL2(Ubuntu)이고, 브라우저는 Windows에서 `localhost`로 접속한다.

## 설계 원칙

이 원칙을 깨는 변경은 하지 않는다. 기능과 부딪히면 원칙 쪽을 지키고 사용자에게 먼저 묻는다.

1. **원문은 절대 내보내지 않는다.** hook 입력과 대화 기록(JSONL)에는 프롬프트, 응답, 생각, 코드, Bash 명령, 도구 출력이 들어 있다. 밖으로 나가는 것은 화이트리스트 필드뿐이다.
   - **hook:** `hooks/sanitize.mjs`가 이벤트 종류, 세션 ID, cwd, 도구 이름, 파일 **basename**, 에이전트 ID/종류, 알림 종류, 대화 기록 **경로**만 새 객체로 복사한다. 원본 객체는 그대로 보내지 않는다. 그래서 원본 payload를 통째로 보내는 `type: "http"` hook은 쓰지 않는다.
   - **서버:** 2차 방어선으로 `OfficeEventSchema`가 `.strict()`라 모르는 필드가 들어오면 400으로 거부한다.
   - **대화 기록:** `parseUsageLine`이 토큰 수, 모델, 시각, ID, cwd만 복사한다. 원문은 메모리에도 DB에도 남기지 않는다. 파일은 읽기 전용으로만 연다.
   - **테스트:** 원문 필드에 고유 문자열을 넣고, 결과에 남지 않는지 확인하는 유출 테스트를 기능마다 둔다(`hooks/sanitize.test.mjs`, `transcript.test.ts`, `usage.test.ts`).
2. **경로는 제한한다.** `/events`는 같은 PC의 아무 프로세스나 보낼 수 있다. 그래서 이벤트로 받은 경로는 믿지 않는다. 대화 기록은 `~/.claude/projects`(`CLAUDE_CONFIG_DIR`) 안의 `.jsonl`만, 심볼릭 링크를 따라간 실제 경로 기준으로 읽는다(`allowedTranscript`). 서버는 `127.0.0.1`에만 바인딩하고, WS는 origin을 검사하며, CORS는 웹 주소만 허용한다.
3. **hook은 Claude Code를 절대 막거나 늦추지 않는다.**
   - **등록:** 설정에 `async: true, timeout: 5`로 등록한다.
   - **스크립트:** 1.5초 뒤 강제 종료, fetch 타임아웃 300ms, stdout 출력 없음, 항상 exit 0이다. stdout은 일부 이벤트(UserPromptSubmit, SessionStart)에서 Claude의 컨텍스트에 주입되므로 쓰지 않는다.
   - **서버:** 204를 먼저 보내고 나서 처리한다(대화 기록 읽기도 응답 뒤에 한다).
   - **의존성:** hook은 Claude Code가 plain `node`로 실행하므로 npm 의존성이나 TS를 쓸 수 없다. 그래서 `packages/shared`를 import하지 않는다.
4. **그 밖의 원칙**
   - **상태 판단:** 서버의 순수 reducer(`packages/shared`)가 하고, 웹은 그리기만 한다.
   - **에셋:** 직접 그리거나 CC0만 쓰고, 출처와 라이선스 파일을 함께 둔다.
   - **사용자 설정:** `~/.claude/settings.json`은 백업 후에만 고친다.
   - **테스트 데이터:** 시뮬레이션·테스트 데이터는 실제 DB에 섞지 않는다(임시 `AI_OFFICE_DB`).

## 명령어

pnpm 12 (corepack). 루트에서 실행한다.

```bash
pnpm install
pnpm dev              # server(:7420, tsx watch) + web(:7421, next dev) 병렬 실행
pnpm typecheck        # 모든 패키지 tsc --noEmit
pnpm test             # node:test(hooks/, scripts/) + 각 패키지 test(shared, server: tsx --test)
node --test hooks/sanitize.test.mjs                                   # 파일 하나만
node --test --test-name-pattern="Bash command" hooks/sanitize.test.mjs  # 테스트 하나만
pnpm --filter @ai-office/shared exec tsx --test --test-name-pattern="parallel" src/office.test.ts
node scripts/simulate.mjs --projects 3 --sessions 2 [--seed 7] [--speed 2]   # 가짜 세션 동시 재생 (서버 실행 중일 때)
node scripts/screenshot.mjs out.png [--view lobby|<방 cwd>] [--shots 10 --every 1500] [--size 1600x1000] [--scale 2] [--ls key=value]
AI_OFFICE_DB=/tmp/x.db AI_OFFICE_OFF_DUTY_MIN=0.5 pnpm dev   # 데모·테스트용: 임시 DB, 퇴근 30초
CLAUDE_CONFIG_DIR=/tmp/ch AI_OFFICE_DB=/tmp/x.db pnpm dev     # 사용량 데모: 가짜 대화 기록 폴더
node scripts/simulate.mjs --transcripts /tmp/ch/projects       # 가짜 대화 기록(토큰 수만)도 함께 기록
pnpm usage:import                                              # 과거 대화 기록을 사용량 통계로 가져오기
pnpm --filter @ai-office/server dev   # 패키지 하나만
pnpm hooks:install --dry-run          # ~/.claude/settings.json 병합 결과만 출력
pnpm hooks:install / pnpm hooks:uninstall
```

- pnpm 12는 `pnpm -r <name>`을 `exec`로 해석하므로, 재귀 스크립트에는 반드시 `run`을 넣는다(`pnpm -r run build`).
- 빌드 스크립트 허용은 `pnpm-workspace.yaml`의 `allowBuilds`로 관리한다(`pnpm approve-builds <pkg>`).
- 린터나 포매터는 아직 없다.

## 아키텍처

```
Claude Code ─(stdin JSON)→ hooks/ai-office-hook.mjs ─POST /events→ apps/server ─WS /ws→ apps/web
```

**필드를 추가할 때는 세 곳을 같이 고친다:** `hooks/sanitize.mjs`(추출), `packages/shared/src/events.ts`(스키마·타입), `hooks/sanitize.test.mjs`(유출 방지 테스트). 셋이 어긋나면 서버가 모든 이벤트를 400으로 거부하는데, hook은 실패를 무시하므로 증상이 조용히 "이벤트가 안 옴"으로만 나타난다.

**이벤트 이름 목록은 세 곳에 중복돼 있다:** `packages/shared/src/events.ts`의 `HOOK_EVENT_NAMES`, `hooks/sanitize.mjs`의 `FORWARDED_EVENTS`, `scripts/settings-lib.mjs`의 `HOOK_EVENTS`(설치 대상).

**팀장/직원 구분:** hook 입력에 `agent_id`가 있으면 서브에이전트 안에서 실행된 것이다. 이를 `agent: {kind:"sub", id, type}`으로, 없으면 `{kind:"main"}`으로 바꾼다. async hook은 도착 순서가 바뀔 수 있으니 순서가 필요하면 `ts`(hook 실행 시각)로 정렬한다.

**상태 reducer** (`packages/shared/src/office.ts`): 이벤트 → 세션별 `SessionState`(에이전트별 상태·책상·말풍선)를 만드는 순수 함수. 서버만 실행하고 웹은 결과를 그리기만 한다. 에이전트 상태 `status`·`tool`·`file`은 `refresh()`가 세 가지에서 계산한다:
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

**사용량** (`packages/shared/src/transcript.ts`, `apps/server/src/usage/`): Claude Code 대화 기록(`~/.claude/projects/<cwd를 -로 바꾼 이름>/<세션ID>.jsonl`, 서브에이전트는 `<세션ID>/subagents/agent-<id>.jsonl`)에서 토큰 수만 읽는다.
- **파서:** `parseUsageLine`은 `type="assistant"` 줄에서 설계 원칙 1의 필드만 꺼낸다. 형식은 공식 스펙이 아니므로, 모르는 줄과 깨진 줄은 조용히 무시한다.
- **중복 제거:** 같은 `message.id`가 여러 줄(최대 5줄, usage 동일)로 기록되므로, 메시지 ID로 한 번만 센다(`usage_messages` PK).
- **연결:** hook이 `transcript_path`(SubagentStop은 `agent_transcript_path`)를 경로로만 보낸다(`OfficeEvent.transcript`). 서버는 설계 원칙 2의 검사를 통과한 파일만 읽는다.
- **서브에이전트 ID:** 실제 확인 결과(Claude Code 2.1.310), hook의 `agent_id`, JSONL의 `agentId`, 파일 이름의 `agent-` 뒤가 모두 같은 17자 16진수다(접두사 없음). 문서 예시와 달라서 `normalizeAgentId`로 `agent-` 접두사를 떼고 비교한다.
- **증분 읽기:** `readIncrement`는 파일별 `{offset, inode}`(`transcript_offsets`) 이후의 완전한 줄만 읽는다. 잘린 마지막 줄은 다음 차례로 미룬다. 파일이 바뀌었거나 줄었으면 처음부터 다시 읽는다. 감시는 `fs.watch(recursive)`와 5초 폴링을 함께 쓴다.
- **집계:** `UsageTracker`가 세션·에이전트별 누적, 현재 컨텍스트(마지막 요청의 input + cache_read + cache_write), 시간 단위 버킷(48시간)을 메모리 스냅샷으로 두고 `{type:"usage"}`로 1초에 최대 한 번 보낸다. 사용량 보관은 90일(`AI_OFFICE_USAGE_RETENTION_DAYS`)이다.
- **모델 설정:** `config/models.default.json`(컨텍스트 한도, API 정가, 확인 출처·날짜)에 사용자 파일(`~/.config/ai-office/models.json` 또는 `AI_OFFICE_MODELS_FILE`)을 모델별로 합친다. 공식 문서로 확인하지 못한 한도는 `contextVerified: false`이고 화면에 "미확인"/"?"로 표시한다. Haiku 5.5처럼 프롬프트 길이에 따라 값이 다른 단가는 `priceOverThreshold`로 요청마다 판단한다.

**서버** (`apps/server`): `app.ts`의 `buildServer(opts)`가 앱을 만들고, `index.ts`는 환경 변수를 읽어 listen만 한다. 테스트는 `buildServer`에 임시 DB를 넘기고 `inject`/`injectWS`로 검증한다.
- **영속화:** 이벤트는 SQLite(`db.ts`, 내장 `node:sqlite`라 네이티브 빌드 없음)에 저장한다. 위치는 `AI_OFFICE_DB`이고, 기본값은 `$XDG_DATA_HOME` 또는 `~/.local/share/ai-office/events.db`다.
- **기동 순서:** 보관 기간(`AI_OFFICE_RETENTION_DAYS`, 기본 7일)이 지난 이벤트 삭제 → 남은 이벤트를 `ts` 순으로 재생 → sweep → `compactPods`. 보관 기간 정리는 1시간마다 한 번 더 돈다.
- **sweep 주기:** 30초마다 돌고, 바뀐 게 있으면 `{type:"state"}`(전체 sessions/rooms)를 보낸다. 퇴근 시간은 `AI_OFFICE_OFF_DUTY_MIN`(기본 10, 소수 가능)이다.
- **WS 메시지:**
  - `snapshot {events, sessions, rooms, config(offDutyMs, models), usage}`: 접속할 때
  - `event {event, session, room}`: 이벤트마다
  - `state`: sweep이나 세션 정리 후
  - `usage`: 사용량 변화 시(1초에 최대 한 번)
  - 타입은 `packages/shared/src/protocol.ts`에 있다.
- **HTTP:** `POST /events`(hook), `POST /usage/import`(과거 대화 기록 가져오기), `GET /health`.
- **origin 검사:** `/ws` route의 `preValidation`에서 403으로 막는다. `@fastify/websocket`의 `verifyClient` 옵션을 쓰면 `injectWS`가 끝나지 않아 테스트가 멈추기 때문이다. CORS도 같은 목록(`AI_OFFICE_WEB_ORIGINS`, 기본값 `localhost:7421`·`127.0.0.1:7421`)을 쓴다.
- **그 밖:** 기본 로그 레벨은 `warn`(`LOG_LEVEL`)이다. 기본 바인딩은 `127.0.0.1`이고, WSL 포워딩이 안 될 때만 `HOST=0.0.0.0`을 쓴다.

**웹** (`apps/web`): `useOfficeSocket`이 WS 연결 하나를 사무실·탭·알림·로그에 같이 쓴다. 끊기면 지수 백오프로 재접속한다. `packages/shared`는 빌드하지 않고 TS 소스를 직접 export하므로, Next는 `transpilePackages`로, 서버는 tsx로 읽는다. shared 안에서는 확장자 없는 import를 쓴다.
- **보기 모드** (`OfficeApp`): localStorage `ai-office.view`에 `auto` / `lobby` / 방 cwd를 저장한다.
  - `auto`: 근무 중인 방이 2개 이하면 로비, 그보다 많으면 집중 보기다.
  - 자동 집중은 고정형(sticky)이다. 지금 방이 바쁜 동안은 바꾸지 않는다. 동시 세션 때문에 이벤트마다 화면이 바뀌는 것을 막기 위해서다.
- **알림** (`lib/useWaitingAlerts.ts`): 키는 `세션:에이전트:waiting.at`이고, 처음 보는 키에만 알림을 띄운다.
  - 첫 스냅샷에 이미 있던 대기는 "본 것"으로 처리해, 새로고침할 때 알림이 쏟아지지 않게 한다.
  - 권한은 토글을 켤 때만 요청한다(`ai-office.alerts`).
  - 대기가 있으면 탭 제목이 깜빡인다.

**3D 사무실** (`apps/web/office/`, Three.js): Three는 window를 쓰므로 `OfficeCanvas`가 동적 import로 클라이언트에서만 불러온다. 서버 렌더링 컴포넌트는 three를 import하는 모듈 대신 `office/status.ts`(상태 라벨, 말풍선 문구)를 써야 한다.
- **건물:** 사무실 전체가 한 층짜리 건물이다(`buildingLayout`, `Building.ts`).
  - 서쪽 공용 구역(폭 7칸)에 엘리베이터, 안내 데스크, 라운지·탕비실, 회의실이 있다.
  - 그 동쪽에 방들이 줄지어 벽을 맞대고, 줄마다 북쪽에 폭 2칸 복도가 있다.
  - 줄은 고르게 나눈다(4개 → 2+2). 짧은 줄의 남는 칸은 "빈 사무실"로 채운다.
  - 방 순서는 `firstSeenAt`이라, 다른 방이 생기거나 사라져도 자리를 지킨다(방 개수가 바뀌어 줄 구성이 달라질 때만 움직인다).
- **벽 내리기:** 바깥 북·서쪽 벽만 창문 달린 높은 벽이다. 방 칸막이·복도·회의실 벽은 낮은 턱(높이 0.22)이다. 카메라가 남쪽 위에서 보므로, 높은 실내 벽은 그 뒤의 복도와 방을 가린다. 이웃 방끼리 같은 위치에 턱이 겹쳐 깜빡이지 않도록, 방은 북·서·남 턱만 그리고 동쪽 턱은 줄 끝 방만 그린다.
- **동선:** 방 문은 북쪽 턱의 틈(x 0.5~1.5)이다. `entryPath`가 엘리베이터 → 홀 → 공용 구역 동쪽 통로(x 6.4) → 그 줄 복도 → 문 밖까지의 경로를 주고, `RoomView`가 방 기준 좌표로 바꿔 캐릭터에 넘긴다. 출근은 엘리베이터에서 나와 이 경로로 들어오고, 퇴근은 역순으로 엘리베이터까지 가서 사라진다. 엘리베이터 문은 근처에 사람이 있으면 열린다.
- **카메라:** 고정된 직교 카메라다(`VIEW_DIR`: 정 아이소메트릭에서 약 25° 돌린 각도. 방이 가로로 넓게 보여 크게 그려진다). 로비는 건물 전체를, 집중 보기는 한 방을 프레이밍하되 다른 방도 계속 그린다. 카메라는 목표 프레이밍으로 부드럽게 이동한다. 집중 보기에서 방 밖을 클릭하면 로비로 돌아간다.
- **표시 단계(`Detail`):** 집중 보기는 모두 표시한다. 로비는 팀장 말풍선·이름과 손 든 에이전트만, 아주 작으면 "!"만 표시한다.
- **좌표:** 바닥 타일 1칸 = 1단위다. x는 동쪽, z는 남쪽(카메라 쪽)이다. 방 안 좌표는 방 북서쪽 모서리 기준이다. 팀 구역 하나는 4.4×4.8칸이고, 방 크기는 정수로 올린다(`layout.ts`).
- **책상 묶음:** 묶음 안에서는 앉는 사람이 +z 쪽에서 -z를 본다. 직원은 회전 0(남쪽에 앉아 북쪽의 팀장을 봄, 카메라에 모니터 화면이 보임), 팀장은 π(카메라를 봄)다. 팀장 모니터는 얼굴이 가리지 않게 옆으로 비킨다.
- **게이지:** 이름표 옆에 컨텍스트 사용량을 `12% · 120K` 형태로 표시한다. 80% 이상은 주황, 95% 이상은 빨강이다. 계산은 three를 쓰지 않는 `lib/usage.ts`에 있다.
- **에셋:** `public/assets/kenney/`의 Kenney Furniture Kit, Mini Characters다(CC0, 각 폴더에 `License.txt`). `assets.ts`가 한 번만 로드한다. 가구는 바닥 중심·밑면 y=0으로 다시 맞춘 뒤 복제한다. 모델 기본 방향 보정은 `RoomView.ts`의 `FACING` 표에 있다. 방마다 재질 사본을 가져서, 빈 방은 그 방 재질만 어둡게 한다(불 끄기).
- **캐릭터 애니메이션:** 뼈대는 root, leg-left/right, torso, arm-left/right, head다. `partClip`으로 하체(`sit`/`walk`/`static`)와 상체(`interact-right`=타이핑, `idle`, `emote-yes`)를 나눠 겹친다. 그 위에 `Agent.pose()`가 뼈 회전을 덧붙인다(손 들기 = arm-right에 X −2.9, Z +0.35. Z가 음수면 팔이 큰 머리 속으로 접혀 안 보인다).
- **모니터 화면:** `screens.ts`가 상태별 캔버스 텍스처를 하나씩만 만들어 모든 모니터가 공유한다.
- **라벨:** 말풍선·이름표·"!"·방 제목은 `CSS2DRenderer`의 HTML이다(스타일은 `app/globals.css`의 `.o3-*`). CSS2D 라벨은 부모가 숨겨져도 따라 숨지 않으므로, 방이 안 보일 때는 `update(..., shown)`으로 직접 숨긴다.
- **상태 반영:** `RoomView.sync`가 화면과 상태를 비교해 맞춘다. 첫 화면에 있던 캐릭터는 바로 앉고, 그 뒤 새로 생긴 캐릭터(팀장 포함)는 문에서 걸어 들어온다. 퇴근하거나 SubagentStop이 오면 걸어 나간다.

**설치 스크립트** (`scripts/settings-lib.mjs`): 쓰기 전에 `settings.json.bak-<시각>`으로 백업한다. command 문자열에 `ai-office-hook.mjs`가 들어 있는지로 자기 항목을 식별하므로, 다시 설치하면 교체되고 제거할 때 다른 사용자 hook은 남는다. JSON을 파싱하지 못하면 덮어쓰지 않고 중단한다. `--settings <path>`로 다른 파일을 대상으로 지정할 수 있다. command에는 `process.execPath`로 얻은 node 절대경로가 들어가므로, nvm으로 node 버전을 바꾸면 다시 설치해야 한다.

## 디버깅

- **스크린샷:** WSL에서 headless Chromium을 쓰려면 sudo 없이 받아 둔 라이브러리와 폰트가 필요하다(`~/.cache/ai-office-libs`). `LD_LIBRARY_PATH=~/.cache/ai-office-libs/root/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=~/.cache/ai-office-libs/fonts.conf node scripts/screenshot.mjs ...` 형태로 실행한다. 이 Claude 세션 자신의 이벤트도 들어오므로, 시뮬레이션을 찍을 때는 `--view lobby` 또는 `--view <방 cwd>`로 화면을 고정한다. 3D는 캐릭터가 작아서 세부를 볼 때는 `--scale 2` 이상으로 찍어 잘라 본다. `--ls ai-office.log=collapsed`로 로그를 접으면 사무실이 크게 나온다.
- **시뮬레이션 DB:** 시뮬레이션은 실제 DB에 기록된다. 실제 데이터와 섞이지 않게 `AI_OFFICE_DB`를 임시 경로로 바꿔서 띄운다.

- 실제 hook 입력을 보려면 hook command 앞에 `AI_OFFICE_DUMP=<파일>`을 붙인다. 원본 JSON이 그 로컬 파일에 쌓인다. 프롬프트 원문이 포함되니 디버깅할 때만 쓴다.
- 수동 주입: `echo '{"hook_event_name":"PreToolUse","session_id":"t","cwd":"/tmp/x","tool_name":"Edit","tool_input":{"file_path":"/tmp/x/a.ts"}}' | node hooks/ai-office-hook.mjs`
- hook 설정 변경은 새로 시작한 Claude Code 세션부터 적용된다.

## 작업 흐름

- **브랜치와 PR:** 기능은 `main`에서 `feat/...` 브랜치를 따서 작업하고 PR로 올린다. 병합은 merge commit 방식이고, 병합한 브랜치는 지우지 않는다. 커밋 메시지와 PR 본문은 한국어로 쓴다.
- **완료 기준:** `pnpm typecheck`, `pnpm test`, 웹 `next build`(개발 서버를 멈추고 실행, 끝나면 `apps/web/.next` 삭제 후 개발 서버 재시작), Playwright 스크린샷 확인까지 마친 뒤 PR을 올린다.
- **브랜치 전환 주의:** `pnpm dev`의 `tsx watch`는 파일이 바뀌는 순간 서버를 다시 띄운다. `git checkout main` 후 `git pull`을 하면, 그 사이 잠깐 옛 코드로 서버가 떠서 웹과 프로토콜이 어긋날 수 있다(실제로 화면이 깨진 적 있음). 병합 뒤에는 `git fetch origin main:main && git checkout main`으로 전환하고, 의심되면 개발 서버를 다시 시작한다. hook도 작업 폴더의 코드를 그대로 실행하므로, hook과 서버는 항상 같은 브랜치 코드여야 한다.

## 진행 상황

| 단계 | 내용 | PR |
|---|---|---|
| 1 | 모노레포, hook → 서버 → 웹 텍스트 로그, hook 설치 스크립트 | (초기 커밋) |
| 2 | 세션 상태 reducer(병렬 도구·대기 해제·도착 순서), 2D 픽셀 사무실, 세션 선택 | #1, #2, #3 |
| 3 | 프로젝트별 방과 팀 구역, 로비/집중 보기, 승인 대기 알림, 퇴근, SQLite 영속화 | #4 |
| 3D | Three.js 3D 디오라마로 교체(Kenney CC0 에셋) | #5 |
| 건물 | 한 층짜리 건물(엘리베이터·공용 구역·복도), 출퇴근 동선 | #6 |
| 4 (1/2) | 대화 기록 기반 토큰 사용량, 컨텍스트 게이지, 사용량 패널, 과거 기록 가져오기, 모델 한도·단가 설정 파일 | #7 |
| 4 (2/2) | 세션 다시보기 | 다음 할 일 |

## 다음 할 일

**4단계 2/2: 세션 다시보기** (`main`에서 새 브랜치로 시작). 사용자와 합의한 내용:
- **서버:**
  - `GET /history`: 지난 세션 목록(프로젝트, 시작 시각, 길이, 이벤트 수, 토큰)
  - `GET /history/:sessionId/events`: SQLite에 저장된 이벤트
  - hook 이벤트가 없는 "기록만" 세션은 목록에 흐리게 표시하고 재생은 막는다.
- **재생 엔진:** 서버 상태는 건드리지 않고, 브라우저에서 같은 reducer(`reduceOffice`, `sweepOffDuty`)로 재생한다. 순수 함수로 `packages/shared`에 두고 테스트한다.
  - 시점 이동은 처음부터 그 시각까지 다시 계산한다.
  - 30초 넘게 이벤트가 없는 구간은 재생에서 2초로 압축하고, 타임라인에 "… N분 건너뜀"으로 표시한다. 화면 시각은 실제 시각 그대로다.
- **조작:** 🎞 버튼의 목록에서 세션을 고르고, 재생/일시정지, 1x/4x/16x, 타임라인 스크롤, 현재 시각을 제공한다.
- **화면:**
  - 재생할 세션의 방 하나만 있는 건물로 보여준다. `OfficeScene`에 초기화(첫 화면 취급) 기능이 필요하다. 그래야 실시간 화면으로 돌아올 때 캐릭터가 다시 걸어 들어오지 않는다.
  - "🎞 다시보기 중 · 실시간 아님" 띠와 세피아 톤으로 실시간 화면과 구분한다.
  - 게이지도 그 시각까지의 사용량으로 다시 계산한다(사용량 메시지 시각 기준).
- **알림:** 재생 장면의 손 들기는 알림과 제목 깜빡임을 일으키지 않는다. 실제 세션의 알림은 재생 중에도 그대로 울리고, 알림을 누르면 다시보기를 나와 그 방으로 간다.
- **테스트:** 재생 속도(1x/4x/16x에서 시각 진행), 빈 구간 압축, 시점 이동 후 상태가 처음부터 다시 계산한 결과와 같은지, 끝에서 멈추는지를 확인한다. Playwright로 다시보기 화면, 띠, 재생 중 알림이 울리지 않는지 확인한다.

**그 밖의 후속 과제**
- **버전 어긋남 대비:** 웹이 서버 메시지의 빠진 필드를 빈 값으로 처리하도록 한다(`data.rooms ?? {}` 등). 지금은 서버만 옛 코드면 페이지가 깨진다.
- **실제 GPU 성능 확인:** Windows 브라우저에서 방이 많을 때 성능을 확인한다. 느리면 고정 가구를 합쳐 그리기 호출을 줄인다.
- **라운지 휴식 연출:** 쉬는 팀장이 라운지에서 커피를 마시는 연출(공용 공간을 만들 때 나온 아이디어)
- **팀 구역 강조:** 한 방에 세션이 여럿일 때 팀 구역을 클릭하면 테두리로 강조한다(3단계 계획에서 빠진 항목).
