#!/usr/bin/env node
// Claude Code hook: forwards a sanitized event to the local AI Office server.
// Must never block or slow Claude Code: no stdout, hard deadline, always exit 0.
import { appendFileSync } from "node:fs";
import { sanitize } from "./sanitize.mjs";

setTimeout(() => process.exit(0), 1500).unref();

const SERVER_URL = process.env.AI_OFFICE_URL ?? "http://127.0.0.1:7420/events";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const text = await readStdin();
  const raw = JSON.parse(text);
  // Debug only: raw payload (may include prompts) stays in a local file.
  if (process.env.AI_OFFICE_DUMP) {
    try {
      appendFileSync(process.env.AI_OFFICE_DUMP, text.trim() + "\n");
    } catch {}
  }
  const event = sanitize(raw);
  if (!event) return;
  await fetch(SERVER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(300),
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
