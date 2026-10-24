# AI Office

Claude Code 세션을 픽셀아트 사무실로 실시간 시각화하는 프로그램. 메인 에이전트는 팀장 책상에 앉고, 서브에이전트는 직원으로 문에서 걸어 들어와 빈 책상에 앉았다가 일이 끝나면 나간다.
- 사무실 전체는 한 층짜리 건물이다. 엘리베이터·안내 데스크·라운지·회의실이 있는 공용 구역 옆으로, 프로젝트(cwd)마다 방이 하나씩 복도를 따라 붙는다.
- 같은 프로젝트의 세션들은 한 방에서 팀 구역을 나눠 쓴다.
- 캐릭터는 엘리베이터에서 내려 복도를 걸어 자기 방으로 출근하고, 오래 조용하면 엘리베이터로 퇴근한다.

```
Claude Code hook ──POST /events──▶ apps/server (Fastify :7420) ──WebSocket /ws──▶ apps/web (Next.js :7421)
```

## 구조

| 경로 | 설명 |
|---|---|
| `packages/shared` | `OfficeEvent` 타입·zod 스키마, 상태 reducer(`office.ts`), WS 프로토콜 |
| `apps/server` | 이벤트 수신·SQLite 저장, 방/세션 상태 관리, 퇴근 처리, WebSocket 브로드캐스트 |
| `apps/web` | Three.js 3D 사무실(로비/집중 보기), 방 탭, 승인 대기 알림, 이벤트 로그 |
| `hooks/` | Claude Code hook 스크립트 (의존성 없음) |
| `scripts/` | hook 설치/제거, 시뮬레이터(`simulate.mjs`), 스크린샷(`screenshot.mjs`) |

## 실행

```bash
pnpm install
pnpm dev            # server :7420 + web :7421
```

Windows 브라우저에서 http://localhost:7421 접속 (WSL2 localhost 포워딩).
포워딩이 안 되면 `HOST=0.0.0.0 pnpm dev`로 실행.

실제 Claude 세션 없이 보려면 서버를 띄운 상태에서 시뮬레이터를 실행하세요. 시뮬레이션 이벤트도 DB에 저장되니, 데모는 임시 DB로 띄우는 것이 좋습니다.

```bash
AI_OFFICE_DB=/tmp/ai-office-demo.db AI_OFFICE_OFF_DUTY_MIN=0.5 pnpm dev
node scripts/simulate.mjs --projects 3 --sessions 2
```

## 화면

- **로비 / 집중 보기:** 로비는 건물 한 층 전체를 보여줍니다. 방을 클릭하거나 탭을 고르면 카메라가 그 방으로 다가가고, 방 밖을 클릭하면 로비로 돌아옵니다. 근무 중인 방이 3개 이상이면 자동으로 한 방에 집중합니다.
  - 자동 모드는 지금 보는 방이 바쁜 동안 화면을 바꾸지 않습니다.
- **방 탭:** 상태 점으로 방 상태를 보여줍니다.
  - 빨강 깜빡임: 손 든 에이전트가 있음
  - 초록: 작업 중
  - 회색: 휴식
  - 흐림: 모두 퇴근
- **🔔 알림:** 켜면 에이전트가 손을 들 때(권한 승인·입력 대기) 브라우저 알림이 뜹니다. 알림을 클릭하면 그 방으로 이동합니다. 같은 대기로는 한 번만 뜨고, 대기 중에는 탭 제목이 "(!) AI 오피스"로 깜빡입니다.
- **퇴근:** 마지막 이벤트 후 10분이 지나면 팀장과 직원이 문으로 나갑니다. 권한 승인을 기다리는 세션은 예외입니다.

## 캐릭터 상태

| 상태 | 언제 | 화면 |
|---|---|---|
| 휴식 | 세션 시작 직후, 완료 후 30초 지남 | 고개 숙여 졸며 z, 회색 링 |
| 생각 중 | 요청을 받았거나 도구 사이 | 말풍선 "…" |
| 읽는 중 | Read / Grep / Glob / WebFetch / WebSearch | 고개 숙임, 파란 화면, 파란 링 |
| 작성 중 | Edit / Write / NotebookEdit | 타이핑, 노란 화면, 노란 링 |
| 실행 중 | Bash | 타이핑, 초록 터미널, 초록 링 |
| 손 듦 | 권한 요청, 입력 대기 알림 | 손 들기 + "!" + 승인 대기 말풍선, 깜빡이는 빨간 링 |
| 완료 | Stop | 끄덕이며 "완료!", 보라 링 |

## 에셋

3D 모델은 [Kenney](https://kenney.nl)의 CC0(퍼블릭 도메인) 에셋을 씁니다. 각 폴더에 원본 `License.txt`가 들어 있습니다.

- [Furniture Kit](https://kenney.nl/assets/furniture-kit): 책상, 의자, 모니터, 벽, 문, 창문, 소품 (`apps/web/public/assets/kenney/furniture/`)
- [Mini Characters](https://kenney.nl/assets/mini-characters): 팀장·직원 캐릭터와 애니메이션 (`apps/web/public/assets/kenney/characters/`)

바닥 무늬와 모니터 화면은 코드로 그립니다.

## hook 설치 / 제거

```bash
pnpm hooks:install --dry-run   # 결과만 출력, 파일 변경 없음
pnpm hooks:install             # 백업(settings.json.bak-YYYYMMDD-HHmmss) 후 병합
pnpm hooks:uninstall           # AI Office hook만 제거 (다른 hook은 유지)
```

설치 후 **새로 시작한** Claude Code 세션부터 적용됩니다.

## 개인정보

hook 스크립트(`hooks/sanitize.mjs`)가 화이트리스트 필드만 복사해서 전송합니다.
전송: 이벤트 종류, session_id, cwd, 도구 이름, 파일 **basename**, agent id/type, notification_type 등.
전송 안 함: 프롬프트, 파일 내용, Bash 명령, 도구 출력, 에러 메시지, 어시스턴트 메시지, transcript 경로.
서버도 strict 스키마라 알 수 없는 필드가 오면 거부합니다.

## Claude Code를 막지 않는 장치

- 설정에 `"async": true` → 백그라운드 실행, Claude Code가 기다리지 않음
- 전송 타임아웃 300ms, 전체 1.5초 강제 종료, stdout 출력 없음, 항상 exit 0

## 토큰 사용량

Claude Code 대화 기록(`~/.claude/projects/**/*.jsonl`)에서 **토큰 수만** 읽어 보여줍니다. 프롬프트, 응답, 코드 같은 내용은 읽지도 저장하지도 않고, 파일은 읽기 전용으로만 엽니다.

- **컨텍스트 게이지:** 캐릭터 이름표 옆에 `12% · 120K`(모델 한도 대비 %와 실제 토큰 수)를 표시합니다. 80% 이상은 주황, 95% 이상은 빨강입니다.
- **📊 사용량 패널:** 오늘 합계, 방별·세션별 누적, 모델 한도·단가 표를 보여줍니다. 비용 환산은 기본으로 꺼져 있고, 켜면 API 정가 기준 추정치와 단가 기준일을 함께 표시합니다(구독 요금제와는 무관).
- **과거 기록 가져오기:** 패널의 버튼이나 `pnpm usage:import`로 hook 설치 전 세션까지 통계에 넣습니다. 몇 번 실행해도 중복되지 않습니다.
- **한도·단가 바꾸기:** `config/models.default.json`이 기본값입니다(공식 문서 확인일 포함, 확인하지 못한 한도는 "미확인"). 바꾸고 싶은 값만 `~/.config/ai-office/models.json`에 같은 형태로 적고 서버를 다시 시작하세요.

```json
{ "models": { "claude-opus-5-5": { "contextLimit": 500000 } } }
```

## 환경 변수

| 변수 | 기본값 | 용도 |
|---|---|---|
| `AI_OFFICE_DB` | `~/.local/share/ai-office/events.db` | 이벤트 DB 위치 (`XDG_DATA_HOME`을 따름) |
| `AI_OFFICE_RETENTION_DAYS` | `7` | 이벤트 보관 기간 |
| `AI_OFFICE_OFF_DUTY_MIN` | `10` | 마지막 이벤트 후 퇴근까지 시간(분, 소수 가능) |
| `AI_OFFICE_USAGE_RETENTION_DAYS` | `90` | 토큰 사용량 보관 기간 |
| `AI_OFFICE_MODELS_FILE` | `~/.config/ai-office/models.json` | 모델 한도·단가 덮어쓰기 파일 |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code 설정 폴더(대화 기록은 그 아래 `projects/`) |
| `AI_OFFICE_URL` | `http://127.0.0.1:7420/events` | hook 전송 주소 |
| `AI_OFFICE_DUMP` | (없음) | 원본 hook JSON을 이 로컬 파일에 기록 (디버그용, 프롬프트 포함됨) |
| `HOST` / `PORT` | `127.0.0.1` / `7420` | 서버 바인딩 |
| `AI_OFFICE_WEB_ORIGINS` | `http://localhost:7421,http://127.0.0.1:7421` | CORS / WS 허용 origin |
| `NEXT_PUBLIC_AI_OFFICE_WS` | `ws://localhost:7420/ws` | 웹이 연결할 WS 주소 |
