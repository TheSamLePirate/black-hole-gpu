import "./airportui.css";
// The airport mode's interface (docs/PLAN-AEROPORT-AAA.md V8 — Sam, 26 Nov 2026: « dans ce mode, pas de HUD ni d'UI, à part le menu
// du haut qui se masque comme d'habitude ; une UI avec la liste des avions, les files — sélectionnables pour voir leurs infos et les
// suivre — ; le bandeau télé »): the game's HUD and panels hidden (body.airport-mode — style.css: what H hides, the top bar left), and
// one panel at the right — the airport, the director's shots, its queues (the arrivals ↘, the departures ↗, the others about the
// airport: on its ground, flying near), each row chosen to follow it (chosen again: let go), the one filmed's card (its callsign,
// airline, registration, type, phase, height, speed, vertical speed, runway, the seconds to the event). Collapsed to its title by its
// handle. Rebuilt four times a second at most, only when what it shows changed.

import { AIRPORT_MODES } from "../cine/airport";
import {
  type Arrival,
  airportCraft,
  airportFollow,
  airportMode,
  airportNext,
  airportState,
  airportStop,
  callsignOf,
} from "../controller/airportview";
import type { TrafficCraft } from "../controller/traffic";
import tzLookup from "tz-lookup";
import { WEATHER_PRESETS, type WeatherPreset, type WeatherState } from "../weather";
import { WEATHER_NAMES } from "./weatherpanel";
import { t, tf, tr } from "../i18n";
import { airlineOf } from "../traffic/livery";
import { AIRPORT_MODE_HELP, AIRPORT_MODE_LABEL } from "./camerapanel";
import { el as h } from "./kit";
import { unitsFor } from "./unitsys";

const PHASE_LABEL: Record<string, string> = {
  parked: t("parked"),
  taxi: t("taxiing"),
  takeoff: t("take-off roll"),
  landing: t("landing"),
  approach: t("approach"),
  climb: t("climbing"),
  cruise: t("cruising"),
  descent: t("descending"),
  rotor: t("rotorcraft"),
};

const mmss = (s: number) => {
  const x = Math.max(0, Math.round(Math.abs(s)));
  return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`;
};
const nameOf = (c: TrafficCraft) =>
  `${c.provenance === "synthetic" ? `${t("Synthetic")} · ` : c.provenance === "reconstructed" ? `${t("Reconstructed")} · ` : ""}${callsignOf(c)}`;

export interface AirportUiDeps {
  settings: { units?: "metric" | "imperial"; weather?: WeatherPreset; wind?: 0 | 1 | 2 | 3 };
  cameraSettings?(): void;
  changeWeather?(preset: WeatherPreset, wind?: 0 | 1 | 2 | 3): void;
  activity?(enabled?: boolean): { enabled: boolean; network: unknown };
  weather?(): { summary: string; metar: string; state?: WeatherState; direction?: number };
  /** the mode left (the free camera kept where it is) */
  quit(): void;
  /** the radio's last lines (traffic/atc.ts) */
  radio?(): readonly { who: "tower" | "pilot"; text: string }[];
}

export class AirportUi {
  readonly root: HTMLElement;
  private key = "";
  private at = -1;
  private collapsed = false;
  private trafficTab = "arr";
  private dockKey = "";
  private dock: HTMLElement | null = null;
  /** the cinema's bars (2.39:1 — the picture letterboxed), on by default */
  private bars: HTMLElement;
  private barsOn = true;

  constructor(private d: AirportUiDeps) {
    this.bars = h("div", "airport-bars");
    this.bars.append(h("div", "ab-top"), h("div", "ab-bottom"));
    this.bars.hidden = true;
    document.body.append(this.bars);
    this.root = h("aside", "airport-ui");
    this.root.dataset.testid = "airport-ui";
    this.root.hidden = true;
    // (its keys, its clicks: the panel's own — not the flight's, not the camera's drag)
    for (const ev of ["keydown", "pointerdown", "wheel"] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    document.body.append(this.root);
  }

  /** A frame: shown while the mode is on (body.airport-mode), its contents rebuilt when they changed (4 Hz at most). */
  frame(nowMs: number) {
    const S = airportState();
    document.body.classList.toggle("airport-mode", !!S);
    this.root.hidden = !S;
    this.bars.hidden = !S || !this.barsOn;
    if (!S) {
      this.key = "";
      return;
    }
    if (nowMs - this.at < 250) return;
    this.at = nowMs;
    const clock = this.root.querySelector(".au-clock b");
    if (clock)
      clock.textContent = new Intl.DateTimeFormat(undefined, {
        timeZone: tzLookup(S.lat, S.lon),
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(new Date());
    if (this.root.contains(document.activeElement) && document.activeElement?.tagName === "SELECT") return;
    const filmed = S.pinned ?? S.current ?? S.filler;
    const cur = filmed ? airportCraft(filmed) : null;
    const U = unitsFor(this.d.settings);
    const key = [
      JSON.stringify(this.d.weather?.()),
      `${this.d.activity?.().enabled}:${this.d.activity?.().network}`,
      S.code,
      S.dir.mode,
      S.shot,
      S.current,
      S.pinned,
      this.collapsed,
      S.queue.map((q) => `${q.c.id}:${Math.round(q.eta)}:${q.c.gnd}`).join(","),
      S.others.map((c) => `${c.id}:${c.phase}`).join(","),
      cur ? `${Math.round(U.alt(cur.msl) / 10)}:${Math.round(U.spd(Math.hypot(...cur.v)))}` : "",
      this.d.radio?.().length ?? 0,
      this.d.radio?.().at(-1)?.text ?? "",
    ].join("|");
    if (key === this.key) return;
    this.key = key;
    this.build();
  }

  private build() {
    const S = airportState();
    if (!S) return;
    const detailsOpen = this.root.querySelector<HTMLDetailsElement>("details")?.open ?? false;
    const U = unitsFor(this.d.settings);
    const head = h("header", "au-head");
    const title = h("div", "au-title");
    title.append(
      h("small", "au-eyebrow", tr({ fr: "TERRE / OBSERVATION", en: "EARTH / OBSERVATION" })),
      h("b", "", S.code),
      h("span", "", S.name),
    );
    const fold = h("button", "au-icon", this.collapsed ? "▾" : "▴");
    fold.title = this.collapsed ? t("Show the lists") : t("Fold the lists");
    fold.dataset.testid = "airport-ui-fold";
    fold.onclick = () => {
      this.collapsed = !this.collapsed;
      this.key = "";
      this.build();
    };
    const quit = h("button", "au-icon", "×");
    quit.title = t("Leave the airport view");
    quit.dataset.testid = "airport-ui-quit";
    quit.onclick = () => {
      airportStop();
      this.d.quit();
    };
    const clock = h("div", "au-clock");
    const zone = tzLookup(S.lat, S.lon);
    clock.dataset.testid = "airport-ui-clock";
    clock.append(
      h(
        "b",
        "",
        new Intl.DateTimeFormat(undefined, {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(new Date()),
      ),
      h("small", "", zone.replaceAll("_", " ")),
    );
    head.append(title, fold, quit);
    const body: HTMLElement[] = [clock];
    const weather = this.d.weather?.();
    if (weather) {
      const box = h("section", "au-weather");
      box.dataset.testid = "airport-ui-weather";
      box.append(h("div", "au-label", t("Weather")));
      const raw = h("div", "au-metar", weather.metar);
      raw.dataset.testid = "airport-ui-metar";
      raw.title = weather.summary;
      const controls = h("div", "au-seg");
      if (this.d.changeWeather) {
        for (const real of [true, false]) {
          const b = h("button", "", tr(real ? { fr: "Météo réelle", en: "Live weather" } : { fr: "Météo du jeu", en: "Game weather" }));
          const active = (this.d.settings.weather === "real") === real;
          b.classList.toggle("on", active);
          b.setAttribute("aria-pressed", String(active));
          b.dataset.testid = real ? "airport-weather-real" : "airport-weather-game";
          b.onclick = () => {
            this.d.changeWeather?.(real ? "real" : "fair");
            this.key = "";
            this.build();
          };
          controls.append(b);
        }
        box.append(controls);
        if (this.d.settings.weather !== "real") {
          const select = h("select", "au-select");
          select.setAttribute("aria-label", tr({ fr: "Conditions météo", en: "Weather conditions" }));
          select.dataset.testid = "airport-weather-preset";
          for (const preset of WEATHER_PRESETS.filter((p) => p !== "real")) {
            const option = h("option", "", tr(WEATHER_NAMES[preset]));
            option.value = preset;
            option.selected = preset === this.d.settings.weather;
            select.append(option);
          }
          select.onchange = () => {
            this.d.changeWeather?.(select.value as WeatherPreset);
            this.key = "";
            this.build();
          };
          box.append(select);
          const wind = h("select", "au-select");
          wind.setAttribute("aria-label", tr({ fr: "Vent par temps clair", en: "Fair weather wind" }));
          for (const [i, label] of [
            tr({ fr: "Calme", en: "Calm" }),
            tr({ fr: "Léger", en: "Light" }),
            tr({ fr: "Modéré", en: "Moderate" }),
            tr({ fr: "Fort", en: "Strong" }),
          ].entries()) {
            const o = h("option", "", label);
            o.value = String(i);
            o.selected = i === this.d.settings.wind;
            wind.append(o);
          }
          wind.hidden = this.d.settings.weather !== "fair";
          wind.onchange = () => this.d.changeWeather?.(this.d.settings.weather ?? "fair", Number(wind.value) as 0 | 1 | 2 | 3);
          box.append(wind);
        }
      }
      const w = weather.state;
      if (w) {
        const graphic = h("div", "au-weather-graphic");
        const compass = h("div", "au-compass");
        compass.append(h("span", "", "N"));
        const arrow = h("b", "", "↑");
        arrow.style.transform = `rotate(${weather.direction ?? 0}deg)`;
        compass.append(arrow);
        compass.title = `${Math.round(weather.direction ?? 0)}°`;
        const sky = h("div", "au-sky");
        sky.append(h("strong", "au-weather-symbol"), h("span", "", tr(WEATHER_NAMES[w.kind])));
        const symbol = sky.querySelector("strong");
        if (symbol)
          symbol.innerHTML = `<svg viewBox="0 0 48 40" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${w.rain > 0 || w.layers.length ? '<path d="M12 27a8 8 0 0 1 0-16 11 11 0 0 1 21-1 8 8 0 0 1 2 17H12Z"/>' : '<circle cx="24" cy="20" r="9"/><path d="M24 2v5m0 26v5M6 20h5m26 0h5M11 7l4 4m18 18 4 4M11 33l4-4M33 11l4-4"/>'}${w.rain > 0 ? '<path d="m16 31-3 6m12-6-3 6m12-6-3 6"/>' : ""}</svg>`;
        const facts = h("div", "au-weather-facts");
        facts.append(
          h("b", "", `${unitsFor(this.d.settings).fSpd(w.wind.u10)} · ${Math.round(weather.direction ?? 0)}°`),
          h("span", "", `VIS ${(w.visibility / 1000).toFixed(1)} km`),
          h("span", "", w.air ? `${w.air.T.toFixed(1)} °C · ${Math.round(w.air.qnh)} hPa` : "—"),
        );
        graphic.append(compass, sky, facts);
        box.append(graphic);
      }
      const details = h("details", "au-weather-details");
      details.open = detailsOpen;
      details.append(h("summary", "", `METAR · ${S.code}`), raw, h("p", "", weather.summary));
      box.append(details);
      body.push(box);
    }
    if (!this.collapsed) {
      const filmed = S.pinned ?? S.current ?? S.filler;
      const cur = filmed ? airportCraft(filmed) : null;
      if (cur) body.push(this.card(cur, S.queue.find((q) => q.c.id === cur.id) ?? null, S.pinned === cur.id, U));
      // the radio: its last lines (the tower amber, the crews white)
      const traffic = h("div", "au-traffic");
      const R = this.d.radio?.() ?? [];
      if (R.length) {
        const box = h("section", "au-radio");
        box.dataset.testid = "airport-ui-radio";
        box.append(h("div", "au-label", t("Radio")));
        for (const l of R.slice(-3)) box.append(h("div", `au-radio-line ${l.who}`, l.text));
        traffic.append(box);
      }
      // the queues
      const arr = S.queue.filter((q) => !q.dep);
      const dep = S.queue.filter((q) => q.dep);
      const tabs = h("div", "au-traffic-tabs");
      for (const [id, label, count] of [
        ["arr", t("Arrivals"), arr.length],
        ["dep", t("Departures"), dep.length],
        ["other", t("About the airport"), S.others.length],
      ] as const) {
        const button = h("button", this.trafficTab === id ? "on" : "", `${label}  ${String(count).padStart(2, "0")}`);
        button.setAttribute("aria-pressed", String(this.trafficTab === id));
        button.onclick = () => {
          this.trafficTab = id;
          this.key = "";
          this.build();
        };
        tabs.append(button);
      }
      traffic.append(tabs);
      const lists = [
        this.list(t("Arrivals"), "arr", arr, S.current, S.pinned),
        this.list(t("Departures"), "dep", dep, S.current, S.pinned),
        this.others(S.others, S.current, S.pinned),
      ];
      lists.forEach((list, i) => {
        list.hidden = ["arr", "dep", "other"][i] !== this.trafficTab;
        traffic.append(list);
      });
      body.push(traffic);
    }
    const dock = this.controls();
    this.root.classList.toggle("au-folded", this.collapsed);
    let content = this.root.querySelector<HTMLElement>(".au-content");
    if (!content) {
      content = h("div", "au-content");
      this.root.append(content);
    }
    content.replaceChildren(head, ...body);
    if (dock.parentElement !== this.root) {
      this.root.querySelector(".au-director")?.remove();
      this.root.append(dock);
    }
  }

  private controls() {
    const S = airportState()!;
    const activity = this.d.activity?.();
    const key = `${S.dir.mode}|${S.pinned}|${this.barsOn}|${activity?.enabled}|${!!activity?.network}`;
    if (this.dock && key === this.dockKey) {
      this.dock.querySelector(".au-shot-status")!.textContent = `${AIRPORT_MODE_LABEL[S.dir.mode]} / ${AIRPORT_MODE_LABEL[S.shot]}`;
      return this.dock;
    }
    const dock = h("section", "au-director");
    this.dock = dock;
    this.dockKey = key;
    dock.setAttribute("aria-label", t("Director"));
    dock.dataset.testid = "airport-ui-director";
    const header = h("div", "au-dock-head");
    header.append(
      h("span", "au-label", tr({ fr: "RÉALISATION / CAMÉRAS", en: "DIRECTOR / CAMERAS" })),
      h("span", "au-shot-status", `${AIRPORT_MODE_LABEL[S.dir.mode]} / ${AIRPORT_MODE_LABEL[S.shot]}`),
    );
    const modes = h("div", "au-camera-modes");
    for (const automatic of [true, false]) {
      const group = h("div", "au-seg");
      group.setAttribute(
        "aria-label",
        tr(automatic ? { fr: "Réalisation automatique", en: "Automatic direction" } : { fr: "Angles de caméra", en: "Camera angles" }),
      );
      for (const mode of AIRPORT_MODES.filter((m) => (m === "auto" || m === "cinema") === automatic)) {
        const b = h("button", S.dir.mode === mode ? "on" : "", AIRPORT_MODE_LABEL[mode]);
        b.title = AIRPORT_MODE_HELP[mode];
        b.setAttribute("aria-pressed", String(S.dir.mode === mode));
        b.dataset.testid = `airport-ui-mode-${mode}`;
        b.onclick = () => {
          airportMode(mode);
          this.key = "";
          this.build();
        };
        group.append(b);
      }
      modes.append(group);
    }
    const actions = h("div", "au-dock-actions");
    const action = (label: string, id: string, run: () => void, pressed?: boolean) => {
      const b = h("button", "au-btn", label);
      b.dataset.testid = id;
      if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
      b.onclick = () => {
        run();
        this.key = "";
        this.build();
      };
      actions.append(b);
      return b;
    };
    action(t("Next movement"), "airport-ui-next", () => airportNext());
    const release = action(tr({ fr: "Libérer le suivi", en: "Release tracking" }), "airport-ui-release", () => airportFollow(null));
    release.disabled = !S.pinned;
    action(
      t(this.barsOn ? "Cinema bars: on" : "Cinema bars: off"),
      "airport-ui-bars",
      () => {
        this.barsOn = !this.barsOn;
        this.bars.hidden = !this.barsOn;
      },
      this.barsOn,
    );
    if (activity)
      action(
        t(activity.enabled ? "Supplemental traffic: on" : "Supplemental traffic: off"),
        "airport-ui-activity",
        () => {
          this.d.activity?.(!activity.enabled);
        },
        activity.enabled,
      ).disabled = !activity.network;
    if (this.d.cameraSettings)
      action(tr({ fr: "Réglages caméra ↗", en: "Camera settings ↗" }), "airport-ui-camera-settings", () => this.d.cameraSettings?.());
    dock.append(header, modes, actions);
    return dock;
  }

  private row(c: TrafficCraft, right: string, cur: string | null, pinned: string | null, sub: string) {
    const r = h("button", "au-row");
    r.dataset.testid = `airport-ui-row-${c.id}`;
    r.classList.toggle("on", c.id === cur);
    r.classList.toggle("pin", c.id === pinned);
    r.append(h("b", "", nameOf(c)), h("span", "au-sub", sub), h("span", "au-eta", right));
    r.title = c.id === pinned ? t("Followed — click to let the director choose again") : t("Follow it");
    r.onclick = () => {
      airportFollow(c.id === pinned ? null : c.id);
      this.key = "";
    };
    return r;
  }

  private list(label: string, id: string, q: Arrival[], cur: string | null, pinned: string | null) {
    const box = h("section", "au-list");
    box.dataset.testid = `airport-ui-${id}`;
    box.append(h("div", "au-label", `${label} · ${q.length}`));
    if (!q.length) box.append(h("div", "au-none", t("none now")));
    for (const x of q.slice(0, 8)) {
      const right = x.dep
        ? x.c.gnd
          ? x.eta > 0 && Math.hypot(...x.c.v) < 3
            ? t("lined up")
            : mmss(x.eta)
          : t("airborne")
        : x.c.gnd
          ? t("rolling")
          : mmss(x.eta);
      box.append(this.row(x.c, right, cur, pinned, [x.c.type, x.way.name.split(" ").pop()].filter(Boolean).join(" · ")));
    }
    return box;
  }

  private others(list: TrafficCraft[], cur: string | null, pinned: string | null) {
    const box = h("section", "au-list");
    box.dataset.testid = "airport-ui-others";
    box.append(h("div", "au-label", `${t("About the airport")} · ${list.length}`));
    if (!list.length) box.append(h("div", "au-none", t("none now")));
    for (const c of list.slice(0, 8))
      box.append(this.row(c, PHASE_LABEL[c.phase] ?? c.phase, cur, pinned, [c.type, c.reg].filter(Boolean).join(" · ")));
    return box;
  }

  private card(c: TrafficCraft, q: Arrival | null, pinned: boolean, U: ReturnType<typeof unitsFor>) {
    const box = h("section", "au-card");
    box.dataset.testid = "airport-ui-card";
    const al = airlineOf(c.cs);
    box.append(
      h("div", "au-eyebrow", tr({ fr: "VOL À L’ÉCRAN", en: "NOW WATCHING" })),
      h("div", "au-card-title", `${pinned ? "• " : ""}${nameOf(c)}`),
      h("div", "au-card-sub", [al, c.reg, c.type].filter(Boolean).join(" · ")),
    );
    const vs = c.v[0]! * c.up[0]! + c.v[1]! * c.up[1]! + c.v[2]! * c.up[2]!;
    const rows: [string, string][] = [
      // (in a queue: its movement's phase — the traffic's own reads « cruise » low on a final, 26 Nov 2026)
      [
        t("Phase"),
        q
          ? q.dep
            ? c.gnd
              ? Math.hypot(...c.v) < 3
                ? t("lined up")
                : t("take-off roll")
              : t("initial climb")
            : c.gnd
              ? t("landing roll")
              : t("final approach")
          : (PHASE_LABEL[c.phase] ?? c.phase),
      ],
      [tr({ fr: "Hauteur sol", en: "Height AGL" }), U.fAlt(c.over)],
      [tr({ fr: "Envergure / longueur", en: "Span / length" }), `${c.span.toFixed(1)} / ${c.len.toFixed(1)} m`],
      [tr({ fr: "Train", en: "Landing gear" }), `${Math.round(c.gear * 100)} %`],
      [tr({ fr: "Données", en: "Data source" }), c.provenance ?? "observed"],
      [tr({ fr: "Âge du relevé", en: "Report age" }), `${Math.round(c.age)} s`],
    ];
    if (q) {
      rows.push([t("Runway"), q.way.name.split(" ").pop() ?? ""]);
      rows.push(
        q.dep
          ? [t("Lift-off"), q.eta > 0 ? tf("in {0}", mmss(q.eta)) : tf("{0} ago", mmss(q.eta))]
          : [t("Touchdown"), q.eta > 0 ? tf("in {0}", mmss(q.eta)) : tf("{0} ago", mmss(q.eta))],
      );
    }
    const telemetry = h("div", "au-telemetry");
    for (const [label, value] of [
      [t("Altitude"), U.fAlt(c.msl)],
      [t("Speed"), U.fSpd(Math.hypot(...c.v))],
      [t("Vertical speed"), U.fVs(vs)],
    ]) {
      const tile = h("div", "");
      tile.append(h("small", "", label), h("strong", "", value));
      telemetry.append(tile);
    }
    box.append(telemetry);
    const dl = h("dl", "au-facts");
    for (const [k, v] of rows) dl.append(h("dt", "", k), h("dd", "", v));
    const details = h("details", "au-flight-details");
    details.open = this.root.querySelector<HTMLDetailsElement>(".au-flight-details")?.open ?? false;
    details.append(h("summary", "", tr({ fr: "Détails du vol", en: "Flight details" })), dl);
    box.append(details);
    return box;
  }
}
