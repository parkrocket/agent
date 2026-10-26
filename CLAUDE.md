# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

Claude Code 세션을 3D 사무실 건물로 실시간 시각화하는 "AI 오피스". 메인 에이전트는 팀장, 서브에이전트는 직원 캐릭터다. 프로젝트(cwd)마다 방이 하나씩 있고, 캐릭터는 엘리베이터로 출퇴근하며 도구를 쓰는 모습, 손 들기(승인 대기), 컨텍스트 사용량 게이지로 상태를 보여준다. 단계별 진행은 아래 "진행 상황"을 본다.

환경은 Windows다. 사용자는 Windows 터미널과 VS Code 확장(Windows)에서 Claude Code를 쓰므로, AI 오피스도 Windows의 Node로 돈다(hook·상태 줄은 Windows `%USERPROFILE%\.claude\settings.json`에 설치). PC가 두 대라 작업 폴더가 다르다: 집은 `C:\Users\parkseonghyeon\projects\agent`, 회사는 `C:\Users\mongk\projects\ai-office`. 설치된 hook 사본·DB·settings.json은 PC마다 따로라서, 한쪽에서 hook을 고쳐 설치해도 다른 PC에서는 pull 후 `pnpm hooks:install`을 다시 해야 한다. 예전에 쓰던 WSL2(Ubuntu) 사본(`~/projects/agent`)도 있다. 코드는 Linux와 Windows 양쪽에서 테스트가 통과해야 한다.
- **Windows에서 다를 점:** Claude Code는 hook과 상태 줄 명령을 Git Bash로 실행한다(따옴표 안 백슬래시 경로는 그대로 유지됨). 프로세스 그룹·SIGTERM이 없어 `pnpm stop`은 `taskkill /T /F`를 쓴다. 열린 SQLite 파일이 든 폴더는 지울 수 없고, 심볼릭 링크는 관리자 권한이 필요하다(테스트는 junction 사용). 경로는 `dirName`처럼 `/`와 `\`를 모두 처리하고, 드라이브 문자는 소문자(`c:\`)로 올 수도 있다.

## 설계 원칙

이 원칙을 깨는 변경은 하지 않는다. 기능과 부딪히면 원칙 쪽을 지키고 사용자에게 먼저 묻는다.

1. **원문은 절대 내보내지 않는다.** hook 입력과 대화 기록(JSONL)에는 프롬프트, 응답, 생각, 코드, Bash 명령, 도구 출력이 들어 있다. 밖으로 나가는 것은 화이트리스트 필드뿐이다.
   - **hook:** `hooks/sanitize.mjs`가 이벤트 종류, 세션 ID, cwd, 도구 이름, 파일 **basename**, 에이전트 ID/종류, 알림 종류, 대화 기록 **경로**만 새 객체로 복사한다. 원본 객체는 그대로 보내지 않는다. 그래서 원본 payload를 통째로 보내는 `type: "http"` hook은 쓰지 않는다.
   - **서버:** 2차 방어선으로 `OfficeEventSchema`가 `.strict()`라 모르는 필드가 들어오면 400으로 거부한다.
   - **대화 기록:** `parseUsageLine`이 토큰 수, 모델, 시각, ID, cwd만 복사한다. 원문은 메모리에도 DB에도 남기지 않는다. 파일은 읽기 전용으로만 연다.
   - **상태 줄:** `hooks/limits.mjs`의 `extractLimits`가 `rate_limits`의 5시간·주간 사용률과 초기화 시각만 복사한다. 세션 ID·경로·모델·비용은 터미널 표시에만 쓰고 보내지 않는다.
   - **테스트:** 원문 필드에 고유 문자열을 넣고, 결과에 남지 않는지 확인하는 유출 테스트를 기능마다 둔다(`hooks/sanitize.test.mjs`, `hooks/limits.test.mjs`, `transcript.test.ts`, `usage.test.ts`).
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
pnpm start / stop / restart / status   # 일상 실행: 서버 + 웹 프로덕션 빌드(.next-prod)를 백그라운드로 (scripts/office.mjs)
pnpm dev              # 개발: server(:7420, tsx watch) + web(:7421, next dev). 포트가 같으니 먼저 pnpm stop
pnpm typecheck        # 모든 패키지 tsc --noEmit
pnpm test             # node:test(hooks/, scripts/) + 각 패키지 test(shared, server: tsx --test)
node --test hooks/sanitize.test.mjs                                   # 파일 하나만
node --test --test-name-pattern="Bash command" hooks/sanitize.test.mjs  # 테스트 하나만
pnpm --filter @ai-office/shared exec tsx --test --test-name-pattern="parallel" src/office.test.ts
node scripts/simulate.mjs --projects 3 --sessions 2 [--seed 7] [--speed 2]   # 가짜 세션 동시 재생 (서버 실행 중일 때)
node scripts/screenshot.mjs out.png [--view lobby|<방 cwd>] [--shots 10 --every 1500] [--size 1600x1000] [--scale 2] [--ls key=value]
node scripts/screenshot.mjs out.png --replay <세션ID>|latest [--replay-at 0.4] [--replay-speed 16] [--replay-pause]   # 다시보기 화면
AI_OFFICE_DB=/tmp/x.db AI_OFFICE_OFF_DUTY_MIN=0.5 pnpm dev   # 데모·테스트용: 임시 DB, 퇴근 30초
CLAUDE_CONFIG_DIR=/tmp/ch AI_OFFICE_DB=/tmp/x.db pnpm dev     # 사용량 데모: 가짜 대화 기록 폴더
node scripts/simulate.mjs --transcripts /tmp/ch/projects       # 가짜 대화 기록(토큰 수만)도 함께 기록
pnpm usage:import                                              # 과거 대화 기록을 사용량 통계로 가져오기
pnpm --filter @ai-office/server dev   # 패키지 하나만
pnpm hooks:install --dry-run          # ~/.claude/settings.json 병합 결과만 출력
pnpm hooks:install / pnpm hooks:uninstall   # hook을 ~/.local/share/ai-office/hook/에 복사해 등록 / 등록 해제 후 사본 삭제
pnpm statusline:install [--replace] / pnpm statusline:uninstall   # (선택) 요금제 한도 상태 줄을 .../statusline/에 복사해 statusLine으로 등록 / 해제
```

- pnpm 12는 `pnpm -r <name>`을 `exec`로 해석하므로, 재귀 스크립트에는 반드시 `run`을 넣는다(`pnpm -r run build`).
- 빌드 스크립트 허용은 `pnpm-workspace.yaml`의 `allowBuilds`로 관리한다(`pnpm approve-builds <pkg>`).
- 린터나 포매터는 아직 없다.

## 아키텍처

```
Claude Code ─(stdin JSON)→ hooks/ai-office-hook.mjs ─POST /events→ apps/server ─WS /ws→ apps/web
```

폴더별 세부 설명은 각 폴더의 CLAUDE.md에 있다(그 폴더 파일을 다룰 때 함께 읽힌다):
- `hooks/CLAUDE.md`: 팀장/직원 구분, 상태 줄 스크립트
- `packages/shared/CLAUDE.md`: 상태 reducer, 방과 퇴근, 대화 기록 파서, 다시보기 타임라인, 응답 정규화
- `apps/server/CLAUDE.md`: 서버 구성·WS 메시지·HTTP, 사용량 집계, 요금제 한도 합치기
- `apps/web/CLAUDE.md`: 웹·보기 모드·알림, 3D 사무실, 다시보기 화면, 한도 표시
- `scripts/CLAUDE.md`: 설치 스크립트, 실행 스크립트, 스크린샷

**필드를 추가할 때는 세 곳을 같이 고친다:** `hooks/sanitize.mjs`(추출), `packages/shared/src/events.ts`(스키마·타입), `hooks/sanitize.test.mjs`(유출 방지 테스트). 셋이 어긋나면 서버가 모든 이벤트를 400으로 거부하는데, hook은 실패를 무시하므로 증상이 조용히 "이벤트가 안 옴"으로만 나타난다. 웹이 받는 상태 타입에 필드를 추가하면 `packages/shared/src/normalize.ts`에 기본값도 넣는다.

**이벤트 버전(`v`):** 설치된 hook은 사본이라 서버보다 오래되거나 새로울 수 있다. 필드를 추가·변경하면 `hooks/sanitize.mjs`의 `EVENT_VERSION`과 `events.ts`의 `EVENT_VERSION`·`SUPPORTED_EVENT_VERSIONS`를 함께 올리고(테스트가 둘을 비교한다), 서버는 예전 버전도 계속 받는다(스키마를 버전별 union으로). 서버는 `v`를 스키마보다 먼저 검사해 `unsupported_version`으로 거부하고, 거부 수를 `/health`의 `rejected`에 세며, `pnpm status`가 이를 경고로 보여준다. 요금제 한도의 `LIMITS_VERSION`도 `hooks/limits.mjs`와 `packages/shared/src/limits.ts`에 있고 테스트가 비교한다.

**이벤트 이름 목록은 세 곳에 중복돼 있다:** `packages/shared/src/events.ts`의 `HOOK_EVENT_NAMES`, `hooks/sanitize.mjs`의 `FORWARDED_EVENTS`, `scripts/settings-lib.mjs`의 `HOOK_EVENTS`(설치 대상).

**요금제 한도의 흐름:** Pro/Max의 5시간·주간 한도는 hook 입력에 없고 상태 줄 입력(`rate_limits`)에만 있다. 그래서 선택 설치하는 상태 줄 스크립트(`hooks/ai-office-statusline.mjs`)가 `POST /limits`로 보내고, 서버(`apps/server/src/routes/limits.ts`)가 합쳐 웹에 보낸다.

## 디버깅

- 실제 hook 입력을 보려면 hook command 앞에 `AI_OFFICE_DUMP=<파일>`을 붙인다. 원본 JSON이 그 로컬 파일에 쌓인다. 프롬프트 원문이 포함되니 디버깅할 때만 쓴다.
- 수동 주입: `echo '{"hook_event_name":"PreToolUse","session_id":"t","cwd":"/tmp/x","tool_name":"Edit","tool_input":{"file_path":"/tmp/x/a.ts"}}' | node hooks/ai-office-hook.mjs`
- hook 설정 변경은 새로 시작한 Claude Code 세션부터 적용된다.
- **시뮬레이션 DB:** 시뮬레이션은 실제 DB에 기록된다. 실제 데이터와 섞이지 않게 `AI_OFFICE_DB`를 임시 경로로 바꿔서 띄운다.
- 스크린샷 요령은 `scripts/CLAUDE.md`에 있다.

## 작업 흐름

- **브랜치와 PR:** 기능은 `main`에서 `feat/...` 브랜치를 따서 작업하고 PR로 올린다. 병합은 merge commit 방식이고, 병합한 브랜치는 지우지 않는다. 커밋 메시지와 PR 본문은 한국어로 쓴다.
- **실행 환경:** 이 PC는 평소 `pnpm start`(프로덕션)로 돌고, hook은 설치된 사본이다. 개발할 때는 `pnpm stop` 후 `pnpm dev`, 끝나면 `pnpm dev`를 끄고 `pnpm start`로 되돌린다.
- **완료 기준:** `pnpm typecheck`, `pnpm test`, 웹 빌드(개발 서버를 끈 뒤 `pnpm start`가 `.next-prod`로 빌드하는 것으로 확인), Playwright 스크린샷 확인까지 마친 뒤 PR을 올린다. `/verify` 스킬이 이 순서를 실행한다. hook을 고쳤다면 병합 후 `pnpm hooks:install`로 이 PC에 반영한다.
- **브랜치 전환 주의:** `pnpm dev`의 `tsx watch`는 파일이 바뀌는 순간 서버를 다시 띄운다. `git checkout main` 후 `git pull`을 하면, 그 사이 잠깐 옛 코드로 서버가 떠서 웹과 프로토콜이 어긋날 수 있다(실제로 화면이 깨진 적 있음). 병합 뒤에는 `git fetch origin main:main && git checkout main`으로 전환하고, 의심되면 개발 서버를 다시 시작한다. `pnpm start`로 띄운 서버는 watch가 없어 브랜치 전환에 영향받지 않는다(바뀐 코드를 반영하려면 `pnpm restart`). hook은 사본이라 브랜치와 무관하다.

## 진행 상황

| 단계 | 내용 | PR |
|---|---|---|
| 1 | 모노레포, hook → 서버 → 웹 텍스트 로그, hook 설치 스크립트 | (초기 커밋) |
| 2 | 세션 상태 reducer(병렬 도구·대기 해제·도착 순서), 2D 픽셀 사무실, 세션 선택 | #1, #2, #3 |
| 3 | 프로젝트별 방과 팀 구역, 로비/집중 보기, 승인 대기 알림, 퇴근, SQLite 영속화 | #4 |
| 3D | Three.js 3D 디오라마로 교체(Kenney CC0 에셋) | #5 |
| 건물 | 한 층짜리 건물(엘리베이터·공용 구역·복도), 출퇴근 동선 | #6 |
| 4 (1/2) | 대화 기록 기반 토큰 사용량, 컨텍스트 게이지, 사용량 패널, 과거 기록 가져오기, 모델 한도·단가 설정 파일 | #7 |
| 4 (2/2) | 세션 다시보기(브라우저 재생, 빈 구간 압축, 그 시각 기준 게이지) | #8 |
| 실사용 | hook 사본 설치·이벤트 버전 검사, `pnpm start/stop/status`(프로덕션), README 정리 | #9 |
| 안정화 | 서버 응답 정규화(버전 어긋남에도 페이지가 깨지지 않음) | #10 |
| 한도 | 상태 줄로 요금제 5시간·주간 한도 표시(터미널·오피스) | #11 |
| Windows | Windows Node에서 직접 실행(시작·종료, 경로, 테스트), 설정 백업 덮어쓰기 수정 | #13 |

## 다음 할 일

후속 과제:
- **실제 GPU 성능 확인:** Windows 브라우저에서 방이 많을 때 성능을 확인한다. 느리면 고정 가구를 합쳐 그리기 호출을 줄인다.
- **라운지 휴식 연출:** 쉬는 팀장이 라운지에서 커피를 마시는 연출(공용 공간을 만들 때 나온 아이디어)
- **팀 구역 강조:** 한 방에 세션이 여럿일 때 팀 구역을 클릭하면 테두리로 강조한다(3단계 계획에서 빠진 항목).
