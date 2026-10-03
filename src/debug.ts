// Failures kept in sight. An assert that throws in development (and in the tests); and the errors a
// per-frame section catches to keep the loop alive — counted, and told once each to the console and
// the game's journal, instead of vanishing (a transition between two states that is not atomic shows
// up there).
import { gameLog } from "./game/log";

/** a development build: the dev server, the tests */
export const DEV = typeof location === "undefined" || /^(localhost|127\.|\[::1\])/.test(location.hostname);

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond && DEV) throw new Error(`assert: ${msg}`);
}

const seen = new Map<string, number>();

/** A caught error, reported: the first of each kind told, all counted. */
export function caught(where: string, e: unknown) {
  const msg = `${where}: ${e instanceof Error ? e.message : String(e)}`;
  const n = (seen.get(msg) ?? 0) + 1;
  seen.set(msg, n);
  if (n === 1) {
    console.warn(msg, e);
    gameLog.add("error", msg);
  }
}

/** every caught error so far, with its count */
export const caughtErrors = () => Object.fromEntries(seen);
