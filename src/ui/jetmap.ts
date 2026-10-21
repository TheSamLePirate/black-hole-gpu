// The tactical map (docs/PLAN-RADAR-AAA.md RD15): the right panel's map in flight — the flight HUD's « Tactical » tab,
// and its full screen (M) —, centred on the craft and following it: OpenStreetMap by night under (the crew's own tiles,
// src/crew/draw/tiles.ts), the craft's trace coloured by its altitude, the prediction of its path (the turn it flies
// carried on, its minutes marked), the flight plan, the airfields, the tactical picture's tracks in the common
// symbology (radar/symbols.ts) — the missiles, the decoys, the lock, the selection —; heading up or north up; the
// wheel steps its range (never the camera's field), a click selects a track (PLAN-RADAR-AAA RD9). The panel's size is
// set by dragging its top-left corner (flighthud.ts).

import { mercX, mercY, metresPerPx, night, TILE_CREDIT, Tiles } from "../crew/draw/tiles";
import type { TrackPoint } from "../controller/owntrack";
import { t } from "../i18n";
import type { PicTrack } from "../radar/picture";
import { drawSym, PAL, type SymSide, sideFor } from "../radar/symbols";
import type { Settings } from "../settings";
import { unitsFor } from "./unitsys";
import { drawFields } from "../world/runwaydraw";
import { type Airfield, fieldShown, fieldsNearCached, RUNWAYS_CREDIT, runwaysEvents } from "../world/runways";

/** What the map draws (main.ts gathers it from the controller). */
export interface JetMapData {
  lat: number;
  lon: number;
  alt: number;
  /** the heading [rad from true north], the ground speed [m/s] */
  hdg: number;
  gs: number;
  trail: TrackPoint[];
  /** the path ahead (t from now [s]) */
  pred: TrackPoint[];
  /** the tactical picture's tracks */
  tracks: PicTrack[];
  route: { lat: number; lon: number; name: string; active: boolean }[];
}

/** The range's steps: the centre to the nearer edge [km]. */
export const JETMAP_RANGES = [2, 5, 10, 20, 40, 80, 160, 320] as const;

/** The altitude's colour on the trace [m]: low warm, high cold. */
function altColour(h: number): string {
  const k = Math.max(0, Math.min(1, h / 12_000));
  const r = Math.round(255 - 180 * k),
    g = Math.round(150 + 80 * Math.sin(k * Math.PI)),
    b = Math.round(70 + 185 * k);
  return `rgb(${r}, ${g}, ${b})`;
}

/** A runway's surface, said. */
const SURF: Record<string, () => string> = {
  paved: () => t("paved"),
  grass: () => t("grass"),
  dirt: () => t("dirt"),
  water: () => t("water"),
  snow: () => t("snow"),
  unknown: () => t("unknown surface"),
};

export class JetMap {
  readonly stage: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private tiles = new Tiles();
  private credit: HTMLDivElement;
  /** the range's step (an index of JETMAP_RANGES), heading up or north up */
  range = 3;
  northUp = false;
  /** where each track was drawn [CSS px on the canvas], for the clicks */
  private hits: { id: string; x: number; y: number }[] = [];
  /** a track clicked (PLAN-RADAR-AAA RD9): null, the void */
  onSelect: (id: string | null) => void = () => {};
  /** an airfield's card's action (RD11): flown direct, added to the plan */
  onField: (action: "direct" | "add", f: Airfield) => void = () => {};
  /** where each airfield was drawn [CSS px], for the clicks */
  private fieldHits: { f: Airfield; x: number; y: number }[] = [];
  private card: HTMLDivElement;
  private last: JetMapData | null = null;
  private wheelAcc = 0;

  constructor(private s: Settings) {
    this.stage = document.createElement("div");
    this.stage.className = "jm-stage";
    this.stage.dataset.testid = "jetmap";
    this.cv = document.createElement("canvas");
    this.cv.className = "jm-cv";
    this.credit = document.createElement("div");
    this.credit.className = "jm-credit";
    this.credit.textContent = `${TILE_CREDIT} · ${RUNWAYS_CREDIT}`;
    this.card = document.createElement("div");
    this.card.className = "jm-card";
    this.card.dataset.testid = "jm-card";
    this.card.hidden = true;
    const bar = document.createElement("div");
    bar.className = "jm-bar";
    const btn = (label: string, tip: string, id: string, f: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.tip = tip;
      b.dataset.testid = id;
      b.onclick = (e) => {
        e.stopPropagation();
        f();
        this.draw(this.last);
      };
      bar.append(b);
      return b;
    };
    btn("−", t("Range: closer"), "jm-in", () => (this.range = Math.max(0, this.range - 1)));
    btn("+", t("Range: farther"), "jm-out", () => (this.range = Math.min(JETMAP_RANGES.length - 1, this.range + 1)));
    const up = btn(t("HDG"), t("Heading up or north up"), "jm-up", () => {
      this.northUp = !this.northUp;
      up.textContent = this.northUp ? "N" : t("HDG");
      try {
        localStorage.setItem("kerr.jetmap.north", this.northUp ? "1" : "0");
      } catch {}
    });
    try {
      this.northUp = localStorage.getItem("kerr.jetmap.north") === "1";
      const r = Number(localStorage.getItem("kerr.jetmap.range"));
      if (Number.isInteger(r) && r >= 0 && r < JETMAP_RANGES.length) this.range = r;
    } catch {}
    up.textContent = this.northUp ? "N" : t("HDG");
    this.stage.append(this.cv, bar, this.credit, this.card);
    this.tiles.onLoad = () => this.draw(this.last);
    const was = runwaysEvents.onLoad;
    runwaysEvents.onLoad = (k) => {
      was(k);
      this.draw(this.last);
    };
    // (the wheel: the range's steps — the event kept from the view: the camera's field never moves under the map)
    this.stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.wheelAcc += e.deltaY;
        if (Math.abs(this.wheelAcc) < 50) return;
        const step = Math.sign(this.wheelAcc);
        this.wheelAcc = 0;
        this.range = Math.min(JETMAP_RANGES.length - 1, Math.max(0, this.range + step));
        try {
          localStorage.setItem("kerr.jetmap.range", String(this.range));
        } catch {}
        this.draw(this.last);
      },
      { passive: false },
    );
    // (a click: the track under it selected, the void lets the selection go)
    this.cv.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = this.cv.getBoundingClientRect();
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      let best: string | null = null,
        bd = 16;
      for (const h of this.hits) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bd) (bd = d), (best = h.id);
      }
      // (no track there: an airfield's card — RD11)
      if (!best) {
        let bf: Airfield | null = null,
          df = 14;
        for (const h of this.fieldHits) {
          const d = Math.hypot(h.x - x, h.y - y);
          if (d < df) (df = d), (bf = h.f);
        }
        if (bf) return this.showCard(bf);
      }
      this.card.hidden = true;
      this.onSelect(best);
    });
    this.cv.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  /** An airfield's card: its codes, name, town, elevation, runways (their names, lengths, surfaces), its actions. */
  private showCard(f: Airfield) {
    const U = unitsFor(this.s);
    const c = this.card;
    c.replaceChildren();
    const row = (t: string, cls: string) => {
      const d = document.createElement("div");
      d.className = cls;
      d.textContent = t;
      c.append(d);
    };
    row(`${f.icao || f.ident}${f.iata ? ` · ${f.iata}` : ""}`, "jm-card-code");
    row(`${f.name}${f.city ? ` — ${f.city}` : ""}`, "jm-card-name");
    row(`${t("Elevation")} ${Math.round(U.alt(f.elev))} ${U.altName}`, "jm-card-row");
    for (const w of f.runways.slice(0, 6))
      row(
        `${w.le}/${w.he} · ${Math.round(U.alt(w.len))} ${U.altName} · ${(SURF[w.surface] ?? SURF.unknown!)()}${w.lit ? " · ☼" : ""}${w.approx ? " ≈" : ""}`,
        "jm-card-row",
      );
    const acts = document.createElement("div");
    acts.className = "jm-card-acts";
    for (const [a, label] of [
      ["direct", t("Direct")],
      ["add", t("Add to the plan")],
    ] as const) {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.testid = `jm-${a}`;
      b.onclick = (e) => {
        e.stopPropagation();
        this.onField(a, f);
        c.hidden = true;
      };
      acts.append(b);
    }
    const x = document.createElement("button");
    x.textContent = "×";
    x.className = "jm-card-x";
    x.onclick = (e) => {
      e.stopPropagation();
      c.hidden = true;
    };
    acts.append(x);
    c.append(acts);
    c.hidden = false;
  }

  /** Where each airfield was drawn [CSS px] (tests). */
  fieldHitsNow() {
    return this.fieldHits.map((h) => ({ code: h.f.icao || h.f.ident, x: h.x, y: h.y }));
  }

  /** Where a track would be clicked [CSS px on the canvas] (tests). */
  hitsNow() {
    return this.hits.slice();
  }

  /** The range now [km]. */
  get rangeKm() {
    return JETMAP_RANGES[this.range]!;
  }

  /** The map drawn (null data: the panel left as it is). */
  draw(d: JetMapData | null) {
    if (!d) return;
    this.last = d;
    const cv = this.cv;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(40, this.stage.clientWidth),
      h = Math.max(40, this.stage.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const c = cv.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#05090e";
    c.fillRect(0, 0, w, h);
    const cx = w / 2,
      cy = h / 2;
    const R = this.rangeKm * 1000;
    // (the scale: the range from the centre to the nearer edge; the tiles' zoom at this latitude)
    const mpp = R / (Math.min(w, h) / 2);
    const z = Math.log2(metresPerPx(d.lat, 0) / mpp);
    const S = 256 * 2 ** z;
    const mx0 = mercX(d.lon),
      my0 = mercY(d.lat);
    const rot = this.northUp ? 0 : -d.hdg;
    const cs = Math.cos(rot),
      sn = Math.sin(rot);
    const at = (lat: number, lon: number): [number, number] => {
      let dx = (mercX(lon) - mx0) * S;
      if (dx > S / 2) dx -= S;
      if (dx < -S / 2) dx += S;
      const dy = (mercY(lat) - my0) * S;
      return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs];
    };
    // the ground: the tiles turned about the centre (a square wide enough for its corners), by night
    c.save();
    c.translate(cx, cy);
    c.rotate(rot);
    c.translate(-cx, -cy);
    const diag = Math.hypot(w, h);
    this.tiles.draw(c, { x: cx - diag / 2, y: cy - diag / 2, w: diag, h: diag }, mx0, my0, z, dpr);
    c.restore();
    night(c, { x: 0, y: 0, w, h });
    // the range rings: half and full, their figures
    const U = unitsFor(this.s);
    c.strokeStyle = "rgba(95, 210, 255, 0.28)";
    c.lineWidth = 1;
    const rpx = Math.min(w, h) / 2;
    for (const f of [0.5, 1]) {
      c.beginPath();
      c.arc(cx, cy, rpx * f, 0, 2 * Math.PI);
      c.stroke();
    }
    c.fillStyle = "rgba(170, 220, 240, 0.85)";
    c.font = "600 10px Rajdhani, sans-serif";
    c.textAlign = "left";
    c.fillText(`${U.dist(R / 2).toFixed(R < 10_000 ? 1 : 0)}`, cx + rpx * 0.5 * 0.71 + 3, cy - rpx * 0.5 * 0.71);
    // (the north: a small N on the ring)
    const nx = cx + Math.sin(rot) * rpx * 0.92,
      ny = cy - Math.cos(rot) * rpx * 0.92;
    c.fillStyle = "rgba(255, 255, 255, 0.9)";
    c.font = "700 11px Rajdhani, sans-serif";
    c.textAlign = "center";
    c.fillText("N", nx, ny + 4);
    // the flight plan: its legs in magenta, the active point ringed
    if (d.route.length) {
      c.strokeStyle = "rgba(255, 92, 225, 0.85)";
      c.lineWidth = 2;
      c.beginPath();
      d.route.forEach((p, k) => {
        const [x, y] = at(p.lat, p.lon);
        if (k) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.stroke();
      for (const p of d.route) {
        const [x, y] = at(p.lat, p.lon);
        c.beginPath();
        c.arc(x, y, p.active ? 5 : 3, 0, 2 * Math.PI);
        c.fillStyle = p.active ? "#ff5ce1" : "rgba(255, 92, 225, 0.6)";
        c.fill();
      }
    }
    // the trace: its segments coloured by the altitude, fading into the past
    const T = d.trail;
    c.lineWidth = 2.4;
    c.lineCap = "round";
    for (let k = 1; k < T.length; k++) {
      const a = T[k - 1]!,
        b = T[k]!;
      const [x0, y0] = at(a.lat, a.lon);
      const [x1, y1] = at(b.lat, b.lon);
      c.globalAlpha = 0.25 + 0.75 * (k / T.length);
      c.strokeStyle = altColour(b.alt);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    }
    c.globalAlpha = 1;
    // the prediction: a dashed line ahead, a tick each minute (each 10 s close in), its time at the end
    if (d.pred.length > 1) {
      c.strokeStyle = "rgba(255, 255, 255, 0.85)";
      c.lineWidth = 1.6;
      c.setLineDash([6, 4]);
      c.beginPath();
      d.pred.forEach((p, k) => {
        const [x, y] = at(p.lat, p.lon);
        if (k) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.stroke();
      c.setLineDash([]);
      const every = this.rangeKm <= 10 ? 10 : 60;
      c.fillStyle = "#ffffff";
      for (const p of d.pred)
        if (p.t > 0 && Math.abs(p.t / every - Math.round(p.t / every)) < 1e-6) {
          const [x, y] = at(p.lat, p.lon);
          c.beginPath();
          c.arc(x, y, 2.4, 0, 2 * Math.PI);
          c.fill();
        }
      const e = d.pred[d.pred.length - 1]!;
      const [ex, ey] = at(e.lat, e.lon);
      c.font = "600 10px JetBrains Mono, monospace";
      c.textAlign = "left";
      c.fillText(e.t >= 60 ? `+${Math.round(e.t / 60)} min` : `+${Math.round(e.t)} s`, ex + 5, ey - 4);
    }
    // the world's airfields (src/world/runways.ts — RD11): by the range's level of detail, the nearest first; the
    // flight plan's magenta — over the trace and the path ahead: the runway under the craft never hidden by its own
    // approach's trace
    const marked = new Set(d.route.map((p) => p.name.toUpperCase()));
    this.fieldHits = [];
    const fields = fieldsNearCached(`tac${R}`, d.lat, d.lon, R * 1.5, (f) => fieldShown(f, R), 1000);
    drawFields(c, fields.slice(0, 400), {
      at: (la, lo) => at(la, lo),
      mpp,
      labels: true,
      marked,
      box: { x: 0, y: 0, w, h },
      hit: (f, x, y) => this.fieldHits.push({ f, x, y }),
    });
    // the tracks: the common symbology — the IFF as the sensors know it (the truth's faded where they hold nothing)
    this.hits = [];
    for (const P of d.tracks) {
      const [x, y] = at(P.lat, P.lon);
      if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
      const sensed = P.sensors !== 0 && P.state !== "truth";
      if (!sensed && P.kind !== "missile") continue;
      const side: SymSide = P.kind === "missile" ? (P.msl?.ours ? "friend" : "hostile") : sideFor(P, false);
      const trk = Math.hypot(P.v[0], P.v[1]) > 3 ? Math.atan2(P.v[0], P.v[1]) + rot : null;
      drawSym(
        c,
        x,
        y,
        {
          kind: P.kind,
          side,
          colour: side === "player" ? P.colour : undefined,
          state: P.state,
          trk,
          locked: P.locked,
          selected: P.selected,
          age: P.cm ? 5 - P.cm.life : undefined,
          atUs: P.msl?.target === "own",
        },
        P.kind === "flare" || P.kind === "chaff" ? 5 : 6.5,
        1.5,
      );
      if (P.kind !== "flare" && P.kind !== "chaff") this.hits.push({ id: P.id, x, y });
      if (P.selected || P.locked) {
        c.fillStyle = P.selected ? PAL.select : "#ffffff";
        c.font = "700 10px Rajdhani, sans-serif";
        c.textAlign = "left";
        c.fillText(P.name.slice(0, 14), x + 10, y - 8);
      }
      // (a missile's line to its target and its time to go)
      if (P.msl?.target && P.msl.tti !== null) {
        const tg = P.msl.target === "own" ? null : d.tracks.find((q) => q.id === P.msl!.target);
        const [tx, ty] = tg ? at(tg.lat, tg.lon) : [cx, cy];
        c.strokeStyle = P.msl.ours ? "rgba(95, 210, 255, 0.7)" : "rgba(255, 75, 60, 0.8)";
        c.setLineDash([3, 3]);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(tx, ty);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = c.strokeStyle;
        c.font = "600 9px JetBrains Mono, monospace";
        c.fillText(`${Math.round(P.msl.tti)} s`, (x + tx) / 2 + 4, (y + ty) / 2);
      }
    }
    // the craft: at the centre, its nose its heading
    c.save();
    c.translate(cx, cy);
    c.rotate(d.hdg + rot);
    c.fillStyle = "#ffffff";
    c.strokeStyle = "rgba(0, 0, 0, 0.6)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-6, 7);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
    // the range, the orientation, the ground speed
    c.fillStyle = "rgba(220, 240, 250, 0.95)";
    c.font = "700 11px Rajdhani, sans-serif";
    c.textAlign = "left";
    c.fillText(`${U.dist(R).toFixed(R < 10_000 ? 1 : 0)} ${U.distName} · ${this.northUp ? t("NORTH UP") : t("HDG UP")}`, 6, h - 6);
  }
}
