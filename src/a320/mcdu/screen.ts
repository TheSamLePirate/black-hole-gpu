// The A320's MCDU's screen (docs/PLAN-A320.md, A9): a page as the MCDU shows it — its title, six lines each a small
// label over a large datum, the scratchpad — on FlightGear's layout (Models/Instruments/MCDU/res/mcdu.svg: a 1024 × 864
// view, the title at 69, the labels from 130 and the data from 187 every 117.35 px, the scratchpad at 837), its
// characters on a grid of 24 columns; Airbus's colours (FlightGear's MCDU.nas). Drawn in the game's monospaced font —
// JetBrains Mono (SIL OFL) —, never Honeywell's (no licence).

export type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** The MCDU's colours (FlightGear's MCDU.nas): white, green (data), cyan (modifiable — FlightGear's BLUE), amber
 *  (required: the boxes), yellow (temporary), magenta (constraints, speed limits). */
export const MC = {
  white: "#ffffff",
  green: "#0dc04b",
  cyan: "#179ab7",
  amber: "#e0821a",
  yellow: "#eeee00",
  magenta: "#c45fd8",
} as const;
export type Col = (typeof MC)[keyof typeof MC];

/** A run of characters: its text, its colour, small (a label's size within a datum). */
export interface Run {
  t: string;
  c: Col;
  s?: boolean;
}
/** A line: its label (small) and its datum (large), each aligned left, centred, right. */
export interface Line {
  ls?: Run[];
  cs?: Run[];
  rs?: Run[];
  l?: Run[];
  c?: Run[];
  r?: Run[];
}
export interface Screen {
  title: Run[];
  /** the page's number ("1/2") at the top right */
  page?: string;
  /** six lines (fewer: the rest empty) */
  lines: Line[];
  /** the slew keys' arrows shown: left / right, up / down */
  lr?: boolean;
  ud?: boolean;
}

export const run = (t: string, c: Col = MC.white, s = false): Run => ({ t, c, s });
/** amber boxes: a datum required (n of them) */
export const boxes = (n: number) => run("□".repeat(n), MC.amber);
/** cyan brackets: a datum optional */
export const brackets = (n: number) => run(`[${" ".repeat(n)}]`, MC.cyan);

export const COLS = 24;
const X0 = 20;
const CW = (1004 - X0) / COLS;
const TITLE_Y = 69;
const LABEL_Y = 130.39;
const DATA_Y = 187.1;
const STEP = 117.35;
const SCRATCH_Y = 837;
const FONT = '"JetBrains Mono", "DejaVu Sans Mono", Menlo, monospace';
const LARGE = 56;
const SMALL = 46;

const width = (rs: Run[] | undefined) => (rs ?? []).reduce((a, r) => a + [...r.t].length, 0);

/** the runs at a row: their characters on the grid from a column */
function put(ctx: Ctx, rs: Run[] | undefined, col: number, y: number, small: boolean, sx: number, sy: number) {
  let k = col;
  for (const r of rs ?? []) {
    const sm = small || !!r.s;
    ctx.font = `600 ${(sm ? SMALL : LARGE) * sy}px ${FONT}`;
    ctx.fillStyle = r.c;
    for (const ch of r.t) {
      if (ch !== " ") ctx.fillText(ch, (X0 + (k + 0.5) * CW) * sx, y * sy);
      k++;
    }
  }
}

/** a row's three parts: left from column 0, right ending at column 24, centred on column 12 */
function row(
  ctx: Ctx,
  l: Run[] | undefined,
  c: Run[] | undefined,
  r: Run[] | undefined,
  y: number,
  small: boolean,
  sx: number,
  sy: number,
) {
  put(ctx, l, 0, y, small, sx, sy);
  put(ctx, c, Math.round((COLS - width(c)) / 2), y, small, sx, sy);
  put(ctx, r, COLS - width(r), y, small, sx, sy);
}

/** The screen on ctx, in a w × h box (the MCDU's 1024 × 864 view scaled), and the scratchpad's runs. */
export function drawScreen(ctx: Ctx, S: Screen, scratch: Run[], w: number, h: number) {
  const sx = w / 1024,
    sy = h / 864;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  // (the title: large, centred; the page's number right)
  row(ctx, undefined, S.title, undefined, TITLE_Y, false, sx, sy);
  if (S.page) put(ctx, [run(S.page, MC.white, true)], COLS - [...S.page].length, TITLE_Y, true, sx, sy);
  S.lines.slice(0, 6).forEach((L, i) => {
    row(ctx, L.ls, L.cs, L.rs, LABEL_Y + i * STEP, true, sx, sy);
    row(ctx, L.l, L.c, L.r, DATA_Y + i * STEP, false, sx, sy);
  });
  put(ctx, scratch, 0, SCRATCH_Y, false, sx, sy);
  // (the slew keys' arrows: ← → by the title, ↑ ↓ by the scratchpad)
  ctx.fillStyle = MC.white;
  const tri = (x: number, y: number, dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo((x + dx) * sx, (y + dy) * sy);
    ctx.lineTo((x - dy * 0.7 - dx * 0.4) * sx, (y + dx * 0.7 - dy * 0.4) * sy);
    ctx.lineTo((x + dy * 0.7 - dx * 0.4) * sx, (y - dx * 0.7 - dy * 0.4) * sy);
    ctx.closePath();
    ctx.fill();
  };
  if (S.lr) {
    tri(940, 50, -16, 0);
    tri(990, 50, 16, 0);
  }
  if (S.ud) {
    tri(970, 810, 0, -16);
    tri(970, 840, 0, 16);
  }
}

/** a text padded on the right / on the left to n characters */
export const padR = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
export const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
