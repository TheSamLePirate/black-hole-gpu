// What the A320's two ECAM displays share (docs/PLAN-A320.md, A7 — ewd.ts, sd.ts): FlightGear's SVGs fetched and read
// with their elements' rotation centres (Inkscape's `inkscape:transform-center-x/y`, which FlightGear's canvas parser
// turns into each element's centre: a needle turns about its gauge's hub, not its own middle), FlightGear's ECAM
// colours (Upper-ECAM.nas getColorString), the SD's bottom strip (TAT, SAT, UTC, G LOAD, GW), small formatters.

import { parseXml, SvgDoc } from "./svg";

/** FlightGear's ECAM colours (r, g, b 0…1) */
export const EC = {
  white: [0.8078, 0.8039, 0.8078],
  green: [0.0509, 0.7529, 0.2941],
  amber: [0.7333, 0.3803, 0],
  cyan: [0.0901, 0.6039, 0.7176],
  magenta: [0.6901, 0.3333, 0.745],
  red: [1, 0, 0],
} as const;
export type EcColour = keyof typeof EC;
export const css = (c: EcColour) => {
  const [r, g, b] = EC[c];
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
};

/** An SVG fetched and read, each element given its rotation centre: its box's middle, moved by Inkscape's offset where
 *  it has one (y up in Inkscape's); null while it loads. */
export class EcamSvg {
  doc: SvgDoc | null = null;
  private loading = false;
  constructor(readonly url: string) {}

  get(): SvgDoc | null {
    if (!this.doc && !this.loading) {
      this.loading = true;
      fetch(this.url)
        .then((r) => r.text())
        .then((t) => {
          const doc = new SvgDoc(t);
          const walk = (x: ReturnType<typeof parseXml>) => {
            const id = x.attrs.id;
            const cx = parseFloat(x.attrs["inkscape:transform-center-x"] ?? ""),
              cy = parseFloat(x.attrs["inkscape:transform-center-y"] ?? "");
            if (id && (Number.isFinite(cx) || Number.isFinite(cy))) {
              const el = doc.byId.get(id);
              if (el) {
                const c = el.getCenter();
                el.setCenter(c[0] + (Number.isFinite(cx) ? cx : 0), c[1] - (Number.isFinite(cy) ? cy : 0));
              }
            }
            for (const k of x.kids) walk(k);
          };
          // (the others turn about their own middle — FlightGear's valves, set by updateCenter)
          for (const el of doc.byId.values()) if (!el.cx && !el.cy) el.setCenter(...el.getCenter());
          walk(parseXml(t));
          this.doc = doc;
        })
        .catch((e) => console.error("A320 ECAM:", this.url, e));
    }
    return this.doc;
  }
}

/** a linear table's value (x ascending) */
export function table(x: number, t: readonly (readonly [number, number])[]): number {
  if (x <= t[0]![0]) return t[0]![1];
  for (let i = 1; i < t.length; i++)
    if (x <= t[i]![0]) {
      const [x0, y0] = t[i - 1]!,
        [x1, y1] = t[i]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  return t[t.length - 1]![1];
}

export const D2R = Math.PI / 180;
/** rounded to a step (Nasal's math.round(x, step)) */
export const roundTo = (x: number, step: number) => Math.round(x / step) * step;
/** a signed figure, Nasal's "%+2.0f" */
export const signed = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(Math.round(x))}`;

/** Elements shown or hidden by id. */
export function vis(doc: SvgDoc, on: boolean, ...ids: string[]) {
  for (const id of ids) doc.get(id).setVisible(on);
}
/** An element's text set, its colour too when given. */
export function txt(doc: SvgDoc, id: string, s: string | number, c?: EcColour) {
  const e = doc.get(id).setText(s);
  if (c) e.setColor(css(c));
  return e;
}
export function colour(doc: SvgDoc, id: string, c: EcColour) {
  doc.get(id).setColor(css(c));
}

/** The SD's bottom strip (every page carries it: Lower-ECAM-*.nas updateBottom): TAT, SAT, the UTC time, the load
 *  factor (shown off 0.7…1.3 g), the gross weight [kg] — FlightGear shows "--" until the FMGC has its fuel; the game's
 *  weight is known: shown. */
export function bottomStrip(doc: SvgDoc, d: { tat: number; sat: number; time: Date; nz: number; gw: number; onGround: boolean }) {
  txt(doc, "TAT", signed(d.tat), "green");
  txt(doc, "SAT", signed(d.sat), "green");
  txt(doc, "UTCh", String(d.time.getUTCHours()).padStart(2, "0"));
  txt(doc, "UTCm", String(d.time.getUTCMinutes()).padStart(2, "0"));
  txt(doc, "GLoad", `G.LOAD ${d.nz.toFixed(1)}`);
  vis(doc, !d.onGround && (d.nz < 0.7 || d.nz > 1.3), "GLoad");
  txt(doc, "GW", String(roundTo(d.gw, 100)), "green");
  txt(doc, "GW-weight-unit", "KG");
}
