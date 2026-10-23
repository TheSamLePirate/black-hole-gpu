// The spacecraft's picture at the crew (PLAN-RADAR-AAA, RD4's leftover — the snapshot's `spacePic`, net/instruments-space.ts):
// the craft's sensors' tracks on its LVLH axes, as the pilot's space scope draws them (ui/hud/kindhud.ts drawSpaceScope —
// the same logarithmic reach, radar/space.ts scopeXY): the V-bar up, the H-bar right, rings at 1, 10, 100 km; each track's
// symbol (the common symbology), its name, range, rate; held by the datalink only dashed, hidden by the body dimmed, the
// target ringed. Beside it (or alone, in a corner of the DOCKING view), the list: range, rate, R-bar, closest approach,
// sensors. A track touched: `pick` (the target set from the console).
import type { InstrumentSpaceTrack } from "../../net/instruments-space";
import { scopeRadius, scopeXY } from "../../radar/space";
import { drawSym, type SymSide } from "../../radar/symbols";
import { L } from "../lang";
import { C, fmt, type Pen, type Point, type Rect } from "./kit";

/** a range in m or km */
const dist = (m: number) => (m < 1000 ? `${fmt(m, 0)} m` : m < 10_000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m / 1000, 0)} km`);
/** the rate: ▼ closing, ▲ opening [m/s] */
const rateTxt = (r: number) => `${r <= 0 ? "▼" : "▲"}${fmt(Math.abs(r), Math.abs(r) < 10 ? 1 : 0)} m/s`;
/** the sensors' bits as words: RDR, LID, DL */
export const sensorWords = (b: number) =>
  [b & 1 ? L("RDR", "RDR") : "", b & 2 ? L("LID", "LID") : "", b & 4 ? L("LIAISON", "DL") : ""].filter(Boolean).join(" ");
const sideOf = (T: InstrumentSpaceTrack): SymSide => (T.kind === "station" ? "neutral" : T.kind === "player" ? "player" : "friend");

/** The LVLH scope in a square `r`; each track's place handed to `pick`. */
export function drawLvlhScope(
  p: Pen,
  r: Rect,
  tracks: InstrumentSpaceTrack[],
  target: string | null,
  pick?: (point: Point, id: string) => void,
) {
  const R = Math.min(r.w, r.h) / 2 - 22;
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2 + 4;
  p.circle(cx, cy, R);
  p.fill("#04101acc");
  p.stroke(C.cyan, 1.2);
  for (const km of [1, 10, 100]) {
    const rr = scopeRadius(km * 1000) * R;
    p.circle(cx, cy, rr);
    p.stroke(`${C.cyan}55`, 1, [2, 4]);
    p.text(`${km} km`, cx + rr * 0.71 + 3, cy - rr * 0.71, { col: `${C.cyan}99`, size: 9 });
  }
  p.seg(cx, cy - R, cx, cy + R, C.grid2, 1);
  p.seg(cx - R, cy, cx + R, cy, C.grid2, 1);
  p.text("+V", cx - 6, cy - R - 6, { col: C.cyan, size: 10, align: "right", weight: 700 });
  p.text("+H", cx + R + 4, cy + 4, { col: C.cyan, size: 10, weight: 700 });
  // the craft at the centre
  p.path([
    [cx, cy - 7],
    [cx + 5, cy + 6],
    [cx - 5, cy + 6],
  ]);
  p.fill(C.white);
  const taken: [number, number, number, number][] = [];
  for (const T of tracks) {
    const [sx, sy] = scopeXY(T.lvlh, T.range);
    const x = cx + sx * R,
      y = cy - sy * R;
    const dl = T.sensors === 4;
    drawSym(
      p.c,
      x,
      y,
      { kind: "air", side: sideOf(T), state: T.hidden ? "coast" : dl ? "datalink" : "firm", trk: null, selected: T.id === target },
      7,
      1.6,
    );
    pick?.([x, y], T.id);
    // (the labels moved down past those already written: two craft side by side both read)
    let ly = y;
    for (let k = 0; k < 6 && taken.some((q) => x + 10 < q[2] && q[0] < x + 130 && ly - 12 < q[3] && q[1] < ly + 12); k++) ly += 24;
    taken.push([x + 10, ly - 12, x + 130, ly + 12]);
    p.text(T.name, x + 10, ly - 3, { col: T.id === target ? C.amber : C.white, size: 11, weight: 700 });
    p.text(`${dist(T.range)} ${rateTxt(T.rate)}`, x + 10, ly + 10, { col: C.cyan, size: 9.5 });
  }
}

/** The tracks' list from `y0` in the column `x`, `w` wide, at most `rows`; where it ended. */
export function drawLvlhList(p: Pen, x: number, y0: number, w: number, tracks: InstrumentSpaceTrack[], target: string | null, rows = 12) {
  let y = y0;
  if (!tracks.length) {
    p.text(L("Aucun engin tenu par les capteurs", "No craft held by the sensors"), x, y, { col: C.dim, size: 11 });
    return y + 20;
  }
  for (const T of tracks.slice(0, rows)) {
    const col = T.id === target ? C.amber : T.hidden ? C.dim : C.text;
    p.text(T.name, x, y, { col, size: 12, weight: 700 });
    p.text(dist(T.range), x + w, y, { col, size: 12, weight: 700, align: "right" });
    const dz = T.lvlh[2];
    const ca = T.ca ? `${L("PPR", "CA")} ${dist(T.ca.d)} · ${fmt(T.ca.t, 0)} s` : L("s'éloigne", "opening");
    p.text(`${rateTxt(T.rate)} · R${dz >= 0 ? "+" : "−"}${dist(Math.abs(dz))} · ${ca}`, x, y + 14, { col: C.dim, size: 9.5 });
    p.text(T.hidden ? L("CACHÉ", "HIDDEN") : sensorWords(T.sensors), x + w, y + 14, {
      col: T.hidden ? C.amber : C.cyan,
      size: 9.5,
      align: "right",
    });
    y += 34;
  }
  return y;
}

/** The whole picture in `r`: the scope on the left, the list on the right (or the scope alone in a narrow one). */
export function drawLvlh(
  p: Pen,
  r: Rect,
  pic: { ref: string; tracks: InstrumentSpaceTrack[] },
  target: string | null,
  pick?: (point: Point, id: string) => void,
) {
  const listW = r.w > 560 ? Math.min(300, r.w * 0.4) : 0;
  const scope: Rect = { x: r.x, y: r.y + 18, w: r.w - listW - (listW ? 16 : 0), h: r.h - 18 };
  p.text(`${L("CAPTEURS · LVLH", "SENSORS · LVLH")} · ${pic.ref.toUpperCase()}`, r.x + 4, r.y + 10, { col: C.cyan, size: 10, weight: 700 });
  drawLvlhScope(p, scope, pic.tracks, target, pick);
  if (listW) drawLvlhList(p, r.x + r.w - listW, r.y + 34, listW - 8, pic.tracks, target, Math.max(1, Math.floor((r.h - 40) / 34)));
}
