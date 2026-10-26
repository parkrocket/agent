---
name: verify
description: PR 전 완료 기준 확인 — typecheck, test, 프로덕션 웹 빌드, 스크린샷까지 순서대로 실행하고 결과를 보고한다. "검증", "확인해줘", "PR 올리기 전", "/verify"에 쓴다.
---

# verify

CLAUDE.md "작업 흐름"의 완료 기준을 순서대로 실행한다. 단계가 실패하면 거기서 멈추고 출력과 함께 보고한다. 고치지 않고 보고만 한다(사용자가 고치라고 하면 고친다).

1. `pnpm typecheck`
2. `pnpm test`
3. **웹 빌드:** `pnpm status`로 지금 무엇이 떠 있는지 본다.
   - `pnpm dev`가 떠 있으면(포트는 쓰이는데 status가 실행 중으로 보지 않음) 멈추고, 개발 서버를 꺼도 되는지 사용자에게 묻는다.
   - 아니면 `pnpm restart`. 소스가 빌드보다 새로우면 `.next-prod`를 다시 빌드한다. 빌드 오류는 `~/.local/share/ai-office/run/`의 웹 로그에서 확인한다.
4. **스크린샷:** `node scripts/screenshot.mjs <스크래치패드>/verify.png --view lobby --ls ai-office.log=collapsed`
   - 출력에 `[console.error]`·`[pageerror]`가 있으면 실패로 보고한다. headless의 `GPU stall due to ReadPixels` 경고는 정상이다.
   - `Executable doesn't exist`면 그 PC에 브라우저가 없는 것이다: `pnpm exec playwright install chromium` 후 다시 찍는다.
   - 이미지를 Read로 열어 직접 본다. 바꾼 화면이 있으면 `--view <방 cwd>`나 `--scale 2`로 한 장 더 찍는다.
5. 단계별 ✓/✗ 표로 보고한다. hook(`hooks/`)을 고친 변경이면 "병합 후 `pnpm hooks:install` 필요"를 덧붙인다.
