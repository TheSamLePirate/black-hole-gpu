// The mission map (docs/PLAN-AVIATION-AAA.md, P2): the Earth's map (ui/mapview.ts) with the tactical picture on it —
// the mission's zones (the places to reach, an escort's end, a landing's), its units where they are now (hostile red
// diamonds, friends' blue half circles, neutrals' white squares, the destroyed crossed), the SAMs' reach in red, the
// carriers at sea, the real traffic about, the flight plan and the craft —; the plan's points dragged; a click on a
// unit, a zone, a point or the ground: "Fly to" it (put in the plan, direct, NAV engaged). The same picture on the
// cockpit's TSD (f35/pcd.ts).

import "./missionmap.css";
import type { CameraController } from "../controls";
import type { MissionMark } from "../controller/mission";
import { enuAt } from "../controller/traffic";
import { gcLine } from "../game/flightplan";
import { t, tf } from "../i18n";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { button, el as h, modal } from "./kit";
import { MapView, type ToScreen } from "./mapview";

export interface MissionMapHost {
  camera: CameraController;
  toast(s: string): void;
}

const D = Math.PI / 180;
/** The traffic drawn at most. */
const TRAFFIC_MAX = 600;

/** Something on the map one may pick: what it is, its place, its name. */
interface Item {
  kind: MissionMark["kind"] | "traffic" | "wp" | "place";
  lat: number;
  lon: number;
  name: string;
  /** a waypoint's index */
  wp?: number;
  text?: string;
}

const COL = {
  hostile: "#ff4a3a",
  friend: "#5fc8ff",
  neutral: "#f2f4f6",
  carrier: "#4f8dff",
  dead: "#8a949a",
  zone: "#ffb03a",
  threat: "#ff4a3a",
  traffic: "rgba(205,215,222,0.8)",
  route: "#ff4fd8",
};

export class MissionMap {
  private map: MapView | null = null;
  private close: (() => void) | null = null;
  private side: HTMLElement | null = null;
  private timer = 0;
  private sel: Item | null = null;
  private drag = -1;

  constructor(private host: MissionMapHost) {}

  get isOpen() {
    return !!this.close;
  }

  open() {
    if (this.close) return;
    const c = this.host.camera;
    const map = (this.map ??= new MapView());
    map.setBody("earth");
    map.overlay = (ctx, to) => this.overlay(ctx, to);
    map.onPick = (lat, lon) => this.pick(lat, lon);
    map.grab = (px, py) => this.grab(px, py);
    map.onDrop = () => {
      this.drag = -1;
      c.routeChanged();
      this.refresh();
    };
    const root = h("div", "mm");
    const stage = h("div", "mm-map");
    stage.append(map.canvas);
    const side = h("div", "mm-side");
    this.side = side;
    root.append(stage, side);
    const m = modal({
      title: c.mission ? tf("Mission map — {0}", c.mission.run.spec.title) : t("Mission map"),
      body: [root],
      cls: "mm-frame",
      testid: "mission-map",
      onClose: () => this.closed(),
    });
    this.close = m.close;
    // (the view: the craft and what is about it)
    const g = c.geoNow();
    const at = g ?? (c.mission ? c.mission.anchor : { lat: 45, lon: 6 });
    requestAnimationFrame(() => map.flyTo(at.lat, at.lon, 7.5, 1));
    this.refresh();
    this.timer = window.setInterval(() => {
      map.request();
      this.refresh();
    }, 700);
  }

  private closed() {
    this.close = null;
    this.side = null;
    clearInterval(this.timer);
  }

  /** The units and places the map shows (the mission's, the carriers', the traffic's, the plan's). */
  private items(): Item[] {
    const c = this.host.camera;
    const out: Item[] = [];
    const marks = c.missionMarks();
    for (const m of marks) out.push({ kind: m.kind, lat: m.lat, lon: m.lon, name: m.label });
    for (const k of c.carrierNow())
      if (!marks.some((m) => m.kind === "carrier" && Math.abs(m.lat - k.P.lat) < 1e-3))
        out.push({ kind: "carrier", lat: k.P.lat, lon: k.P.lon, name: k.sp.kind });
    c.nav.route.wps.forEach((w, i) => out.push({ kind: "wp", lat: w.lat, lon: w.lon, name: w.name, wp: i }));
    for (const a of this.traffic()) out.push({ kind: "traffic", lat: a.lat, lon: a.lon, name: a.cs });
    return out;
  }

  /** The real traffic about: where each is, its heading, its callsign. */
  private traffic() {
    const c = this.host.camera;
    if (!c.s.traffic) return [];
    return c
      .trafficNow()
      .slice(0, TRAFFIC_MAX)
      .map((a) => {
        const g = cartToGeodetic(WGS84_A, WGS84_F, a.p as [number, number, number]);
        const f = enuAt(g.lat / D, g.lon / D);
        const ve = a.v[0]! * f.E[0]! + a.v[1]! * f.E[1]! + a.v[2]! * f.E[2]!;
        const vn = a.v[0]! * f.N[0]! + a.v[1]! * f.N[1]! + a.v[2]! * f.N[2]!;
        return { lat: g.lat / D, lon: g.lon / D, hdg: Math.atan2(ve, vn), cs: a.cs.trim() || a.id, gnd: a.gnd };
      });
  }

  private overlay(ctx: CanvasRenderingContext2D, to: ToScreen) {
    const c = this.host.camera;
    const map = this.map!;
    ctx.save();
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.font = "600 11px var(--mono, monospace)";
    const label = (s: string, x: number, y: number, col: string) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(s, x, y);
      ctx.fillStyle = col;
      ctx.fillText(s, x, y);
    };
    /** a radius [m] on the screen about a place [px] */
    const rpx = (lat: number, lon: number, r: number) => Math.abs(to(lat + r / 111_195, lon)[1] - to(lat, lon)[1]);
    const marks = c.missionMarks();
    // the threats: the SAMs' reach
    for (const m of marks.filter((k) => k.kind === "threat")) {
      const [x, y] = to(m.lat, m.lon);
      const r = rpx(m.lat, m.lon, m.r ?? 0);
      ctx.fillStyle = "rgba(255,74,58,0.12)";
      ctx.strokeStyle = COL.threat;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      label(`${m.label} · ${Math.round((m.r ?? 0) / 1000)} km`, x - r * 0.7, y - r * 0.72, COL.threat);
    }
    // the zones: the objectives' places (the active solid, the waiting dashed)
    for (const m of marks.filter((k) => k.kind === "zone")) {
      const [x, y] = to(m.lat, m.lon);
      const r = Math.max(rpx(m.lat, m.lon, m.r ?? 0), 6);
      ctx.strokeStyle = COL.zone;
      ctx.globalAlpha = m.state === "active" ? 1 : 0.55;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(m.state === "active" ? [] : [5, 5]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      label(m.label, x + r * 0.72 + 4, y - r * 0.72, COL.zone);
      ctx.globalAlpha = 1;
    }
    // the plan: its legs on their great circles, its points (dragged)
    const W = c.nav.route.wps;
    const act = c.nav.lnav?.active ?? -1;
    for (let i = 1; i < W.length; i++) {
      ctx.strokeStyle = i === act && c.nav.on.l ? COL.route : "rgba(255,255,255,0.9)";
      ctx.lineWidth = i === act ? 3 : 2;
      ctx.beginPath();
      let prev: [number, number] | null = null;
      for (const p of gcLine(W[i - 1]!, W[i]!, 15_000)) {
        const s = to(p.lat, p.lon);
        if (!prev || Math.abs(s[0] - prev[0]) > 2000) ctx.moveTo(s[0], s[1]);
        else ctx.lineTo(s[0], s[1]);
        prev = s;
      }
      ctx.stroke();
    }
    W.forEach((w, i) => {
      const [x, y] = to(w.lat, w.lon);
      ctx.fillStyle = i === act ? COL.route : "#ffffff";
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 8, y);
      ctx.lineTo(x, y + 8);
      ctx.lineTo(x - 8, y);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      label(`${i} ${w.name}`, x + 10, y + 14, "#fff");
    });
    // the traffic: small arrows, their callsigns close in
    const close = map.zoom >= 8;
    for (const a of this.traffic()) {
      const [x, y] = to(a.lat, a.lon);
      if (x < -20 || y < -20 || x > map.canvas.clientWidth + 20 || y > map.canvas.clientHeight + 20) continue;
      this.arrow(ctx, x, y, a.hdg, 6, COL.traffic);
      if (close) label(a.cs, x + 7, y - 6, COL.traffic);
    }
    // the carriers at sea
    for (const k of c.carrierNow()) {
      const [x, y] = to(k.P.lat, k.P.lon);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(k.sp.heading);
      ctx.fillStyle = COL.carrier;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(5, -6);
      ctx.lineTo(5, 11);
      ctx.lineTo(-5, 11);
      ctx.lineTo(-5, -6);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
      const m = marks.find((q) => q.kind === "carrier" && Math.abs(q.lat - k.P.lat) < 1e-3);
      label(m?.label ?? k.sp.kind, x + 10, y + 4, COL.carrier);
    }
    // the mission's units: their NATO shapes, an aircraft's way
    for (const m of marks) {
      if (m.kind === "zone" || m.kind === "threat" || m.kind === "carrier") continue;
      const [x, y] = to(m.lat, m.lon);
      const col = COL[m.kind];
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const k = 8;
      if (m.kind === "dead") {
        ctx.moveTo(x - k, y - k);
        ctx.lineTo(x + k, y + k);
        ctx.moveTo(x + k, y - k);
        ctx.lineTo(x - k, y + k);
      } else if (m.kind === "friend") ctx.arc(x, y, k, Math.PI, 2 * Math.PI);
      else if (m.kind === "neutral") ctx.rect(x - k * 0.8, y - k * 0.8, k * 1.6, k * 1.6);
      else {
        ctx.moveTo(x, y - k);
        ctx.lineTo(x + k, y);
        ctx.lineTo(x, y + k);
        ctx.lineTo(x - k, y);
        ctx.closePath();
      }
      ctx.stroke();
      if (m.air && m.hdg !== undefined) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.sin(m.hdg * D) * 20, y - Math.cos(m.hdg * D) * 20);
        ctx.stroke();
      }
      label(m.label, x + 11, y - 8, col);
    }
    // the craft
    const g = c.geoNow();
    if (g) {
      const [x, y] = to(g.lat, g.lon);
      this.arrow(ctx, x, y, g.track, 11, "#4dff7a");
    }
    // the selection
    if (this.sel) {
      const [x, y] = to(this.sel.lat, this.sel.lon);
      ctx.strokeStyle = "#ffd23f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** An aircraft's arrow at a point, along a heading [rad]. */
  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, hdg: number, k: number, col: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hdg);
    ctx.fillStyle = col;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -k);
    ctx.lineTo(k * 0.7, k * 0.8);
    ctx.lineTo(0, k * 0.4);
    ctx.lineTo(-k * 0.7, k * 0.8);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  /** A click: the nearest thing within 16 px picked, else the place itself. */
  private pick(lat: number, lon: number) {
    const map = this.map!;
    const [px, py] = map.toScreen(lat, lon);
    let best: Item | null = null;
    let bd = 16;
    for (const it of this.items()) {
      const [x, y] = map.toScreen(it.lat, it.lon);
      const d = Math.hypot(x - px, y - py);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    this.sel = best ?? { kind: "place", lat, lon, name: `${lat.toFixed(3)}° ${lon.toFixed(3)}°` };
    map.request();
    this.refresh();
  }

  /** A press on a waypoint: it dragged. */
  private grab(px: number, py: number) {
    const map = this.map!;
    const W = this.host.camera.nav.route.wps;
    const i = W.findIndex((w) => {
      const [x, y] = map.toScreen(w.lat, w.lon);
      return Math.hypot(x - px, y - py) < 12;
    });
    if (i < 0) return null;
    this.drag = i;
    return (lat: number, lon: number) => {
      const w = W[i];
      if (!w) return;
      w.lat = lat;
      w.lon = lon;
      if (w.field) delete w.field;
      this.sel = { kind: "wp", lat, lon, name: w.name, wp: i };
    };
  }

  /** "Fly to" the selected: in the plan, direct to it, NAV on. */
  flyTo(it: { name: string; lat: number; lon: number } | null = this.sel) {
    if (!it) return;
    this.host.toast(this.host.camera.routeFlyTo(it.name, it.lat, it.lon));
    this.map?.request();
    this.refresh();
  }

  /** The side: the objectives, the selection and its actions, the legend. */
  private refresh() {
    const S = this.side;
    if (!S || this.drag >= 0) return;
    const c = this.host.camera;
    const M = c.mission;
    const parts: HTMLElement[] = [];
    if (M) {
      parts.push(h("h4", "mm-h", t("Objectives")));
      for (const o of M.run.spec.objectives) {
        const st = M.run.state[o.id]!;
        parts.push(
          h(
            "div",
            `mm-obj mm-${st}${o.optional ? " mm-opt" : ""}`,
            `${st === "done" ? "✓" : st === "failed" ? "✗" : st === "active" ? "•" : "◦"} ${o.text}`,
          ),
        );
      }
    } else parts.push(h("p", "mm-note", t("No mission flown: the traffic, the carriers and the flight plan.")));
    parts.push(h("h4", "mm-h", t("Selected")));
    const it = this.sel;
    if (it) {
      const kinds: Record<Item["kind"], string> = {
        hostile: t("hostile"),
        friend: t("friend"),
        neutral: t("neutral"),
        carrier: t("carrier"),
        dead: t("destroyed"),
        zone: t("objective"),
        threat: t("SAM threat"),
        traffic: t("traffic"),
        wp: t("waypoint"),
        place: t("place"),
      };
      parts.push(
        h("div", "mm-sel", `${it.name} — ${kinds[it.kind]}`),
        h("div", "mm-coord", `${it.lat.toFixed(4)}°, ${it.lon.toFixed(4)}°`),
      );
      const row = h("div", "mm-row");
      row.append(button({ label: t("Fly to"), kind: "primary", testid: "mm-flyto", onClick: () => this.flyTo() }));
      if (it.kind === "wp" && it.wp !== undefined)
        row.append(
          button({
            label: t("Remove"),
            onClick: () => {
              c.nav.route.wps.splice(it.wp!, 1);
              c.routeChanged();
              this.sel = null;
              this.map?.request();
              this.refresh();
            },
          }),
        );
      parts.push(row);
    } else parts.push(h("p", "mm-note", t("Click a unit, a zone, a point or the ground; drag the plan's points.")));
    parts.push(h("h4", "mm-h", t("Legend")));
    const lg = h("div", "mm-legend");
    for (const [cls, txt] of [
      ["mm-k-hostile", t("hostile")],
      ["mm-k-friend", t("friend")],
      ["mm-k-neutral", t("neutral")],
      ["mm-k-threat", t("SAM threat")],
      ["mm-k-zone", t("objective")],
      ["mm-k-carrier", t("carrier")],
      ["mm-k-route", t("flight plan")],
    ] as const)
      lg.append(h("span", `mm-k ${cls}`, txt));
    parts.push(lg);
    S.replaceChildren(...parts);
  }
}
