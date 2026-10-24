#!/usr/bin/env node
// Runs AI Office for everyday use: server + production web build in the background.
// Usage: node scripts/office.mjs start | stop | restart | status
//   pnpm start    builds the web app when its sources changed, then starts both (logs: ~/.local/share/ai-office/run/)
//   pnpm stop     stops both
//   pnpm status   processes, server health (rejected events), installed hook, DB and log locations
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  PROD_DIST,
  SERVER_PORT,
  WEB_PORT,
  WEB_SOURCES,
  alive,
  buildStamp,
  needsBuild,
  portOpen,
  procFiles,
  readPid,
  runDir,
  serverDir,
  webDir,
} from "./office-lib.mjs";
import { HOOK_EVENTS, dataDir, hookState, installedHookDir, installedStatuslineDir, parseArgs, readSettings, statuslineState } from "./settings-lib.mjs";

const HOST = process.env.HOST ?? "127.0.0.1";
const NAMES = ["server", "web"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const home = (p) => p.replace(homedir(), "~");
const pad = (n) => String(n).padStart(2, "0");
const localTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "?" : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const nextBin = () => createRequire(join(webDir, "package.json")).resolve("next/dist/bin/next");

async function health() {
  try {
    const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

function launch(name, args, cwd, env) {
  const { pid, log } = procFiles(name);
  const fd = openSync(log, "a");
  writeFileSync(fd, `\n--- ${new Date().toISOString()} start ${name} ---\n`);
  // detached: its own process group, so `stop` can end it with everything it spawned
  // (on Windows: outlives the terminal; windowsHide keeps it from opening a console window)
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  writeFileSync(pid, String(child.pid));
  return child.pid;
}

async function start() {
  const running = NAMES.filter((n) => alive(readPid(procFiles(n).pid)));
  if (running.length === NAMES.length) {
    console.log("이미 실행 중입니다.");
    return status();
  }
  if (running.length) await stop(); // half running: start over cleanly

  for (const port of [SERVER_PORT, WEB_PORT]) {
    if (await portOpen(port)) {
      console.error(`✗ 포트 ${port}를 다른 프로세스가 쓰고 있습니다. pnpm dev가 떠 있다면 먼저 끄세요.`);
      process.exit(1);
    }
  }

  const dist = join(webDir, PROD_DIST);
  const stamp = buildStamp();
  const reason = needsBuild(dist, WEB_SOURCES, stamp);
  if (reason) {
    console.log(`웹 빌드 중 (${reason})… 처음에는 1~2분 걸립니다.`);
    // next build points next-env.d.ts at its own output folder; keep the checked-in one (dev's .next)
    const nextEnv = join(webDir, "next-env.d.ts");
    const nextEnvBefore = existsSync(nextEnv) ? readFileSync(nextEnv, "utf8") : undefined;
    const res = spawnSync(process.execPath, [nextBin(), "build"], {
      cwd: webDir,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, AI_OFFICE_WEB_DIST: PROD_DIST, NEXT_TELEMETRY_DISABLED: "1" },
    });
    if (nextEnvBefore !== undefined) writeFileSync(nextEnv, nextEnvBefore);
    if (res.status !== 0) {
      console.error("✗ 웹 빌드 실패.");
      process.exit(1);
    }
    writeFileSync(join(dist, "ai-office-build.json"), JSON.stringify(stamp) + "\n");
  }

  mkdirSync(runDir(), { recursive: true });
  launch("server", ["--import", "tsx", "src/index.ts"], serverDir, { NODE_ENV: "production" });
  launch("web", [nextBin(), "start", "-p", String(WEB_PORT), "-H", HOST], webDir, {
    NODE_ENV: "production",
    AI_OFFICE_WEB_DIST: PROD_DIST,
    NEXT_TELEMETRY_DISABLED: "1",
  });

  for (let i = 0; i < 60; i++) {
    if ((await health()) && (await portOpen(WEB_PORT))) {
      console.log(`✓ 실행 중: http://localhost:${WEB_PORT}  (끄기: pnpm stop, 상태: pnpm status)`);
      return;
    }
    if (!NAMES.every((n) => alive(readPid(procFiles(n).pid)))) break;
    await wait(500);
  }
  console.error(`✗ 시작하지 못했습니다. 로그: ${home(runDir())}`);
  for (const n of NAMES) {
    const { log } = procFiles(n);
    if (existsSync(log)) console.error(`--- ${n}.log (끝부분) ---\n${readFileSync(log, "utf8").split("\n").slice(-15).join("\n")}`);
  }
  await stop();
  process.exit(1);
}

async function stop() {
  let stopped = 0;
  for (const name of [...NAMES].reverse()) {
    const file = procFiles(name).pid;
    const pid = readPid(file);
    if (alive(pid) && process.platform === "win32") {
      // No process groups or SIGTERM on Windows: end the tree. SQLite (WAL) keeps every committed event.
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      for (let i = 0; i < 20 && alive(pid); i++) await wait(250);
      stopped++;
    } else if (alive(pid)) {
      const signal = (sig) => {
        try {
          process.kill(-pid, sig); // the whole group
        } catch {
          try {
            process.kill(pid, sig);
          } catch {}
        }
      };
      signal("SIGTERM");
      for (let i = 0; i < 20 && alive(pid); i++) await wait(250);
      if (alive(pid)) signal("SIGKILL");
      stopped++;
    }
    rmSync(file, { force: true });
  }
  console.log(stopped ? "✓ 껐습니다." : "실행 중인 AI 오피스가 없습니다 (pnpm start로 띄운 것 기준).");
  const busy = [];
  for (const port of [SERVER_PORT, WEB_PORT]) if (await portOpen(port)) busy.push(port);
  if (busy.length) console.log(`참고: 포트 ${busy.join(", ")}가 아직 열려 있습니다. pnpm dev로 띄운 개발 서버일 수 있습니다.`);
}

async function status() {
  console.log("AI 오피스 상태");
  const h = await health();
  for (const [name, port, label] of [
    ["server", SERVER_PORT, "서버"],
    ["web", WEB_PORT, "웹  "],
  ]) {
    const pid = readPid(procFiles(name).pid);
    const up = alive(pid);
    const open = await portOpen(port);
    const url = name === "web" ? `http://localhost:${port}` : `http://127.0.0.1:${port}`;
    if (up && open) console.log(`  ${label}  ● 실행 중  pid ${pid}  ${url}`);
    else if (up) console.log(`  ${label}  ◐ 시작 중이거나 응답 없음  pid ${pid}`);
    else if (open) console.log(`  ${label}  ● 포트 ${port} 열림 (pnpm start로 띄운 것은 아님: pnpm dev?)`);
    else console.log(`  ${label}  ○ 꺼짐`);
  }
  if (h) {
    const r = h.rejected ?? {};
    const warn = (r.version?.count ?? 0) > 0;
    console.log(
      `  이벤트 v${h.eventVersion} (지원: ${h.supportedEventVersions?.join(", ")})  거부: 버전 ${r.version?.count ?? 0} · 형식 ${r.schema?.count ?? 0}` +
        (warn ? `\n        ⚠ 지원하지 않는 버전(v${r.version.lastVersion})의 이벤트가 왔습니다. 서버와 hook 버전을 맞추세요: pnpm hooks:install 후 pnpm restart` : ""),
    );
  }

  const { settingsPath } = parseArgs([]);
  let settings = {};
  try {
    settings = readSettings(settingsPath);
  } catch (err) {
    console.log(`  hook  ? ${home(settingsPath)}를 읽을 수 없음: ${err.message}`);
  }
  const hook = hookState(settings);
  const v = hook.version;
  const detail = v ? ` (v${v.eventVersion}${v.commit ? `, ${v.commit}` : ""}, ${localTime(v.installedAt)} 설치)` : "";
  if (!hook.registered.length) console.log("  hook  ✗ 설치 안 됨 → pnpm hooks:install");
  else if (!hook.usesCopy) console.log("  hook  ⚠ 작업 폴더의 hook을 직접 실행 중(예전 방식) → pnpm hooks:install");
  else if (!hook.copyPresent) console.log(`  hook  ✗ 등록은 됐지만 사본이 없음 (${home(installedHookDir())}) → pnpm hooks:install`);
  else if (!hook.matchesRepo) console.log(`  hook  ⚠ 설치된 사본${detail}이 작업 폴더 hooks/와 다름 → 반영하려면 pnpm hooks:install`);
  else console.log(`  hook  ✓ ${home(installedHookDir())}${detail}`);
  if (hook.registered.length && hook.events < HOOK_EVENTS.length) console.log(`        일부 이벤트만 등록됨 (${hook.events}개) → pnpm hooks:install`);

  // optional: without it the office just shows no plan limits
  const line = statuslineState(settings);
  if (line.registered === "none") console.log("  상태 줄 - 설치 안 됨 (선택: 요금제 한도 표시 → pnpm statusline:install)");
  else if (line.registered === "other") console.log("  상태 줄 - 다른 상태 줄 사용 중 (요금제 한도 표시 안 됨)");
  else if (!line.copyPresent) console.log(`  상태 줄 ✗ 등록은 됐지만 사본이 없음 (${home(installedStatuslineDir())}) → pnpm statusline:install`);
  else if (!line.matchesRepo) console.log("  상태 줄 ⚠ 설치된 사본이 작업 폴더 hooks/와 다름 → 반영하려면 pnpm statusline:install");
  else console.log(`  상태 줄 ✓ ${home(installedStatuslineDir())}`);

  console.log(`  DB    ${home(process.env.AI_OFFICE_DB || join(dataDir(), "events.db"))}`);
  console.log(`  로그  ${home(runDir())}`);
}

const commands = { start, stop, status, restart: async () => (await stop(), start()) };
const cmd = commands[process.argv[2] ?? ""];
if (!cmd) {
  console.error("사용법: node scripts/office.mjs start | stop | restart | status");
  process.exit(1);
}
await cmd();
