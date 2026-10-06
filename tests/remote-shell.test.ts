import { expect, test } from "bun:test";
import { shellJoin } from "../scripts/lib/shell";

// The command sent to the other Mac's zsh (scripts/remote.ts): the words this shell gave, as they were.
test("a word holding a shell character reaches the other Mac whole", () => {
  expect(shellJoin(["bun", "scripts/flightlab.ts", "run", "--only", "moon-hover|moon-orbit", "--port", "4711"])).toBe(
    "bun scripts/flightlab.ts run --only 'moon-hover|moon-orbit' --port 4711",
  );
  expect(shellJoin(["E2E=1", "bun", "test", "tests/e2e/x.e2e.test.ts"])).toBe("E2E=1 bun test tests/e2e/x.e2e.test.ts");
  expect(shellJoin(["echo", "it's"])).toBe(`echo 'it'\\''s'`);
  expect(shellJoin(["bun", "test", "&&", "bun", "run", "typecheck"])).toBe("bun test && bun run typecheck");
  // (one word: the command line as written)
  expect(shellJoin(["E2E=1 bun test x && y"])).toBe("E2E=1 bun test x && y");
});
