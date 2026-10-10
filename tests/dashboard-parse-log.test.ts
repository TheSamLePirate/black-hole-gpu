import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type LogEvent, LogParser, parseLog } from "../scripts/dashboard/parse-log";

const lines = (...rows: string[]) => rows.join("\n");

const ONE_RUN = lines(
  "bun test v1.3.14 (0d9b296a)",
  "",
  "tests/e2e/a.e2e.test.ts:",
  "(pass) suite > works [561.66ms]",
  "Expected: 5",
  "Received: 6",
  "      at <anonymous> (x.ts:1:1)",
  "(fail) suite > breaks [1.23s]",
  "(skip) suite > later",
  "",
  " 1 pass",
  " 1 fail",
  " 1 skip",
  " 3 expect() calls",
  "Ran 3 tests across 1 file. [2.50s]",
);

describe("parseLog on a synthetic run", () => {
  test("statuses, durations, error block, totals", () => {
    const s = parseLog(ONE_RUN);
    expect(s.files.length).toBe(1);
    const f = s.files[0]!;
    expect(f.file).toBe("tests/e2e/a.e2e.test.ts");
    expect(f.tests.map((t) => [t.name, t.status])).toEqual([
      ["suite > works", "pass"],
      ["suite > breaks", "fail"],
      ["suite > later", "skip"],
    ]);
    expect(f.tests[0]!.ms).toBeCloseTo(561.66);
    expect(f.tests[1]!.ms).toBe(1230);
    expect(f.tests[2]!.ms).toBeUndefined();
    expect(f.tests[1]!.error).toBe("Expected: 5\nReceived: 6\nat <anonymous> (x.ts:1:1)");
    expect(f.tests[0]!.error).toBeUndefined();
    expect(f.pass).toBe(1);
    expect(f.fail).toBe(1);
    expect(f.skip).toBe(1);
    expect(f.ms).toBeCloseTo(1791.66);
    expect(s.pass).toBe(1);
    expect(s.fail).toBe(1);
    expect(s.skip).toBe(1);
    expect(s.expects).toBe(3);
    expect(s.totalMs).toBe(2500);
  });

  test("ANSI colours and carriage returns are stripped", () => {
    const s = parseLog("\x1b[32m(pass)\x1b[0m suite > name [1ms]\r\n\x1b[31m(fail)\x1b[0m other\r\n");
    expect(s.files[0]!.tests).toEqual([
      { name: "suite > name", status: "pass", ms: 1 },
      { name: "other", status: "fail" },
    ]);
  });

  test("the error block keeps the last 40 non-empty lines since the previous test line", () => {
    const body = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const s = parseLog(lines("tests/x.test.ts:", "(pass) before [1ms]", ...body, "(fail) after [2ms]"));
    const t = s.files[0]!.tests[1]!;
    const err = t.error?.split("\n") ?? [];
    expect(err.length).toBe(40);
    expect(err[0]!).toBe("line 10");
    expect(err[39]!).toBe("line 49");
  });

  test("the 'N tests failed:' block repeats the failures and is not counted twice", () => {
    const s = parseLog(
      lines(
        "tests/x.test.ts:",
        "Expected: 1",
        "(fail) a > b [1.00s]",
        "",
        "1 tests failed:",
        "(fail) a > b [1.00s]",
        "",
        " 0 pass",
        " 1 fail",
        "Ran 1 test across 1 file. [1.00s]",
      ),
    );
    expect(s.files[0]!.tests.length).toBe(1);
    expect(s.files[0]!.tests[0]!.error).toBe("Expected: 1");
    expect(s.fail).toBe(1);
  });

  test("the --each mode: several runs accumulate", () => {
    const s = parseLog(
      lines(
        "bun test v1.3.14 (0d9b296a)",
        "tests/e2e/a.e2e.test.ts:",
        "(pass) a > one [100.00ms]",
        " 1 pass",
        " 2 expect() calls",
        "Ran 1 test across 1 file. [1.50s]",
        "bun test v1.3.14 (0d9b296a)",
        "tests/e2e/b.e2e.test.ts:",
        "Expected: true",
        "(fail) b > two [200.00ms]",
        "(pass) b > three [300.00ms]",
        " 1 pass",
        " 1 fail",
        " 3 expect() calls",
        "Ran 2 tests across 1 file. [2.00s]",
      ),
    );
    expect(s.files.map((f) => f.file)).toEqual(["tests/e2e/a.e2e.test.ts", "tests/e2e/b.e2e.test.ts"]);
    expect(s.files[1]!.tests.map((t) => t.status)).toEqual(["fail", "pass"]);
    expect(s.files[1]!.tests[0]!.error).toBe("Expected: true");
    expect(s.pass).toBe(2);
    expect(s.fail).toBe(1);
    expect(s.expects).toBe(5);
    expect(s.totalMs).toBe(3500);
  });

  test("remote job and summary JSON lines", () => {
    const s = parseLog(
      lines("remote: 20261010-223841-harness-check started on kerr-mini", "remote-results/e2e-summary-2026-10-10T20-41-35.json"),
    );
    expect(s.remoteJob).toBe("20261010-223841-harness-check");
    expect(s.summaryJson).toBe("remote-results/e2e-summary-2026-10-10T20-41-35.json");
  });

  test("without totals lines, the counts come from the test lines", () => {
    const s = parseLog(lines("tests/x.test.ts:", "(pass) a [1ms]", "(pass) b [1ms]", "(skip) c"));
    expect([s.pass, s.fail, s.skip]).toEqual([2, 0, 1]);
    expect(s.totalMs).toBeUndefined();
  });
});

describe("LogParser incremental", () => {
  test("pushing line by line gives the same summary as parseLog, and the events", () => {
    const text = `${ONE_RUN}\n${ONE_RUN.replace("a.e2e", "b.e2e")}`;
    const parser = new LogParser();
    const events: LogEvent[] = [];
    for (const line of text.split("\n")) events.push(...parser.push(line));
    expect(parser.summary()).toEqual(parseLog(text));

    expect(events.filter((e) => e.type === "file").map((e) => e.file)).toEqual(["tests/e2e/a.e2e.test.ts", "tests/e2e/b.e2e.test.ts"]);
    const tests = events.filter((e) => e.type === "test");
    expect(tests.length).toBe(6);
    const fail = tests.find((e) => e.type === "test" && e.test.status === "fail");
    expect(fail?.type === "test" ? fail.test.error?.split("\n")[0] : undefined).toBe("Expected: 5");
    expect(events.filter((e) => e.type === "end").length).toBe(2);
  });

  test("a test event is emitted at its own line, before the run's end", () => {
    const parser = new LogParser();
    expect(parser.push("tests/x.test.ts:")).toEqual([{ type: "file", file: "tests/x.test.ts" }]);
    expect(parser.push("(pass) a [1ms]")).toEqual([{ type: "test", file: "tests/x.test.ts", test: { name: "a", status: "pass", ms: 1 } }]);
    expect(parser.push("")).toEqual([]);
  });
});

const LOG_DIR = join(import.meta.dir, "..", "remote-results");
const logs = existsSync(LOG_DIR) ? [...new Bun.Glob("*/log").scanSync({ cwd: LOG_DIR })].map((p) => join(LOG_DIR, p)) : [];

describe("the existing remote-results logs", () => {
  test.skipIf(logs.length === 0)("every log parses without throwing", async () => {
    for (const path of logs) {
      const s = parseLog(await Bun.file(path).text());
      expect(Array.isArray(s.files)).toBe(true);
    }
  });

  test.skipIf(!existsSync(join(LOG_DIR, "20261010-223841-harness-check", "log")))("the harness check log: 4 pass", async () => {
    const s = parseLog(await Bun.file(join(LOG_DIR, "20261010-223841-harness-check", "log")).text());
    expect([s.pass, s.fail, s.skip]).toEqual([4, 0, 0]);
    expect(s.files.length).toBe(2);
  });
});
