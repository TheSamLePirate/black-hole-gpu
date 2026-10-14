// A plane's flight plan, edited (docs/PLAN-F35.md, F8 — game/flightplan.ts, controller/fplan.ts): the Earth's
// map (ui/mapview.ts: dragged, zoomed, its imagery's tiles) with the route drawn on it — its legs along their
// great circles, its waypoints numbered, the active one magenta, the airfields, the craft and its track —; a
// click adds a waypoint (on an airfield: that airfield), on a waypoint selects it; the list beside: each point's
// name, its altitude and speed constraints, its leg's course and distance, moved, removed, flown direct to; the
// cruise level and speed, the reserve; the plan's distance, time, fuel, what is left on arrival, the bingo now.

import "./routepanel.css";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import { cruiseBurn } from "../f35/cruise";
import { FIELD_PATTERN, fuelPlan, gcLine, legs, type Waypoint } from "../game/flightplan";
import { SITES } from "../game/sites";
import { t, tf } from "../i18n";
import { VESSELS } from "../vessels";
import { MapView } from "./mapview";
import { button, el as h, modal } from "./kit";

export interface RouteHost {
  camera: CameraController;
  toast(s: string): void;
}

const D = Math.PI / 180;
const NM = 1852;
const FIELDS = SITES.filter((s) => s.body === "earth" && s.runway);
const deg = (r: number) => ((Math.round(r / D) % 360) + 360) % 360;
const hms = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : "—");

export class RoutePanel {
  private map: MapView | null = null;
  private close: (() => void) | null = null;
  private list: HTMLElement | null = null;
  private sum: HTMLElement | null = null;
  private navBtn: HTMLButtonElement | null = null;
  private sel = -1;
  private timer = 0;

  constructor(private host: RouteHost) {}

  get isOpen() {
    return !!this.close;
  }

  private get route() {
    return this.host.camera.nav.route;
  }

  open() {
    if (this.close) return;
    const map = (this.map ??= new MapView());
    map.setBody("earth");
    map.overlay = (ctx, toScreen) => this.overlay(ctx, toScreen);
    map.onPick = (lat, lon) => this.pick(lat, lon);
    const root = h("div", "rp");
    const stage = h("div", "rp-map");
    stage.append(map.canvas);
    const side = h("div", "rp-side");
    root.append(stage, side);
    const m = modal({ title: t("Flight plan"), body: [root], cls: "rp-frame", testid: "route-panel", onClose: () => this.closed() });
    this.close = m.close;
    this.buildSide(side);
    // (the view: the route, or the craft, or the first airfield)
    const g = this.host.camera.geoNow();
    const W = this.route.wps;
    const at = W.length ? W[0]! : (g ?? FIELDS[0]!);
    requestAnimationFrame(() => map.flyTo(at.lat, at.lon, 7, 1));
    this.refresh();
    this.timer = window.setInterval(() => {
      map.request();
      this.summary();
    }, 700);
  }

  private closed() {
    this.close = null;
    clearInterval(this.timer);
    this.list = this.sum = this.navBtn = null;
  }

  /** The route changed: the guidance told, the list and the map redrawn. */
  private changed() {
    this.host.camera.routeChanged();
    this.refresh();
  }

  private refresh() {
    this.renderList();
    this.summary();
    this.map?.request();
  }

  // ---------------------------------------------------------------------------- the map
  private overlay(ctx: CanvasRenderingContext2D, toScreen: (lat: number, lon: number) => [number, number]) {
    const N = this.host.camera.nav;
    const W = this.route.wps;
    ctx.save();
    ctx.lineCap = ctx.lineJoin = "round";
    // the airfields: a runway bar, their ICAO
    ctx.font = "600 11px var(--mono, monospace)";
    for (const f of FIELDS) {
      const [x, y] = toScreen(f.lat, f.lon);
      const a = (f.rwy ?? 0) * D;
      ctx.strokeStyle = "rgba(120,205,255,0.9)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 7 * Math.sin(a), y + 7 * Math.cos(a));
      ctx.lineTo(x + 7 * Math.sin(a), y - 7 * Math.cos(a));
      ctx.stroke();
      ctx.fillStyle = "rgba(200,232,255,0.92)";
      ctx.fillText(f.icao ?? f.name, x + 9, y - 7);
    }
    // the legs along their great circles; the active one magenta
    const act = N.lnav?.active ?? -1;
    for (let i = 1; i < W.length; i++) {
      const pts = gcLine(W[i - 1]!, W[i]!, 15_000);
      ctx.strokeStyle = i === act && N.on.l ? "#ff4fd8" : "rgba(255,255,255,0.92)";
      ctx.lineWidth = i === act ? 3 : 2;
      ctx.setLineDash(i < act ? [5, 5] : []);
      ctx.beginPath();
      let prev: [number, number] | null = null;
      for (const p of pts) {
        const s = toScreen(p.lat, p.lon);
        // (a jump across the map's edge: the line broken)
        if (!prev || Math.abs(s[0] - prev[0]) > 2000) ctx.moveTo(s[0], s[1]);
        else ctx.lineTo(s[0], s[1]);
        prev = s;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // the waypoints: numbered, the active magenta, the selected ringed
    W.forEach((w, i) => {
      const [x, y] = toScreen(w.lat, w.lon);
      ctx.fillStyle = i === act ? "#ff4fd8" : w.field ? "#6fd2ff" : "#ffffff";
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      // (a diamond: a fix's symbol)
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y);
      ctx.lineTo(x, y + 7);
      ctx.lineTo(x - 7, y);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      if (i === this.sel) {
        ctx.strokeStyle = "#ffb35c";
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 3;
      const label = `${i} ${w.name}${w.alt !== undefined ? ` ${Math.round(w.alt)}m` : ""}`;
      ctx.strokeText(label, x + 10, y + 14);
      ctx.fillText(label, x + 10, y + 14);
    });
    // the craft: its symbol on its track
    const g = this.host.camera.geoNow();
    if (g) {
      const [x, y] = toScreen(g.lat, g.lon);
      ctx.translate(x, y);
      ctx.rotate(g.track);
      ctx.fillStyle = "#ffe14a";
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(7, 8);
      ctx.lineTo(0, 4);
      ctx.lineTo(-7, 8);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,225,74,0.7)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(0, -60);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A click on the map: a waypoint selected, an airfield or a point added after the selected one (or at the end). */
  private pick(lat: number, lon: number) {
    const map = this.map!;
    const [px, py] = map.toScreen(lat, lon);
    const near = (a: { lat: number; lon: number }) => {
      const [x, y] = map.toScreen(a.lat, a.lon);
      return Math.hypot(x - px, y - py) < 12;
    };
    const W = this.route.wps;
    const hit = W.findIndex(near);
    if (hit >= 0) {
      this.sel = this.sel === hit ? -1 : hit;
      this.refresh();
      return;
    }
    const f = FIELDS.find(near);
    // (the next free number: WP01, WP02… — the ones removed not reused while higher ones remain)
    const n = Math.max(0, ...W.map((w) => (/^WP(\d+)$/.exec(w.name) ? Number(/^WP(\d+)$/.exec(w.name)![1]) : 0))) + 1;
    const w: Waypoint = f
      ? { name: f.icao ?? f.name, lat: f.lat, lon: f.lon, field: { icao: f.icao, elev: f.elev ?? 0, rwy: f.rwy } }
      : { name: `WP${String(n).padStart(2, "0")}`, lat, lon };
    const at = this.sel >= 0 ? this.sel + 1 : W.length;
    W.splice(at, 0, w);
    this.sel = at;
    this.changed();
  }

  // ---------------------------------------------------------------------------- the list
  private buildSide(side: HTMLElement) {
    const R = this.route;
    const num = (label: string, unit: string, get: () => number, set: (v: number) => void, step = 1) => {
      const inp = h("input", "rp-in");
      inp.type = "number";
      inp.step = String(step);
      inp.value = String(Math.round(get()));
      inp.addEventListener("change", () => {
        const v = Number(inp.value);
        if (Number.isFinite(v) && v >= 0) set(v);
        this.changed();
      });
      const f = h("label", "rp-field");
      f.append(h("span", "k-label", label), inp, h("span", "rp-unit", unit));
      return f;
    };
    const cruise = h("div", "rp-cruise");
    cruise.append(
      num(
        t("Cruise level"),
        "m",
        () => R.cruiseAlt,
        (v) => (R.cruiseAlt = v),
        100,
      ),
      num(
        t("Cruise speed"),
        "m/s",
        () => R.cruiseSpd,
        (v) => (R.cruiseSpd = Math.max(v, 60)),
        5,
      ),
      num(
        t("Reserve"),
        "kg",
        () => R.reserveKg,
        (v) => (R.reserveKg = v),
        50,
      ),
    );
    const tools = h("div", "rp-tools");
    const fieldSel = h("select", "rp-in rp-sel");
    for (const f of FIELDS) {
      const o = h("option", "", `${f.icao ?? ""} · ${f.name}`);
      o.value = f.name;
      fieldSel.append(o);
    }
    const addField = () => {
      const f = FIELDS.find((x) => x.name === fieldSel.value)!;
      const at = this.sel >= 0 ? this.sel + 1 : R.wps.length;
      R.wps.splice(at, 0, { name: f.icao ?? f.name, lat: f.lat, lon: f.lon, field: { icao: f.icao, elev: f.elev ?? 0, rwy: f.rwy } });
      this.sel = at;
      this.map?.flyTo(f.lat, f.lon, this.map.zoom);
      this.changed();
    };
    tools.append(
      button({
        label: t("From here"),
        title: t("The plan starts where the craft is"),
        testid: "rp-here",
        onClick: () => {
          const g = this.host.camera.geoNow();
          if (!g) return this.host.toast(t("Not over the Earth"));
          const W = R.wps;
          const p: Waypoint = { name: t("HERE"), lat: g.lat, lon: g.lon };
          if (W[0]?.name === p.name) W[0] = p;
          else W.unshift(p);
          this.changed();
        },
      }),
      fieldSel,
      button({ label: t("Add airfield"), testid: "rp-addfield", onClick: addField }),
      button({
        label: t("Reverse"),
        title: t("The route flown back"),
        onClick: () => {
          R.wps.reverse();
          this.changed();
        },
      }),
      button({
        label: t("Clear"),
        kind: "danger",
        onClick: () => {
          R.wps.length = 0;
          this.sel = -1;
          this.changed();
        },
      }),
    );
    this.list = h("div", "rp-list");
    this.sum = h("div", "rp-sum");
    const foot = h("div", "rp-foot");
    this.navBtn = button({
      label: "NAV",
      kind: "primary",
      testid: "rp-nav",
      title: t("The autopilot flies the plan (⇧M)"),
      onClick: () => {
        this.host.toast(this.host.camera.navToggle());
        this.summary();
      },
    });
    foot.append(
      h(
        "p",
        "rp-note",
        t("Click the map: a waypoint (on an airfield: the airfield), after the one selected. Click a waypoint: select it."),
      ),
      this.navBtn,
    );
    side.append(cruise, tools, this.list, this.sum, foot);
  }

  private renderList() {
    const L = this.list;
    if (!L) return;
    const R = this.route;
    const W = R.wps;
    const lg = legs(R);
    const act = this.host.camera.nav.lnav?.active ?? -1;
    L.replaceChildren();
    if (!W.length) {
      L.append(h("p", "rp-note", t("No waypoint yet.")));
      return;
    }
    W.forEach((w, i) => {
      const row = h("div", `rp-row${i === this.sel ? " sel" : ""}${i === act ? " act" : ""}`);
      row.dataset.testid = `rp-wp-${i}`;
      const name = h("input", "rp-in rp-name");
      name.value = w.name;
      name.addEventListener("change", () => {
        w.name = name.value.trim().toUpperCase().slice(0, 8) || w.name;
        this.refresh();
      });
      const opt = (v: number | undefined, unit: string, set: (x: number | undefined) => void, ph: string) => {
        const inp = h("input", "rp-in rp-num");
        inp.type = "number";
        inp.placeholder = ph;
        inp.value = v === undefined ? "" : String(Math.round(v));
        inp.title = unit;
        inp.addEventListener("change", () => {
          const x = inp.value === "" ? undefined : Number(inp.value);
          set(x !== undefined && Number.isFinite(x) ? x : undefined);
          this.changed();
        });
        return inp;
      };
      const g = lg[i - 1];
      const leg = h("span", "rp-leg", g ? `${String(deg(g.course)).padStart(3, "0")}° ${(g.dist / NM).toFixed(0)} NM` : t("start"));
      const sel = () => {
        this.sel = this.sel === i ? -1 : i;
        this.map?.flyTo(w.lat, w.lon, this.map.zoom);
        this.refresh();
      };
      const idx = h("button", "rp-idx", String(i));
      idx.type = "button";
      idx.title = t("Select (the next click on the map adds after it)");
      idx.addEventListener("click", sel);
      const move = (d: number) => () => {
        const j = i + d;
        if (j < 0 || j >= W.length) return;
        [W[i], W[j]] = [W[j]!, W[i]!];
        this.sel = j;
        this.changed();
      };
      row.append(
        idx,
        name,
        opt(w.alt, "m", (x) => (w.alt = x), w.field ? `${Math.round(w.field.elev + FIELD_PATTERN)}` : t("cruise")),
        opt(w.spd, "m/s", (x) => (w.spd = x), "—"),
        leg,
        button({ icon: "M7 14l5-5 5 5z", title: t("Up"), onClick: move(-1) }),
        button({ icon: "M7 10l5 5 5-5z", title: t("Down"), onClick: move(1) }),
        button({
          label: "→",
          title: t("Direct to"),
          onClick: () => {
            const here = this.host.camera.geoNow();
            if (!here) return;
            if (!this.host.camera.nav.lnav) this.host.camera.routeChanged();
            this.host.camera.nav.lnav?.directTo(i, here);
            this.host.toast(tf("Direct to {0}", w.name));
            this.refresh();
          },
        }),
        button({
          icon: "close",
          title: t("Remove"),
          onClick: () => {
            W.splice(i, 1);
            this.sel = Math.min(this.sel, W.length - 1);
            this.changed();
          },
        }),
      );
      L.append(row);
    });
    const head = h("div", "rp-row rp-head");
    head.append(h("span", "", "#"), h("span", "", t("Name")), h("span", "", "ALT m"), h("span", "", "SPD m/s"), h("span", "", t("Leg")));
    L.prepend(head);
  }

  private summary() {
    const S = this.sum;
    if (!S) return;
    const c = this.host.camera;
    const R = this.route;
    const N = c.nav;
    if (this.navBtn) this.navBtn.classList.toggle("on", N.on.l || N.on.v);
    const lg = legs(R);
    const dist = lg.reduce((a, g) => a + g.dist, 0);
    const jet = !!VESSELS[fleet.active].turbofan;
    const f = jet ? fuelPlan(R, cruiseBurn) : null;
    const fuel = fleet.fuel[fleet.active] ?? 0;
    const bingo = c.routeBingo();
    const o = N.last.l;
    const cells: [string, string, string?][] = [
      [t("Distance"), `${(dist / NM).toFixed(0)} NM · ${(dist / 1000).toFixed(0)} km`],
      [t("Flight time"), hms(f?.time ?? dist / R.cruiseSpd)],
    ];
    if (f) {
      const left = fuel - f.fuel;
      cells.push(
        [t("Fuel planned"), `${Math.round(f.fuel)} kg`],
        [t("On arrival"), `${Math.round(left)} kg`, left < R.reserveKg ? "warn" : ""],
        [t("Bingo now"), bingo !== null ? `${Math.round(bingo)} kg` : "—", bingo !== null && fuel < bingo ? "warn" : ""],
      );
    }
    if ((N.on.l || N.on.v) && o) {
      const w = R.wps[o.active];
      const ete = Number.isFinite(o.ete) ? `${Math.floor(o.ete / 60)}:${String(Math.floor(o.ete % 60)).padStart(2, "0")}` : "—";
      cells.push([t("Active"), `${w?.name ?? "—"} · ${(o.dist / NM).toFixed(1)} NM · ${ete}`, "act"]);
    }
    S.replaceChildren(
      ...cells.map(([k, v, cls]) => {
        const d = h("div", `rp-cell${cls ? ` ${cls}` : ""}`);
        d.append(h("span", "k-label", k), h("b", "", v));
        return d;
      }),
    );
  }
}
