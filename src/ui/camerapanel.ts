// The camera panel: one place for the camera in every mode. Without the ship: where it stands (around
// the target, following it, free, on a tripod, falling freely), where it looks (locked on the target or
// free), the lens (a focal length, the telescope), the target (a search, the bodies by kind, framing
// it, going there), the relativistic observer's motion and the cinematics. With the ship: its views
// (on board, outside: around it, free, a fly-by) with the same look, lens and target. Opened by the
// toolbar's camera button, the flight HUD's view button, or C / Y / V and Tab from the keyboard.

import type { CameraController } from "../controls";
import { TELE_MIN } from "../controls";
import { cameraFrame } from "../camera";
import { MOUNTS, type Mount } from "../mounts";
import type { Settings, Target } from "../settings";
import { BODY_NAMES } from "../targeting";
import { SOLAR_BODIES } from "../system/solar";
import { fmtAngle, focalLength } from "./telescope";

/** The camera's placements without the ship: the rig's four, and falling freely (gravity). */
export type View = Settings["rotation"] | "fall";
export const VIEWS: View[] = ["orbit", "follow", "free", "tripod", "fall"];
export const VIEW_LABEL: Record<View, string> = { orbit: "Around", follow: "Follow", free: "Free", tripod: "Tripod", fall: "Free fall" };
export const VIEW_HELP: Record<View, string> = {
  orbit: "Circles the target — drag to turn about it, scroll to come closer",
  follow: "Moves with the target — drag to look around, fly to shift the camera",
  free: "Flies freely, carried by the nearest world — drag to look around",
  tripod: "Fixed on the nearest world, turning with it — a time-lapse's camera (⇧T: set down on the ground)",
  fall: "A massive body in free fall along its geodesic — the keys thrust",
};
/** Their glyphs (24 × 24 line icons). */
const VIEW_ICON: Record<View, string> = {
  orbit: '<circle cx="12" cy="12" r="2.6" class="f"/><ellipse cx="12" cy="12" rx="9" ry="4.2"/><circle cx="20.2" cy="10.4" r="1.5" class="f"/>',
  follow: '<circle cx="15" cy="12" r="3" class="f"/><path d="M3 12h6M6 9l3 3-3 3"/><path d="M18.5 7.5a6.5 6.5 0 0 1 0 9"/>',
  free: '<path d="M12 3l3 7h6l-5 4 2 7-6-4-6 4 2-7-5-4h6z"/>',
  tripod: '<path d="M12 5v6M12 11l-6 9M12 11l6 9M12 11v9"/><rect x="8.5" y="3" width="7" height="4" rx="1"/>',
  fall: '<circle cx="12" cy="7" r="3" class="f"/><path d="M12 12v8M8 16l4 4 4-4"/><path d="M5 4.5a9 9 0 0 0 0 5M19 4.5a9 9 0 0 1 0 5"/>',
};
const MOUNT_ICON = {
  on: '<path d="M4 16l8-11 8 11-8-3z"/><circle cx="12" cy="10.5" r="1.4" class="f"/>',
  around: VIEW_ICON.orbit,
  free: VIEW_ICON.free,
  flyby: '<path d="M3 17c4-1 8-5 11-10"/><path d="M11 6l3 1 1-3"/><path d="M17 20v-5l-3-2"/><circle cx="17" cy="12" r="1.3" class="f"/>',
  station: '<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M8 9V4M16 9V4M8 15v5M16 15v5"/><circle cx="12" cy="12" r="1.5" class="f"/>',
};
const ICON = {
  look: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.4" class="f"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  tele: '<path d="M3 14l13-6 2 4-13 6z"/><path d="M16 8l3-1.5 2 4-3 1.5"/><path d="M9 16l-2 5M11 15l3 6"/>',
  mouse: '<rect x="7" y="3" width="10" height="16" rx="5"/><path d="M12 3v6"/>',
  level: '<path d="M3 13h18"/><path d="M6 17h12" opacity=".5"/><circle cx="12" cy="9" r="2.2"/>',
  ahead: '<path d="M4 12h13M13 7l5 5-5 5"/>',
  frame: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><circle cx="12" cy="12" r="3" class="f"/>',
  go: '<path d="M5 19L19 5M10 5h9v9"/>',
  ground: '<path d="M2 20h20"/><path d="M12 6v6M12 12l-5 8M12 12l5 8"/><rect x="9" y="3" width="6" height="4" rx="1"/>',
  orbit: '<path d="M19.2 8.4A8 8 0 1 1 15.6 4.9"/><circle cx="12" cy="12" r="2.2" class="f"/><circle cx="18" cy="6" r="2" class="f"/>',
  dive: '<path d="M12 3v14"/><path d="M6.5 12.5 12 18l5.5-5.5"/><path d="M5 21h14"/>',
  journey: '<ellipse cx="6" cy="12" rx="2.2" ry="6"/><ellipse cx="18" cy="12" rx="2.2" ry="6"/><path d="M6 6c4 3 8 3 12 0M6 18c4-3 8-3 12 0"/>',
};

/** The targets' colours (the list's dots, the toolbar's chip, the markers). */
export const BODY_COLOURS: Record<Target, string> = {
  hole: "255, 179, 92", star: "255, 217, 138", wormhole: "159, 184, 255", barycentre: "235, 240, 255",
  miller: "140, 210, 220", mann: "220, 232, 245", k2: "255, 190, 120", edmunds: "220, 170, 120", iss: "95, 255, 208",
  ranger: "255, 214, 120", lander: "255, 160, 200", endurance: "200, 225, 255",
  sun: "255, 236, 170", mercury: "190, 180, 170", venus: "240, 220, 170", earth: "120, 180, 255", moon: "210, 210, 210",
  mars: "240, 130, 90", phobos: "170, 150, 130", deimos: "170, 150, 130", ceres: "180, 180, 180", jupiter: "230, 200, 160",
  io: "240, 220, 120", europa: "220, 210, 190", ganymede: "190, 180, 170", callisto: "160, 150, 140", saturn: "235, 215, 160",
  mimas: "210, 210, 210", enceladus: "240, 245, 255", tethys: "220, 220, 220", dione: "210, 210, 210", rhea: "210, 210, 210",
  titan: "235, 170, 90", iapetus: "200, 190, 170", uranus: "160, 220, 230", neptune: "110, 150, 255", triton: "220, 210, 220",
  pluto: "220, 190, 160", charon: "190, 190, 190",
};

/** The relativistic observer's motion (settings.motion) as offered: the rest are the controller's. */
const OBSERVER: [Settings["motion"], string, string][] = [
  ["static", "Carried", "At rest where the camera is carried (a world, the star's frame, the centre of mass)"],
  ["orbit", "Orbiting", "On a circular orbit: aberration and Doppler of the orbital speed"],
  ["infall", "Falling", "Falling from rest at infinity (the rain frame): the sky crowds ahead"],
  ["forward", "Boost", "Moving forwards at β: the searchlight effect"],
];

/** The worlds one can stand on: our planets and moons with a ground, Gargantua's three. */
const SOLID = new Set<Target>([...SOLAR_BODIES.filter((b) => b.kind === "planet" && b.surface !== "gas").map((b) => b.id as Target), "miller", "mann", "edmunds"]);

/** A lens's focal lengths on a 35 mm frame [mm], and the telescope's. */
const LENSES = [14, 24, 35, 50, 85, 200, 600];
const SCOPES = [2000, 8000, 20000, 70000];
/** The slider's ranges of focal length [mm]: a lens, the telescope. */
const LENS_RANGE: [number, number] = [8, focalLength(1)];
const SCOPE_RANGE: [number, number] = [300, focalLength(TELE_MIN)];

export interface CameraPanelDeps {
  settings: Settings;
  camera: CameraController;
  /** the view without the ship: a placement or falling freely */
  view(): View;
  setView(v: View): void;
  setMount(m: Mount): void;
  /** a cinematic started (or stopped) */
  cinematic(c: "orbit" | "dive" | "journey"): void;
  /** the camera taken to a body (anywhere in the world: through the wormhole too); why not, or null */
  goTo(b: Target): string | null;
  /** the camera on a tripod on a world's ground (the target, the nearest), facing the horizon; why not, or null */
  standOn(b?: Target): string | null;
  /** settings the panel changed (routed like the settings panel's) */
  changed(keys: (keyof Settings)[]): void;
  toast(t: string): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const fmtFocal = (f: number) => (f >= 1e4 ? `${(f / 1e3).toFixed(f >= 1e5 ? 0 : 1)} m` : `${Math.round(f)} mm`);

export class CameraPanel {
  readonly el = h("div");
  private filter = "";
  private statusMode = h("span", "cp-mode");
  private statusText = h("span", "cp-carried");
  private lensValue = h("span", "cp-value");
  private lensRange = h("input") as HTMLInputElement;
  private lastKey = "";

  constructor(private d: CameraPanelDeps) {
    this.el.id = "cam-pop";
    this.el.hidden = true;
    document.body.append(this.el);
    addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && !this.el.hidden && !(e.target as HTMLElement).closest?.("input")) this.toggle(false);
    });
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(open = this.el.hidden) {
    this.el.hidden = !open;
    this.filter = "";
    this.lastKey = "";
    this.refresh();
  }

  /** What the panel shows depends on: rebuilt when it changes (the camera's mode, the target…). */
  private key() {
    const s = this.d.settings, c = this.d.camera;
    return [s.ship, s.shipMount, this.d.view(), s.lookAt, s.telescope, s.target, c.flyMode, c.cinematic, s.motion, cameraFrame(s).region, c.availableTargets().join()].join();
  }

  /** Rebuilds the panel (when open); cheap to call often — only its state line moves otherwise. */
  refresh(force = false) {
    if (this.el.hidden) return;
    const k = this.key();
    if (!force && k === this.lastKey) return this.status();
    this.lastKey = k;
    const { settings: s, camera: c } = this.d;
    const el = this.el;
    const scroll = el.scrollTop;
    el.replaceChildren();
    const head = h("div", "fl-title cp-head");
    head.append(h("span", "fl-htext", s.ship ? "Camera · Ranger" : "Camera"));
    const x = h("button", "cp-x", "×");
    x.title = "Close (Esc)";
    x.onclick = () => this.toggle(false);
    head.append(x);
    const st = h("div", "cp-state");
    st.append(this.statusMode, this.statusText);
    el.append(head, st);

    if (s.ship) this.shipViews();
    else this.placements();
    this.looks();
    this.lens();
    this.targets();
    if (!s.ship) {
      this.motion();
      this.cinematics();
    }
    this.status();
    el.scrollTop = scroll;
    void c;
  }

  // ---------------------------------------------------------------------------------- pieces
  private section(label: string, hint = "") {
    const sec = h("div", "cp-sec");
    const l = h("div", "cp-label", label);
    if (hint) l.append(h("small", "cp-hint", hint));
    sec.append(l);
    this.el.append(sec);
    return sec;
  }

  private tile(icon: string, name: string, desc: string, active: boolean, on: () => void, key = "") {
    const b = h("button", "cp-tile");
    b.classList.toggle("active", active);
    const i = h("span", "cp-ti");
    i.innerHTML = svg(icon);
    const t = h("span", "cp-tt");
    const nm = h("b", "", name);
    if (key) nm.append(h("kbd", "", key));
    t.append(nm, h("small", "", desc));
    b.append(i, t);
    b.onclick = () => {
      on();
      this.refresh(true);
    };
    return b;
  }

  private chip(icon: string, name: string, tip: string, on: boolean, fn: () => void, key = "") {
    const b = h("button", "cp-chip");
    b.classList.toggle("on", on);
    b.innerHTML = svg(icon);
    b.append(h("span", "", name));
    if (key) b.append(h("kbd", "", key));
    b.dataset.tip = tip;
    b.onclick = () => {
      fn();
      this.refresh(true);
    };
    return b;
  }

  private placements() {
    const sec = this.section("Placement", "V · ⇧V");
    const tiles = h("div", "cp-tiles cp-tiles-5");
    const now = this.d.view();
    for (const v of VIEWS) tiles.append(this.tile(VIEW_ICON[v], VIEW_LABEL[v], VIEW_HELP[v], now === v, () => this.d.setView(v)));
    const row = h("div", "cp-chips");
    row.append(this.chip(ICON.ground, "Set down on the ground", "The tripod on the target's ground when it is a world, else the nearest one's — level, looking at the horizon", false, () => {
      const why = this.d.standOn();
      if (why) this.d.toast(why);
    }, "⇧T"));
    sec.append(tiles, row);
  }

  private shipViews() {
    const s = this.d.settings;
    for (const [g, outside] of [["On the ship", false], ["Outside", true]] as const) {
      const sec = this.section(g, outside ? "" : "V · ⇧V");
      const tiles = h("div", "cp-tiles cp-tiles-3");
      for (const m of Object.keys(MOUNTS) as Mount[]) {
        const o = (MOUNTS[m] as { outside?: "around" | "free" | "flyby" | "station" }).outside;
        if (!!o !== outside) continue;
        tiles.append(this.tile(o ? MOUNT_ICON[o] : MOUNT_ICON.on, MOUNTS[m].short, MOUNTS[m].label, s.shipMount === m, () => this.d.setMount(m)));
      }
      sec.append(tiles);
    }
  }

  private looks() {
    const { settings: s, camera: c } = this.d;
    const sec = this.section("View");
    const row = h("div", "cp-chips");
    const around = !s.ship && this.d.view() === "orbit";
    row.append(
      this.chip(ICON.look, around ? "On the target" : "Look at target", around ? "Around the target the view is always on it (right-drag: an offset)" : "The view locked on the target, wherever the camera goes (drag: where it sits in the view)",
        around || s.lookAt, () => !around && c.setLookAt(!s.lookAt), "C"),
      this.chip(ICON.tele, "Telescope", "A long lens down to a 0.02° field, held on the target, with a reticle and the angular scale — the wheel zooms", s.telescope, () => c.setTelescope(!s.telescope), "Y"),
    );
    if (s.ship) {
      row.append(
        this.chip(ICON.ahead, "Look ahead", "The camera back along its mount's axis (double-click)", false, () => c.setLook(0, 0)),
        this.chip(ICON.ahead, "Reset camera", "Back to the craft's attach points as they are: looking ahead, no lock, the outside views' own places — from outside, back on the hull", false, () => {
          this.d.toast(c.resetShipView());
          this.refresh?.();
        }, "⇧R"),
      );
    }
    else {
      row.append(
        this.chip(ICON.mouse, "Mouse look", "Game-style flight: the mouse turns the camera, the wheel sets the speed (middle click; Esc leaves)", c.flyMode, () => c.setFlyMode(!c.flyMode)),
        this.chip(ICON.level, "Level", "Recentre on the target, or level the horizon (⇧R, double-click on the sky)", false, () => c.resetView()),
      );
    }
    sec.append(row);
  }

  private lens() {
    const s = this.d.settings, c = this.d.camera;
    const sec = this.section(s.telescope ? "Telescope" : "Lens", "wheel · Alt+wheel");
    const [lo, hi] = s.telescope ? SCOPE_RANGE : LENS_RANGE;
    const r = this.lensRange;
    r.type = "range";
    r.min = "0";
    r.max = "1000";
    r.step = "1";
    const toU = (f: number) => Math.round((1000 * Math.log(f / lo)) / Math.log(hi / lo));
    const toF = (u: number) => lo * (hi / lo) ** (u / 1000);
    r.value = String(Math.min(1000, Math.max(0, toU(focalLength(s.fov)))));
    r.oninput = () => {
      const f = toF(Number(r.value));
      c.setFov((360 / Math.PI) * Math.atan(12 / f));
    };
    const row = h("div", "cp-speed");
    row.append(r, this.lensValue);
    const presets = h("div", "cp-chips cp-lenses");
    for (const f of s.telescope ? SCOPES : LENSES) {
      const b = h("button", "cp-chip cp-lens", fmtFocal(f));
      b.onclick = () => c.setFov((360 / Math.PI) * Math.atan(12 / f));
      presets.append(b);
    }
    if (s.telescope) {
      const b = h("button", "cp-chip cp-lens");
      b.innerHTML = svg(ICON.frame);
      b.append(h("span", "", "Frame the target"));
      b.onclick = () => {
        const info = c.targetInfo();
        if (info && info.ang > 0) c.setFov(Math.min(20, Math.max(TELE_MIN, ((info.ang * 360) / Math.PI) * 3)));
      };
      presets.prepend(b);
    }
    sec.append(row, presets);
  }

  private targets() {
    const { settings: s, camera: c } = this.d;
    const sec = this.section("Target", "Tab · click it in the view");
    const search = h("input", "cp-search") as HTMLInputElement;
    search.type = "search";
    search.placeholder = "Search a body…";
    search.value = this.filter;
    const acts = h("div", "cp-chips");
    const name = BODY_NAMES[s.target];
    acts.append(this.chip(ICON.frame, `Frame ${name}`, "Fly the view to it and frame it (double-click it)", false, () => {
      if (s.ship) return this.d.toast("The Ranger flies there: the planner (O) or the autopilot (0: approach)");
      if (this.d.view() !== "orbit") this.d.setView("orbit");
      c.selectTarget(s.target, { frame: !c.gravity });
    }));
    if (!s.ship) acts.append(this.chip(ICON.go, `Go to ${name}`, "Take the camera there — anywhere in the world, through the wormhole too: in orbit around it", false, () => {
      const why = this.d.goTo(s.target);
      if (why) this.d.toast(why);
    }));
    if (!s.ship && SOLID.has(s.target)) acts.append(this.chip(ICON.ground, `Stand on ${name}`, "A tripod on its ground, under where the camera is (or on the side facing it), level, looking at the horizon", false, () => {
      const why = this.d.standOn(s.target);
      if (why) this.d.toast(why);
    }, "⇧T"));
    const lists = h("div", "cp-groups");
    const fill = () => {
      lists.replaceChildren();
      const q = this.filter.trim().toLowerCase();
      for (const [g, list] of this.groups(c.availableTargets())) {
        const items = list.filter((b) => !q || BODY_NAMES[b].toLowerCase().includes(q));
        if (!items.length) continue;
        lists.append(h("div", "cp-gname", g));
        const box = h("div", "cp-bodies");
        for (const b of items) {
          const btn = h("button", "cp-body");
          btn.classList.toggle("active", s.target === b);
          const dot = h("i");
          dot.style.background = `rgb(${BODY_COLOURS[b] ?? "200, 200, 200"})`;
          btn.append(dot, h("span", "", BODY_NAMES[b]));
          btn.onclick = () => {
            c.selectTarget(b, { focus: true });
            this.refresh(true);
          };
          btn.ondblclick = () => {
            if (!s.ship) {
              if (this.d.view() !== "orbit") this.d.setView("orbit");
              c.selectTarget(b, { frame: !c.gravity });
            }
          };
          box.append(btn);
        }
        lists.append(box);
      }
    };
    search.oninput = () => {
      this.filter = search.value;
      fill();
    };
    search.onkeydown = (e) => {
      if (e.key === "Escape") (search.value = ""), (this.filter = ""), fill(), search.blur();
      e.stopPropagation();
    };
    fill();
    sec.append(acts, search, lists);
  }

  /** the targets by kind: the worlds here, their moons, what lies beyond the wormhole */
  private groups(list: Target[]): [string, Target[]][] {
    const s = this.d.settings;
    const ours = list.filter((b) => SOLAR_BODIES.some((q) => q.id === b));
    const craft: Target[] = list.filter((b) => b === "iss" || b === "ranger" || b === "lander" || b === "endurance");
    const theirs = list.filter((b) => !ours.includes(b) && !craft.includes(b));
    const planets = ours.filter((b) => {
      const q = SOLAR_BODIES.find((x) => x.id === b)!;
      return !q.parent || q.parent === "sun";
    });
    const moons = ours.filter((b) => !planets.includes(b));
    const cam = cameraFrame(s);
    const here = cam.region === "throat" && cam.ell < 0;
    const g: [string, Target[]][] = here
      ? [["The Sun and the planets", planets], ["Moons", moons], ["Spacecraft", craft], ["Beyond the wormhole", theirs]]
      : [["Gargantua's system", theirs], ["Through the wormhole — the Sun and the planets", planets], ["Moons", moons], ["Spacecraft", craft]];
    return g.filter(([, l]) => l.length);
  }

  private motion() {
    const { settings: s, camera: c } = this.d;
    const sec = this.section("Motion");
    const speed = h("div", "cp-speed");
    const r = h("input") as HTMLInputElement;
    r.type = "range";
    r.min = "-4";
    r.max = "4";
    r.step = "0.1";
    r.value = String(Math.log2(c.flySpeed));
    const v = h("span", "cp-value", `×${c.flySpeed.toFixed(2)}`);
    r.oninput = () => {
      c.flySpeed = 2 ** Number(r.value);
      v.textContent = `×${c.flySpeed.toFixed(2)}`;
    };
    speed.append(h("span", "cp-sub", "Flight speed"), r, v);
    sec.append(speed);
    // (the observer's own motion for the relativistic view: near the hole, not falling — a falling
    // camera's is its geodesic's)
    const cam = cameraFrame(s);
    if (cam.region !== "hole" || c.gravity) return;
    const seg = h("div", "cp-seg");
    const cur = s.motion === "orbit" || s.motion === "infall" || s.motion === "forward" ? s.motion : "static";
    for (const [m, label, tip] of OBSERVER) {
      const b = h("button", "", label);
      b.classList.toggle("on", cur === m);
      b.dataset.tip = tip;
      b.onclick = () => {
        s.motion = m;
        s.velR = s.velT = s.velP = 0;
        this.d.changed(["motion"]);
        this.refresh(true);
      };
      seg.append(b);
    }
    sec.append(h("div", "cp-sub", "The observer's motion (aberration, Doppler)"), seg);
    if (s.motion === "forward") {
      const row = h("div", "cp-speed");
      const br = h("input") as HTMLInputElement;
      br.type = "range";
      br.min = "0";
      br.max = "0.99";
      br.step = "0.01";
      br.value = String(s.beta);
      const bv = h("span", "cp-value", `β ${s.beta.toFixed(2)}`);
      br.oninput = () => {
        s.beta = Number(br.value);
        bv.textContent = `β ${s.beta.toFixed(2)}`;
        this.d.changed(["beta"]);
      };
      row.append(br, bv);
      sec.append(row);
    }
  }

  private cinematics() {
    const { settings: s, camera: c } = this.d;
    const sec = this.section("Cinematics", "they run with the time");
    const row = h("div", "cp-chips");
    row.append(
      this.chip(ICON.orbit, "Auto-orbit", "Circles the target at the cinematic speed", c.cinematic === "orbit", () => this.d.cinematic("orbit"), "O"),
      this.chip(ICON.dive, "Dive", "Free fall from rest at infinity to the horizon, in the falling frame", c.cinematic === "dive", () => this.d.cinematic("dive"), "⇧C"),
      this.chip(ICON.journey, "Journey", "Through the wormhole, to the black hole's universe or back", c.cinematic === "journey", () => this.d.cinematic("journey"), "T"),
    );
    const speed = h("div", "cp-speed");
    const r = h("input") as HTMLInputElement;
    r.type = "range";
    r.min = "0.5";
    r.max = "40";
    r.step = "0.5";
    r.value = String(s.cinematicSpeed);
    const v = h("span", "cp-value", `${s.cinematicSpeed}`);
    r.oninput = () => {
      s.cinematicSpeed = Number(r.value);
      v.textContent = `${s.cinematicSpeed}`;
      this.d.changed(["cinematicSpeed"]);
    };
    speed.append(h("span", "cp-sub", "Speed (°/s · M/s)"), r, v);
    sec.append(row, speed);
  }

  /** The state line and the lens's readout (every few frames). */
  status() {
    if (this.el.hidden) return;
    const { settings: s, camera: c } = this.d;
    const f = focalLength(s.fov);
    this.lensValue.textContent = `${fmtFocal(f)} · ${fmtAngle(s.fov)}`;
    if (document.activeElement !== this.lensRange) {
      const [lo, hi] = s.telescope ? SCOPE_RANGE : LENS_RANGE;
      this.lensRange.value = String(Math.min(1000, Math.max(0, Math.round((1000 * Math.log(f / lo)) / Math.log(hi / lo)))));
    }
    const look = s.lookAt || (!s.ship && this.d.view() === "orbit") ? ` · on ${BODY_NAMES[s.target]}` : "";
    if (s.ship) {
      this.statusMode.textContent = MOUNTS[s.shipMount as Mount]?.short ?? "";
      this.statusText.textContent = `Target: ${BODY_NAMES[s.target]}${s.lookAt ? " · locked" : ""}${s.telescope ? " · telescope" : ""}`;
      return;
    }
    const v = this.d.view();
    this.statusMode.textContent = VIEW_LABEL[v];
    const rs = c.rigStatus();
    const where = rs
      ? `${v === "orbit" ? "around" : "by"} ${BODY_NAMES[rs.body]} · ${fmtHeight(rs.h * 1476.625 * s.massSolar)} above it`
      : v === "orbit" ? `around ${BODY_NAMES[s.target]}` : v === "fall" ? "falling freely" : "in open space";
    this.statusText.textContent = where + (v === "orbit" ? "" : look) + (s.telescope ? " · telescope" : "") + (c.cinematic ? ` · ${c.cinematic}` : "");
  }
}

/** A height [m] as the panel shows it. */
export const fmtHeight = (m: number) => (m < 1e3 ? `${m.toFixed(0)} m` : m < 1e6 ? `${(m / 1e3).toFixed(m < 1e4 ? 1 : 0)} km` : `${(m / 1e6).toFixed(1)} Mm`);
