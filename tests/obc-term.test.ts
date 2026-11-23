import { expect, test } from "bun:test";
import { drawObcSurface } from "../src/obc/fb-renderer";
import { TermBuffer } from "../src/obc/term-buffer";
import { TerminalMouseGuard } from "../src/obc/term-mouse";

test("TermBuffer: renders text, CRLF, CSI clear, SGR 16/256/truecolor, and scrollback", () => {
  const tb = new TermBuffer(32, 6);
  const r0 = tb.rev;
  tb.write("\x1b[1;36mOBC READY\x1b[0m\r\n");
  expect(tb.rev).toBeGreaterThan(r0);
  expect(tb.lines()[0]).toBe("OBC READY");
  expect(tb.grid[0]![0]!.bold).toBe(true);
  expect(tb.grid[0]![0]!.fg).toBe("#62e6ff");

  // Truecolor SGR
  tb.write("\x1b[38;2;10;20;30mRGB\x1b[0m\r\n");
  expect(tb.grid[1]![0]!.fg).toBe("rgb(10,20,30)");
  expect(tb.lines()[1]).toBe("RGB");

  // Scroll beyond 6 rows
  for (let i = 0; i < 8; i++) tb.write(`LINE ${i}\r\n`);
  const tail = tb.tail(3);
  expect(tail).toEqual(["LINE 5", "LINE 6", "LINE 7"]);

  // Clear screen CSI 2J + home CSI H
  tb.write("\x1b[2J\x1b[HFRESH");
  expect(tb.lines()[0]).toBe("FRESH");
  expect(tb.lines()[1]).toBe("");

  // Dynamic resize preserves existing cells and clamps cursor cleanly
  tb.resize(64, 20);
  expect(tb.cols).toBe(64);
  expect(tb.rows).toBe(20);
  expect(tb.lines()[0]).toBe("FRESH");
  tb.resize(24, 8);
  expect(tb.cols).toBe(24);
  expect(tb.rows).toBe(8);
  expect(tb.row).toBeLessThan(8);
  expect(tb.col).toBeLessThan(24);
});

test("TermBuffer: streams multi-byte UTF-8 chunks without corrupting characters", () => {
  const tb = new TermBuffer(40, 4);
  const bytes = new TextEncoder().encode("dτ/dt = 0.999 · Δv = 120 m/s");
  tb.write(bytes.subarray(0, 3));
  tb.write(bytes.subarray(3));
  expect(tb.lines()[0]).toBe("dτ/dt = 0.999 · Δv = 120 m/s");
});

test("drawObcSurface: renders standby, suspended, terminal mirror, and footer across all 4 themes", () => {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_, k) =>
        k === "fillText"
          ? (s: string) => calls.push(String(s))
          : k === "createRadialGradient"
            ? () => ({ addColorStop: () => {} })
            : () => {},
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;

  const term = new TermBuffer(40, 12);
  term.write("alpine:~# uname -a\r\nLinux unkernel 7.3.4 aarch64\r\n");

  for (const theme of ["interstellar", "f35", "a320", "amber"] as const) {
    drawObcSurface(
      ctx,
      { phase: "off", term, fbFrame: null, dtauDt: 1, activeScript: null, lastError: null, bootMs: null, crtFx: true },
      0,
      0,
      512,
      512,
      theme,
    );
    drawObcSurface(
      ctx,
      { phase: "suspended", term, fbFrame: null, dtauDt: 1, activeScript: null, lastError: null, bootMs: 420, crtFx: false },
      0,
      0,
      512,
      512,
      theme,
    );
    drawObcSurface(
      ctx,
      {
        phase: "ready",
        term,
        fbFrame: null,
        dtauDt: 0.9985,
        activeScript: "obc-diag",
        lastError: null,
        bootMs: 420,
        vessel: "ranger",
        body: "earth",
        altMsl: 12000,
        tasMps: 240,
      },
      0,
      0,
      512,
      512,
      theme,
      { footer: true },
    );
  }
  expect(calls.some((s) => s.includes("LINUX OBC"))).toBe(true);
  expect(calls.some((s) => s.includes("obc-diag"))).toBe(true);
  expect(calls.some((s) => s.includes("SUSPENDED"))).toBe(true);
  expect(calls.some((s) => s.includes("RANGER"))).toBe(true);
});

test("TerminalMouseGuard: blocks bare hover floods & stale mouse modes while preserving TUI clicks, wheel & normal keys", () => {
  const g = new TerminalMouseGuard();

  // 1. Before any app enables mouse tracking, stale SGR/X10/Focus sequences are dropped; normal keys untouched
  expect(g.filterInput("\x1b[<35;42;12M\x1b[<0;10;5M\x1b[I", { allowMouse: true, nowMs: 100 })).toBe("");
  expect(g.filterInput("ls -la\r\x1b[Aé", { allowMouse: true, nowMs: 100 })).toBe("ls -la\r\x1b[Aé");

  // 2. App enters alt-screen & enables any-motion (?1003h) + SGR (?1006h) + focus (?1004h)
  expect(g.observeGuestOutput("\x1b[?1049h\x1b[?1003;1006;1004h")).toBe(false);
  expect(g.mouseTrackingActive).toBe(true);

  // Bare hover motion (btn 35 / 39 / X10 hover) is ALWAYS suppressed so moving the mouse never floods serial TTY
  expect(g.filterInput("\x1b[<35;42;12M\x1b[<35;43;12M\x1b[<39;44;12M", { allowMouse: true, nowMs: 200 })).toBe("");
  expect(g.filterInput(`\x1b[M${String.fromCharCode(32 + 35, 50, 40)}`, { allowMouse: true, nowMs: 200 })).toBe("");

  // Real clicks & releases pass immediately, even mixed with text
  expect(g.filterInput("\x1b[<0;15;8M\x1b[<0;15;8m", { allowMouse: true, nowMs: 200 })).toBe("\x1b[<0;15;8M\x1b[<0;15;8m");

  // Active button drag (btn 32) is throttled to 20 Hz (50 ms)
  expect(g.filterInput("\x1b[<32;15;8M", { allowMouse: true, nowMs: 300 })).toBe("\x1b[<32;15;8M");
  expect(g.filterInput("\x1b[<32;16;8M", { allowMouse: true, nowMs: 320 })).toBe("");
  expect(g.filterInput("\x1b[<32;17;8M", { allowMouse: true, nowMs: 360 })).toBe("\x1b[<32;17;8M");

  // Wheel (btn 64/65) is throttled to 30 Hz (33 ms)
  expect(g.filterInput("\x1b[<64;15;8M", { allowMouse: true, nowMs: 400 })).toBe("\x1b[<64;15;8M");
  expect(g.filterInput("\x1b[<65;15;8M", { allowMouse: true, nowMs: 410 })).toBe("");
  expect(g.filterInput("\x1b[<65;15;8M", { allowMouse: true, nowMs: 440 })).toBe("\x1b[<65;15;8M");

  // Suppressing during window drag/resize or when termMouse=false drops all mouse reports
  expect(g.filterInput("\x1b[<0;15;8M", { allowMouse: false, nowMs: 500 })).toBe("");
  expect(g.filterInput("\x1b[<0;15;8M", { allowMouse: true, suppressAllMouse: true, nowMs: 500 })).toBe("");

  // 3. App leaves alt-screen without disabling mouse tracking -> auto-heals immediately!
  expect(g.observeGuestOutput("\x1b[?1049l")).toBe(true);
  expect(g.mouseTrackingActive).toBe(false);
  expect(g.filterInput("\x1b[<0;15;8M", { allowMouse: true, nowMs: 600 })).toBe("");

  // 4. App enables mouse on normal screen and exits back to /home/pilot prompt -> auto-heals!
  expect(g.observeGuestOutput("\x1b[?1003h\x1b[?1006h")).toBe(false);
  expect(g.mouseTrackingActive).toBe(true);
  expect(g.observeGuestOutput("\r\n/home/pilot → ")).toBe(true);
  expect(g.mouseTrackingActive).toBe(false);
});
