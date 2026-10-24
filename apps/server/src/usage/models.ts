import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeModelConfig, type ModelConfig } from "@ai-office/shared";

const DEFAULTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../config/models.default.json");

/** User override file: AI_OFFICE_MODELS_FILE, else ~/.config/ai-office/models.json (optional). */
export function userModelsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_OFFICE_MODELS_FILE || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "ai-office", "models.json");
}

/** Shipped defaults merged with the user's file; a broken user file is reported and ignored. */
export function loadModelConfig(
  userPath = userModelsPath(),
  warn: (msg: string) => void = console.warn,
): ModelConfig {
  const base = JSON.parse(readFileSync(DEFAULTS, "utf8")) as ModelConfig;
  if (!existsSync(userPath)) return base;
  try {
    return mergeModelConfig(base, JSON.parse(readFileSync(userPath, "utf8")));
  } catch (err) {
    warn(`[ai-office] ignoring ${userPath}: ${(err as Error).message}`);
    return base;
  }
}
