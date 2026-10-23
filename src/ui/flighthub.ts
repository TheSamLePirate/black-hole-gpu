// A flight prepared (docs/PLAN-F35.md, F8): the F-35 set where and when to fly in one card — the airfield, the
// start (lined up on its runway in use, on a 15 km final, cruising 40 km out), the hour of the airfield's own
// day (dawn, morning, noon, dusk, night — or the clock as it is), the weather (weather.ts's presets, the real
// one), the fuel aboard, a flight plan to an arrival field (game/flightplan.ts) — then flown at once.

import { siteByName, worldSite } from "../world/fieldsite";
import { fieldByCode } from "../world/runways";
import "./flighthub.css";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import type { GameTools } from "../game/tools";
import { newPlan } from "../game/flightplan";
import { SITES } from "../game/sites";
import { t, tf, tr } from "../i18n";
import type { Settings } from "../settings";
import { isAircraft, VESSELS } from "../vessels";
import type { WeatherPreset } from "../weather";
import { button, el as h, modal } from "./kit";

export interface HubHost {
  tools: GameTools;
  settings: Settings;
  camera: CameraController;
  /** the weather setting changed: the real weather fetched, the scene redrawn */
  weatherChanged(): void;
  toast(s: string): void;
  /** the flight plan's panel */
  openRoute(): void;
}

type Start = "runway" | "final" | "cruise" | "stand";
type Hour = "now" | "dawn" | "morning" | "noon" | "dusk" | "night";

const FIELDS = SITES.filter((s) => s.body === "earth" && s.runway);
/** the hours of the airfield's own (mean solar) day */
const HOURS: Record<Exclude<Hour, "now">, number> = { dawn: 6.2, morning: 9.5, noon: 12.5, dusk: 18.6, night: 22.5 };
const WX: WeatherPreset[] = ["real", "fair", "cloudy", "overcast", "rain", "storm", "windy", "fog"];
const WX_NAMES: Record<string, { fr: string; en: string }> = {
  real: { fr: "Réelle", en: "Real" },
  fair: { fr: "Clair", en: "Fair" },
  cloudy: { fr: "Nuageux", en: "Cloudy" },
  overcast: { fr: "Couvert", en: "Overcast" },
  rain: { fr: "Pluie", en: "Rain" },
  storm: { fr: "Orage", en: "Storm" },
  windy: { fr: "Vent fort", en: "Strong wind" },
  fog: { fr: "Brouillard", en: "Fog" },
};

export class FlightHub {
  private close: (() => void) | null = null;
  private field: (typeof FIELDS)[number] = FIELDS.find((f) => f.icao === "KEDW") ?? FIELDS[0]!;
  private start: Start = "runway";
  private hour: Hour = "now";
  private wx: WeatherPreset | null = null;
  private fuel = 1;
  private dest: string | null = null;
  /** the A320's stand (its ref; empty: the nearest the airfield's middle) — the start at the gate */
  private standRef = "";

  constructor(private host: HubHost) {}

  get isOpen() {
    return !!this.close;
  }

  open() {
    if (this.close) return;
    const root = h("div", "fhb");
    const m = modal({
      title: fleet.active === "a320" ? t("Prepare a flight — A320") : t("Prepare a flight — F-35B"),
      body: [root],
      cls: "fhb-frame",
      testid: "flight-hub",
      onClose: () => (this.close = null),
    });
    this.close = m.close;
    this.wx = this.host.settings.weather;
    this.build(root);
  }

  /** A row of choices: one pressed. */
  private seg<T extends string>(label: string, items: [T, string, string?][], get: () => T | null, set: (v: T) => void, testid: string) {
    const row = h("div", "fhb-seg");
    row.dataset.testid = testid;
    const btns: [T, HTMLButtonElement][] = [];
    const sync = () => btns.forEach(([v, b]) => b.classList.toggle("on", v === get()));
    for (const [v, text, title] of items) {
      const b = button({ label: text, title, testid: `${testid}-${v}`, onClick: () => (set(v), sync()) });
      btns.push([v, b]);
      row.append(b);
    }
    sync();
    const box = h("div", "fhb-block");
    box.append(h("span", "k-label", label), row);
    return box;
  }

  /** Any airfield of the world by its code (PLAN-RADAR-AAA RD13): its longest paved runway the start's. */
  private codeBox() {
    const box = h("div", "fhb-block fhb-code");
    const inp = h("input", "fhb-icao") as HTMLInputElement;
    inp.placeholder = t("Any airfield: its ICAO code");
    inp.dataset.testid = "fhb-icao";
    inp.maxLength = 8;
    const said = h("span", "k-label fhb-code-said", "");
    inp.onchange = () => {
      const q = inp.value.trim();
      if (!q) return;
      said.textContent = "…";
      void fieldByCode(q).then((f) => {
        const s = f ? worldSite(f, 1200) : null;
        if (!s) {
          said.textContent = f ? tf("{0}: no paved runway of 1 200 m", f.icao || f.ident) : tf("{0}: unknown", q.toUpperCase());
          return;
        }
        this.field = s;
        said.textContent = s.name;
        this.host.toast(tf("Airfield: {0}", s.name));
      });
    };
    box.append(h("span", "k-label", t("Airfield code")), inp, said);
    return box;
  }

  /** The stand's ref (the A320's start at the gate): typed, or none — the nearest the airfield's middle. */
  private standBox() {
    const box = h("div", "fhb-block fhb-code");
    const inp = h("input", "fhb-icao") as HTMLInputElement;
    inp.placeholder = t("Stand (its number; empty: the nearest)");
    inp.dataset.testid = "fhb-stand";
    inp.maxLength = 8;
    inp.value = this.standRef;
    inp.onchange = () => (this.standRef = inp.value.trim());
    box.append(h("span", "k-label", t("Stand")), inp, h("span", "k-label fhb-code-said", "© OpenStreetMap"));
    return box;
  }

  private build(root: HTMLElement) {
    const fieldItems = FIELDS.map((f) => [f.icao ?? f.name, f.icao ?? f.name, f.name] as [string, string, string]);
    root.append(
      this.seg(
        t("Airfield"),
        fieldItems,
        () => this.field.icao ?? this.field.name,
        (v) => (this.field = FIELDS.find((f) => (f.icao ?? f.name) === v)!),
        "fhb-field",
      ),
      this.codeBox(),
      this.seg<Start>(
        t("Start"),
        [
          // (the A320: at a stand of the airfield — OpenStreetMap's —, its route out to the runway made)
          ...(fleet.active === "a320"
            ? [
                ["stand", t("At a stand"), t("At a stand of the airfield, the parking brake set: push back, taxi out")] as [
                  Start,
                  string,
                  string,
                ],
              ]
            : []),
          ["runway", t("On the runway"), t("Lined up on the runway in use, the engine at idle")],
          ["final", t("On final"), t("15 km out, 900 m up, the runway ahead")],
          ["cruise", t("Cruising"), t("40 km out, 6 000 m up, 230 m/s")],
        ],
        () => this.start,
        (v) => (this.start = v),
        "fhb-start",
      ),
      ...(fleet.active === "a320" ? [this.standBox()] : []),
      this.seg<Hour>(
        t("Hour (the airfield's)"),
        [
          ["now", t("As it is")],
          ["dawn", t("Dawn")],
          ["morning", t("Morning")],
          ["noon", t("Noon")],
          ["dusk", t("Dusk")],
          ["night", t("Night")],
        ],
        () => this.hour,
        (v) => (this.hour = v),
        "fhb-hour",
      ),
      this.seg<WeatherPreset>(
        t("Weather"),
        WX.map((w) => [w, tr(WX_NAMES[w]!)] as [WeatherPreset, string]),
        () => this.wx,
        (v) => (this.wx = v),
        "fhb-wx",
      ),
      this.seg<string>(
        t("Fuel"),
        [
          ["0.3", "30 %"],
          ["0.5", "50 %"],
          ["0.75", "75 %"],
          ["1", "100 %"],
        ],
        () => String(this.fuel),
        (v) => (this.fuel = Number(v)),
        "fhb-fuel",
      ),
      this.seg<string>(
        t("Flight plan to"),
        [["none", t("None")] as [string, string], ...fieldItems.map(([v, txt, ti]) => [v, txt, ti] as [string, string, string])],
        () => this.dest ?? "none",
        (v) => (this.dest = v === "none" ? null : v),
        "fhb-dest",
      ),
    );
    const foot = h("div", "fhb-foot");
    foot.append(
      h(
        "p",
        "fhb-note",
        t("The plan to an airfield: a direct leg at the cruise level — edit it after (⇧O): waypoints, altitudes, speeds."),
      ),
      button({ label: t("Fly"), kind: "primary", testid: "fhb-go", onClick: () => this.go() }),
    );
    root.append(foot);
  }

  /** The flight set up as the card has it, then flown (at a stand: lined up first, then moved to the stand once the
   *  airport's ground network is in). */
  go() {
    try {
      const field = this.field.icao ?? this.field.name;
      const said = prepareFlight(this.host, {
        field,
        start: this.start,
        hour: this.hour,
        weather: this.wx,
        fuel: this.fuel,
        dest: this.dest,
      });
      this.close?.();
      if (this.start !== "stand") return this.host.toast(said);
      this.host.toast(t("The airport's ground network: loading…"));
      void this.host.tools.atStand(field, this.standRef || null).then(
        (note) => this.host.toast(note),
        (e) => this.host.toast(tf("{0} — lined up on the runway instead", String((e as Error).message ?? e))),
      );
    } catch (e) {
      this.host.toast(String((e as Error).message ?? e));
    }
  }
}

/** What a flight is set up with: the airfield (its ICAO or a part of its name), the start, the hour of its day, the
 *  weather (none: as it is), the fuel's share, an arrival field for the plan (none: no plan). */
export interface FlightSetup {
  field: string;
  start?: Start;
  hour?: Hour;
  weather?: WeatherPreset | null;
  fuel?: number;
  dest?: string | null;
}
export const FLIGHT_STARTS: Start[] = ["runway", "final", "cruise"];
export const FLIGHT_HOURS: Hour[] = ["now", "dawn", "morning", "noon", "dusk", "night"];
export const FLIGHT_WEATHER = WX;
/** The airfields a flight can start from, by ICAO and name. */
export const flightFields = () => FIELDS.map((f) => ({ icao: f.icao ?? null, name: f.name }));
const fieldOf = (q: string) => {
  const n = q.trim().toLowerCase();
  return (
    FIELDS.find((f) => f.icao?.toLowerCase() === n || f.name.toLowerCase() === n) ??
    FIELDS.find((f) => f.name.toLowerCase().includes(n)) ??
    // (any airfield of the world by its code, its tile in — PLAN-RADAR-AAA RD13)
    siteByName(q)
  );
};

/**
 * A flight set up — the Flight hub's card and TARS's prepare_flight: the F-35 at an airfield (lined up on its runway
 * in use, on a 15 km final, cruising 40 km out), the hour of the airfield's own day, the weather, the fuel aboard,
 * a plan to an arrival field. Its line; an unknown field or start: thrown.
 */
export function prepareFlight(H: HubHost, o: FlightSetup): string {
  const T = H.tools;
  const F = fieldOf(o.field);
  if (!F) throw new Error(`no airfield "${o.field}"`);
  const start = o.start ?? "runway",
    hour = o.hour ?? "now";
  if (!isAircraft(fleet.active)) T.set("vessel", "f35");
  if (hour !== "now") {
    // (the airfield's mean solar hour → UTC, on the scene's day)
    const day = T.date().slice(0, 10);
    const utc = (((HOURS[hour] - F.lon / 15) % 24) + 24) % 24;
    const hh = Math.floor(utc),
      mm = Math.floor((utc - hh) * 60);
    T.setDate(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  if (o.weather && o.weather !== H.settings.weather) {
    H.settings.weather = o.weather;
    H.weatherChanged();
  }
  const name = F.len ? (F.icao ?? F.name) : F.name;
  // (at a stand: lined up first — the stand once the airport's network is in: FlightHub.go)
  if (start === "runway" || start === "stand") T.lineUp(F.len ? F : name);
  else if (start === "final") T.glideTo(name, 15, 0.9, 110);
  else T.glideTo(name, 40, 6, 230);
  // (the fuel after the placing: it fills the tanks)
  const full = VESSELS.f35.fuelKg ?? 0;
  fleet.fuel.f35 = full * Math.min(Math.max(o.fuel ?? 1, 0.05), 1);
  const C = H.camera;
  if (start !== "runway" && start !== "stand") {
    // (in the air: flown by hand — the glide's entry autopilot let go —, the engine at the power that
    // holds the speed; on final the gear down and half flaps, cruising clean)
    if (C.pilot.auto !== "none") C.pilot.setAuto(C.pilot.auto);
    C.pilot.auto = "none";
    const fin = start === "final";
    C.pilot.throttle = C.pilot.engineNow = fin ? 0.5 : 0.62;
    C.gearInit = true;
    C.gearDown = fin;
    C.gearExt = fin ? 1 : 0;
    C.airFlight.cfg.flaps = fin ? 0.5 : 0;
  }
  if (o.dest) {
    const D = fieldOf(o.dest);
    if (!D) throw new Error(`no airfield "${o.dest}"`);
    const R = newPlan();
    const wp = (f: typeof F) => ({
      name: f.icao ?? f.name,
      lat: f.lat,
      lon: f.lon,
      field: { icao: f.icao, elev: f.elev ?? 0, rwy: f.rwy },
    });
    R.wps = D === F ? [wp(F)] : [wp(F), wp(D)];
    C.nav.route = R;
    C.nav.on = { l: false, v: false };
    C.routeChanged();
  }
  return tf("Ready: {0} — {1}", F.icao ?? F.name, start === "runway" ? t("lined up") : start === "final" ? t("on final") : t("cruising"));
}
