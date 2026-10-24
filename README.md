# AI Office

Claude Code 세션을 픽셀아트 사무실로 실시간 시각화하는 프로그램. (현재 1단계: 텍스트 이벤트 로그)

```
Claude Code hook ──POST /events──▶ apps/server (Fastify :7420) ──WebSocket /ws──▶ apps/web (Next.js :7421)
```

## 구조

| 경로 | 설명 |
|---|---|
| `packages/shared` | `OfficeEvent` 타입·zod 스키마, WS 프로토콜 |
| `apps/server` | 이벤트 수신, 최근 500개 링버퍼, WebSocket 브로드캐스트 |
| `apps/web` | 실시간 이벤트 로그 페이지 |
| `hooks/` | Claude Code hook 스크립트 (의존성 없음) |
| `scripts/` | `~/.claude/settings.json`에 hook 설치/제거 |

## 실행

```bash
pnpm install
pnpm dev            # server :7420 + web :7421
```

Windows 브라우저에서 http://localhost:7421 접속 (WSL2 localhost 포워딩).
포워딩이 안 되면 `HOST=0.0.0.0 pnpm dev`로 실행.

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

## 환경 변수

| 변수 | 기본값 | 용도 |
|---|---|---|
| `AI_OFFICE_URL` | `http://127.0.0.1:7420/events` | hook 전송 주소 |
| `AI_OFFICE_DUMP` | (없음) | 원본 hook JSON을 이 로컬 파일에 기록 (디버그용, 프롬프트 포함됨) |
| `HOST` / `PORT` | `127.0.0.1` / `7420` | 서버 바인딩 |
| `AI_OFFICE_WEB_ORIGINS` | `http://localhost:7421,http://127.0.0.1:7421` | CORS / WS 허용 origin |
| `NEXT_PUBLIC_AI_OFFICE_WS` | `ws://localhost:7420/ws` | 웹이 연결할 WS 주소 |
