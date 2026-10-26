# scripts/

**설치 스크립트** (`settings-lib.mjs`): hook(`HOOK_FILES`)을 `~/.local/share/ai-office/hook/`(`XDG_DATA_HOME`)에 복사하고 그 사본을 등록한다.
- 그래서 작업 폴더에서 브랜치를 바꿔도 실행 중인 Claude 세션의 hook은 그대로이고, hook 변경은 `pnpm hooks:install`을 다시 해야 반영된다.
- 복사는 파일별로 임시 파일에 쓴 뒤 rename하고(실행 중인 hook이 반쯤 쓴 파일을 읽지 않게), 설치 내역은 `version.json`(이벤트 버전, 커밋, 파일 해시)에 남긴다.
- 설치는 복사 후 settings 쓰기, 제거는 settings 쓰기 후 사본 삭제 순서다. 설정 파일 쓰기 전에 `settings.json.bak-<시각>`으로 백업한다.
- command 문자열에 `ai-office-hook.mjs`가 들어 있는지로 자기 항목을 식별하므로, 다시 설치하면 교체되고 제거할 때 다른 사용자 hook은 남는다. JSON을 파싱하지 못하면 덮어쓰지 않고 중단한다. `--settings <path>`로 다른 파일을 대상으로 지정할 수 있다.
- command에는 `process.execPath`로 얻은 node 절대경로가 들어가므로, nvm으로 node 버전을 바꾸면 다시 설치해야 한다.

**실행 스크립트** (`office.mjs`, 순수 부분은 `office-lib.mjs`): `pnpm start`는 서버(`node --import tsx`, watch 없음)와 웹(`next start`)을 detached 프로세스 그룹으로 띄우고 pid·로그를 `~/.local/share/ai-office/run/`에 둔다.
- 웹은 `AI_OFFICE_WEB_DIST=.next-prod`로 빌드해 `next dev`의 `.next`와 겹치지 않게 하고, 소스가 빌드보다 새롭거나 `NEXT_PUBLIC_*`(빌드에 박힘)가 바뀌었을 때만 다시 빌드한다. `next build`가 `next-env.d.ts`를 자기 출력 폴더로 바꿔 쓰므로 빌드 뒤 원래 내용으로 되돌린다.
- `pnpm stop`은 그룹에 SIGTERM(5초 뒤 SIGKILL)을 보내고(Windows는 `taskkill /T /F`), 서버는 SIGTERM에 `app.close()`로 DB를 닫는다. 포트가 이미 쓰이면(`pnpm dev`) 시작하지 않는다.
- `pnpm status`가 hook·상태 줄 설치 상태와 이벤트 거부 수를 보여 준다.

**스크린샷** (`screenshot.mjs`, Playwright):
- 새 PC에서는 먼저 `pnpm exec playwright install chromium`으로 브라우저를 받는다.
- WSL에서 headless Chromium을 쓰려면 sudo 없이 받아 둔 라이브러리와 폰트가 필요하다(`~/.cache/ai-office-libs`). `LD_LIBRARY_PATH=~/.cache/ai-office-libs/root/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=~/.cache/ai-office-libs/fonts.conf node scripts/screenshot.mjs ...` 형태로 실행한다.
- 이 Claude 세션 자신의 이벤트도 들어오므로, 시뮬레이션을 찍을 때는 `--view lobby` 또는 `--view <방 cwd>`로 화면을 고정한다.
- 3D는 캐릭터가 작아서 세부를 볼 때는 `--scale 2` 이상으로 찍어 잘라 본다. `--ls ai-office.log=collapsed`로 로그를 접으면 사무실이 크게 나온다.
- 브라우저 콘솔 오류·경고는 `[console.error]`/`[pageerror]`로 출력된다.
