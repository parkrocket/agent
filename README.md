# AI 오피스

Claude Code 세션을 3D 사무실로 실시간으로 보여주는 프로그램입니다.

- **캐릭터:** 메인 에이전트는 팀장, 서브에이전트는 직원 캐릭터가 됩니다. 도구를 쓰면 읽기·작성·실행 모습으로 바뀌고, 권한 승인이나 입력을 기다리면 손을 듭니다.
- **방:** 프로젝트 폴더(cwd)마다 방이 하나씩 생깁니다. 캐릭터는 엘리베이터로 출근하고, 한동안 조용하면 퇴근합니다.
- **사용량:** 이름표 옆 게이지가 컨텍스트 사용량을 보여주고, 📊 패널에서 토큰 사용량을 볼 수 있습니다.
- **다시보기:** 🎞에서 지난 세션을 다시 재생할 수 있습니다.

```
Claude Code ─(hook)→ 로컬 서버 :7420 ─(WebSocket)→ 브라우저 :7421
```

모든 것이 내 PC 안에서만 돕니다. 서버는 `127.0.0.1`에만 열리고, 프롬프트나 코드 같은 내용은 보내지도 저장하지도 않습니다([개인정보](#개인정보)).

## 준비물

- **Node.js 22.13 이상**(`node -v`로 확인). nvm을 쓴다면 `nvm install 22`.
- **pnpm:** Node에 들어 있는 corepack으로 켭니다: `corepack enable`
- **Claude Code**
- **운영체제:** Windows의 WSL2(Ubuntu)에서 주로 쓰고 확인했습니다. Linux와 macOS도 같은 방법으로 동작합니다. Windows용 Node에서 직접 실행하는 것은 확인하지 않았습니다.

## 설치

```bash
git clone https://github.com/parkrocket/agent.git ai-office
cd ai-office
pnpm install
pnpm hooks:install     # Claude Code에 hook 등록 (아래 "hook" 참고)
pnpm start             # 서버와 웹을 백그라운드로 실행 (처음에는 빌드 때문에 1~2분)
```

브라우저에서 **http://localhost:7421** 을 엽니다. WSL2라면 Windows 브라우저에서 그대로 열면 됩니다.

그다음 **Claude Code를 새로 시작**하세요. hook은 새로 시작한 세션부터 적용됩니다. 대화를 시작하면 사무실에 방이 생기고 팀장이 출근합니다.

## 켜기 · 끄기 · 상태

| 명령 | 하는 일 |
|---|---|
| `pnpm start` | 서버와 웹을 백그라운드로 켭니다. 웹 소스가 바뀌었으면 먼저 빌드합니다. 이미 켜져 있으면 상태만 보여줍니다. |
| `pnpm stop` | 둘 다 끕니다. |
| `pnpm restart` | 껐다가 다시 켭니다. |
| `pnpm status` | 실행 여부, hook 설치 상태, 거부된 이벤트 수, DB·로그 위치를 보여줍니다. |

```
$ pnpm status
AI 오피스 상태
  서버  ● 실행 중  pid 75534  http://127.0.0.1:7420
  웹    ● 실행 중  pid 75535  http://localhost:7421
  이벤트 v1 (지원: 1)  거부: 버전 0 · 형식 0
  hook  ✓ ~/.local/share/ai-office/hook (v1, 2c25fc0, 10/24 19:43 설치)
  DB    ~/.local/share/ai-office/events.db
  로그  ~/.local/share/ai-office/run
```

PC를 다시 켜면 `pnpm start`를 한 번 실행하세요. 기록은 DB에 남아 있어서 사무실 상태가 그대로 돌아옵니다.

## hook 설치 · 제거

hook은 Claude Code가 도구를 쓰거나 응답을 마칠 때마다 실행하는 작은 스크립트입니다. AI 오피스는 이 hook으로 이벤트를 받습니다.

```bash
pnpm hooks:install --dry-run   # 바뀔 설정만 출력 (파일은 안 건드림)
pnpm hooks:install             # 설치·업데이트
pnpm hooks:uninstall           # 제거 (다른 hook은 그대로 둠)
```

**설치하면 일어나는 일**
- hook 스크립트를 `~/.local/share/ai-office/hook/`에 복사합니다.
- `~/.claude/settings.json`에 그 사본을 등록합니다. 고치기 전에 `settings.json.bak-날짜-시각`으로 백업합니다.
- 다시 설치하면 AI 오피스 항목만 교체되고, 직접 만든 다른 hook은 건드리지 않습니다.

**설치할 때 알아둘 점**
- hook은 비동기로 실행되고 항상 1.5초 안에 끝납니다. 서버가 꺼져 있어도 Claude Code를 막거나 느리게 하지 않습니다.
- Claude Code는 복사본을 실행합니다. 그래서 이 저장소에서 브랜치를 바꾸거나 코드를 고쳐도 실행 중인 Claude 세션에는 영향이 없습니다. hook을 바꾸려면 `pnpm hooks:install`을 다시 실행하세요.
- hook 명령에는 설치할 때 쓴 node의 절대경로가 들어갑니다. nvm으로 node 버전을 바꿨다면 다시 설치하세요.

**제거하면 일어나는 일**
- settings.json에서 AI 오피스 항목만 빼고, 복사본을 지웁니다.

## 상태 줄 (선택): 요금제 한도 표시

Pro/Max 요금제라면 5시간·주간 한도 사용률과 초기화 시각을 볼 수 있습니다. Claude Code가 이 값을 **상태 줄**(입력창 아래 한 줄) 스크립트에만 넘겨 주므로, 이 기능은 상태 줄로 동작합니다.

```bash
pnpm statusline:install --dry-run   # 바뀔 설정만 출력
pnpm statusline:install             # 설치·업데이트 (다른 상태 줄이 있으면 멈춤 → --replace로 교체)
pnpm statusline:uninstall           # 제거 (AI 오피스 상태 줄일 때만)
```

- **터미널:** 입력창 아래에 `Opus 5.5 · ctx 12% · 5h 72% (3시간 3분 후) · 주간 91% (화 10:00 초기화)`가 표시됩니다. 80% 이상은 노랑, 95% 이상은 빨강입니다.
- **오피스:** 화면 상단과 📊 사용량 패널에 같은 값이 나옵니다. 계정 전체 값이라 가장 최근 보고 하나만 보여 주고, 15분 넘게 보고가 없으면 흐리게 표시합니다. 초기화 시각이 지나면 "초기화됨"으로 바뀝니다.
- **알아둘 점:**
  - Claude Code의 상태 줄은 하나뿐입니다.
  - 상태 줄을 켜면 입력창 아래의 키 안내 문구(`? for shortcuts`, `esc to interrupt`)가 숨겨집니다. 키는 그대로 동작합니다.
  - API 키 사용자이거나 세션의 첫 응답 전에는 한도 정보가 없어서, 모델과 컨텍스트만 표시됩니다.
- **보내는 것:** 두 한도의 사용률과 초기화 시각뿐입니다. 세션 ID, 경로, 모델, 비용은 보내지 않습니다.
- **설치 방식:** hook처럼 사본(`~/.local/share/ai-office/statusline/`)을 등록합니다. `hooks/limits.mjs`나 `hooks/ai-office-statusline.mjs`를 고쳤다면 다시 설치하세요.

## 업데이트

```bash
git pull
pnpm install
pnpm hooks:install     # hook이 바뀌었을 수 있으니 항상
pnpm statusline:install  # 상태 줄을 쓰고 있다면
pnpm restart           # 웹은 바뀐 게 있으면 자동으로 다시 빌드
```

서버는 예전 버전 hook이 보내는 이벤트도 받습니다. 그래도 hook과 서버는 같은 버전으로 맞춰 두는 것이 좋습니다. `pnpm status`에 "작업 폴더 hooks/와 다름"이나 "지원하지 않는 버전"이 보이면 위 순서대로 다시 하세요.

## 다른 PC에 설치하기

1. [준비물](#준비물)을 설치합니다(Node 22.13+, `corepack enable`, Claude Code).
2. [설치](#설치)의 명령을 그대로 실행합니다. 설정이나 DB는 PC마다 따로 생깁니다.
3. Claude Code를 새로 시작합니다.

**옮길 수 있는 것**
- 지난 기록을 옮기고 싶다면, 서버를 끈 상태에서 `~/.local/share/ai-office/events.db*` 파일들을 새 PC의 같은 위치로 복사합니다.
- 모델 한도·단가를 바꿔 썼다면 `~/.config/ai-office/models.json`도 복사합니다.

**설치 위치가 다를 때**
- 저장소는 아무 폴더에 받아도 됩니다. hook은 복사본을 쓰므로 저장소 위치와 상관없습니다.

**포트가 이미 쓰이고 있을 때**
- `7420`과 `7421`을 다른 프로그램이 쓰고 있으면 `pnpm start`가 알려줍니다.

## 화면

- **로비 / 집중 보기:** 로비는 건물 전체를 보여줍니다.
  - 방을 클릭하거나 위쪽 탭을 고르면 그 방으로 다가가고, 방 밖을 클릭하면 로비로 돌아옵니다.
  - 근무 중인 방이 3개 이상이면 자동으로 한 방에 집중합니다. 지금 보는 방이 바쁜 동안은 화면을 바꾸지 않습니다.
- **방 탭의 점:** 빨강 깜빡임(손 든 에이전트 있음), 초록(작업 중), 회색(휴식), 흐림(모두 퇴근)
- **🔔 알림:** 켜 두면 에이전트가 손을 들 때 브라우저 알림이 뜨고, 누르면 그 방으로 갑니다. 기다리는 동안에는 탭 제목이 "(!) AI 오피스"로 깜빡입니다.
- **퇴근:** 마지막 활동 후 10분이 지나면 퇴근합니다. 승인을 기다리는 세션은 남아 있습니다.
- **요금제 한도 (상단):** 상태 줄을 설치했다면 5시간·주간 한도 사용률과 초기화 시각이 보입니다(위 "상태 줄" 참고).
- **📊 사용량:** 요금제 한도, 오늘 합계, 방별·세션별 토큰, 모델 한도·단가를 보여줍니다.
  - 비용 환산은 API 정가 기준 추정치이며 구독 요금제와는 무관합니다.
  - "과거 기록 가져오기"(또는 `pnpm usage:import`)로 hook 설치 전 세션도 통계에 넣을 수 있습니다.
- **🎞 다시보기:** 지난 세션(이벤트 보관 7일)을 골라 재생합니다.
  - 1x/4x/16x로 재생하고, 타임라인으로 원하는 시점에 갑니다.
  - 30초 넘게 조용했던 구간은 짧게 건너뜁니다.
  - 재생 중에도 실제 세션 알림은 울립니다.
  - 토큰 기록만 있고 hook 이벤트가 없는 세션은 "기록만"으로 흐리게 표시되며 재생할 수 없습니다.

### 캐릭터 상태

| 상태 | 언제 | 모습 |
|---|---|---|
| 휴식 | 세션 시작 직후, 완료 후 30초 지남 | 고개 숙여 졸며 z, 회색 링 |
| 생각 중 | 요청을 받았거나 도구 사이 | 말풍선 "…" |
| 읽는 중 | Read / Grep / Glob / WebFetch / WebSearch | 고개 숙임, 파란 화면, 파란 링 |
| 작성 중 | Edit / Write / NotebookEdit | 타이핑, 노란 화면, 노란 링 |
| 실행 중 | Bash | 타이핑, 초록 터미널, 초록 링 |
| 손 듦 | 권한 요청, 입력 대기 | 손 들기, "!" 표시, 승인 대기 말풍선, 깜빡이는 빨간 링 |
| 완료 | 응답을 마침 | 끄덕이며 "완료!", 보라 링 |

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 페이지가 안 열림 | `pnpm status`에서 웹이 실행 중인지 확인하세요. 꺼져 있으면 `pnpm start`. |
| 페이지 오른쪽 위가 `closed` | 서버가 꺼져 있습니다. `pnpm status`를 확인하고 `pnpm restart`. |
| 사무실이 비어 있음 | Claude Code를 hook 설치 **후에** 새로 시작했는지 확인하세요. `pnpm status`의 hook 줄이 ✓인지도 보세요. |
| "지원하지 않는 버전" 경고 | hook과 서버 버전이 다릅니다. `pnpm hooks:install` 후 `pnpm restart`. |
| `pnpm start`가 포트 사용 중이라고 함 | 개발 서버(`pnpm dev`)가 떠 있으면 끄세요. 다른 프로그램이면 그 프로그램을 끄세요. |
| WSL2에서 Windows 브라우저로 접속이 안 됨 | WSL의 localhost 포워딩이 꺼져 있을 수 있습니다. `HOST=0.0.0.0 pnpm restart`로 실행해 보세요(같은 네트워크에 열리므로 주의). |
| 실행 기록 | `~/.local/share/ai-office/run/server.log`, `web.log` |

hook이 실제로 받는 입력을 보고 싶다면, `~/.claude/settings.json`의 hook 명령 앞에 `AI_OFFICE_DUMP=/tmp/hook.jsonl`을 붙이세요. 원본 JSON이 그 파일에 쌓입니다. 프롬프트 원문이 들어가니 확인이 끝나면 지우세요.

## 개인정보

- **hook이 보내는 것:** hook(`hooks/sanitize.mjs`)은 다음 항목만 골라서 로컬 서버로 보냅니다.
  - 이벤트 종류, 세션 ID, 작업 폴더 경로
  - 도구 이름, 파일 **이름**(경로 아님)
  - 에이전트 ID·종류, 알림 종류
  - 대화 기록 파일의 **경로**
- **hook이 보내지 않는 것:** 프롬프트, 응답, 생각, 코드, 파일 내용, Bash 명령, 도구 출력, 에러 메시지
- **서버의 이중 확인:** 서버도 모르는 필드가 들어 있는 이벤트는 거부합니다.
- **상태 줄이 보내는 것:** (설치했을 때만) 5시간·주간 한도의 사용률과 초기화 시각, 보고 시각. 서버는 이 밖의 필드가 있으면 거부합니다.
- **토큰 사용량:** 대화 기록(`~/.claude/projects/**/*.jsonl`)에서 **토큰 수, 모델, 시각만** 읽습니다. 파일은 읽기 전용으로 열고, 내용은 메모리에도 DB에도 남기지 않습니다.

## 설정 (환경 변수)

`pnpm start`나 `pnpm restart` 앞에 붙여 씁니다. 예: `AI_OFFICE_OFF_DUTY_MIN=5 pnpm restart`

| 변수 | 기본값 | 용도 |
|---|---|---|
| `AI_OFFICE_OFF_DUTY_MIN` | `10` | 마지막 활동 후 퇴근까지(분) |
| `AI_OFFICE_RETENTION_DAYS` | `7` | 이벤트(다시보기) 보관 기간 |
| `AI_OFFICE_USAGE_RETENTION_DAYS` | `90` | 토큰 사용량 보관 기간 |
| `AI_OFFICE_DB` | `~/.local/share/ai-office/events.db` | DB 위치 (`XDG_DATA_HOME`을 따름) |
| `AI_OFFICE_MODELS_FILE` | `~/.config/ai-office/models.json` | 모델 한도·단가를 바꿀 파일 |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code 설정 폴더 |
| `HOST` | `127.0.0.1` | 서버·웹을 열 주소 |
| `AI_OFFICE_URL` | `http://127.0.0.1:7420/events` | hook이 보낼 주소 (hook 명령 앞에 붙임) |
| `AI_OFFICE_WEB_ORIGINS` | `http://localhost:7421,http://127.0.0.1:7421` | 서버가 허용하는 웹 주소 |
| `NEXT_PUBLIC_AI_OFFICE_WS` | `ws://localhost:7420/ws` | 웹이 연결할 서버 주소 (빌드할 때 들어가며, 바꾸면 `pnpm start`가 다시 빌드함) |

모델 한도·단가는 `config/models.default.json`이 기본값입니다. 바꿀 값만 `~/.config/ai-office/models.json`에 적고 `pnpm restart`하세요.

```json
{ "models": { "claude-opus-5-5": { "contextLimit": 500000 } } }
```

## 개발

```bash
pnpm dev          # 개발 모드 (server :7420 tsx watch + web :7421 next dev). pnpm start와 포트가 같으니 먼저 pnpm stop
pnpm typecheck
pnpm test
AI_OFFICE_DB=/tmp/demo.db AI_OFFICE_OFF_DUTY_MIN=0.5 pnpm dev   # 임시 DB로 데모
node scripts/simulate.mjs --projects 3 --sessions 2              # 가짜 세션 재생 (서버 실행 중일 때)
```

- **hook 고칠 때:** `hooks/`를 고친 뒤에는 `pnpm hooks:install`을 해야 Claude Code에 반영됩니다. 따로 시험하려면 `echo '{...}' | node hooks/ai-office-hook.mjs`처럼 직접 실행하세요.
- **이벤트 필드를 바꿀 때:** `EVENT_VERSION`(`hooks/sanitize.mjs`)과 `SUPPORTED_EVENT_VERSIONS`(`packages/shared/src/events.ts`)를 함께 올립니다. 서버는 예전 버전을 계속 받아야 합니다.
- **구조와 설계 원칙:** [CLAUDE.md](CLAUDE.md)에 있습니다.

| 경로 | 설명 |
|---|---|
| `packages/shared` | 이벤트 스키마, 상태 reducer, 다시보기 엔진, WS 프로토콜 |
| `apps/server` | 이벤트 수신·SQLite 저장, 사무실 상태, 토큰 사용량, 다시보기 API |
| `apps/web` | Three.js 3D 사무실, 탭, 알림, 사용량 패널, 다시보기, 로그 |
| `hooks/` | Claude Code hook (의존성 없는 plain node) |
| `scripts/` | 켜기·끄기(`office.mjs`), hook 설치·제거, 시뮬레이터, 스크린샷 |

## 에셋

3D 모델은 [Kenney](https://kenney.nl)의 CC0(퍼블릭 도메인) 에셋입니다. 각 폴더에 원본 `License.txt`가 있습니다.

- [Furniture Kit](https://kenney.nl/assets/furniture-kit): `apps/web/public/assets/kenney/furniture/`
- [Mini Characters](https://kenney.nl/assets/mini-characters): `apps/web/public/assets/kenney/characters/`

바닥 무늬와 모니터 화면은 코드로 그립니다.
