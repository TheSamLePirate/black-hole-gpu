// A flight prepared (docs/PLAN-F35.md, F8): the F-35 set where and when to fly in one card — the airfield, the
// start (lined up on its runway in use, on a 15 km final, cruising 40 km out), the hour of the airfield's own
// day (dawn, morning, noon, dusk, night — or the clock as it is), the weather (weather.ts's presets, the real
// one), the fuel aboard, a flight plan to an arrival field (game/flightplan.ts) — then flown at once.

import "./flighthub.css";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import type { GameTools } from "../game/tools";
import { newPlan } from "../game/flightplan";
import { SITES } from "../game/sites";
import { t, tf, tr } from "../i18n";
import type { Settings } from "../settings";
import { VESSELS } from "../vessels";
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

type Start = "runway" | "final" | "cruise";
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
  private field = FIELDS.find((f) => f.icao === "KEDW") ?? FIELDS[0]!;
  private start: Start = "runway";
  private hour: Hour = "now";
  private wx: WeatherPreset | null = null;
  private fuel = 1;
  private dest: string | null = null;

  constructor(private host: HubHost) {}

  get isOpen() {
    return !!this.close;
  }

  open() {
    if (this.close) return;
    const root = h("div", "fhb");
    const m = modal({ title: t("Prepare a flight — F-35B"), body: [root], cls: "fhb-frame", testid: "flight-hub", onClose: () => (this.close = null) });
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

  private build(root: HTMLElement) {
    const fieldItems = FIELDS.map((f) => [f.icao ?? f.name, f.icao ?? f.name, f.name] as [string, string, string]);
    root.append(
      this.seg(t("Airfield"), fieldItems, () => this.field.icao ?? this.field.name, (v) => (this.field = FIELDS.find((f) => (f.icao ?? f.name) === v)!), "fhb-field"),
      this.seg<Start>(
        t("Start"),
        [
          ["runway", t("On the runway"), t("Lined up on the runway in use, the engine at idle")],
          ["final", t("On final"), t("15 km out, 900 m up, the runway ahead")],
          ["cruise", t("Cruising"), t("40 km out, 6 000 m up, 230 m/s")],
        ],
        () => this.start,
        (v) => (this.start = v),
        "fhb-start",
      ),
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
      h("p", "fhb-note", t("The plan to an airfield: a direct leg at the cruise level — edit it after (⇧O): waypoints, altitudes, speeds.")),
      button({ label: t("Fly"), kind: "primary", testid: "fhb-go", onClick: () => this.go() }),
    );
    root.append(foot);
  }

  /** The flight set up: the F-35, the hour, the weather, the place, the fuel, the plan. */
  go() {
    const H = this.host;
    const T = H.tools;
    const F = this.field;
    try {
      if (fleet.active !== "f35") T.set("vessel", "f35");
      if (this.hour !== "now") {
        // (the airfield's mean solar hour → UTC, on the scene's day)
        const day = T.date().slice(0, 10);
        const utc = (((HOURS[this.hour] - F.lon / 15) % 24) + 24) % 24;
        const hh = Math.floor(utc),
          mm = Math.floor((utc - hh) * 60);
        T.setDate(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
      }
      if (this.wx && this.wx !== H.settings.weather) {
        H.settings.weather = this.wx;
        H.weatherChanged();
      }
      const name = F.name;
      if (this.start === "runway") T.lineUp(name);
      else if (this.start === "final") T.glideTo(name, 15, 0.9, 110);
      else T.glideTo(name, 40, 6, 230);
      // (the fuel after the placing: it fills the tanks)
      const full = VESSELS.f35.fuelKg ?? 0;
      fleet.fuel.f35 = full * this.fuel;
      const C = H.camera;
      if (this.start !== "runway") {
        // (in the air: flown by hand — the glide's entry autopilot let go —, the engine at the power that
        // holds the speed; on final the gear down and half flaps, cruising clean)
        if (C.pilot.auto !== "none") C.pilot.setAuto(C.pilot.auto);
        C.pilot.auto = "none";
        const fin = this.start === "final";
        C.pilot.throttle = C.pilot.engineNow = fin ? 0.5 : 0.62;
        C.gearInit = true;
        C.gearDown = fin;
        C.gearExt = fin ? 1 : 0;
        C.airFlight.cfg.flaps = fin ? 0.5 : 0;
      }
      if (this.dest) {
        const D = FIELDS.find((f) => (f.icao ?? f.name) === this.dest)!;
        const R = newPlan();
        const wp = (f: typeof F) => ({ name: f.icao ?? f.name, lat: f.lat, lon: f.lon, field: { icao: f.icao, elev: f.elev ?? 0, rwy: f.rwy } });
        R.wps = D === F ? [wp(F)] : [wp(F), wp(D)];
        C.nav.route = R;
        C.nav.on = { l: false, v: false };
        C.routeChanged();
      }
      H.toast(tf("Ready: {0} — {1}", F.icao ?? F.name, this.start === "runway" ? t("lined up") : this.start === "final" ? t("on final") : t("cruising")));
      this.close?.();
    } catch (e) {
      H.toast(String((e as Error).message ?? e));
    }
  }
}
