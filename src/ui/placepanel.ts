// Placing the ship (the HUD's Place button, the radial wheel, the pause menu): in orbit around any body,
// on a ground, beside a body at rest, before the wormhole on either side — over the game's tools
// (src/game/tools.ts: orbit, orbitOver, land, near, wormhole). A mission running ends, once confirmed;
// a scene without the game's world (a bare Kerr view) loads it first. The place found by its name too: a
// destination, a runway, coordinates typed, an address on the Earth (game/geocode.ts — WGS84 latitudes, as
// the ground and the orbit over it take them).

import "./placepanel.css";
import type { GameTools } from "../game/tools";
import { defaultAltKm, THEIR_IDS } from "../game/place";
import { SITES } from "../game/sites";
import { geocode, parseCoords } from "../game/geocode";
import { POI_KINDS, POIS, searchPois } from "../game/pois";
import { M_METRES, SOLAR_BODIES } from "../system/solar";
import { solidBody } from "../system/our-surface";
import { body as systemBody, GARGANTUA_SYSTEM } from "../system/bodies";
import { mouth } from "../wormhole";
import { BODY_NAMES } from "../targeting";
import type { Settings } from "../settings";
import { lang, t, tf, tr } from "../i18n";
import { GroundTrack } from "./groundtrack";
import { button, el as h, modal } from "./kit";

type Where = "orbit" | "ground" | "walk" | "near" | "wormhole";
type Universe = "ours" | "gargantua";

export interface PlaceHost {
  tools: GameTools;
  settings: Settings;
  /** the mission running (its name), or null */
  mission(): string | null;
  /** ends it: the controls the player's */
  endMission(): void;
  /** the placement made (main.ts placeShip: the game's world loaded if the scene lacks it, the walker back
   *  aboard, the panels redrawn): its note */
  place(f: () => string): string;
}

const nameOf = (id: string) => (BODY_NAMES as Record<string, string>)[id === "gargantua" ? "hole" : id] ?? id;
const D = Math.PI / 180;

export class PlacePanel {
  private picker: GroundTrack;
  private where: Where = "orbit";
  private uni: Universe = "ours";
  private body = "earth";
  private side: Universe = "ours";
  /** the place picked on the globe: latitude, east longitude [°] */
  private at: [number, number] | null = null;
  private close: (() => void) | null = null;

  constructor(private host: PlaceHost) {
    this.picker = new GroundTrack(host.settings);
  }

  get isOpen() {
    return !!this.close;
  }

  open(where?: Where) {
    if (this.close) return;
    const st = this.host.tools.status();
    this.uni = st.side === "gargantua" ? "gargantua" : "ours";
    this.body =
      this.uni === "ours" ? (st.soi && st.soi !== "sun" ? st.soi : "earth") : st.soi === "gargantua" ? "gargantua" : st.soi || "miller";
    if (where) this.where = where;
    this.at = null;
    const root = h("div", "pp");
    const m = modal({ title: t("Place the ship"), body: [root], cls: "pp-frame", testid: "place-panel", onClose: () => this.closed() });
    this.close = m.close;
    this.build(root);
  }

  private closed() {
    this.close = null;
    this.searching?.abort();
    this.searching = null;
    clearInterval(this.timer);
    this.picker.onPick = null;
  }
  private timer = 0;
  /** the address search under way (a newer one, the panel closed: dropped) */
  private searching: AbortController | null = null;

  private build(root: HTMLElement) {
    const T = this.host.tools;
    // ---- where
    const whereRow = h("div", "pp-seg");
    const WHERE: [Where, string, string][] = [
      ["orbit", t("In orbit"), t("On an orbit around the body")],
      ["ground", t("On the ground"), t("Landed, on its gear")],
      ["walk", t("On foot"), t("Land the ship and step out: explore on foot")],
      ["near", t("Beside it"), t("At rest beside the body: the hover autopilot holds the ship there")],
      ["wormhole", t("Wormhole"), t("Before one of its two mouths, at rest")],
    ];
    // ---- the body
    const uniRow = h("div", "pp-seg pp-uni");
    const bodies = h("div", "pp-bodies");
    const sides = h("div", "pp-sides");
    // ---- the parameters
    const params = h("div", "pp-params");
    const num = (v: number, step = "any", min?: number) => {
      const i = h("input", "pp-in") as HTMLInputElement;
      i.type = "number";
      i.step = step;
      if (min !== undefined) i.min = String(min);
      i.value = String(v);
      return i;
    };
    const field = (label: string, input: HTMLElement, unit = "") => {
      const f = h("label", "pp-field");
      f.append(h("span", "k-label", label), input, unit ? h("span", "pp-unit", unit) : "");
      return f;
    };
    const alt = num(400, "1", 0),
      apo = num(400, "1", 0),
      inc = num(0, "0.1"),
      rM = num(12, "0.1", 2),
      nearAlt = num(1000, "1", 0),
      nearM = num(12, "0.1", 2),
      dRho = num(4, "0.5", 1.5),
      lat = num(0, "any"),
      lon = num(0, "any");
    const retro = h("input") as HTMLInputElement;
    retro.type = "checkbox";
    const retroBox = h("label", "pp-check");
    retroBox.append(retro, h("span", "", t("Retrograde")));
    const orbitBox = h("div", "pp-grid");
    orbitBox.append(field(t("Periapsis"), alt, "km"), field(t("Apoapsis"), apo, "km"), field(t("Inclination"), inc, "°"), retroBox);
    const holeBox = h("div", "pp-grid");
    holeBox.append(field(t("Radius"), rM, "M"));
    const groundBox = h("div", "pp-grid");
    groundBox.append(field(t("Latitude"), lat, "°"), field(t("East longitude"), lon, "°"));
    const nearBox = h("div", "pp-grid");
    nearBox.append(field(t("Height above it"), nearAlt, "km"));
    const nearHoleBox = h("div", "pp-grid");
    nearHoleBox.append(field(t("From its centre"), nearM, "M"));
    const mouthBox = h("div", "pp-grid");
    mouthBox.append(field(t("From the mouth's centre"), dRho, t("throat radii")));
    params.append(orbitBox, holeBox, groundBox, nearBox, nearHoleBox, mouthBox);
    // ---- the globe and the sites
    const pickBox = h("div", "pp-pick");
    const pickNote = h("div", "pp-picknote");
    pickBox.append(this.picker.stage, pickNote);
    const sites = h("div", "pp-sites");
    // ---- the search: a destination, a runway, coordinates, an address (the Earth's)
    const findBox = h("div", "pp-find");
    const findIn = h("input", "pp-in pp-find-in") as HTMLInputElement;
    findIn.type = "search";
    findIn.placeholder = t("A destination, an address, coordinates…");
    findIn.setAttribute("data-testid", "place-search");
    findIn.setAttribute("aria-label", t("Search a place"));
    const findStatus = h("div", "pp-find-status");
    const findList = h("ul", "pp-find-list");
    findList.setAttribute("data-testid", "place-results");
    findBox.append(findIn, findStatus, findList);
    /** the place found by its name (the globe clicked, the latitude typed: none) */
    let placeName: string | null = null;
    // ---- what will happen, a refusal, the button
    const note = h("p", "pp-note");
    const err = h("p", "pp-err");
    const confirm = h("div", "pp-confirm");
    const go = button({ label: t("Place the ship"), kind: "primary", testid: "place-go", onClick: () => this.go(placeNow, confirm, err) });
    const foot = h("div", "pp-foot");
    foot.append(go);
    const quick = h("div", "pp-quick");
    const q = (label: string, f: () => unknown) => quick.append(button({ label, onClick: () => this.go(f, confirm, err) }));
    q(t("Low Earth orbit"), () => T.orbit("earth", { altKm: 400 }));
    q(t("KSC pad"), () => T.land("earth", 28.573, -80.649));
    q(t("Low lunar orbit"), () => T.orbit("moon", { altKm: 100 }));
    q(t("Before the wormhole"), () => T.wormhole("ours"));
    q(t("Orbit the target"), () => T.orbitTarget());
    root.append(
      h("div", "k-label pp-h", t("Where")),
      whereRow,
      uniRow,
      bodies,
      sides,
      params,
      findBox,
      pickBox,
      sites,
      note,
      err,
      confirm,
      foot,
      h("div", "k-label pp-h", t("Quick")),
      quick,
    );

    const ours = () => this.uni === "ours";
    const isHole = () => !ours() && this.body === "gargantua";
    const canLand = (id: string) => (THEIR_IDS.includes(id) ? id !== "gargantua" : solidBody(id));
    // walking: a solid body here; Gargantua's side, a surface that is neither gas nor ocean (Miller is
    // refused, Mann and Edmunds are not)
    const canWalk = (id: string) => {
      if (!canLand(id)) return false;
      if (!THEIR_IDS.includes(id)) return true;
      try {
        const s = systemBody(GARGANTUA_SYSTEM, id).surface;
        return !!s && s.kind !== "gas" && (s.kind !== "ocean" || id === "miller");
      } catch {
        return false;
      }
    };
    const pickable = () => this.body !== "sun" && this.body !== "gargantua";
    const drawPick = () => {
      const show = (this.where === "orbit" || this.where === "ground" || this.where === "walk") && pickable();
      pickBox.hidden = !show;
      findBox.hidden = !show || !ours();
      if (!show) return;
      this.picker.drawWorld(this.body, T.now());
      const at = this.at ? (placeName ? `${placeName} (${fmtAt(this.at)})` : fmtAt(this.at)) : "";
      pickNote.textContent =
        this.where === "ground" || this.where === "walk"
          ? this.at
            ? tf("Landing at {0}", at)
            : t("Click the world or search a place: where to land")
          : this.at
            ? tf("The orbit passes over {0} now", at)
            : t("Click the world or search a place: the orbit will pass over it now");
    };
    const setAt = (la: number, lo: number, centre = false, name: string | null = null) => {
      placeName = name;
      this.at = [la, lo];
      // (shown to the millionth of a degree — 0.1 m —; the place itself kept whole, as found or clicked)
      if (document.activeElement !== lat) lat.value = String(+la.toFixed(6));
      if (document.activeElement !== lon) lon.value = String(+lo.toFixed(6));
      this.picker.pick = [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
      if (centre) this.picker.centre(this.picker.pick);
      if (this.where === "orbit" && Math.abs(la) > +inc.value) inc.value = (Math.ceil(Math.abs(la) * 10) / 10).toFixed(1);
      describe();
      drawPick();
    };
    this.picker.onPick = (p) => setAt(Math.asin(Math.max(-1, Math.min(1, p[2]))) / D, Math.atan2(p[1], p[0]) / D);
    lat.oninput = lon.oninput = () => setAt(+lat.value, +lon.value);

    /**
     * The places by that name on this world: coordinates typed, its destinations and runways at once; on the
     * Earth, its addresses as one types (Photon, a pause first) — `explicit` (Enter): at once, Nominatim when
     * Photon finds nothing.
     */
    const search = (explicit = false) => {
      this.searching?.abort();
      this.searching = null;
      const q = findIn.value.trim();
      const id = this.body;
      const rows: { name: string; sub: string; lat: number; lon: number }[] = [];
      const c = q ? parseCoords(q) : null;
      if (c) rows.push({ name: fmtAt([c.lat, c.lon]), sub: t("Coordinates"), ...c });
      if (q) {
        if (id === "earth" || id === "moon" || id === "mars")
          for (const p of searchPois(q, POIS, id).slice(0, 8))
            rows.push({ name: tr(p.name), sub: tr(POI_KINDS[p.kind]), lat: p.lat, lon: p.lon });
        const w = q.toLowerCase();
        for (const x of SITES)
          if (x.body === id && (x.name.toLowerCase().includes(w) || x.icao?.toLowerCase() === w))
            rows.push({ name: x.name, sub: t("Runway or site"), lat: x.lat, lon: x.lon });
      }
      const show = (more: typeof rows) => {
        findList.replaceChildren();
        // (OpenStreetMap's same place under several entries: once)
        const seen = new Set<string>();
        const all = [...rows, ...more].filter((r) => {
          const k = `${r.name}|${r.lat.toFixed(3)}|${r.lon.toFixed(3)}`;
          return !seen.has(k) && !!seen.add(k);
        });
        for (const r of all.slice(0, 14)) {
          const b = h("button", "pp-find-item") as HTMLButtonElement;
          b.type = "button";
          b.setAttribute("data-testid", "place-result");
          b.onclick = () => setAt(r.lat, r.lon, true, r.name);
          b.append(h("b", "", r.name), h("small", "", r.sub));
          const li = h("li", "");
          li.append(b);
          findList.append(li);
        }
      };
      show([]);
      findStatus.textContent = q && !rows.length && (id !== "earth" || q.length < 3 || c) ? t("Nothing by that name here") : "";
      if (id !== "earth" || q.length < 3 || c) return;
      const ctl = new AbortController();
      this.searching = ctl;
      findStatus.textContent = t("Searching the addresses…");
      // (near the place picked, else the ship's: the nearer first)
      const near = this.at ? { lat: this.at[0], lon: this.at[1] } : undefined;
      setTimeout(
        () => {
          if (ctl.signal.aborted) return;
          void geocode(q, { lang, near, signal: ctl.signal, fallback: explicit }).then(
            (r) => {
              if (ctl.signal.aborted) return;
              show(r.map((g) => ({ name: g.name, sub: g.detail || g.kind, lat: g.lat, lon: g.lon })));
              findStatus.textContent = r.length || rows.length ? "" : t("No address found");
            },
            () => {
              if (!ctl.signal.aborted) findStatus.textContent = rows.length ? "" : t("No address found");
            },
          );
        },
        explicit ? 0 : 350,
      );
    };
    findIn.oninput = () => search();
    findIn.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      // (the first place found taken; none yet: asked again at once, OpenStreetMap's Nominatim too)
      const first = findList.querySelector("button") as HTMLButtonElement | null;
      if (first) first.click();
      else search(true);
    };

    const fillSites = () => {
      sites.replaceChildren();
      if (this.where !== "ground" && this.where !== "walk") return;
      for (const s of SITES.filter((x) => x.body === this.body)) {
        const b = button({ label: s.name, onClick: () => setAt(s.lat, s.lon, true) });
        b.classList.add("pp-site");
        sites.append(b);
      }
    };
    const describe = () => {
      const n = nameOf(this.body);
      note.textContent =
        this.where === "wormhole"
          ? this.side === "ours"
            ? t("Before our mouth of the wormhole, beyond Saturn: at rest, the mouth targeted, the hover autopilot on")
            : t("Before the far mouth, Gargantua beyond it: at rest, the mouth targeted, the hover autopilot on")
          : this.where === "near"
            ? tf("Beside {0}, at rest on its sunlit side: the body targeted, the hover autopilot holding the ship", n)
            : this.where === "ground"
              ? tf("On {0}'s ground, on the gear — the flight started afresh", n)
              : this.where === "walk"
                ? tf("On {0}'s ground, on foot — the ship landed beside you, the walk starts at once", n)
                : isHole()
                  ? t("On a circular orbit around Gargantua (Kerr), in its equator")
                  : tf("On an orbit around {0} — the flight started afresh: engine off, no plan", n);
    };
    const layout = () => {
      for (const [w, b] of whereBtns) b.classList.toggle("on", w === this.where);
      for (const [u, b] of uniBtns) b.classList.toggle("on", u === this.uni);
      const wh = this.where === "wormhole";
      uniRow.hidden = bodies.hidden = wh;
      sides.hidden = !wh;
      for (const [u, b] of sideBtns) b.classList.toggle("on", u === this.side);
      // the bodies of the universe, those that cannot take the placement greyed
      bodies.replaceChildren();
      const list: string[] = ours() ? SOLAR_BODIES.map((b) => b.id) : THEIR_IDS;
      if (!list.includes(this.body)) this.body = ours() ? "earth" : "miller";
      const walk = this.where === "walk";
      if ((this.where === "ground" && !canLand(this.body)) || (walk && !canWalk(this.body))) this.body = ours() ? "earth" : "miller";
      for (const id of list) {
        const sb = SOLAR_BODIES.find((b) => b.id === id);
        const b = button({ label: nameOf(id), testid: `place-body-${id}`, onClick: () => pickBody(id) });
        b.classList.add("pp-body");
        if (sb?.parent && sb.parent !== "sun") b.classList.add("pp-moon");
        b.classList.toggle("on", id === this.body);
        b.disabled = (this.where === "ground" && !canLand(id)) || (walk && !canWalk(id));
        if (b.disabled) b.title = t(walk ? "No ground to walk on" : "No ground to land on");
        bodies.append(b);
      }
      orbitBox.hidden = this.where !== "orbit" || isHole();
      holeBox.hidden = this.where !== "orbit" || !isHole();
      groundBox.hidden = !(this.where === "ground" || walk);
      nearBox.hidden = this.where !== "near" || isHole();
      nearHoleBox.hidden = this.where !== "near" || !isHole();
      mouthBox.hidden = !wh;
      fillSites();
      describe();
      drawPick();
    };
    const pickBody = (id: string) => {
      this.body = id;
      this.at = null;
      placeName = null;
      this.picker.pick = null;
      const a = ours() ? defaultAltKm(id) : 100;
      alt.value = apo.value = String(a);
      const sb = SOLAR_BODIES.find((b) => b.id === id);
      // (two radii above it: three from its centre — the approach's stand-off)
      nearAlt.value = String(Math.round(sb ? (2 * sb.radius * M_METRES) / 1e3 : 1000));
      layout();
      // (the same words looked for on the new world)
      search();
    };
    const whereBtns = WHERE.map(([w, label, tip]) => {
      const b = button({ label, title: tip, testid: `place-${w}`, onClick: () => ((this.where = w), (this.at = null), layout()) });
      whereRow.append(b);
      return [w, b] as const;
    });
    const uniBtns = (
      [
        ["ours", t("Solar system")],
        ["gargantua", t("Gargantua's system")],
      ] as const
    ).map(([u, label]) => {
      const b = button({ label, onClick: () => ((this.uni = u), pickBody(u === "ours" ? "earth" : "miller")) });
      uniRow.append(b);
      return [u, b] as const;
    });
    const sideBtns = (
      [
        ["ours", t("Our side (beyond Saturn)")],
        ["gargantua", t("Gargantua's side")],
      ] as const
    ).map(([u, label]) => {
      const b = button({ label, testid: `place-side-${u}`, onClick: () => ((this.side = u), layout()) });
      sides.append(b);
      return [u, b] as const;
    });

    const placeNow = () => {
      const id = this.body;
      switch (this.where) {
        case "wormhole": {
          const rho = mouth(this.host.settings).w.rho;
          return T.wormhole(this.side, Math.max(+dRho.value, 1.5) * rho);
        }
        case "near":
          return isHole() ? T.near("gargantua", { rM: Math.max(+nearM.value, 2) }) : T.near(id, { altKm: Math.max(+nearAlt.value, 0) });
        case "ground":
          return T.land(id, this.at?.[0] ?? +lat.value, this.at?.[1] ?? +lon.value);
        case "walk":
          return T.walk(id, this.at?.[0] ?? +lat.value, this.at?.[1] ?? +lon.value);
        default: {
          if (isHole()) return T.orbit("gargantua", { rM: Math.max(+rM.value, 2), retrograde: retro.checked });
          const o = { peKm: Math.max(+alt.value, 0), apKm: Math.max(+apo.value, +alt.value), inc: +inc.value, retrograde: retro.checked };
          return this.at ? T.orbitOver(id, this.at[0], this.at[1], o) : T.orbit(id, o);
        }
      }
    };

    pickBody(this.body);
    // (the world turns, the Sun with the time: the globe redrawn every second)
    this.timer = window.setInterval(drawPick, 1000);
  }

  /** Places (after the confirmation a running mission asks for), or says why not. */
  private go(f: () => unknown, confirm: HTMLElement, err: HTMLElement) {
    err.textContent = "";
    const mission = this.host.mission();
    if (mission && !confirm.childElementCount) {
      confirm.append(
        h("span", "", tf("The mission “{0}” will end.", mission)),
        button({
          label: t("End it and place"),
          kind: "danger",
          testid: "place-confirm",
          onClick: () => {
            confirm.replaceChildren();
            this.host.endMission();
            this.go(f, confirm, err);
          },
        }),
        button({ label: t("Cancel"), onClick: () => confirm.replaceChildren() }),
      );
      return;
    }
    confirm.replaceChildren();
    try {
      this.host.place(() => String(f() ?? ""));
      this.close?.();
    } catch (e) {
      err.textContent = (e as Error).message ?? String(e);
    }
  }
}

const fmtAt = (a: [number, number]) =>
  `${Math.abs(a[0]).toFixed(2)}° ${a[0] >= 0 ? "N" : "S"}, ${Math.abs(a[1]).toFixed(2)}° ${a[1] >= 0 ? "E" : "W"}`;
