import { DEFAULT_OFF_DUTY_MS, DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT } from "@ai-office/shared";
import { buildServer } from "./app";
import { defaultDbPath } from "./db";

const DAY_MS = 24 * 60 * 60_000;

/** Positive number from env, else the fallback (with a warning for bad values). */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  console.warn(`[ai-office] ignoring ${name}=${raw}; using ${fallback}`);
  return fallback;
}

const host = process.env.HOST ?? "127.0.0.1";
const port = envNumber("PORT", DEFAULT_SERVER_PORT);
const webOrigins = (
  process.env.AI_OFFICE_WEB_ORIGINS ??
  `http://localhost:${DEFAULT_WEB_PORT},http://127.0.0.1:${DEFAULT_WEB_PORT}`
).split(",");

const app = await buildServer({
  dbPath: process.env.AI_OFFICE_DB || defaultDbPath(),
  offDutyMs: envNumber("AI_OFFICE_OFF_DUTY_MIN", DEFAULT_OFF_DUTY_MS / 60_000) * 60_000,
  retentionMs: envNumber("AI_OFFICE_RETENTION_DAYS", 7) * DAY_MS,
  webOrigins,
  logLevel: process.env.LOG_LEVEL ?? "warn",
  usageRetentionMs: envNumber("AI_OFFICE_USAGE_RETENTION_DAYS", 90) * DAY_MS,
});
// `pnpm stop` sends SIGTERM: close cleanly so SQLite checkpoints its WAL.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}
await app.listen({ host, port });
console.log(`[ai-office] server on http://${host}:${port}`);
