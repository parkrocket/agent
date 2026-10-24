#!/usr/bin/env node
// Claude Code status line: prints model · context · plan limits, and forwards
// only the limit numbers to the local AI Office server. Never fails loudly:
// hard deadline, errors swallowed, always exit 0.
import { extractLimits, statusLine } from "./limits.mjs";

setTimeout(() => process.exit(0), 1500).unref();

const SERVER_URL = process.env.AI_OFFICE_LIMITS_URL ?? "http://127.0.0.1:7420/limits";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = JSON.parse(await readStdin());
  // stdout is what Claude Code shows; print before the (slower) network call
  process.stdout.write(statusLine(raw));
  const limits = extractLimits(raw);
  if (!limits) return;
  await fetch(SERVER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(limits),
    signal: AbortSignal.timeout(300),
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
