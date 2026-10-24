import { closeSync, openSync, readSync, statSync } from "node:fs";
import { parseUsageLine, type UsageRecord } from "@ai-office/shared";

export interface ReadPosition {
  offset: number;
  ino: number;
}

const CHUNK = 8 * 1024 * 1024;

/**
 * Reads the complete lines appended since `prev` (read-only; the file is never
 * written). A trailing line without a newline is left for the next read. A
 * replaced (different inode) or truncated file is read again from the start;
 * records are deduplicated by message id downstream, so rereads are harmless.
 */
export function readIncrement(path: string, prev: ReadPosition | undefined): { records: UsageRecord[]; next: ReadPosition } {
  const st = statSync(path);
  let offset = prev && prev.ino === st.ino && prev.offset <= st.size ? prev.offset : 0;
  const records: UsageRecord[] = [];
  if (offset === st.size) return { records, next: { offset, ino: st.ino } };

  const fd = openSync(path, "r");
  try {
    let carry = Buffer.alloc(0);
    let pos = offset;
    const buf = Buffer.alloc(Math.min(CHUNK, st.size - offset));
    while (pos < st.size) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, st.size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const last = data.lastIndexOf(0x0a);
      if (last < 0) {
        carry = Buffer.from(data);
        continue;
      }
      for (const line of data.subarray(0, last).toString("utf8").split("\n")) {
        const r = parseUsageLine(line);
        if (r) records.push(r);
      }
      // consumed = everything read so far except the bytes after the last newline
      offset = pos - (data.length - (last + 1));
      carry = Buffer.from(data.subarray(last + 1));
    }
  } finally {
    closeSync(fd);
  }
  return { records, next: { offset, ino: st.ino } };
}
