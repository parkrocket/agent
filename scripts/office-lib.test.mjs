import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive, needsBuild, newestMtime, portOpen, procFiles, readPid } from "./office-lib.mjs";

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "ai-office-run-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const at = (path, seconds) => utimesSync(path, seconds, seconds);

test("needsBuild: missing build, other baked-in settings, newer sources; up to date otherwise", (t) => {
  const root = tempDir(t);
  const src = join(root, "src");
  const dist = join(root, ".next-prod");
  mkdirSync(join(src, "nested", "node_modules"), { recursive: true });
  writeFileSync(join(src, "a.ts"), "");
  writeFileSync(join(src, "nested", "b.ts"), "");
  at(join(src, "a.ts"), 1000);
  at(join(src, "nested", "b.ts"), 2000);
  const stamp = { ws: "" };

  assert.equal(needsBuild(dist, [src], stamp), "빌드 없음");
  mkdirSync(dist);
  writeFileSync(join(dist, "BUILD_ID"), "x");
  at(join(dist, "BUILD_ID"), 3000);
  assert.equal(needsBuild(dist, [src], stamp), "빌드 기록 없음");
  writeFileSync(join(dist, "ai-office-build.json"), JSON.stringify(stamp));
  assert.equal(needsBuild(dist, [src], stamp), undefined);
  assert.equal(needsBuild(dist, [src], { ws: "ws://other:7420/ws" }), "빌드 설정(NEXT_PUBLIC_*) 바뀜");

  // node_modules inside sources doesn't count
  writeFileSync(join(src, "nested", "node_modules", "dep.js"), "");
  at(join(src, "nested", "node_modules", "dep.js"), 9000);
  assert.equal(newestMtime([src]), 2000 * 1000);
  assert.equal(needsBuild(dist, [src], stamp), undefined);

  at(join(src, "nested", "b.ts"), 4000);
  assert.equal(needsBuild(dist, [src], stamp), "소스가 빌드보다 새로움");
  assert.equal(newestMtime([join(root, "missing")]), 0);
});

test("pid files and liveness", (t) => {
  const env = { XDG_DATA_HOME: tempDir(t) };
  const { pid, log } = procFiles("server", env);
  assert.ok(pid.endsWith(join("ai-office", "run", "server.pid")));
  assert.ok(log.endsWith("server.log"));
  assert.equal(readPid(pid), undefined);
  mkdirSync(join(pid, ".."), { recursive: true });
  writeFileSync(pid, `${process.pid}\n`);
  assert.equal(readPid(pid), process.pid);
  assert.equal(alive(process.pid), true);
  writeFileSync(pid, "garbage");
  assert.equal(readPid(pid), undefined);
  assert.equal(alive(undefined), false);
});

test("portOpen sees a listening port", async (t) => {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const { port } = server.address();
  assert.equal(await portOpen(port), true);
  server.close();
  await new Promise((r) => server.once("close", r));
  assert.equal(await portOpen(port), false);
});
