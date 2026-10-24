/** Counts events refused by POST /events, so `pnpm status` can tell a silent "no events" apart from a version mismatch. */
export interface RejectionStats {
  /** `v` the server doesn't support (usually a hook installed from a newer or much older checkout). */
  version: { count: number; lastAt?: number; lastVersion?: unknown };
  /** Supported `v` but the body failed the strict schema. */
  schema: { count: number; lastAt?: number };
}

export function newRejectionStats(): RejectionStats {
  return { version: { count: 0 }, schema: { count: 0 } };
}
