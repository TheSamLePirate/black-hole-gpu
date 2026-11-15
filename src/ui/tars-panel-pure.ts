// TARS's console's decisions that touch no page (audit 2026-11-10, QA-10: src/ui/tars-panel.ts — 1 132 lines — never imported by a
// test): what was asked kept (no repeat in a row, the last 60), stepped through with ↑ ↓ as a shell's history, a waking of his own named
// in the exchanges. Moved out of tars-panel.ts as they were; tested in tests/tars-panel-pure.test.ts.

export const HISTORY_MAX = 60;

/** A question kept in what was asked (the list changed in place): not twice in a row, the last `max` kept. True when kept. */
export function rememberAsked(asked: string[], q: string, max = HISTORY_MAX): boolean {
  if (asked.at(-1) === q) return false;
  asked.push(q);
  asked.splice(0, Math.max(0, asked.length - max));
  return true;
}

/**
 * A step through what was asked with ↑ (`up`) or ↓, from `at` (−1: the draft being typed, 0 the last asked…): the new place and the
 * field's text — the draft back below the history —; null when ↓ from the draft (nothing to do).
 */
export function stepAsked(asked: readonly string[], at: number, up: boolean, draft: string): { at: number; text: string } | null {
  if (at < 0 && !up) return null;
  const next = up ? Math.min(asked.length - 1, at + 1) : at - 1;
  return { at: next, text: next < 0 ? draft : asked[asked.length - 1 - next]! };
}

/** An exchange's line for the pilot: a waking of his own named by what woke him ("⚡ …"), not his instruction to himself. */
export function exchangeLabel(user: string): string {
  const woke = /^\[Woken by your [^—]*— (.*?)\. No pilot/.exec(user);
  return woke ? `⚡ ${woke[1]}` : user;
}
