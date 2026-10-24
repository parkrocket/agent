# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

Claude Code 세션을 픽셀아트 사무실로 실시간 시각화하는 "AI 오피스". 메인 에이전트는 팀장, 서브에이전트는 직원 캐릭터로 그린다. 3단계까지 구현됐다:
- 프로젝트(cwd)별 방, 방 안에서 세션마다 팀 구역(pod)
- 로비/집중 보기
- 승인 대기 브라우저 알림
- 퇴근 처리
- SQLite 영속화

환경은 Windows WSL2(Ubuntu)이고, 브라우저는 Windows에서 `localhost`로 접속한다.

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

**hook이 개인정보 경계다.** 원본 hook payload에는 프롬프트, 파일 내용, Bash 명령, 도구 출력, 어시스턴트 메시지가 들어 있다. `hooks/sanitize.mjs`가 화이트리스트 필드만 새 객체로 복사하고(파일은 basename만), 원본은 절대 내보내지 않는다. 그래서 `type: "http"` hook은 쓰지 않는다. 서버는 2차 방어선으로, `packages/shared/src/events.ts`의 `OfficeEventSchema`가 `.strict()`라서 모르는 필드가 들어오면 400으로 거부한다.

**필드를 추가할 때는 세 곳을 같이 고친다:** `hooks/sanitize.mjs`(추출), `packages/shared/src/events.ts`(스키마·타입), `hooks/sanitize.test.mjs`(유출 방지 테스트). 셋이 어긋나면 서버가 모든 이벤트를 400으로 거부하는데, hook은 실패를 무시하므로 증상이 조용히 "이벤트가 안 옴"으로만 나타난다.

**hook은 Claude Code를 절대 막거나 늦추면 안 된다.** 설정에 `async: true, timeout: 5`로 등록되고, 스크립트 자체도 1.5초 강제 종료, fetch 타임아웃 300ms, stdout 출력 없음, 항상 exit 0이다. stdout에 무언가 출력하면 일부 이벤트(UserPromptSubmit, SessionStart)에서 Claude의 컨텍스트에 주입되므로 출력하지 않는다. hook은 Claude Code가 plain `node`로 실행하므로 npm 의존성이나 TS를 쓸 수 없다. 그래서 `packages/shared`를 import하지 않고 이벤트 이름 목록을 따로 가지고 있다.

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

**서버** (`apps/server`): `app.ts`의 `buildServer(opts)`가 앱을 만들고, `index.ts`는 환경 변수를 읽어 listen만 한다. 테스트는 `buildServer`에 임시 DB를 넘기고 `inject`/`injectWS`로 검증한다.
- **영속화:** 이벤트는 SQLite(`db.ts`, 내장 `node:sqlite`라 네이티브 빌드 없음)에 저장한다. 위치는 `AI_OFFICE_DB`이고, 기본값은 `$XDG_DATA_HOME` 또는 `~/.local/share/ai-office/events.db`다.
- **기동 순서:** 보관 기간(`AI_OFFICE_RETENTION_DAYS`, 기본 7일)이 지난 이벤트 삭제 → 남은 이벤트를 `ts` 순으로 재생 → sweep → `compactPods`. 보관 기간 정리는 1시간마다 한 번 더 돈다.
- **sweep 주기:** 30초마다 돌고, 바뀐 게 있으면 `{type:"state"}`(전체 sessions/rooms)를 보낸다. 퇴근 시간은 `AI_OFFICE_OFF_DUTY_MIN`(기본 10, 소수 가능)이다.
- **WS 메시지:**
  - `snapshot {events, sessions, rooms, config}`: 접속할 때
  - `event {event, session, room}`: 이벤트마다
  - `state`: sweep이나 세션 정리 후
  - 타입은 `packages/shared/src/protocol.ts`에 있다.
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
- **화면 구성:** 장면은 하나이고 카메라는 고정된 직교 카메라다(`VIEW_DIR`: 정 아이소메트릭에서 약 25° 돌린 각도. 방이 가로로 넓게 보여 크게 그려진다). `OfficeScene`이 로비는 방들을 격자로 놓고 전부, 집중 보기는 한 방만 프레이밍한다. 카메라는 목표 프레이밍으로 부드럽게 이동한다.
- **좌표:** 바닥 타일 1칸 = 1단위, 방 북서쪽 모서리 기준이다. x는 동쪽, z는 남쪽(카메라 쪽)이다. 벽은 북·서쪽에만 있다(잘라 낸 디오라마). 팀 구역 하나는 4.4×4.8칸이고, 방 크기는 벽 타일에 맞춰 정수로 올린다(`layout.ts`).
- **책상 묶음:** 묶음 안에서는 앉는 사람이 +z 쪽에서 -z를 본다. 직원은 회전 0(남쪽에 앉아 북쪽의 팀장을 봄, 카메라에 모니터 화면이 보임), 팀장은 π(카메라를 봄)다. 팀장 모니터는 얼굴이 가리지 않게 옆으로 비킨다.
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
