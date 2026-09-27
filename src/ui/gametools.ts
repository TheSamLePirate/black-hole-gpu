// The game tools' window (F2, or the 🛠 button of the mission bar): the Ranger's state, placing it,
// the target and the spheres of influence, time, saved games, the audit and the journal — over the
// same tools as the console's __bh.game (src/game/tools.ts).

import type { GameTools } from "../game/tools";
import { fmtDate } from "../game/tools";
import { defaultAltKm, universeOf } from "../game/place";
import { SOLAR_BODIES } from "../system/solar";
import { solidBody } from "../system/our-surface";
import { autosave, slots } from "../game/save";
import type { AuditReport } from "../game/audit";
import type { LogKind } from "../game/log";

type Tab = "ranger" | "place" | "target" | "time" | "saves" | "perf" | "audit" | "journal";
const TABS: [Tab, string][] = [
  ["ranger", "Ranger"], ["place", "Place"], ["target", "Target · SOI"], ["time", "Time"], ["saves", "Saves"], ["perf", "Perf"], ["audit", "Audit"], ["journal", "Journal"],
];

/** landing sites (latitude, east longitude) */
const SITES: Record<string, [string, number, number][]> = {
  earth: [["Kennedy Space Center", 28.573, -80.649], ["Baikonur", 45.965, 63.305], ["Kourou", 5.236, -52.769], ["Paris", 48.857, 2.352]],
  moon: [["Apollo 11 · Tranquility Base", 0.674, 23.473], ["Shackleton crater (south pole)", -89.9, 0], ["Tycho", -43.31, -11.36]],
  mars: [["Jezero crater", 18.38, 77.58], ["Olympus Mons", 18.65, -133.8], ["Gale crater", -5.4, 137.8]],
  titan: [["Huygens site", -10.25, 167.7]],
  europa: [["Conamara Chaos", 9.7, -86.6]],
};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const btn = (text: string, onClick: () => void, cls = "") => {
  const b = h("button", `gt-btn ${cls}`, text) as HTMLButtonElement;
  b.onclick = onClick;
  return b;
};
const num = (v: number, step = "any") => {
  const i = h("input", "gt-in") as HTMLInputElement;
  i.type = "number";
  i.step = step;
  i.value = String(v);
  return i;
};
const field = (label: string, el: HTMLElement) => {
  const f = h("label", "gt-field");
  f.append(h("span", "", label), el);
  return f;
};
const select = (opts: [string, string][], value?: string) => {
  const s = h("select", "gt-in") as HTMLSelectElement;
  for (const [v, t] of opts) {
    const o = h("option", "", t) as HTMLOptionElement;
    o.value = v;
    s.append(o);
  }
  if (value !== undefined) s.value = value;
  return s;
};

const fmtKm = (km: number) => (!Number.isFinite(km) ? "∞" : Math.abs(km) >= 1e7 ? `${(km / 1.495978707e8).toFixed(3)} AU` : Math.abs(km) >= 1e4 ? `${Math.round(km).toLocaleString("en")} km` : `${km.toFixed(1)} km`);
const fmtMs = (v: number) => (!Number.isFinite(v) ? "—" : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(2)} km/s` : `${v.toFixed(1)} m/s`);
export const fmtS = (s: number) => {
  if (!Number.isFinite(s)) return "∞";
  const a = Math.abs(s);
  const sign = s < 0 ? "−" : "";
  if (a < 120) return `${sign}${a.toFixed(0)} s`;
  if (a < 7200) return `${sign}${Math.floor(a / 60)} min ${Math.round(a % 60)} s`;
  if (a < 2 * 86400) return `${sign}${Math.floor(a / 3600)} h ${Math.round((a % 3600) / 60)} min`;
  if (a < 800 * 86400) return `${sign}${(a / 86400).toFixed(1)} d`;
  return `${sign}${(a / (365.25 * 86400)).toFixed(2)} y`;
};

export class GameToolsWindow {
  readonly root = h("div", "gt-root fl-panel");
  private body = h("div", "gt-body");
  private tab: Tab = "ranger";
  private tabEls = new Map<Tab, HTMLButtonElement>();
  private live: (() => void) | null = null;
  private at = 0;
  open = false;

  constructor(private g: GameTools) {
    const head = h("div", "gt-head");
    head.append(h("div", "fl-title", "Game tools"), btn("×", () => this.toggle(false), "gt-x"));
    const tabs = h("div", "gt-tabs");
    for (const [id, label] of TABS) {
      const b = btn(label, () => this.show(id), "gt-tab");
      this.tabEls.set(id, b);
      tabs.append(b);
    }
    this.root.append(head, tabs, this.body);
    this.root.hidden = true;
    document.body.append(this.root);
    this.g.log.on(() => {
      if (this.open && this.tab === "journal") this.show("journal");
    });
    try {
      const t = localStorage.getItem("kerr.tools-tab") as Tab | null;
      if (t && TABS.some(([id]) => id === t)) this.tab = t;
    } catch {
      /* private mode */
    }
  }

  toggle(on = !this.open) {
    this.open = on;
    this.root.hidden = !on;
    if (on) this.show(this.tab);
  }

  /** Called from the frame loop: refreshes the live figures (4 times a second). */
  tick() {
    if (!this.open || !this.live) return;
    const now = performance.now();
    if (now - this.at < 250) return;
    this.at = now;
    try {
      this.live();
    } catch (e) {
      console.warn(e);
    }
  }

  private run(f: () => unknown) {
    try {
      const r = f();
      if (r instanceof Promise) r.catch((e) => this.fail(e));
      return r;
    } catch (e) {
      this.fail(e);
    }
  }
  private fail(e: unknown) {
    const msg = (e as Error).message ?? String(e);
    this.g.log.add("warn", msg);
    const n = h("div", "gt-err", msg);
    this.body.prepend(n);
    setTimeout(() => n.remove(), 6000);
  }

  show(tab: Tab) {
    this.tab = tab;
    try {
      localStorage.setItem("kerr.tools-tab", tab);
    } catch {
      /* private mode */
    }
    this.tabEls.forEach((b, id) => b.classList.toggle("on", id === tab));
    this.body.replaceChildren();
    this.live = null;
    const views: Record<Tab, () => void> = {
      ranger: () => this.ranger(), place: () => this.place(), target: () => this.target(), time: () => this.time(),
      saves: () => this.saves(), perf: () => this.perf(), audit: () => this.audit(), journal: () => this.journal(),
    };
    views[tab]();
    (this.live as (() => void) | null)?.(); // (set by the view)
  }

  // ------------------------------------------------------------------------------ Ranger
  private ranger() {
    const grid = h("div", "gt-kv");
    const rows = new Map<string, HTMLElement>();
    const row = (k: string, label: string) => {
      const v = h("b");
      grid.append(h("span", "", label), v);
      rows.set(k, v);
    };
    const badge = h("div", "gt-badge");
    for (const [k, l] of [
      ["side", "Universe"], ["soi", "Sphere of influence"], ["alt", "Altitude"], ["speed", "Speed"], ["vv", "Vertical speed"],
      ["pe", "Periapsis"], ["ap", "Apoapsis"], ["inc", "Inclination · e"], ["period", "Period"], ["tpe", "Next periapsis"], ["tap", "Next apoapsis"],
      ["next", "Next event"], ["target", "Target"], ["tdist", "Range · rate"], ["tca", "Closest approach"], ["date", "Date · warp"], ["pilot", "Pilot"],
    ] as const) row(k, l);
    const copy = btn("Copy as JSON", () => this.run(() => navigator.clipboard.writeText(JSON.stringify(this.g.status(), null, 1))));
    this.body.append(badge, grid, h("div", "gt-row", ""), copy);
    this.live = () => {
      const st = this.g.status();
      this.g.watch(st);
      badge.textContent = st.label;
      badge.dataset.status = st.status;
      const set = (k: string, v: string) => (rows.get(k)!.textContent = v);
      set("side", st.side === "ours" ? "Ours (solar system)" : st.side === "throat" ? "The wormhole's throat" : "Gargantua's");
      set("soi", `${st.soiName}${Number.isFinite(st.soiKm) ? ` · r ${fmtKm(st.soiKm)}` : ""}`);
      set("alt", st.kerr ? `r = ${st.kerr.r.toFixed(3)} M` : fmtKm(st.altKm));
      set("speed", fmtMs(st.speed));
      set("vv", fmtMs(st.vVert));
      const o = st.orbit;
      set("pe", o ? fmtKm(o.peKm) : st.kerr ? `E ${st.kerr.E.toFixed(5)}` : "—");
      set("ap", o ? fmtKm(o.apKm) : st.kerr ? `L ${st.kerr.L.toFixed(3)} M` : "—");
      set("inc", o ? `${o.incDeg.toFixed(2)}° · ${o.ecc.toFixed(4)}` : "—");
      set("period", o ? fmtS(o.period) : "—");
      set("tpe", o ? fmtS(o.tPe) : "—");
      set("tap", o && Number.isFinite(o.tAp) ? fmtS(o.tAp) : "—");
      const n = st.next;
      set("next", n ? `${n.kind === "exit" ? `leaving ${n.name}'s SOI` : n.kind === "enter" ? `entering ${n.name}'s SOI` : n.kind === "impact" ? `impact on ${n.name}` : "into the mouth"} · in ${fmtS(n.inS)}` : "—");
      const t = st.target;
      set("target", t ? t.name : "—");
      set("tdist", t ? `${fmtKm(t.distKm)} · ${t.rate >= 0 ? "+" : ""}${fmtMs(t.rate)}` : "—");
      set("tca", t && Number.isFinite(t.caKm) ? `${t.caKm < 0 ? "impact" : fmtKm(t.caKm)} · in ${fmtS(t.caIn)}` : "—");
      const s = this.g.settings();
      const warp = s.timeSpeed * 4.925490947e-6 * s.massSolar;
      set("date", `${this.g.date()} · ${s.animate ? `×${warp >= 10 ? Math.round(warp) : warp.toPrecision(2)}` : "paused"}`);
      const info = this.g.pilotState();
      set("pilot", info);
    };
  }

  // ------------------------------------------------------------------------------ Place
  private place() {
    const st = this.g.status();
    const uni = select([["ours", "Our universe (solar system)"], ["gargantua", "Gargantua's system"]], st.side === "ours" ? "ours" : "gargantua");
    const bodySel = h("select", "gt-in") as HTMLSelectElement;
    const mode = select([["orbit", "In orbit"], ["ground", "On the ground"]]);
    const pe = num(400, "1"), ap = num(400, "1"), inc = num(0, "0.1"), raan = num(0, "1"), argPe = num(0, "1"), nu = num(0, "1"), rM = num(12, "0.1");
    const retro = h("input") as HTMLInputElement;
    retro.type = "checkbox";
    const lat = num(0, "0.001"), lon = num(0, "0.001");
    const site = h("select", "gt-in") as HTMLSelectElement;
    const orbitBox = h("div", "gt-grid"), groundBox = h("div", "gt-grid"), holeBox = h("div", "gt-grid");
    orbitBox.append(field("Periapsis alt. [km]", pe), field("Apoapsis alt. [km]", ap), field("Inclination [°]", inc), field("Node Ω [°]", raan), field("Periapsis ω [°]", argPe), field("True anomaly ν [°]", nu), field("Retrograde", retro));
    holeBox.append(field("Radius [M]", rM), field("Azimuth [°]", nu), field("Retrograde", retro));
    groundBox.append(field("Site", site), field("Latitude [°]", lat), field("East longitude [°]", lon));
    const fillBodies = () => {
      const ours = uni.value === "ours";
      bodySel.replaceChildren();
      const list: [string, string][] = ours ? SOLAR_BODIES.map((b) => [b.id, `${b.parent && b.parent !== "sun" ? "  · " : ""}${b.name}`]) : [["gargantua", "Gargantua (Kerr orbit)"], ["miller", "Miller"], ["mann", "Mann"], ["edmunds", "Edmunds"]];
      for (const [v, t] of list) {
        const o = h("option", "", t) as HTMLOptionElement;
        o.value = v;
        bodySel.append(o);
      }
      const want = ours ? (st.side === "ours" ? st.soi : "earth") : st.side === "gargantua" ? st.soi : "miller";
      bodySel.value = list.some(([v]) => v === want) ? want : list[0]![0];
      fillBody();
    };
    const fillBody = () => {
      const id = bodySel.value;
      const ours = universeOf(id) === "ours";
      const alt = ours ? defaultAltKm(id) : 100;
      pe.value = ap.value = String(alt);
      const canLand = ours && solidBody(id);
      mode.disabled = !canLand;
      if (!canLand) mode.value = "orbit";
      site.replaceChildren();
      for (const [name, la, lo] of [["—", 0, 0] as [string, number, number], ...(SITES[id] ?? [])]) {
        const o = h("option", "", name) as HTMLOptionElement;
        o.value = `${la},${lo}`;
        site.append(o);
      }
      layout();
    };
    const layout = () => {
      const hole = bodySel.value === "gargantua";
      orbitBox.hidden = hole || mode.value !== "orbit";
      holeBox.hidden = !hole;
      groundBox.hidden = hole || mode.value !== "ground";
    };
    site.onchange = () => {
      const [la, lo] = site.value.split(",").map(Number);
      lat.value = String(la);
      lon.value = String(lo);
    };
    uni.onchange = fillBodies;
    bodySel.onchange = fillBody;
    mode.onchange = layout;
    const go = btn("PLACE THE RANGER", () =>
      this.run(() => {
        const id = bodySel.value;
        if (id === "gargantua") return this.g.orbit(id, { rM: +rM.value, nu: +nu.value, retrograde: retro.checked });
        if (mode.value === "ground") return this.g.land(id, +lat.value, +lon.value);
        return this.g.orbit(id, { peKm: +pe.value, apKm: +ap.value, inc: +inc.value, raan: +raan.value, argPe: +argPe.value, nu: +nu.value, retrograde: retro.checked });
      }), "gt-primary");
    const quick = h("div", "gt-row");
    quick.append(
      btn("Orbit the target", () => this.run(() => this.g.orbitTarget())),
      btn("Low Earth orbit", () => this.run(() => this.g.orbit("earth", { altKm: 400 }))),
      btn("KSC pad", () => this.run(() => this.g.land("earth", 28.573, -80.649))),
      btn("Low lunar orbit", () => this.run(() => this.g.orbit("moon", { altKm: 100 }))),
    );
    const g2 = h("div", "gt-grid");
    g2.append(field("Universe", uni), field("Body", bodySel), field("Where", mode));
    this.body.append(h("p", "gt-note", "Puts the Ranger there now, its flight started afresh (engine off, no plan). Altitudes above the mean radius; inclination from the body's equator."));
    this.body.append(g2, orbitBox, holeBox, groundBox, go, quick);
    fillBodies();
  }

  // ------------------------------------------------------------------------------ Target · SOI
  private target() {
    const soiBox = h("div", "gt-kv");
    const tbl = h("table", "gt-table");
    this.body.append(h("div", "fl-label", "Sphere of influence"), soiBox, h("div", "fl-label", "Bodies — a click: target"), tbl);
    let built = "";
    this.live = () => {
      const soi = this.g.soi();
      soiBox.replaceChildren();
      for (const c of soi.chain) soiBox.append(h("span", "", c.id === soi.body ? "▶ in" : "within"), h("b", "", `${c.name} · SOI ${fmtKm(c.soiKm)}`));
      if (!soi.chain.length) soiBox.append(h("span", "", "▶ in"), h("b", "", soi.name));
      const list = this.g.bodies();
      const tgt = String(this.g.get("target"));
      const key = list.map((b) => b.id).join() + tgt;
      if (key !== built) {
        built = key;
        tbl.replaceChildren();
        const hr = h("tr");
        for (const c of ["Body", "Radius", "SOI", "Distance"]) hr.append(h("th", "", c));
        tbl.append(hr);
        for (const b of list) {
          const tr = h("tr", b.id === tgt ? "on" : "");
          tr.dataset.id = b.id;
          tr.onclick = () => this.run(() => (this.g.target(b.id), (built = "")));
          tr.append(h("td", "", `${b.parent && b.parent !== "sun" && b.parent !== "gargantua" ? "· " : ""}${b.name}`), h("td", "", fmtKm(b.radiusKm)), h("td", "", "soiKm" in b ? fmtKm(b.soiKm as number) : "—"), h("td"));
          tbl.append(tr);
        }
      }
      for (const b of list) {
        const td = tbl.querySelector(`tr[data-id="${b.id}"] td:last-child`);
        if (td) td.textContent = "distKm" in b && Number.isFinite(b.distKm as number) ? fmtKm(b.distKm as number) : "—";
      }
    };
    const extra = h("div", "gt-row");
    extra.append(btn("Wormhole", () => this.run(() => this.g.target("wormhole"))), btn("Gargantua", () => this.run(() => this.g.target("hole"))));
    this.body.append(extra);
  }

  // ------------------------------------------------------------------------------ Time
  private time() {
    const now = h("div", "gt-big");
    const warps = h("div", "gt-row");
    for (const x of [1, 10, 100, 1000, 1e4, 1e5, 1e6]) warps.append(btn(`×${x >= 1000 ? `${x / 1000}k` : x}`, () => this.run(() => this.g.warp(x))));
    warps.append(btn("Pause", () => this.run(() => this.g.pause(true))), btn("Run", () => this.run(() => this.g.pause(false))));
    const date = h("input", "gt-in") as HTMLInputElement;
    date.type = "datetime-local";
    date.step = "60";
    date.value = this.g.date().replace(" ", "T");
    const set = btn("Set the clock", () => this.run(() => this.g.setDate(date.value)));
    this.body.append(
      now, warps,
      h("p", "gt-note", "The clock moves the bodies along their orbits; the ship keeps its place (and speed) in the home frame — re-place it afterwards to be in orbit there."),
      field("Date (UTC)", date), set,
    );
    this.live = () => (now.textContent = `${this.g.date()} UTC`);
  }

  // ------------------------------------------------------------------------------ Saves
  private saves() {
    const name = h("input", "gt-in") as HTMLInputElement;
    name.placeholder = "name";
    const list = h("div", "gt-list");
    const refresh = () => {
      list.replaceChildren();
      const auto = autosave.get();
      if (auto) list.append(this.saveRow(auto.name, auto.summary, new Date(auto.savedAt).toLocaleString(), true, refresh));
      for (const g of slots.list()) list.append(this.saveRow(g.name, g.summary, new Date(g.savedAt).toLocaleString(), false, refresh));
      if (!list.children.length) list.append(h("p", "gt-note", "No saved game yet."));
    };
    const saveBtn = btn("Save", () => this.run(() => (this.g.save(name.value), (name.value = ""), refresh())), "gt-primary");
    const file = h("input") as HTMLInputElement;
    file.type = "file";
    file.accept = "application/json,.json";
    file.onchange = async () => {
      const f = file.files?.[0];
      if (f) this.run(async () => (this.g.importSave(await f.text()), refresh()));
      file.value = "";
    };
    const row = h("div", "gt-row");
    row.append(name, saveBtn);
    const row2 = h("div", "gt-row");
    row2.append(
      btn("Import a file…", () => file.click()),
      btn("Export now", () => this.run(() => this.g.exportSave())),
      btn("Copy a link", () => this.run(async () => {
        await navigator.clipboard.writeText(this.g.shareLink());
        this.g.log.add("save", "Link copied (this moment, without the plan)");
      })),
    );
    this.body.append(
      h("p", "gt-note", `A save keeps every setting exactly, the date, the pilot and the flight plan. Autosave: ${this.g.get("autosave") ? `every ${this.g.get("autosaveEvery")} s, resumed at the next visit` : "off"} (settings › Game).`),
      row, row2, list,
    );
    refresh();
  }
  private saveRow(nm: string, summary: string, when: string, auto: boolean, refresh: () => void) {
    const r = h("div", "gt-save");
    const txt = h("div");
    txt.append(h("b", "", auto ? "Autosave" : nm), h("span", "", `${summary} · ${when}`));
    const acts = h("div", "gt-acts");
    acts.append(btn("Load", () => this.run(() => this.g.load(nm))), btn("⤓", () => this.run(() => this.g.exportSave(nm))));
    if (!auto) acts.append(btn("✕", () => this.run(() => (this.g.deleteSave(nm), refresh()))));
    r.append(txt, acts);
    return r;
  }

  // ------------------------------------------------------------------------------ Perf
  private perf() {
    const head = h("div", "gt-kv");
    const gpu = h("table", "gt-table");
    const cpu = h("table", "gt-table");
    const qual = h("div", "gt-row");
    for (const [q, label] of [["game", "Game (≈ 60 fps)"], ["realtime", "RT max (sharp, ≈ 30)"], ["high", "High"]] as const) {
      qual.append(btn(label, () => this.run(() => this.g.quality(q))));
    }
    qual.append(btn("Dynamic resolution on/off", () => this.run(() => this.g.set("dynamicResolution", !this.g.get("dynamicResolution")))));
    this.body.append(
      head, qual,
      h("div", "fl-label", "GPU passes (ms per frame they run in)"), gpu,
      h("div", "fl-label", "Main thread (ms per loop · worst over 3 s)"), cpu,
      h("p", "gt-note", "The frame rate is the lower of the GPU's (its passes, two frames in flight) and the display's. A hidden page is throttled by the browser. Settings › Render: quality, pixel ratio, frame budget, dynamic resolution."),
    );
    const fill = (t: HTMLElement, cols: string[], rows: (string | number)[][]) => {
      t.replaceChildren();
      const hr = h("tr");
      for (const c of cols) hr.append(h("th", "", c));
      t.append(hr);
      for (const r of rows) {
        const tr = h("tr");
        for (const c of r) tr.append(h("td", "", String(c)));
        t.append(tr);
      }
    };
    this.live = () => {
      const p = this.g.perf();
      head.replaceChildren();
      const kv = (k: string, v: string) => head.append(h("span", "", k), h("b", "", v));
      kv("Frames rendered", `${p.renderFps.toFixed(0)} / s (loop ${p.loopFps.toFixed(0)} / s)`);
      kv("GPU per frame", `${p.gpuFrameMs.toFixed(1)} ms · passes ${p.gpuPassesMs.toFixed(1)} ms`);
      kv("Image", `${p.image} · pixel ratio ${p.pixelRatio} × ${p.renderScale.toFixed(3)}`);
      kv("Quality", `${p.quality} · budget ${p.budgetMs} ms · 1 ray / ${p.block}×${p.block} px`);
      kv("Worst loop", `${p.worstLoopMs.toFixed(1)} ms`);
      fill(gpu, ["Pass", "ms", "last"], p.gpu.slice(0, 14).map((g) => [g.pass, g.ms.toFixed(2), g.last.toFixed(2)]));
      fill(cpu, ["Section", "ms", "worst"], p.cpu.slice(0, 12).map((c) => [c.section, c.ms.toFixed(2), c.worst.toFixed(1)]));
    };
  }

  // ------------------------------------------------------------------------------ Audit
  private audit() {
    const planner = h("input") as HTMLInputElement;
    planner.type = "checkbox";
    const out = h("div");
    const show = (rep: AuditReport) => {
      out.replaceChildren();
      out.append(h("div", "gt-note", `${rep.counts.pass} pass · ${rep.counts.warn} warn · ${rep.counts.fail} fail · ${rep.counts.skip} skipped — ${rep.sceneDate}`));
      const tbl = h("table", "gt-table gt-audit");
      for (const c of rep.checks) {
        const tr = h("tr", c.verdict);
        tr.append(h("td", "gt-v", c.verdict.toUpperCase()), h("td", "", c.name), h("td", "", c.detail));
        tbl.append(tr);
      }
      out.append(tbl, btn("Download the report", () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(rep, null, 1)], { type: "application/json" }));
        a.download = `audit-${rep.at.slice(0, 19).replace(/:/g, "-")}.json`;
        a.click();
      }));
    };
    const go = btn("RUN THE AUDIT", () =>
      this.run(async () => {
        go.disabled = true;
        go.textContent = "Running…";
        try {
          show(await this.g.audit({ planner: planner.checked }));
        } finally {
          go.disabled = false;
          go.textContent = "RUN THE AUDIT";
        }
      }), "gt-primary");
    this.body.append(
      h("p", "gt-note", "Checks the ephemeris, the ship's state and sphere of influence, the free-fall predictor against Kepler, a save's round trip, the settings, the frame rate, the steadiness of the ship's light and of the auto exposure, the errors — and, ticked, the planner on the target."),
      field("Include the planner (slow)", planner), go, out,
    );
    if (this.g.lastAudit) show(this.g.lastAudit);
  }

  // ------------------------------------------------------------------------------ Journal
  private journal() {
    const kinds: (LogKind | "all")[] = ["all", "pilot", "soi", "status", "place", "save", "audit", "info", "warn", "error"];
    const filter = select(kinds.map((k) => [k, k]), (this.body.dataset.filter as string) || "all");
    const list = h("div", "gt-log");
    const render = () => {
      list.replaceChildren();
      const ev = this.g.log.events.filter((e) => filter.value === "all" || e.kind === filter.value).slice(-300).reverse();
      for (const e of ev) {
        const r = h("div", `gt-ev ${e.kind}`);
        r.append(h("span", "", new Date(e.at).toLocaleTimeString()), h("span", "", Number.isFinite(e.t) ? fmtDate(e.t) : ""), h("b", "", e.kind), h("div", "", e.text));
        list.append(r);
      }
      if (!ev.length) list.append(h("p", "gt-note", "Nothing yet."));
    };
    filter.onchange = render;
    const acts = h("div", "gt-row");
    acts.append(
      field("Show", filter),
      btn("Copy", () => this.run(() => navigator.clipboard.writeText(this.g.log.text(fmtDate)))),
      btn("Download", () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([this.g.log.text(fmtDate)], { type: "text/plain" }));
        a.download = "ranger-journal.txt";
        a.click();
      }),
      btn("Clear", () => (this.g.log.clear(), render())),
    );
    this.body.append(acts, list);
    render();
  }
}
