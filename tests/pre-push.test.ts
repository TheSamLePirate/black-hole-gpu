import { expect, test } from "bun:test";
import { parsePushLines, revisionsToCheck } from "../scripts/pre-push";

// The pre-push gate (audit 2026-11-10, QA-01) reads git's pre-push lines: each pushed revision checked once, a
// deletion skipped, a new branch's binaries counted from origin/main.

const Z = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

test("git's pre-push lines read; blank and short lines ignored", () => {
  const refs = parsePushLines(`refs/heads/main ${A} refs/heads/main ${B}\n\n  \nbroken line\n`);
  expect(refs).toEqual([{ localRef: "refs/heads/main", localSha: A, remoteRef: "refs/heads/main", remoteSha: B }]);
});

test("each revision once; a deletion skipped; a new branch against the fallback base", () => {
  const refs = parsePushLines(
    [
      `refs/heads/main ${A} refs/heads/main ${B}`,
      `refs/heads/copy ${A} refs/heads/copy ${C}`,
      `(delete) ${Z} refs/heads/old ${C}`,
      `refs/heads/new ${C} refs/heads/new ${Z}`,
    ].join("\n"),
  );
  expect(revisionsToCheck(refs, "origin")).toEqual([
    { sha: A, base: B },
    { sha: C, base: "origin" },
  ]);
  expect(revisionsToCheck([], "origin")).toEqual([]);
});
