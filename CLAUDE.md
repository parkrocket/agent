# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

Claude Code 세션을 픽셀아트 사무실로 실시간 시각화하는 "AI 오피스". 메인 에이전트는 팀장, 서브에이전트는 직원 캐릭터, 프로젝트(cwd)별로 방을 나누는 것이 최종 목표다. 현재는 1단계(hook → 서버 → 웹 텍스트 로그)까지 구현됐고, PixiJS 렌더링·세션 상태 관리·방 분리·손 들기/브라우저 알림은 아직 없다.

환경은 Windows WSL2(Ubuntu)이고, 브라우저는 Windows에서 `localhost`로 접속한다.

## 명령어

pnpm 12 (corepack). 루트에서 실행한다.

```bash
pnpm install
pnpm dev              # server(:7420, tsx watch) + web(:7421, next dev) 병렬 실행
pnpm typecheck        # 모든 패키지 tsc --noEmit
pnpm test             # node:test — hooks/*.test.mjs, scripts/*.test.mjs
node --test hooks/sanitize.test.mjs                                   # 파일 하나만
node --test --test-name-pattern="Bash command" hooks/sanitize.test.mjs  # 테스트 하나만
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

**팀장/직원 구분:** hook 입력에 `agent_id`가 있으면 서브에이전트 안에서 실행된 것이다. 이를 `agent: {kind:"sub", id, type}`으로, 없으면 `{kind:"main"}`으로 바꾼다. 방 구분 키는 `cwd`, 화면 표시는 `project`(cwd의 basename)를 쓴다. async hook은 도착 순서가 바뀔 수 있으니 순서가 필요하면 `ts`(hook 실행 시각)로 정렬한다.

**서버** (`apps/server`): 메모리 링버퍼에 최근 500개를 보관한다(`store.ts`, 재시작하면 사라짐). WS에 접속하면 `{type:"snapshot"}`을 보내고, 이후에는 `{type:"event"}`를 push한다. 프로토콜 타입은 `packages/shared/src/protocol.ts`에 있다. CORS와 WS `verifyClient`는 같은 origin 목록(`AI_OFFICE_WEB_ORIGINS`, 기본값 `localhost:7421`·`127.0.0.1:7421`)을 쓴다. 기본 바인딩은 `127.0.0.1`이고, WSL 포워딩이 안 될 때만 `HOST=0.0.0.0`을 쓴다.

**웹** (`apps/web`): 브라우저가 서버 WS(`NEXT_PUBLIC_AI_OFFICE_WS`)에 직접 연결하고, 끊기면 지수 백오프로 재접속한다. `packages/shared`는 빌드하지 않고 TS 소스를 직접 export하므로, Next는 `transpilePackages`로, 서버는 tsx로 읽는다. shared 안에서는 확장자 없는 import를 쓴다.

**설치 스크립트** (`scripts/settings-lib.mjs`): 쓰기 전에 `settings.json.bak-<시각>`으로 백업한다. command 문자열에 `ai-office-hook.mjs`가 들어 있는지로 자기 항목을 식별하므로, 다시 설치하면 교체되고 제거할 때 다른 사용자 hook은 남는다. JSON을 파싱하지 못하면 덮어쓰지 않고 중단한다. `--settings <path>`로 다른 파일을 대상으로 지정할 수 있다. command에는 `process.execPath`로 얻은 node 절대경로가 들어가므로, nvm으로 node 버전을 바꾸면 다시 설치해야 한다.

## 디버깅

- 실제 hook 입력을 보려면 hook command 앞에 `AI_OFFICE_DUMP=<파일>`을 붙인다. 원본 JSON이 그 로컬 파일에 쌓인다. 프롬프트 원문이 포함되니 디버깅할 때만 쓴다.
- 수동 주입: `echo '{"hook_event_name":"PreToolUse","session_id":"t","cwd":"/tmp/x","tool_name":"Edit","tool_input":{"file_path":"/tmp/x/a.ts"}}' | node hooks/ai-office-hook.mjs`
- hook 설정 변경은 새로 시작한 Claude Code 세션부터 적용된다.
