import { openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, existsSync, lstatSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { SnapshotSchema, ToolError } from "./model.ts";
import { readHistory } from "./analysis.ts";

export function writeAtomic(path: string, data: unknown) {
  const temporary = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(data) + "\n");
    fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw new ToolError("WRITE_FAILED", `Could not atomically write ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function appendRotating(path: string, data: unknown, maxBytes = 8 * 1024 * 1024) {
  const line = JSON.stringify(data) + "\n";
  const bytes = Buffer.byteLength(line);
  if (bytes > maxBytes) throw new ToolError("RECORD_TOO_LARGE", "A single snapshot exceeds the log size limit. Disable --raw.");
  try {
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new ToolError("INVALID_LOG", "Log path must be a regular file, not a symlink.");
      if (stat.size + bytes > maxBytes) {
        if (existsSync(`${path}.2`)) unlinkSync(`${path}.2`);
        if (existsSync(`${path}.1`)) renameSync(`${path}.1`, `${path}.2`);
        renameSync(path, `${path}.1`);
      }
    }
    appendFileSync(path, line, { mode: 0o600 });
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("LOG_WRITE_FAILED", `Could not append log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function latest(path: string, maxAgeSeconds: number, now = Date.now()) {
  const samples = readHistory(path);
  if (samples.length !== 1) throw new ToolError("INVALID_LATEST", "The latest file must contain exactly one snapshot.");
  const sample = SnapshotSchema.parse(samples[0]);
  const ageMs = now - Date.parse(sample.timestamp);
  if (!Number.isFinite(ageMs) || ageMs < -5000) throw new ToolError("CLOCK_SKEW", "Snapshot time is invalid or in the future.", 6);
  if (ageMs > maxAgeSeconds * 1000) throw new ToolError("STALE_SNAPSHOT", `Snapshot is ${Math.round(ageMs / 1000)} seconds old.`, 6,
    "Check that monitor is still running, or explicitly increase --max-age.", true);
  return { ...sample, freshness: { ageMs: Math.max(0, ageMs), maxAgeSeconds, stale: false as const, readFromFile: true as const } };
}

export function acquireLock(path: string): () => void {
  const lock = `${path}.lock`;
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); } finally { closeSync(fd); }
      return () => {
        try { if (JSON.parse(readFileSync(lock, "utf8")).token === token) unlinkSync(lock); } catch {}
      };
    } catch (error) {
      if (!existsSync(lock)) throw new ToolError("LOCK_FAILED", `Cannot create lock ${lock}.`);
      try {
        if (lstatSync(lock).isSymbolicLink()) throw new Error("symlink");
        const owner = JSON.parse(readFileSync(lock, "utf8"));
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== "string") throw new Error("owner");
        try { process.kill(owner.pid, 0); }
        catch (failure: any) {
          if (failure.code === "ESRCH") { unlinkSync(lock); continue; }
        }
      } catch {}
      throw new ToolError("COLLECTOR_BUSY", `Another collector may own ${lock}.`, 5,
        "Use the running collector's latest file, or verify the lock owner before removing an abandoned lock.", true);
    }
  }
  throw new ToolError("LOCK_FAILED", `Could not acquire ${lock}.`);
}
