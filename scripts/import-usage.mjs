#!/usr/bin/env node
// Asks the running server to scan every Claude Code transcript into the usage stats
// (past sessions included). Only token counts are read; repeated runs add nothing new.
// Usage: node scripts/import-usage.mjs   (AI_OFFICE_SERVER=http://127.0.0.1:7420 to override)
const base = process.env.AI_OFFICE_SERVER ?? "http://127.0.0.1:7420";
try {
  const res = await fetch(`${base}/usage/import`, { method: "POST" });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { files, added } = await res.json();
  console.log(`checked ${files} transcript(s), added ${added} new message(s)`);
} catch (err) {
  console.error(`import failed: ${err.message} (is the server running? pnpm dev)`);
  process.exit(1);
}
