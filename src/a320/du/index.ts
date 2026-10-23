// The A320's displays (docs/PLAN-A320.md, A7): the PFDs, the NDs, the E/WD, the SD, the ISIS, the DCDUs — each drawn on
// its own 1024² canvas at its own rate (two a frame at most: the PFDs first, then whoever waited longest), then
// copied into its cell of the displays' atlas (ship.ts updateDu — the deck's screens sample it: deck.ts screens).
// The MCDUs' come with A9.

import ecamFont from "../../../assets/a320/fonts/ECAMFontRegular.ttf";
import type { DuData } from "./data";
import { type Ctx, type Display, ECAM_FONT } from "./display";
import { Dcdu } from "./dcdu";
import { Ewd } from "./ewd";
import { Isis } from "./isis";
import { Nd } from "./nd";
import { Pfd } from "./pfd";
import { Sd } from "./sd";
import { DeckTexts } from "./texts";
import { McduDisplay } from "./mcdu";
import type { Mcdu } from "../mcdu/mcdu";
import type { DeckText } from "../deck";
import type { Props } from "../rig";

const SIZE = 1024;

export interface DuPart {
  src: OffscreenCanvas;
  x: number;
  y: number;
  w: number;
  h: number;
}

let fontLoaded: Promise<void> | null = null;
/** the ECAM font, once */
function loadFont(): Promise<void> {
  return (fontLoaded ??= (async () => {
    try {
      const f = new FontFace(ECAM_FONT, `url(${ecamFont})`);
      await f.load();
      (document.fonts as unknown as { add(f: FontFace): void }).add(f);
    } catch (e) {
      console.error("A320 ECAM font:", e);
    }
  })());
}

/** Each display's bus (the A320's: the captain's PFD and the E/WD on AC ESS, the first officer's and the SD on AC 2, the
 *  ISIS on DC ESS, the FCU's windows on DC ESS — src/a320/systems): dark while it is not powered. */
const BUS: Record<string, string> = {
  PFD1: "ac-ess",
  ND1: "ac-1",
  UECAM: "ac-ess",
  LECAM: "ac-2",
  ND2: "ac-2",
  PFD2: "ac-2",
  IESI: "dc-ess",
  DCDU1: "dc-1",
  DCDU2: "dc-2",
  MCDU1: "ac-ess-shed",
  MCDU2: "ac-2",
  TEXTS: "dc-ess",
};

/** a display's bus powered (none given — no systems run —: powered) */
export function duPowered(P: Props | undefined, name: string): boolean {
  const b = BUS[name];
  const v = b ? P?.[`systems/electrical/bus/${b}`] : undefined;
  return v === undefined || Number(v) > (b!.startsWith("dc") ? 20 : 100);
}

export class DuSet {
  private units: { name: string; d: Display; canvas: OffscreenCanvas; ctx: Ctx; cell: [number, number, number, number]; due: number }[] =
    [];
  private fontReady = false;
  /** the displays drawn last frame (tests, captures) */
  drawn: string[] = [];
  /** the time spent drawing [ms] by display (smoothed — captures, tests) */
  readonly cost: Record<string, number> = {};
  /** each display its name, its top marked, its corners coloured (the cells' orientation checked: captures) */
  testPattern = false;

  constructor(
    cells: Record<string, [number, number, number, number]>,
    texts: DeckText[] = [],
    /** the MCDUs (src/a320/mcdu): the captain's, the first officer's — their screens drawn when given */
    mcdus?: [Mcdu, Mcdu],
    atlas = 4096,
  ) {
    const make: Record<string, () => Display> = {
      PFD1: () => new Pfd(0),
      PFD2: () => new Pfd(1),
      ND1: () => new Nd(0),
      ND2: () => new Nd(1),
      UECAM: () => new Ewd(),
      LECAM: () => new Sd(),
      IESI: () => new Isis(),
      DCDU1: () => new Dcdu(0),
      DCDU2: () => new Dcdu(1),
      ...(mcdus ? { MCDU1: () => new McduDisplay(mcdus[0]), MCDU2: () => new McduDisplay(mcdus[1]) } : {}),
    };
    for (const [name, c] of Object.entries(cells)) {
      const f = make[name];
      if (!f) continue;
      const canvas = new OffscreenCanvas(SIZE, SIZE);
      const ctx = canvas.getContext("2d")!;
      this.units.push({
        name,
        d: f(),
        canvas,
        ctx,
        cell: [Math.round(c[0] * atlas), Math.round(c[1] * atlas), Math.round(c[2] * atlas), Math.round(c[3] * atlas)],
        due: 0,
      });
    }
    // (the deck's texts — the FCU's windows, the radios, the clock —: their slots' cell)
    if (texts.length) {
      const canvas = new OffscreenCanvas(SIZE, SIZE);
      this.units.push({
        name: "TEXTS",
        d: new DeckTexts(texts, [3072, 2048]),
        canvas,
        ctx: canvas.getContext("2d")!,
        cell: [3072, 2048, SIZE, SIZE],
        due: 0,
      });
    }
    void loadFont().then(() => (this.fontReady = true));
  }

  /** The displays due now drawn (two at most; the latest first, by their periods — the PFDs' short: a slow frame rate
   *  starves none): their canvases and cells for the atlas. */
  frame(now: number, data: DuData | null, most = 2): DuPart[] {
    this.drawn = [];
    if (!this.fontReady) return [];
    const late = (u: (typeof this.units)[number]) => (now - u.due) * u.d.hz;
    const due = this.units
      .filter((u) => now >= u.due && u.d.ready())
      .sort((a, b) => late(b) - late(a))
      .slice(0, most);
    const out: DuPart[] = [];
    for (const u of due) {
      u.due = now + 1 / u.d.hz;
      const ctx = u.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, SIZE, SIZE);
      if (this.testPattern) testPattern(ctx, u.name);
      else if (data?.powered && duPowered(data.deck, u.name)) {
        try {
          const t0 = performance.now();
          u.d.draw(ctx, data, now);
          this.cost[u.name] = (this.cost[u.name] ?? 0) * 0.8 + (performance.now() - t0) * 0.2;
        } catch (e) {
          console.error("A320 display", u.name, e);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const [x, y, w, h] = u.cell;
      out.push({ src: u.canvas, x, y, w: Math.min(w, SIZE), h: Math.min(h, SIZE) });
      this.drawn.push(u.name);
    }
    return out;
  }

  /** a display's canvas (tests, captures) */
  canvasOf(name: string): OffscreenCanvas | null {
    return this.units.find((u) => u.name === name)?.canvas ?? null;
  }
}

function testPattern(ctx: Ctx, name: string) {
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, SIZE - 16, SIZE - 16);
  const corner = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 120, 120);
  };
  corner(0, 0, "#f00");
  corner(SIZE - 120, 0, "#0f0");
  corner(0, SIZE - 120, "#00f");
  corner(SIZE - 120, SIZE - 120, "#ff0");
  ctx.fillStyle = "#fff";
  ctx.font = `bold 140px ${ECAM_FONT}, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(name, SIZE / 2, SIZE / 2);
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, 150);
  ctx.lineTo(SIZE / 2 - 80, 300);
  ctx.lineTo(SIZE / 2 + 80, 300);
  ctx.fill();
}
