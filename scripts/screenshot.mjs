#!/usr/bin/env node
// Takes a headless screenshot of the web app and prints browser console errors.
// Usage: node scripts/screenshot.mjs <out.png> [--url URL] [--wait ms] [--size 1280x800] [--reload]
//        [--pin <sessionId>] [--shots N --every ms]   (shots are saved as out-1.png, out-2.png, ...)
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const out = args.find((a) => a.endsWith(".png"));
if (!out) {
  console.error("usage: node scripts/screenshot.mjs <out.png> [--url URL] [--wait ms] [--size WxH] [--reload]");
  process.exit(1);
}
const url = opt("url", "http://localhost:7421/");
const wait = Number(opt("wait", "1500"));
const [width, height] = opt("size", "1280x800").split("x").map(Number);
const pin = opt("pin", "");
const shots = Number(opt("shots", "1"));
const every = Number(opt("every", "1000"));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
// Pin the session picker so other sessions' events don't switch the view.
if (pin) await page.addInitScript((id) => localStorage.setItem("ai-office.session", id), pin);
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[console.${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
if (args.includes("--reload")) await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(wait);
for (let i = 1; i <= shots; i++) {
  const path = shots > 1 ? out.replace(/\.png$/, `-${i}.png`) : out;
  await page.screenshot({ path });
  console.log(`saved ${path}`);
  if (i < shots) await page.waitForTimeout(every);
}
await browser.close();
