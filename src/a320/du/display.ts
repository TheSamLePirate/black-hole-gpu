// An A320 display (docs/PLAN-A320.md, A7): its picture drawn on a 1024² canvas from the displays' data (data.ts), at
// its own rate; FlightGear's SVG behind it when it has one (svg.ts), fetched with its first draw.

import type { DuData } from "./data";
import { SvgDoc } from "./svg";

export type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** the displays' font: FlyByWire's ECAM font (GPL v3 — assets/a320/fonts), loaded by index.ts */
export const ECAM_FONT = "A320 ECAM";
export const fontOf = (_family: string) => `"${ECAM_FONT}", "Arial Narrow", sans-serif`;

/** Airbus's display colours */
export const COL = {
  green: "#00ff00",
  amber: "#ff9900",
  red: "#ff0000",
  cyan: "#00e8ff",
  magenta: "#ff4dff",
  white: "#ffffff",
  yellow: "#ffff00",
  grey: "#4a4a4a",
  sky: "#0b6bd3",
  ground: "#8a5a2b",
  black: "#000000",
} as const;

export abstract class Display {
  /** the refresh rate [Hz] */
  hz = 10;
  /** the SVG (null: drawn by code), loaded */
  doc: SvgDoc | null = null;
  private loading = false;

  constructor(
    /** its side: 0 the captain's, 1 the first officer's */
    readonly side: 0 | 1 = 0,
    /** its SVG's URL (none: drawn by code alone) */
    readonly svgUrl: string | null = null,
  ) {}

  /** ready to draw (its SVG read) — the first call fetches it */
  ready(): boolean {
    if (!this.svgUrl) return true;
    if (!this.doc && !this.loading) {
      this.loading = true;
      fetch(this.svgUrl)
        .then((r) => r.text())
        .then((t) => {
          this.doc = new SvgDoc(t);
          this.init(this.doc);
        })
        .catch((e) => console.error("A320 display:", this.svgUrl, e));
    }
    return !!this.doc;
  }

  /** the SVG read: its elements set as FlightGear's driver sets them at its start */
  protected init(_doc: SvgDoc): void {}

  /** The picture on ctx (1024²), cleared black by the caller. */
  abstract draw(ctx: Ctx, d: DuData, t: number): void;
}
