import { promises as fsp, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

/**
 * Per-file mutex chain. JSONL appends are not POSIX-atomic past PIPE_BUF
 * (4KB Linux / 512B macOS) and an Express server can have several in-flight
 * tool calls writing concurrently. Serialise via an in-memory promise chain;
 * one chain per absolute file path. Single-process Node only.
 */
const queues = new Map<string, Promise<unknown>>();

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Append a single JSON object as one line to a JSONL file under a per-file mutex. */
export function appendJsonl(path: string, obj: unknown): Promise<void> {
  ensureDir(path);
  const line = JSON.stringify(obj) + "\n";
  const prev = queues.get(path) ?? Promise.resolve();
  const next = prev.then(() => fsp.appendFile(path, line));
  // Swallow errors on the chained version so a single failure doesn't
  // poison every subsequent write. Callers can still observe via the
  // returned promise.
  queues.set(path, next.catch(() => {}));
  return next;
}
