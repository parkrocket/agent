# apps/server

**구성:** `app.ts`의 `buildServer(opts)`가 앱을 만들고, `index.ts`는 환경 변수를 읽어 listen만 한다. 테스트는 `buildServer`에 임시 DB를 넘기고 `inject`/`injectWS`로 검증한다.
- **영속화:** 이벤트는 SQLite(`db.ts`, 내장 `node:sqlite`라 네이티브 빌드 없음)에 저장한다. 위치는 `AI_OFFICE_DB`이고, 기본값은 `$XDG_DATA_HOME` 또는 `~/.local/share/ai-office/events.db`다.
- **기동 순서:** 보관 기간(`AI_OFFICE_RETENTION_DAYS`, 기본 7일)이 지난 이벤트 삭제 → 남은 이벤트를 `ts` 순으로 재생 → sweep → `compactPods`. 보관 기간 정리는 1시간마다 한 번 더 돈다.
- **sweep 주기:** 30초마다 돌고, 바뀐 게 있으면 `{type:"state"}`(전체 sessions/rooms)를 보낸다. 퇴근 시간은 `AI_OFFICE_OFF_DUTY_MIN`(기본 10, 소수 가능)이다.
- **WS 메시지** (타입은 `packages/shared/src/protocol.ts`):
  - `snapshot {events, sessions, rooms, config(offDutyMs, models), usage, limits}`: 접속할 때
  - `event {event, session, room}`: 이벤트마다
  - `state`: sweep이나 세션 정리 후
  - `usage`: 사용량 변화 시(1초에 최대 한 번)
  - `limits`: 더 새로운 요금제 한도 보고가 왔을 때
- **HTTP:** `POST /events`(hook), `POST /limits`(상태 줄), `POST /usage/import`(과거 대화 기록 가져오기), `GET /history`(지난 세션 목록), `GET /history/:sessionId/events`(이벤트 + 메시지별 사용량), `GET /health`(이벤트 버전, 거부 수).
- **목록:** `GET /history`는 이벤트(보관 7일)와 사용량(90일)을 세션별로 합친다. 이벤트가 없으면 `replayable: false`("기록만", 재생 불가)다.
- **origin 검사:** `/ws` route의 `preValidation`에서 403으로 막는다. `@fastify/websocket`의 `verifyClient` 옵션을 쓰면 `injectWS`가 끝나지 않아 테스트가 멈추기 때문이다. CORS도 같은 목록(`AI_OFFICE_WEB_ORIGINS`, 기본값 `localhost:7421`·`127.0.0.1:7421`)을 쓴다.
- **그 밖:** 기본 로그 레벨은 `warn`(`LOG_LEVEL`)이다. 기본 바인딩은 `127.0.0.1`이고, WSL 포워딩이 안 될 때만 `HOST=0.0.0.0`을 쓴다.

**사용량** (`src/usage/`, 파서는 `packages/shared/src/transcript.ts`):
- **중복 제거:** 같은 `message.id`가 여러 줄(최대 5줄, usage 동일)로 기록되므로, 메시지 ID로 한 번만 센다(`usage_messages` PK).
- **연결:** 이벤트의 `transcript` 경로는 설계 원칙 2의 검사(`allowedTranscript`)를 통과한 파일만 읽는다.
- **증분 읽기:** `readIncrement`는 파일별 `{offset, inode}`(`transcript_offsets`) 이후의 완전한 줄만 읽는다. 잘린 마지막 줄은 다음 차례로 미룬다. 파일이 바뀌었거나 줄었으면 처음부터 다시 읽는다. 감시는 `fs.watch(recursive)`와 5초 폴링을 함께 쓴다.
- **집계:** `UsageTracker`가 세션·에이전트별 누적, 현재 컨텍스트(마지막 요청의 input + cache_read + cache_write), 시간 단위 버킷(48시간)을 메모리 스냅샷으로 두고 `{type:"usage"}`로 1초에 최대 한 번 보낸다. 사용량 보관은 90일(`AI_OFFICE_USAGE_RETENTION_DAYS`)이다.
- **모델 설정:** `config/models.default.json`(컨텍스트 한도, API 정가, 확인 출처·날짜)에 사용자 파일(`~/.config/ai-office/models.json` 또는 `AI_OFFICE_MODELS_FILE`)을 모델별로 합친다. 공식 문서로 확인하지 못한 한도는 `contextVerified: false`이고 화면에 "미확인"/"?"로 표시한다. Haiku 5.5처럼 프롬프트 길이에 따라 값이 다른 단가는 `priceOverThreshold`로 요청마다 판단한다.

**요금제 한도** (`src/routes/limits.ts`): 스키마가 `.strict()`이고, 초기화 시각이 보고 시각에서 8일 넘게 떨어지면 거부한다.
- 세션마다 자기 마지막 API 응답 시점의 값을 보내고 쉬는 세션도 옛 값을 새 `ts`로 다시 보내므로(초기화 시각이 지난 창은 빠진 채로), 최신 보고가 이기는 방식은 화면이 세션 사이를 오간다(실제로 겪음).
- `mergeLimits`가 창마다 합친다: 초기화 시각이 30분 넘게 늦으면 새 창, 같은 창이면 더 높은 사용률(창 안에서 사용률은 줄지 않음)이 이기고, 보고에 없는 창은 유지한다.
- `ts`는 보고가 모든 창에서 같거나 앞설 때만 갱신해, 옛 값이 "방금 기준"으로 보이지 않게 한다. 바뀐 게 없으면 같은 객체를 돌려줘 저장·전송을 건너뛴다.
- `kv` 테이블에 저장해 재시작해도 남고, `snapshot.limits`(없으면 null)와 `{type:"limits"}`로 보낸다.
