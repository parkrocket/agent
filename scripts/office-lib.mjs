// Helpers for scripts/office.mjs (pnpm start / stop / status), kept free of side effects where possible so they can be tested.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { dataDir, repoRoot } from "./settings-lib.mjs";

export const SERVER_PORT = 7420;
export const WEB_PORT = 7421;
/** Production build output, separate from `next dev`'s .next so the two never clobber each other. */
export const PROD_DIST = ".next-prod";
export const webDir = join(repoRoot, "apps", "web");
export const serverDir = join(repoRoot, "apps", "server");
/** Everything a web build depends on. */
export const WEB_SOURCES = [
  join(webDir, "app"),
  join(webDir, "components"),
  join(webDir, "lib"),
  join(webDir, "office"),
  join(webDir, "public"),
  join(webDir, "next.config.ts"),
  join(webDir, "package.json"),
  join(repoRoot, "packages", "shared", "src"),
];

export function runDir(env = process.env) {
  return join(dataDir(env), "run");
}

export function procFiles(name, env = process.env) {
  const dir = runDir(env);
  return { pid: join(dir, `${name}.pid`), log: join(dir, `${name}.log`) };
}

/** Newest modification time under the given files/folders (0 if none exist). */
export function newestMtime(paths) {
  let newest = 0;
  const visit = (p) => {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) if (name !== "node_modules" && !name.startsWith(".next")) visit(join(p, name));
    } else newest = Math.max(newest, st.mtimeMs);
  };
  for (const p of paths) visit(p);
  return newest;
}

/** What a build bakes in besides sources: NEXT_PUBLIC_* values are fixed at build time. */
export function buildStamp(env = process.env) {
  return { ws: env.NEXT_PUBLIC_AI_OFFICE_WS ?? "" };
}

/** A web build is needed when there is none, a source is newer than it, or it was built with other baked-in settings. */
export function needsBuild(distDir, sources, stamp) {
  const buildId = join(distDir, "BUILD_ID");
  if (!existsSync(buildId)) return "빌드 없음";
  try {
    const prev = JSON.parse(readFileSync(join(distDir, "ai-office-build.json"), "utf8"));
    if (JSON.stringify(prev) !== JSON.stringify(stamp)) return "빌드 설정(NEXT_PUBLIC_*) 바뀜";
  } catch {
    return "빌드 기록 없음";
  }
  return newestMtime(sources) > statSync(buildId).mtimeMs ? "소스가 빌드보다 새로움" : undefined;
}

export function readPid(file) {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/** True when something accepts connections on 127.0.0.1:port. */
export function portOpen(port, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
