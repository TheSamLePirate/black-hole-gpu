import { expect, test } from "bun:test";
import { drawObcSurface } from "../src/obc/fb-renderer";
import { TermBuffer } from "../src/obc/term-buffer";

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
