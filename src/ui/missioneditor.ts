// The mission editor (docs/PLAN-AVIATION-AAA.md, P3 — game/missionedit.ts): a mission made on the map — a tool
// chosen, a click places it: the start, a place to reach, to land at, an escort's destination, a SAM, a truck, a
// bunker, a drone, a fighter, an airliner, a real flight (its callsign), a carrier —, each dragged where it should
// be; beside, the mission's words and its conditions (the hour there, the weather, the F-35's variant and stores, the
// time allowed, the objectives one after the other), each unit's objectives (destroy, identify, escort, protect, land
// aboard), its side, when it appears, each place's, the messages along the way. Flown at once, shared as a link,
// kept among one's missions, exported as JSON or one pasted.

import "./missioneditor.css";
import type { CameraController } from "../controls";
import type { MissionSpec } from "../game/mission";
import {
  type Draft,
  type DraftPlace,
  type DraftUnit,
  draftToSpec,
  missionToHash,
  newDraft,
  specToDraft,
  type UnitRole,
} from "../game/missionedit";
import { t, tf } from "../i18n";
import { store } from "../util/storage";
import { button, el as h, modal } from "./kit";
import { MapView, type ToScreen } from "./mapview";

export interface EditorHost {
  camera: CameraController;
  toast(s: string): void;
  /** the mission flown (its briefing first) */
  fly(spec: MissionSpec): void;
}

type Tool = "start" | "reach" | "land" | "dest" | DraftUnit["kind"];
const TOOLS: Tool[] = ["start", "reach", "dest", "land", "sam", "truck", "bunker", "drone", "fighter", "airliner", "traffic", "carrier"];
const ROLES: UnitRole[] = ["destroy", "identify", "escort", "protect", "land"];

/** One's own missions, kept in this browser. */
const MINE_KEY = "missions.mine";
export const myMissions = (): MissionSpec[] => store.getJSON<MissionSpec[]>(MINE_KEY, []);
export function keepMission(spec: MissionSpec) {
  const all = myMissions().filter((m) => m.id !== spec.id);
  all.unshift(spec);
  store.set(MINE_KEY, JSON.stringify(all.slice(0, 50)));
}
export function dropMission(id: string) {
  store.set(MINE_KEY, JSON.stringify(myMissions().filter((m) => m.id !== id)));
}

/** A mission's link (the page's address with it). */
export const missionLink = (spec: MissionSpec) => `${location.origin}${location.pathname}${missionToHash(spec)}`;

const COL: Record<string, string> = {
  hostile: "#ff4a3a",
  friend: "#5fc8ff",
  neutral: "#f2f4f6",
  carrier: "#4f8dff",
  reach: "#ffb03a",
  land: "#7fe08a",
  dest: "#c58bff",
  start: "#4dff7a",
};

export class MissionEditor {
  private map: MapView | null = null;
  private close: (() => void) | null = null;
  private side: HTMLElement | null = null;
  private d: Draft = newDraft({ lat: 45, lon: 6 });
  private tool: Tool | null = null;
  private sel: string | null = null;
  private seq = 1;

  constructor(private host: EditorHost) {}

  get isOpen() {
    return !!this.close;
  }
  /** the draft (the tests, the automation) */
  get draft() {
    return this.d;
  }

  /** The editor opened on a mission (a copy edited), else on a new one about the craft. */
  open(spec?: MissionSpec) {
    if (this.close) this.close();
    const c = this.host.camera;
    const g = c.geoNow();
    this.d = spec
      ? specToDraft(spec)
      : newDraft(g ? { lat: g.lat, lon: g.lon, alt: g.alt, hdg: (g.track * 180) / Math.PI } : { lat: 45.85, lon: 6.75 });
    if (spec && !spec.id.startsWith("m-")) this.d.id = `${spec.id}-${Date.now().toString(36).slice(-4)}`;
    this.tool = null;
    this.sel = null;
    const map = (this.map ??= new MapView());
    map.setBody("earth");
    map.overlay = (ctx, to) => this.overlay(ctx, to);
    map.onPick = (lat, lon) => this.place(lat, lon);
    map.grab = (px, py) => this.grab(px, py);
    map.onDrop = () => this.refresh();
    const root = h("div", "me");
    const stage = h("div", "me-map");
    stage.append(map.canvas);
    const side = h("div", "me-side");
    this.side = side;
    root.append(stage, side);
    const m = modal({
      title: t("Mission editor"),
      body: [root],
      cls: "me-frame",
      testid: "mission-editor",
      onClose: () => (this.close = this.side = null),
    });
    this.close = m.close;
    const at = this.d.start;
    requestAnimationFrame(() => map.flyTo(at.lat, at.lon, 7.5, 1));
    this.refresh();
  }

  // ------------------------------------------------------------------ the map

  /** Everything placed, with its point and colour. */
  private things(): { key: string; lat: number; lon: number; col: string; label: string; r?: number }[] {
    const d = this.d;
    return [
      { key: "start", lat: d.start.lat, lon: d.start.lon, col: COL.start!, label: t("Start") },
      ...d.places.map((p) => ({
        key: p.id,
        lat: p.lat,
        lon: p.lon,
        col: COL[p.role]!,
        label: p.name || this.placeRole(p.role),
        r: p.radius,
      })),
      ...d.units.map((u) => ({
        key: u.id,
        lat: u.lat,
        lon: u.lon,
        col: u.kind === "carrier" ? COL.carrier! : COL[u.side]!,
        label: u.name || u.callsign || this.kindName(u.kind),
      })),
    ];
  }

  private overlay(ctx: CanvasRenderingContext2D, to: ToScreen) {
    const d = this.d;
    ctx.save();
    ctx.font = "600 11px var(--mono, monospace)";
    ctx.lineJoin = ctx.lineCap = "round";
    const label = (s: string, x: number, y: number, col: string) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(s, x, y);
      ctx.fillStyle = col;
      ctx.fillText(s, x, y);
    };
    const rpx = (lat: number, lon: number, r: number) => Math.abs(to(lat + r / 111_195, lon)[1] - to(lat, lon)[1]);
    for (const p of d.places) {
      const [x, y] = to(p.lat, p.lon);
      ctx.strokeStyle = COL[p.role]!;
      ctx.lineWidth = p.id === this.sel ? 3.5 : 2;
      ctx.setLineDash(p.role === "dest" ? [6, 5] : []);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(rpx(p.lat, p.lon, p.radius), 7), 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // (the start: an arrow on its heading; the units: their shapes, an aircraft's way)
    const [sx, sy] = to(d.start.lat, d.start.lon);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate((d.start.hdg * Math.PI) / 180);
    ctx.fillStyle = COL.start!;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    for (const u of d.units) {
      const [x, y] = to(u.lat, u.lon);
      const col = u.kind === "carrier" ? COL.carrier! : COL[u.side]!;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = u.id === this.sel ? 3.5 : 2.5;
      ctx.beginPath();
      const k = 8;
      if (u.kind === "carrier") ctx.rect(x - 5, y - 11, 10, 22);
      else if (u.side === "friend") ctx.arc(x, y, k, Math.PI, 2 * Math.PI);
      else if (u.side === "neutral") ctx.rect(x - k * 0.8, y - k * 0.8, k * 1.6, k * 1.6);
      else {
        ctx.moveTo(x, y - k);
        ctx.lineTo(x + k, y);
        ctx.lineTo(x, y + k);
        ctx.lineTo(x - k, y);
        ctx.closePath();
      }
      ctx.stroke();
      if (u.kind === "drone" || u.kind === "fighter" || u.kind === "airliner" || u.kind === "traffic" || u.kind === "carrier") {
        const a = (u.hdg * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.sin(a) * 20, y - Math.cos(a) * 20);
        ctx.stroke();
      }
    }
    for (const th of this.things()) {
      const [x, y] = to(th.lat, th.lon);
      label(th.label, x + 11, y - 9, th.col);
    }
    ctx.restore();
  }

  /** A click: the tool's thing placed there (else what is under it selected). */
  private place(lat: number, lon: number) {
    const d = this.d;
    const tool = this.tool;
    if (!tool) {
      const map = this.map!;
      const [px, py] = map.toScreen(lat, lon);
      const hit = this.things().find((th) => {
        const [x, y] = map.toScreen(th.lat, th.lon);
        return Math.hypot(x - px, y - py) < 14;
      });
      this.sel = hit?.key ?? null;
      this.refresh();
      return;
    }
    const id = `${tool}${this.seq++}`;
    if (tool === "start") Object.assign(d.start, { lat, lon });
    else if (tool === "reach" || tool === "land" || tool === "dest") {
      if (tool === "dest") d.places = d.places.filter((p) => p.role !== "dest");
      d.places.push({ id, lat, lon, radius: tool === "reach" ? 3000 : tool === "land" ? 4000 : 15_000, role: tool, name: "" });
    } else {
      const air = tool === "drone" || tool === "fighter" || tool === "airliner" || tool === "traffic";
      const toStart = (Math.atan2((d.start.lon - lon) * Math.cos((lat * Math.PI) / 180), d.start.lat - lat) * 180) / Math.PI;
      const u: DraftUnit = {
        id,
        kind: tool,
        name: tool === "sam" ? "SA-6" : tool === "fighter" ? "Bandit" : "",
        lat,
        lon,
        alt: tool === "drone" ? 4000 : tool === "fighter" ? 6000 : tool === "airliner" || tool === "traffic" ? 10_000 : 0,
        hdg: air ? Math.round((toStart + 360) % 360) : 0,
        side: tool === "airliner" || tool === "traffic" ? "neutral" : "hostile",
        carrier: tool === "carrier" ? "ford" : undefined,
        roles: tool === "carrier" ? ["land"] : tool === "airliner" || tool === "traffic" ? ["identify"] : ["destroy"],
      };
      d.units.push(u);
    }
    this.sel = tool === "start" ? "start" : id;
    this.map?.request();
    this.refresh();
  }

  /** A press on something placed: it dragged. */
  private grab(px: number, py: number) {
    const map = this.map!;
    const hit = this.things().find((th) => {
      const [x, y] = map.toScreen(th.lat, th.lon);
      return Math.hypot(x - px, y - py) < 12;
    });
    if (!hit) return null;
    const d = this.d;
    const obj: { lat: number; lon: number } | undefined =
      hit.key === "start" ? d.start : (d.places.find((p) => p.id === hit.key) ?? d.units.find((u) => u.id === hit.key));
    if (!obj) return null;
    this.sel = hit.key;
    return (lat: number, lon: number) => {
      obj.lat = lat;
      obj.lon = lon;
    };
  }

  // ------------------------------------------------------------------ the side

  private kindName(k: DraftUnit["kind"]): string {
    const n: Record<DraftUnit["kind"], string> = {
      sam: t("SAM"),
      truck: t("Truck"),
      bunker: t("Bunker"),
      drone: t("Drone"),
      fighter: t("Fighter"),
      airliner: t("Airliner"),
      traffic: t("Real flight"),
      carrier: t("Carrier"),
    };
    return n[k];
  }
  private placeRole(r: DraftPlace["role"]) {
    return r === "reach" ? t("Place to reach") : r === "land" ? t("Airfield to land at") : t("Escort's destination");
  }
  private toolName(tl: Tool) {
    return tl === "start"
      ? t("Start")
      : tl === "reach"
        ? t("Place to reach")
        : tl === "land"
          ? t("Airfield to land at")
          : tl === "dest"
            ? t("Escort's destination")
            : this.kindName(tl);
  }

  private input(value: string | number, on: (v: string) => void, o: { type?: string; cls?: string; place?: string; testid?: string } = {}) {
    const i = h("input", `me-in ${o.cls ?? ""}`);
    i.type = o.type ?? "text";
    i.value = String(value);
    if (o.place) i.placeholder = o.place;
    if (o.testid) i.dataset.testid = o.testid;
    i.onchange = () => {
      on(i.value);
      this.map?.request();
    };
    return i;
  }
  private select<T extends string>(value: T, opts: [T, string][], on: (v: T) => void) {
    const s = h("select", "me-in me-sel");
    for (const [v, l] of opts) {
      const o = h("option", "", l);
      o.value = v;
      o.selected = v === value;
      s.append(o);
    }
    s.onchange = () => {
      on(s.value as T);
      this.map?.request();
      this.refresh();
    };
    return s;
  }
  private check(on0: boolean, label: string, on: (v: boolean) => void) {
    const l = h("label", "me-check");
    const c = h("input");
    c.type = "checkbox";
    c.checked = on0;
    c.onchange = () => {
      on(c.checked);
      this.refresh();
    };
    l.append(c, document.createTextNode(` ${label}`));
    return l;
  }
  private row(label: string, ...els: (HTMLElement | Text)[]) {
    const r = h("div", "me-row");
    r.append(h("span", "me-lbl", label), ...els);
    return r;
  }

  private refresh() {
    const S = this.side;
    if (!S) return;
    const d = this.d;
    const parts: HTMLElement[] = [];
    parts.push(
      this.row(
        t("Title"),
        this.input(d.title, (v) => (d.title = v), { place: t("A name for it"), testid: "me-title" }),
      ),
    );
    const brief = h("textarea", "me-in me-brief");
    brief.value = d.brief;
    brief.placeholder = t("The briefing (else its objectives)");
    brief.onchange = () => (d.brief = brief.value);
    parts.push(brief);
    // the tools
    parts.push(h("h4", "me-h", t("Place on the map")));
    const tools = h("div", "me-tools");
    for (const tl of TOOLS)
      tools.append(
        button({
          label: this.toolName(tl),
          on: this.tool === tl,
          testid: `me-tool-${tl}`,
          onClick: () => {
            this.tool = this.tool === tl ? null : tl;
            this.refresh();
          },
        }),
      );
    parts.push(tools);
    parts.push(
      h(
        "p",
        "me-note",
        this.tool
          ? tf("Click the map: {0}. Drag what is placed.", this.toolName(this.tool))
          : t("A tool, then a click on the map. Drag what is placed; a click selects."),
      ),
    );
    // the conditions
    parts.push(h("h4", "me-h", t("Conditions")));
    parts.push(
      this.row(
        t("Start"),
        this.input(Math.round(d.start.alt), (v) => (d.start.alt = Math.max(0, +v || 0)), { type: "number", cls: "me-num" }),
        h("span", "me-unit", "m"),
        this.input(Math.round(d.start.hdg), (v) => (d.start.hdg = ((+v % 360) + 360) % 360), { type: "number", cls: "me-num" }),
        h("span", "me-unit", "°"),
        this.input(Math.round(d.start.speed), (v) => (d.start.speed = Math.max(0, +v || 0)), { type: "number", cls: "me-num" }),
        h("span", "me-unit", "m/s"),
      ),
      this.row(
        t("F-35"),
        this.select(
          d.variant,
          [
            ["B", "F-35B"],
            ["C", "F-35C"],
          ],
          (v) => (d.variant = v),
        ),
        this.select(
          d.loadout,
          [
            ["aa", t("air-to-air")],
            ["ag", t("air-to-ground")],
            ["gun", t("gun only")],
          ],
          (v) => (d.loadout = v),
        ),
      ),
      this.row(
        t("Hour"),
        this.input(d.hour ?? "", (v) => (d.hour = v === "" ? undefined : Math.max(0, Math.min(23.99, +v))), {
          type: "number",
          cls: "me-num",
          place: t("now"),
        }),
        h("span", "me-unit", t("h local")),
        this.select(
          d.weather,
          [
            ["fair", t("fair")],
            ["cloudy", t("cloudy")],
            ["overcast", t("overcast")],
            ["rain", t("rain")],
            ["storm", t("storm")],
            ["fog", t("fog")],
            ["windy", t("windy")],
          ],
          (v) => (d.weather = v),
        ),
      ),
      this.row(
        t("Time allowed"),
        this.input(d.limit, (v) => (d.limit = Math.max(1, +v || 30)), { type: "number", cls: "me-num" }),
        h("span", "me-unit", "min"),
      ),
      this.check(d.chain, t("Objectives one after the other"), (v) => (d.chain = v)),
    );
    // the units and the places
    parts.push(h("h4", "me-h", t("Units and places")));
    if (!d.units.length && !d.places.length) parts.push(h("p", "me-note", t("Nothing placed yet.")));
    for (const u of d.units) parts.push(this.unitCard(u));
    for (const p of d.places) parts.push(this.placeCard(p));
    // the messages
    parts.push(h("h4", "me-h", t("Messages")));
    d.msgs.forEach((m, i) => {
      const del = button({ icon: "close", title: t("Remove"), onClick: () => (d.msgs.splice(i, 1), this.refresh()) });
      parts.push(
        this.row(
          "",
          this.input(m.at, (v) => (m.at = Math.max(0, +v || 0)), { type: "number", cls: "me-num" }),
          h("span", "me-unit", "s"),
          this.input(m.text, (v) => (m.text = v), { cls: "me-grow" }),
          del,
        ),
      );
    });
    parts.push(button({ label: t("Add a message"), onClick: () => (d.msgs.push({ at: 30, text: "" }), this.refresh()) }));
    // what is wrong; the actions
    const { errors } = draftToSpec(d);
    if (errors.length) parts.push(h("p", "me-err", errors.join(" · ")));
    const acts = h("div", "me-acts");
    acts.append(
      button({ label: t("Fly it"), kind: "primary", testid: "me-fly", onClick: () => this.act("fly") }),
      button({ label: t("Copy the link"), testid: "me-link", onClick: () => this.act("link") }),
      button({ label: t("Keep"), testid: "me-keep", onClick: () => this.act("keep") }),
      button({ label: t("Export JSON"), onClick: () => this.act("json") }),
      button({ label: t("Paste JSON"), onClick: () => this.paste() }),
    );
    parts.push(acts);
    S.replaceChildren(...parts);
    this.map?.request();
  }

  private unitCard(u: DraftUnit) {
    const d = this.d;
    const card = h("div", `me-card${u.id === this.sel ? " me-on" : ""}`);
    const del = button({ icon: "close", title: t("Remove"), onClick: () => ((d.units = d.units.filter((v) => v !== u)), this.refresh()) });
    card.append(
      this.row(
        this.kindName(u.kind),
        this.input(u.name, (v) => (u.name = v), { cls: "me-grow", place: t("its name") }),
        del,
      ),
    );
    if (u.kind === "traffic")
      card.append(
        this.row(
          t("Callsign"),
          this.input(u.callsign ?? "", (v) => (u.callsign = v.trim().toUpperCase() || undefined), {
            cls: "me-grow",
            place: t("else the nearest flight"),
          }),
        ),
      );
    if (u.kind === "carrier")
      card.append(
        this.row(
          t("Carrier"),
          this.select(
            u.carrier ?? "ford",
            [
              ["ford", "Gerald R. Ford"],
              ["kiev", "Kiev"],
              ["implacable", "Implacable"],
            ],
            (v) => (u.carrier = v),
          ),
        ),
      );
    else
      card.append(
        this.row(
          t("Side"),
          this.select(
            u.side,
            [
              ["hostile", t("hostile")],
              ["friend", t("friend")],
              ["neutral", t("neutral")],
            ],
            (v) => (u.side = v),
          ),
        ),
      );
    const air = u.kind === "drone" || u.kind === "fighter" || u.kind === "airliner" || u.kind === "traffic";
    if (air || u.kind === "carrier")
      card.append(
        this.row(
          t("Way"),
          ...(air
            ? [
                this.input(Math.round(u.alt), (v) => (u.alt = Math.max(100, +v || 0)), { type: "number", cls: "me-num" }),
                h("span", "me-unit", "m"),
              ]
            : []),
          this.input(Math.round(u.hdg), (v) => (u.hdg = ((+v % 360) + 360) % 360), { type: "number", cls: "me-num" }),
          h("span", "me-unit", "°"),
        ),
      );
    const roles = h("div", "me-roles");
    for (const r of ROLES) {
      if (r === "land" ? u.kind !== "carrier" : u.kind === "carrier") continue;
      roles.append(
        this.check(u.roles.includes(r), this.roleName(r), (on) => {
          u.roles = on ? [...u.roles, r] : u.roles.filter((x) => x !== r);
        }),
      );
    }
    card.append(roles);
    card.append(
      this.row(
        t("Appears at"),
        this.input(u.appear ?? 0, (v) => (u.appear = +v > 0 ? +v : undefined), { type: "number", cls: "me-num" }),
        h("span", "me-unit", "s"),
        this.check(!!u.optional, t("bonus"), (v) => (u.optional = v || undefined)),
      ),
    );
    card.onclick = (e) => {
      if ((e.target as HTMLElement).closest("input,select,button,label")) return;
      this.sel = u.id;
      this.map?.request();
    };
    return card;
  }

  private roleName(r: UnitRole) {
    return r === "destroy"
      ? t("destroy")
      : r === "identify"
        ? t("identify")
        : r === "escort"
          ? t("escort")
          : r === "protect"
            ? t("protect")
            : t("land aboard");
  }

  private placeCard(p: DraftPlace) {
    const d = this.d;
    const card = h("div", `me-card${p.id === this.sel ? " me-on" : ""}`);
    const del = button({
      icon: "close",
      title: t("Remove"),
      onClick: () => ((d.places = d.places.filter((v) => v !== p)), this.refresh()),
    });
    card.append(
      this.row(
        this.placeRole(p.role),
        this.input(p.name, (v) => (p.name = v), { cls: "me-grow", place: t("its name") }),
        del,
      ),
      this.row(
        t("Radius"),
        this.input(Math.round(p.radius / 100) / 10, (v) => (p.radius = Math.max(200, (+v || 1) * 1000)), { type: "number", cls: "me-num" }),
        h("span", "me-unit", "km"),
        ...(p.role === "dest" ? [] : [this.check(!!p.optional, t("bonus"), (v) => (p.optional = v || undefined))]),
      ),
    );
    return card;
  }

  /** The mission flown, linked, kept or exported. */
  act(what: "fly" | "link" | "keep" | "json"): string | null {
    const { spec, errors } = draftToSpec(this.d);
    if (!spec) {
      this.host.toast(errors.join(" · "));
      return null;
    }
    if (what === "fly") {
      keepMission(spec);
      this.close?.();
      this.host.fly(spec);
    } else if (what === "link") {
      const url = missionLink(spec);
      void navigator.clipboard?.writeText(url).catch(() => {});
      this.host.toast(t("The mission's link is copied"));
      return url;
    } else if (what === "keep") {
      keepMission(spec);
      this.host.toast(tf("Kept among your missions: {0}", spec.title));
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }));
      a.download = `${spec.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    return null;
  }

  /** A mission pasted as JSON: edited. */
  private paste() {
    const ta = h("textarea", "me-in me-paste");
    ta.placeholder = '{ "v": 1, "title": … }';
    const m = modal({ title: t("Paste JSON"), body: [ta], cls: "me-frame-small" });
    const row = h("div", "me-acts");
    row.append(
      button({
        label: t("Edit it"),
        kind: "primary",
        onClick: () => {
          try {
            const x = JSON.parse(ta.value);
            const d = specToDraft(x as MissionSpec);
            m.close();
            this.d = d;
            this.refresh();
            this.map?.flyTo(d.start.lat, d.start.lon, 7.5, 1);
          } catch (e) {
            this.host.toast(String((e as Error).message ?? e));
          }
        },
      }),
    );
    ta.after(row);
  }
}
