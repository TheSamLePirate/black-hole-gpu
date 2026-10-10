// Parser of `bun test` output as the e2e runs print it (remote-results/*/log): a whole log with parseLog,
// or line by line with LogParser for a live stream. Several "bun test" runs in one log (the --each mode)
// accumulate. Test lines and the totals are read; the "N tests failed:" block repeats the (fail) lines and is skipped.

export interface TestResult {
  name: string;
  status: "pass" | "fail" | "skip" | "todo";
  ms?: number;
  /** The error lines printed before a (fail) line, at most 40, ANSI stripped. */
  error?: string;
}

export interface FileResult {
  file: string;
  tests: TestResult[];
  pass: number;
  fail: number;
  skip: number;
  /** Sum of the tests' ms. */
  ms: number;
}

export interface LogSummary {
  files: FileResult[];
  pass: number;
  fail: number;
  skip: number;
  expects?: number;
  /** Sum of the "Ran N tests across M files. [..]" durations. */
  totalMs?: number;
  remoteJob?: string;
  summaryJson?: string;
}

export type LogEvent = { type: "file"; file: string } | { type: "test"; file: string; test: TestResult } | { type: "end"; ran: string };

// biome-ignore lint/suspicious/noControlCharactersInRegex: the ANSI escape introducer
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const MAX_ERROR_LINES = 40;
const TEST_LINE = /^\((pass|fail|skip|todo)\) (.*?)(?: \[(\d+(?:\.\d+)?)(ms|s)\])?$/;
const FILE_LINE = /^(\S+\.[cm]?[jt]sx?):$/;
const HEADER_LINE = /^bun test v/;
const RAN_LINE = /^Ran (\d+) tests? across (\d+) files?\.(?: \[(\d+(?:\.\d+)?)(ms|s)\])?$/;
const TOTAL_LINE = /^(\d+) (pass|fail|skip|todo)$/;
const EXPECT_LINE = /^(\d+) expect\(\) calls?$/;
const FAILED_BLOCK = /^\d+ tests? failed:$/;
const REMOTE_LINE = /^remote: (\S+) started on/;
const SUMMARY_JSON = /^\S*remote-results\/e2e-summary-\S+\.json$/;

function toMs(value: string, unit: string | undefined): number {
  const n = Number.parseFloat(value);
  return unit === "s" ? n * 1000 : n;
}

export class LogParser {
  private readonly files = new Map<string, TestResult[]>();
  private currentFile = "";
  private buffer: string[] = [];
  private inFailedBlock = false;
  private totalsSeen = false;
  private totals = { pass: 0, fail: 0, skip: 0 };
  private expects: number | undefined;
  private totalMs: number | undefined;
  private remoteJob: string | undefined;
  private summaryJson: string | undefined;

  push(line: string): LogEvent[] {
    const events: LogEvent[] = [];
    for (const raw of line.split("\n")) {
      const text = raw.replace(ANSI, "").replace(/\r/g, "").trim();
      if (text === "") continue;

      const test = TEST_LINE.exec(text);
      if (test) {
        if (this.inFailedBlock) continue;
        const result: TestResult = { name: test[2] ?? "", status: test[1] as TestResult["status"] };
        if (test[3] !== undefined) result.ms = toMs(test[3], test[4]);
        if (result.status === "fail" && this.buffer.length > 0) result.error = this.buffer.join("\n");
        this.buffer = [];
        this.tests(this.currentFile).push(result);
        events.push({ type: "test", file: this.currentFile, test: result });
        continue;
      }

      if (this.inFailedBlock && !(TOTAL_LINE.test(text) || RAN_LINE.test(text) || HEADER_LINE.test(text) || FILE_LINE.test(text))) continue;
      this.inFailedBlock = false;

      if (FAILED_BLOCK.test(text)) {
        this.inFailedBlock = true;
        this.buffer = [];
        continue;
      }

      const file = FILE_LINE.exec(text);
      if (file) {
        this.currentFile = file[1] ?? "";
        this.tests(this.currentFile);
        this.buffer = [];
        events.push({ type: "file", file: this.currentFile });
        continue;
      }

      if (HEADER_LINE.test(text)) {
        this.buffer = [];
        continue;
      }

      const ran = RAN_LINE.exec(text);
      if (ran) {
        if (ran[3] !== undefined) this.totalMs = (this.totalMs ?? 0) + toMs(ran[3], ran[4]);
        this.buffer = [];
        events.push({ type: "end", ran: text });
        continue;
      }

      const total = TOTAL_LINE.exec(text);
      if (total) {
        if (total[2] !== "todo") this.totals[total[2] as "pass" | "fail" | "skip"] += Number(total[1]);
        this.totalsSeen = true;
        this.buffer = [];
        continue;
      }

      const expect = EXPECT_LINE.exec(text);
      if (expect) {
        this.expects = (this.expects ?? 0) + Number(expect[1]);
        this.buffer = [];
        continue;
      }

      const remote = REMOTE_LINE.exec(text);
      if (remote) {
        this.remoteJob ??= remote[1];
        continue;
      }

      if (SUMMARY_JSON.test(text)) {
        this.summaryJson = text;
        continue;
      }

      this.buffer.push(text);
      if (this.buffer.length > MAX_ERROR_LINES) this.buffer.splice(0, this.buffer.length - MAX_ERROR_LINES);
    }
    return events;
  }

  summary(): LogSummary {
    const files: FileResult[] = [];
    const counted = { pass: 0, fail: 0, skip: 0 };
    for (const [file, tests] of this.files) {
      const fr: FileResult = { file, tests: tests.map((t) => ({ ...t })), pass: 0, fail: 0, skip: 0, ms: 0 };
      for (const t of tests) {
        if (t.status === "pass" || t.status === "fail" || t.status === "skip") {
          fr[t.status]++;
          counted[t.status]++;
        }
        fr.ms += t.ms ?? 0;
      }
      files.push(fr);
    }
    const s: LogSummary = {
      files,
      pass: this.totalsSeen ? this.totals.pass : counted.pass,
      fail: this.totalsSeen ? this.totals.fail : counted.fail,
      skip: this.totalsSeen ? this.totals.skip : counted.skip,
    };
    if (this.expects !== undefined) s.expects = this.expects;
    if (this.totalMs !== undefined) s.totalMs = this.totalMs;
    if (this.remoteJob !== undefined) s.remoteJob = this.remoteJob;
    if (this.summaryJson !== undefined) s.summaryJson = this.summaryJson;
    return s;
  }

  private tests(file: string): TestResult[] {
    let list = this.files.get(file);
    if (!list) {
      list = [];
      this.files.set(file, list);
    }
    return list;
  }
}

export function parseLog(text: string): LogSummary {
  const parser = new LogParser();
  for (const line of text.split("\n")) parser.push(line);
  return parser.summary();
}
