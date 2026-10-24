import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/** Where Claude Code keeps transcripts: $CLAUDE_CONFIG_DIR/projects or ~/.claude/projects. */
export function projectsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
}

/**
 * Resolves a transcript path from a hook event, or undefined if it isn't a
 * .jsonl file inside the projects root. /events is open to any local process,
 * so without this check it would be a way to make the server read any file.
 */
export function allowedTranscript(root: string, path: string): string | undefined {
  if (!path.endsWith(".jsonl")) return undefined;
  const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  let real: string;
  let realRoot: string;
  try {
    real = realpathSync(resolve(expanded)); // follows symlinks, so a link can't point outside
    realRoot = realpathSync(root);
  } catch {
    return undefined;
  }
  return real.startsWith(realRoot + sep) ? real : undefined;
}
