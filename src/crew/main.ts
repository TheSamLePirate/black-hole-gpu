import { NetClient } from "../net/client";
import { isCode, normCode } from "../net/proto";
import { serverUrl } from "../net/load";
import { store } from "../util/storage";
import { CrewModel, METRICS, relative, valueText } from "./model";
import { unitsOf } from "../ui/unitsys";
import { wgs84Inverse } from "../system/ellipsoid";
import { CrewRadio } from "./radio";
import { bindTalk } from "./ptt";
import { CrewViews, VIEW_NAMES, type CrewView } from "./views";
import { dur } from "./draw/kit";
import { bodyName } from "./draw/orbit";
import { linkFor, Outbox, type Station, type StationId, STATIONS, stationOf } from "./station";
import { CHECKLISTS_FR } from "./checklists";
import { type CrewProfile, PROFILE_TILES, PROFILE_VIEWS, profileOf, type TileKey, viewIn } from "./profile";
import { CrewActions, type Done } from "./actions";
import { ACTS, type Act, AUTO_FR, AUTOS, HOLD_FR, HOLDS, MANEUVER_FR, MANEUVERS } from "../net/crewcmd";
import type { Args } from "../ai/tool-schema";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (text: string, action: () => void, id?: string) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (id) b.id = id;
  b.addEventListener("click", action);
  return b;
};
const el = (tag: string, text = "", cls = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = cls;
  return e;
};
const lobby = $<HTMLDialogElement>("lobby");
const pilot = $<HTMLSelectElement>("pilot"),
  talk = $<HTMLButtonElement>("talk"),
  toggle = $<HTMLInputElement>("toggle-talk");
const name = $<HTMLInputElement>("name"),
  code = $<HTMLInputElement>("code"),
  password = $<HTMLInputElement>("password");
// One identity per document, kept by NetClient on reconnect. Even duplicated tabs stay independent.
const device = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const net = new NetClient({
  url: serverUrl(),
  build: "crew-v1",
  id: { device: `crew:${device}`, name: store.get("kerr.crew.name") || "Équipage", colour: "#89dce5" },
});
const model = new CrewModel(net);
/** the station chosen at the lobby (PLAN-VAISSEAUX K5): aboard, live; on the ground, the light's time late */
let station: Station = stationOf(store.get("kerr.crew.station"));
model.linkFor = (link) => linkFor(station, link);
const outbox = new Outbox();
const views = new CrewViews($<HTMLCanvasElement>("instruments"), model);
const radio = new CrewRadio(net, () => syncRadio());
// (the CAPCOM's Quindar tones: 2 525 Hz as the voice opens, 2 475 Hz as it closes — 250 ms, the Apollo loops')
let quindarCtx: AudioContext | null = null;
radio.onTalk = (active) => {
  if (station.id !== "capcom") return;
  try {
    quindarCtx ??= new AudioContext();
    const c = quindarCtx;
    const o = c.createOscillator(),
      g = c.createGain();
    o.frequency.value = active ? 2525 : 2475;
    g.gain.value = 0.12;
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.25);
  } catch {
    // (no audio: no tone)
  }
};
const actions = new CrewActions(net, model);
actions.onChange(() => {
  board();
  views.request();
});
let noticeTimer: ReturnType<typeof setTimeout>;
const notice = (s: string) => {
  $("notice").textContent = s;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $("notice").textContent = "";
  }, 4000);
};
let rosterKey = "";
let pilotKey = "";
let busy = false;
let painted = "";
views.units = store.get("kerr.crew.units") === "imperial" ? "imperial" : "metric";
const initialParams = new URLSearchParams(location.hash.slice(1));
name.value = store.get("kerr.crew.name") || net.o.id.name;
// the lobby's stations: aboard, on the ground
{
  const sel = $<HTMLSelectElement>("station");
  for (const [place, title] of [
    ["aboard", "À bord"],
    ["ground", "Au sol — contrôle de mission"],
  ] as const) {
    const g = document.createElement("optgroup");
    g.label = title;
    for (const st of STATIONS.filter((x) => x.place === place)) {
      const o = document.createElement("option");
      o.value = st.id;
      o.textContent = st.place === "ground" ? `${st.call} — ${st.title}` : st.title;
      o.selected = st.id === station.id;
      g.append(o);
    }
    sel.append(g);
  }
  const role = () => ($("station-role").textContent = stationOf(sel.value).role);
  sel.addEventListener("change", role);
  role();
}
code.value = normCode(initialParams.get("join") ?? "");
code.addEventListener("input", () => {
  code.value = normCode(code.value).slice(0, 6);
});

function syncRadio() {
  talk.disabled = !radio.gate.ready || !radio.gate.online;
  talk.setAttribute("aria-pressed", String(radio.gate.active));
  $("talk-label").textContent = radio.gate.active
    ? "TRANSMISSION · vous parlez"
    : toggle.checked
      ? "Toucher pour parler"
      : "Maintenir pour parler";
  $("microphone").textContent = radio.requesting ? "Annuler le micro" : radio.gate.ready ? "Couper le micro" : "Activer le micro";
  $("microphone").setAttribute("aria-pressed", String(radio.gate.ready));
  $("listen").setAttribute("aria-pressed", String(radio.listening));
  $("listen").textContent = radio.listening ? "Écoute activée" : "Écouter";
  $("radio-status").textContent =
    radio.error ||
    (!net.room
      ? "Rejoignez une salle pour communiquer."
      : !net.mesh
        ? "WebRTC indisponible : instruments accessibles, voix indisponible."
        : radio.gate.active
          ? "Votre microphone est transmis à la salle."
          : radio.gate.ready
            ? "Micro prêt · émission uniquement sur votre commande."
            : "Écoute seule · activez le micro pour transmettre.");
}
bindTalk(talk, radio.gate, () => toggle.checked);
toggle.addEventListener("change", () => {
  radio.gate.cancel();
  syncRadio();
});
$("listen").addEventListener("click", () => {
  if (net.room) void radio.listen();
  else notice("Rejoignez d’abord une salle.");
});
$("microphone").addEventListener("click", () => {
  if (radio.gate.ready || radio.requesting) radio.disableMic();
  else if (net.room) void radio.enableMic();
  else notice("Rejoignez d’abord une salle.");
});

async function join(roomCode: string, displayName: string, pass = "") {
  if (busy) return;
  const normal = normCode(roomCode);
  if (!isCode(normal)) {
    $("join-error").textContent = "Saisissez les six caractères du code de la salle.";
    return;
  }
  busy = true;
  $<HTMLButtonElement>("join").disabled = true;
  $("join-error").textContent = "Connexion…";
  try {
    if (net.room) {
      radio.stop();
      net.leave();
    }
    // (the station: its call after the name, in the room — FIDO, CAPCOM…)
    station = stationOf($<HTMLSelectElement>("station").value);
    store.set("kerr.crew.station", station.id);
    const bare = displayName.trim().slice(0, 16) || "Équipage";
    net.profile(`${bare} · ${station.call}`, "#89dce5");
    await net.join(normal, "instruments", pass || undefined);
    store.set("kerr.crew.name", bare);
    const params = new URLSearchParams({ join: normal });
    if (initialParams.has("server")) params.set("server", initialParams.get("server")!);
    history.replaceState(null, "", `#${params}`);
    lobby.close();
    rosterKey = "";
    pilotKey = "";
    refresh();
    // (a spacecraft followed: the station's own view)
    if (profile === "space") setView(station.view);
  } catch (error) {
    const errors: Record<string, string> = {
      password: "Mot de passe incorrect.",
      "unknown-room": "Cette salle n’existe plus.",
      full: "La salle accueille déjà huit appareils.",
      update: "Rechargez cette page pour mettre le réseau à jour.",
    };
    const key = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    $("join-error").textContent = errors[key] ?? "Connexion impossible. Vérifiez le réseau et réessayez.";
    if (!net.room) net.close();
  } finally {
    busy = false;
    $<HTMLButtonElement>("join").disabled = false;
  }
}
$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void join(code.value, name.value, password.value);
});
const showLobby = () => {
  radio.gate.cancel();
  $("leave").hidden = !net.room;
  $("close-lobby").hidden = !net.room;
  $("join-error").textContent = "";
  if (!lobby.open) lobby.showModal();
};
$("room-button").addEventListener("click", showLobby);
$("close-lobby").addEventListener("click", () => lobby.close());
$("leave").addEventListener("click", () => {
  radio.stop();
  net.close();
  password.value = "";
  history.replaceState(null, "", location.pathname);
  showLobby();
  refresh();
});
lobby.addEventListener("cancel", (e) => {
  if (!net.room) e.preventDefault();
});
net.on("status", () => refresh());
net.on("room", () => {
  rosterKey = "";
  pilotKey = "";
});
net.on("error", ({ msg }) => notice(msg));
net.on("roster", () => {
  rosterKey = "";
  refresh();
});

function select(slot: number) {
  model.selected = slot;
  views.paused = false;
  views.reset();
  pilotKey = "";
  refresh();
}
pilot.addEventListener("change", () => select(Number(pilot.value)));
views.onSelect = select;
const showCrew = (show: boolean) => {
  $("crew-panel").classList.toggle("open", show);
  $("crew-button").setAttribute("aria-expanded", String(show));
};
$("crew-button").addEventListener("click", () => showCrew(!$("crew-panel").classList.contains("open")));
$("close-crew").addEventListener("click", () => showCrew(false));

function selectControl<T extends string>(items: [T, string][], current: T, title: string, change: (v: T) => void) {
  const s = document.createElement("select");
  s.setAttribute("aria-label", title);
  for (const [value, text] of items) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    s.append(o);
  }
  s.value = current;
  s.addEventListener("change", () => change(s.value as T));
  return s;
}
function segmented<T extends string>(items: [T, string][], current: T, title: string, change: (v: T) => void) {
  const g = el("div", "", "seg");
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", title);
  for (const [value, text] of items) {
    const b = button(text, () => {
      for (const o of g.querySelectorAll("button")) o.setAttribute("aria-pressed", String(o === b));
      change(value);
    });
    b.setAttribute("aria-pressed", String(value === current));
    g.append(b);
  }
  return g;
}
const NOTES: Record<CrewView, string> = {
  air: "Radar et carte côte à côte · l’objectif, les armes, les alertes · toucher un panneau pour l’ouvrir",
  sdash: "L’orbite, l’attitude, l’ordinateur de vol · toucher un panneau pour l’ouvrir",
  orbit: "L’orbite vue de dessus de son plan · périapside en haut · les poussées du plan en magenta",
  system: "Glisser pour tourner · pincer pour zoomer · la prédiction à faire défiler",
  navball: "L’attitude contre l’orbite · marqueurs prograde, normal, radial, nœud",
  dock: "Le couloir d’approche de côté, le réticule de face · limites de vitesse et d’alignement",
  budget: "Le Δv des ergols contre les poussées du plan · la marge",
  eecom: "Énergie, oxygène, épurateurs · les pannes et leurs checklists",
  timeline: "Le temps de mission · les événements des heures à venir",
  rel: "Les deux horloges : dτ/dt, γ, le temps écoulé sur Terre",
  ground: "Le corps survolé : la trace au sol, le point d’atterrissage, la nuit",
  dash: "Toucher un panneau pour l’ouvrir · pincer pour la portée",
  pfd: "Horizon, rubans vitesse et altitude, cap, modes du pilote automatique",
  nd: "Pincer pour la portée · toucher un joueur ou un contact",
  map: "Glisser pour déplacer · pincer pour zoomer · toucher un joueur",
  globe: "Glisser pour tourner · pincer pour zoomer",
  radar: "Pincer pour la portée · toucher un contact",
  schematic: "Glisser pour faire défiler les systèmes",
  plan: "Profil vertical et branches · glisser pour faire défiler",
  telemetry: "Glisser pour lire une mesure · historique reçu sur cet écran",
};
function rangeControl() {
  const range = document.createElement("input");
  range.type = "number";
  range.id = "range";
  range.min = "0.5";
  range.max = "20000";
  range.step = "1";
  range.value = String(Math.round((views.range / 1000) * 10) / 10);
  range.setAttribute("aria-label", "Portée en kilomètres");
  range.addEventListener("change", () => {
    const v = range.valueAsNumber;
    if (Number.isFinite(v)) views.range = Math.max(500, Math.min(2e7, v * 1000));
    views.request();
  });
  const label = el("label", "km");
  label.prepend(range);
  return label;
}
function controls() {
  const bar = $("view-controls");
  bar.replaceChildren();
  const v = views.view;
  if (v === "system") {
    // the system map (PLAN-VAISSEAUX K3): its centre, its scale, the views from above and edge-on, the prediction
    const M = views.map3d;
    bar.append(
      segmented(
        [
          ["body", "Corps"],
          ["craft", "Vaisseau"],
          ["sun", "Soleil"],
        ],
        M.focus,
        "Centre de la carte",
        (o) => {
          M.focus = o;
          M.cam.zoom = 1;
          views.request();
        },
      ),
      segmented(
        [
          ["true", "Vraie"],
          ["log", "Log"],
        ],
        M.cam.log ? "log" : "true",
        "Échelle",
        (o) => {
          M.cam.log = o === "log";
          views.request();
        },
      ),
      button(
        "Dessus",
        () => {
          M.cam.pitch = 1.55;
          views.request();
        },
        "map-top",
      ),
      button(
        "Profil",
        () => {
          M.cam.pitch = 0.02;
          views.request();
        },
        "map-edge",
      ),
    );
    const ahead = document.createElement("input");
    ahead.type = "range";
    ahead.id = "map-ahead";
    ahead.min = "0";
    ahead.max = "1000";
    ahead.value = "0";
    ahead.setAttribute("aria-label", "Prédiction : temps à venir");
    ahead.addEventListener("input", () => {
      // (the slider's end: the longest path received, six hours at least — squared for a fine start)
      const span = Math.max(views.mapSpan, 6 * 3600);
      M.ahead = span * (Number(ahead.value) / 1000) ** 2;
      views.request();
    });
    bar.append(ahead);
  } else if (v === "map" || v === "globe") {
    bar.append(button("Centrer", () => views.reset(), "recenter"));
    const pan = document.createElement("details");
    pan.className = "pan-controls";
    pan.append(el("summary", "Déplacer"));
    const directions = el("div");
    for (const [label, east, north] of [
      ["← Ouest", -1, 0],
      ["↑ Nord", 0, 1],
      ["↓ Sud", 0, -1],
      ["Est →", 1, 0],
    ] as const)
      directions.append(button(label, () => views.pan(east, north)));
    pan.append(directions);
    bar.append(pan);
  } else if (v === "radar" || v === "nd" || v === "dash") {
    bar.append(rangeControl());
    if (v !== "dash")
      bar.append(
        segmented(
          [
            ["heading", "Cap"],
            ["north", "Nord"],
          ],
          views.north ? "north" : "heading",
          "Orientation",
          (o) => {
            views.north = o === "north";
            views.request();
          },
        ),
      );
    bar.append(
      segmented(
        [
          ["players", "Partagé"],
          ["sensor", "Capteur"],
        ],
        views.sensor ? "sensor" : "players",
        "Source radar",
        (o) => {
          views.sensor = o === "sensor";
          views.request();
        },
      ),
      button("Ajuster", () => {
        views.fit();
        controls();
      }),
    );
    const contacts = document.createElement("details");
    contacts.className = "pan-controls";
    contacts.append(el("summary", "Contacts"));
    const list = el("div");
    list.id = "contact-list";
    contacts.append(list);
    bar.append(contacts);
  } else if (v === "plan") {
    // the flight plan edited (PLAN-CREW-ACTIONS A2): a place added by its name, the cruise, the procedures, cleared
    const u = unitsOf(views.units);
    const add = el("form", "", "plan-add");
    const q = document.createElement("input");
    q.type = "search";
    q.id = "plan-query";
    q.placeholder = "OACI, terrain ou lieu";
    q.setAttribute("aria-label", "Point à ajouter au plan");
    q.autocomplete = "off";
    const go = actButton(
      "Ajouter",
      "nav.add",
      () => ({ query: q.value.trim().slice(0, 40) }),
      "plan-add",
      (ok) => {
        if (ok) q.value = "";
      },
    );
    go.type = "submit";
    add.append(q, go);
    add.addEventListener("submit", (e) => e.preventDefault());
    const cruise = document.createElement("details");
    cruise.className = "pan-controls";
    cruise.append(el("summary", "Croisière"));
    const nav = snapNow()?.nav;
    const [altBox, altVal] = numberField("Niveau", nav?.cruiseAlt, u.alt, u.altName.toLowerCase());
    const [spdBox, spdVal] = numberField("Vitesse", nav?.cruiseSpd, u.spd, u.spdName.toLowerCase());
    const body = el("div", "", "cruise-box");
    body.append(
      altBox,
      spdBox,
      actButton("Appliquer", "nav.cruise", () => ({
        ...(Number.isFinite(altVal()) ? { alt: Math.round(altVal()) } : {}),
        ...(Number.isFinite(spdVal()) ? { spd: Math.round(spdVal()) } : {}),
      })),
    );
    cruise.append(body);
    // (cleared only on a second press within 3 s)
    const clear = button(
      "Vider",
      () => {
        if (clear.dataset.armed) {
          delete clear.dataset.armed;
          clear.textContent = "Vider";
          void fire(clear, "nav.clear", {});
        } else {
          clear.dataset.armed = "1";
          clear.textContent = "Confirmer ?";
          setTimeout(() => {
            delete clear.dataset.armed;
            clear.textContent = "Vider";
          }, 3000);
        }
      },
      "plan-clear",
    );
    clear.dataset.act = "nav.clear";
    bar.append(add, cruise, actButton("Procédures", "nav.procedures", {}, "plan-procedures"), clear);
  } else if (v === "schematic") {
    // the configuration (PLAN-CREW-ACTIONS A1): what a copilot sets — every switch lit as the pilot's craft is
    const sys = () => snapNow()?.sys;
    bar.append(
      actGroup("Train", [
        ["Rentré", "cfg.gear", { down: false }, () => sys()?.gearDown === false],
        ["Sorti", "cfg.gear", { down: true }, () => !!sys()?.gearDown],
      ]),
      actGroup("Volets", [
        ["0", "cfg.flaps", { pos: 0 }, () => (sys()?.flaps ?? -1) === 0],
        ["½", "cfg.flaps", { pos: 0.5 }, () => sys()?.flaps === 0.5],
        ["Pleins", "cfg.flaps", { pos: 1 }, () => sys()?.flaps === 1],
      ]),
      actGroup("Aérofrein", [
        ["Rentré", "cfg.brake", { on: false }, () => (sys()?.brake ?? 1) === 0],
        ["Sorti", "cfg.brake", { on: true }, () => (sys()?.brake ?? 0) > 0],
      ]),
      actGroup("SAS", [
        ["Off", "cfg.sas", { on: false }, () => snapNow()?.auto?.sas === false],
        ["On", "cfg.sas", { on: true }, () => !!snapNow()?.auto?.sas],
      ]),
      actButton("Acquitter l’alarme", "cfg.ack", {}, "ack-systems"),
    );
  } else if (v === "telemetry") {
    bar.append(
      selectControl(
        [["multi", "Vue d’ensemble"], ...METRICS.map((m) => [m.key, m.name] as [string, string])],
        views.channel,
        "Mesure affichée",
        (c) => {
          views.channel = c as typeof views.channel;
          views.request();
        },
      ),
      selectControl(
        [
          ["60", "1 min"],
          ["300", "5 min"],
          ["600", "10 min"],
          ["3600", "1 h"],
        ],
        String(views.window),
        "Fenêtre de temps",
        (w) => {
          views.window = Number(w);
          views.request();
        },
      ),
    );
    const pause = button(
      views.paused ? "Reprendre" : "Figer",
      () => {
        views.togglePause();
        controls();
      },
      "pause-chart",
    );
    pause.setAttribute("aria-pressed", String(views.paused));
    const cursor = document.createElement("input");
    cursor.type = "range";
    cursor.min = "0";
    cursor.max = "100";
    cursor.value = String(views.inspect * 100);
    cursor.setAttribute("aria-label", "Instant de la courbe");
    cursor.addEventListener("input", () => {
      views.inspect = Number(cursor.value) / 100;
      views.request();
    });
    views.onInspect = () => {
      cursor.value = String(views.inspect * 100);
    };
    bar.append(pause, cursor, button("CSV", download));
  }
  $("view-note").textContent = NOTES[v];
}
function setView(view: CrewView) {
  views.setView(view);
  $("view-title").textContent = VIEW_NAMES[view];
  $("instruments").setAttribute("aria-label", `${VIEW_NAMES[view]} du pilote suivi ; contrôles disponibles au-dessus de la vue`);
  for (const b of $("views").querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.view === view);
    b.setAttribute("aria-pressed", String(b.dataset.view === view));
  }
  document.querySelector<HTMLElement>(".zoom")!.hidden = [
    "pfd",
    "orbit",
    "sdash",
    "navball",
    "dock",
    "budget",
    "eecom",
    "timeline",
    "rel",
    "ground",
  ].includes(view);
  if (view === "system") views.map3d.ahead = 0;
  // (the spacecraft's flight computer under every view of its console — K6: each station acts from its own)
  mcp.hidden = profile !== "space" && view !== "pfd" && view !== "dash" && view !== "radar" && view !== "air";
  syncMcpKind();
  $("views").querySelector<HTMLElement>(`[data-view=${view}]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  controls();
  showCrew(false);
}
const ICONS: Record<CrewView, string> = {
  air: '<path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>',
  sdash:
    '<rect x="3" y="3" width="11" height="11" rx="2"/><rect x="16" y="3" width="5" height="18" rx="2"/><rect x="3" y="16" width="11" height="5" rx="2"/>',
  navball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><circle cx="12" cy="8" r="1.6"/><path d="M8 12l4 3 4-3"/>',
  dock: '<rect x="3" y="9" width="7" height="6" rx="1"/><path d="M10 12h4"/><circle cx="18" cy="12" r="3"/>',
  budget: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  eecom: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  timeline: '<path d="M3 12h18"/><circle cx="7" cy="12" r="2"/><circle cx="14" cy="12" r="2"/><path d="M19 9v6"/>',
  rel: '<circle cx="8" cy="12" r="5"/><circle cx="17" cy="12" r="4"/><path d="M8 12V9M17 12l2-2"/>',
  ground: '<circle cx="12" cy="12" r="9"/><path d="M5 15c4-6 10-6 14-3"/><circle cx="16" cy="11" r="1.5"/>',
  system:
    '<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="9.5" ry="4"/><ellipse cx="12" cy="12" rx="5.5" ry="2.3"/><circle cx="21" cy="12" r="1.2"/>',
  orbit:
    '<ellipse cx="12" cy="12" rx="9" ry="5" transform="rotate(-25 12 12)"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="8" r="1.2"/>',
  dash: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/>',
  pfd: '<circle cx="12" cy="12" r="9"/><path d="M3 13h18M8 12h-3M19 12h-3M10 12l2 2 2-2"/>',
  nd: '<path d="M4 18a9 9 0 0 1 16 0"/><path d="M12 18l-2.5-6L12 4l2.5 8z"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>',
  schematic: '<path d="M12 3v18M5 9l7-2 7 2M8 18l4-1 4 1"/><circle cx="12" cy="12" r="1.5"/>',
  plan: '<path d="M3 18l5-6 4 3 4-7 5 4"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="8" r="1.5"/>',
  telemetry: '<path d="M3 17l4-5 4 3 4-8 6 6"/><path d="M3 21h18"/>',
};
/** the header's badge: the profile and the craft followed (F-35 · TACTIQUE, VAISSEAU · ENDURANCE) */
function syncBadge() {
  const c = snapNow()?.craft;
  // (a spacecraft's console: the station, aboard or on the ground — and the light's time from there)
  const L = model.selected !== null ? model.linkOf(model.selected) : { delay: 0, cut: false };
  const where = station.place === "aboard" ? "à bord" : L.cut ? "sol · liaison coupée" : L.delay >= 0.5 ? `sol +${dur(L.delay)}` : "sol";
  $("profile-badge").textContent =
    profile === "jet"
      ? `${c?.name ?? "F-35"} · TACTIQUE`.toUpperCase()
      : profile === "space"
        ? `VAISSEAU · ${c?.name ?? ""} — ${station.call} · ${where}`.toUpperCase()
        : "";
  $("profile-badge").classList.toggle("cut", station.place === "ground" && L.cut);
}
/** the console's profile now (PLAN-VAISSEAUX K2 — profile.ts): the craft followed's — its views, its tiles, its theme */
let profile: CrewProfile | null = null;
function setProfile(p: CrewProfile) {
  if (p === profile) return;
  profile = p;
  document.body.dataset.profile = p;
  syncBadge();
  $("views").replaceChildren();
  for (const view of PROFILE_VIEWS[p]) {
    const b = button("", () => setView(view));
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[view]}</svg><span>${VIEW_NAMES[view]}</span>`;
    b.dataset.view = view;
    $("views").append(b);
  }
  $("metrics").replaceChildren();
  // (the view kept when the other profile has it — the globe, the telemetry —, else the station's, the profile's first)
  setView(PROFILE_VIEWS[p].includes(views.view) ? views.view : p === "space" ? station.view : viewIn(p, views.view));
}
views.onOpen = setView;
$("zoom-in").addEventListener("click", () => views.zoomBy(1.333));
$("zoom-out").addEventListener("click", () => views.zoomBy(0.75));
const unitsButton = $("units-button");
function setUnits(sys: "metric" | "imperial") {
  views.units = sys;
  store.set("kerr.crew.units", sys);
  unitsButton.textContent = sys === "metric" ? "MÉTRIQUE" : "IMPÉRIAL";
  for (const e of $("metrics").children) (e as HTMLElement).dataset.unit = "";
  refresh();
  views.request();
}
unitsButton.addEventListener("click", () => setUnits(views.units === "metric" ? "imperial" : "metric"));
function download() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([model.csv()], { type: "text/csv" }));
  a.download = `kerr-crew-${model.selected ?? "flight"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** the strip's tiles: the measures a glance needs, their state (amber, red) and trend — each profile its own
 *  (PLAN-VAISSEAUX K2: the spacecraft's Δv, propellant, apsides, period, next event, g, dτ/dt, the link) */
const TILES: Record<TileKey, { name: string; unit: (u: ReturnType<typeof unitsOf>) => string }> = {
  alt: { name: "Altitude", unit: (u) => u.altName.toLowerCase() },
  speed: { name: "Vitesse", unit: (u) => u.spdName.toLowerCase() },
  vz: { name: "Vario", unit: (u) => u.vsName.toLowerCase() },
  mach: { name: "Mach", unit: () => "" },
  g: { name: "Charge", unit: () => "g" },
  hdg: { name: "Cap", unit: () => "°" },
  fuel: { name: "Carburant", unit: () => "%" },
  agl: { name: "Hauteur sol", unit: (u) => u.altName.toLowerCase() },
  dv: { name: "Δv restant", unit: () => "m/s" },
  prop: { name: "Ergols", unit: () => "%" },
  pe: { name: "Périapside", unit: () => "km" },
  ap: { name: "Apoapside", unit: () => "km" },
  period: { name: "Période", unit: () => "" },
  next: { name: "Prochain", unit: () => "" },
  dtau: { name: "dτ/dt", unit: () => "" },
  link: { name: "Liaison", unit: () => "" },
};
function tiles(own: ReturnType<typeof model.own>) {
  const box = $("metrics");
  const u = unitsOf(views.units);
  const keys = PROFILE_TILES[profile ?? "jet"];
  if (!box.childElementCount)
    for (const k of keys) {
      const e = el("div", "", "metric");
      e.dataset.key = k;
      e.append(el("small", TILES[k].name), el("strong", "—"), el("em", ""));
      box.append(e);
    }
  const live = !!own && own.age < 3;
  const m = own?.metrics ?? {},
    snap = own?.snapshot,
    f = snap?.flight,
    sys = snap?.sys;
  const fmt0 = (v: number | undefined | null, d = 0) =>
    v === undefined || v === null || !Number.isFinite(v)
      ? "—"
      : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  for (const k of keys) {
    const e = box.querySelector<HTMLElement>(`[data-key=${k}]`)!;
    let text = "—",
      state = "",
      unit = TILES[k].unit(u);
    if (live) {
      switch (k) {
        case "alt":
          text =
            m.alt !== undefined && Math.abs(m.alt) > 99_999
              ? `${fmt0(m.alt / 1000, 1)}`
              : fmt0(m.alt !== undefined ? u.alt(m.alt) : undefined);
          if (m.alt !== undefined && Math.abs(m.alt) > 99_999) unit = "km";
          break;
        case "speed": {
          const v = f?.tas ?? m.speed;
          text = fmt0(v !== undefined ? u.spd(v) : undefined);
          break;
        }
        case "vz":
          text = m.vz !== undefined ? `${m.vz > 0.5 ? "▲" : m.vz < -0.5 ? "▼" : ""}${fmt0(Math.abs(u.vs(m.vz)))}` : "—";
          state = m.vz !== undefined && m.vz < -40 ? "warn" : "";
          break;
        case "mach":
          text = fmt0(m.mach, 2);
          state = m.mach !== undefined && m.mach > 1 ? "warn" : "";
          break;
        case "g":
          text = fmt0(f?.nz ?? m.g, 1);
          state = f?.gMax && Math.abs(f.nz ?? m.g ?? 0) > f.gMax * 0.9 ? "alarm" : Math.abs(f?.nz ?? m.g ?? 1) > 5 ? "warn" : "";
          break;
        case "hdg": {
          const h = f?.hdg ?? own?.geo?.heading;
          text = h === undefined ? "—" : String(Math.round(((((h * 180) / Math.PI) % 360) + 360) % 360) % 360).padStart(3, "0");
          break;
        }
        case "fuel":
          if (sys?.fuelKg != null && sys.fuelFull) {
            text = fmt0(sys.fuelKg);
            unit = "kg";
          } else text = fmt0(m.fuel !== undefined ? m.fuel * 100 : undefined);
          {
            const frac = sys?.fuelKg != null && sys.fuelFull ? sys.fuelKg / sys.fuelFull : m.fuel;
            state = frac === undefined ? "" : frac < 0.1 ? "alarm" : frac < 0.25 ? "warn" : "ok";
          }
          break;
        case "agl":
          text = f?.agl !== undefined && f.agl < 30_000 ? fmt0(u.alt(f.agl)) : "—";
          state = f?.agl !== undefined && f.agl < 150 && (m.vz ?? 0) < -3 ? "warn" : "";
          break;
        case "dv": {
          const dv = snap?.budget?.dv;
          // (a big one in km/s: the tile is narrow)
          text = dv === null ? "∞" : dv !== undefined && dv >= 100_000 ? fmt0(dv / 1000, 1) : fmt0(dv);
          if (dv != null && dv >= 100_000) unit = "km/s";
          state = dv != null && dv < 200 ? "warn" : "";
          break;
        }
        case "prop": {
          const pr = snap?.budget?.prop ?? (m.fuel !== undefined ? m.fuel : null);
          text = fmt0(pr !== null ? pr * 100 : null);
          state = pr === null ? "" : pr < 0.1 ? "alarm" : pr < 0.25 ? "warn" : "ok";
          break;
        }
        case "pe":
          text = fmt0(snap?.orbit?.pe, Math.abs(snap?.orbit?.pe ?? 0) < 100 ? 1 : 0);
          state = snap?.orbit && snap.orbit.pe < 0 ? "alarm" : "";
          break;
        case "ap":
          text = snap?.orbit ? (snap.orbit.ecc >= 1 ? "libre" : fmt0(snap.orbit.ap, Math.abs(snap.orbit.ap) < 100 ? 1 : 0)) : "—";
          if (snap?.orbit && snap.orbit.ecc >= 1) unit = "";
          break;
        case "period":
          text = dur(snap?.orbit?.period ?? null);
          break;
        case "next":
          // (short: the tile is narrow — 15 min, not 14 min 57)
          text = !snap?.next ? "—" : snap.next.in < 60 || snap.next.in >= 3600 ? dur(snap.next.in) : `${Math.round(snap.next.in / 60)} min`;
          unit = "";
          e.title = snap?.next ? `${snap.next.name || snap.next.kind} dans ${dur(snap.next.in)}` : "";
          state = snap?.next?.kind === "impact" ? "alarm" : "";
          break;
        case "dtau":
          text = fmt0(snap?.time?.dtau, 4);
          state = snap?.time && snap.time.dtau < 0.99 ? "warn" : "";
          break;
        case "link":
          text = snap?.link ? (snap.link.cut ? "coupée" : dur(snap.link.light)) : "—";
          unit = snap?.link && !snap.link.cut ? "lumière" : "";
          state = snap?.link?.cut ? "alarm" : "";
          break;
      }
    }
    e.querySelector("strong")!.textContent = text;
    e.querySelector("em")!.textContent = unit;
    e.dataset.state = state;
  }
}
/** the annunciator: the warnings red and blinking, the cautions amber */
let alertKey = "";
function alerts(own: ReturnType<typeof model.own>) {
  const list = own && own.age < 3 ? (own.snapshot?.warn ?? []) : [];
  const key = list.join("|");
  if (key === alertKey) return;
  alertKey = key;
  $("alerts").replaceChildren(
    ...list.map((w) => el("span", w, `alert${/PULL|FLY|STALL|G-LOC|MISSILE|OVER|IMPACT|FAIL/.test(w) ? " warning" : ""}`)),
    ...(list.length ? [actButton("Acquitter", "cfg.ack", {}, "ack-alarm")] : []),
  );
  syncActs();
}

/**
 * A control that gives an order: busy until the pilot answers, its result said (a refusal also by a short
 * vibration on a phone), unusable while its family is closed (the lock, the craft, the mode) — the reason its title.
 */
function actButton(text: string, act: Act, args: Args | (() => Args) = {}, id?: string, done?: (ok: boolean, r: Done) => void) {
  const b = button(text, () => void fire(b, act, typeof args === "function" ? args() : args, done), id);
  b.dataset.act = act;
  return b;
}
async function fire(b: HTMLElement | null, act: Act, args: Args, done?: (ok: boolean, r: Done) => void) {
  b?.setAttribute("aria-busy", "true");
  const r = await actions.send(act, args);
  b?.removeAttribute("aria-busy");
  b?.classList.remove("ok", "ko");
  void b?.offsetWidth;
  b?.classList.add(r.ok ? "ok" : "ko");
  const what = actions.label(act, args);
  const What = what.charAt(0).toUpperCase() + what.slice(1);
  notice(r.ok ? `${What} ✓` : `${What} — ${r.msg || "refusé"}`);
  if (!r.ok) navigator.vibrate?.(60);
  done?.(r.ok, r);
  refresh();
  return r;
}
/** the controls that show a state of the pilot's (the gear down, the SAS…): their pressed look from his instruments */
const pressedOf = new Map<HTMLElement, () => boolean>();
/**
 * A group of ordering buttons, one of them lit as the pilot's state says (read at 4 Hz, not assumed): a title, and
 * each choice's words, act, arguments and whether it is the state now.
 */
function actGroup(title: string, items: [string, Act, Args, () => boolean][]) {
  const g = el("div", "", "seg act-seg");
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", title);
  g.append(el("span", title, "seg-title"));
  for (const [text, act, args, on] of items) {
    const b = actButton(text, act, args);
    pressedOf.set(b, on);
    g.append(b);
  }
  return g;
}
/**
 * An order given only by holding (a shot): the finger kept down `ms` — a ring fills — or, from a keyboard, a second
 * press within 1.5 s. Let go early: nothing sent. Never a pilot's validation (all is allowed): a gesture against slips.
 */
function holdButton(text: string, act: Act, args: () => Args, id: string, ms = 600) {
  const b = el("button", text, "hold-btn") as HTMLButtonElement;
  b.type = "button";
  b.id = id;
  b.dataset.act = act;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armed = 0;
  const go = () => void fire(b, act, args());
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    b.classList.remove("holding");
  };
  b.addEventListener("pointerdown", (e) => {
    if (b.disabled) return;
    e.preventDefault();
    b.style.setProperty("--hold", `${ms}ms`);
    b.classList.add("holding");
    timer = setTimeout(() => {
      stop();
      go();
    }, ms);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, stop);
  b.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (performance.now() - armed < 1500) {
      armed = 0;
      b.classList.remove("armed");
      go();
    } else {
      armed = performance.now();
      b.classList.add("armed");
      notice(`${text} : appuyer encore pour confirmer`);
      setTimeout(() => b.classList.remove("armed"), 1500);
    }
  });
  b.title = "Maintenir pour tirer";
  return b;
}

/** the pilot followed's snapshot now (fresh), for the controls' states */
const snapNow = () => {
  const own = model.own();
  return own && own.age < 3 ? own.snapshot : null;
};

/** every control that gives an order: on or off as its family is open */
function syncActs() {
  const armsBox = document.querySelector<HTMLElement>(".arms-state");
  if (armsBox) {
    const a = snapNow()?.arms;
    const s = a?.stores ?? {};
    armsBox.textContent = !a
      ? ""
      : `${a.live ? "ARMES ACTIVES" : "HORS COMBAT"} · 120×${s.aim120 ?? 0} 9X×${s.aim9x ?? 0} JDAM×${s.jdam ?? 0} JSM×${s.jsm ?? 0}${a.lock ? ` · VERROU ${a.lock}` : ""}`;
    armsBox.dataset.live = String(!!a?.live);
  }
  for (const [b, on] of pressedOf) {
    if (!b.isConnected) {
      pressedOf.delete(b);
      continue;
    }
    b.setAttribute("aria-pressed", String(on()));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("[data-act]")) {
    const fam = ACTS[b.dataset.act as Act]?.fam;
    const can = fam ? actions.can(fam) : { ok: false, why: "" };
    // (a control held back for its own reason — a failure's action before its checklist is ticked: K6)
    const held = b.dataset.held ?? "";
    b.disabled = !can.ok || !!held;
    b.title = !can.ok ? can.why : held;
  }
}
// ---- the MCP (PLAN-CREW-ACTIONS A3): the aircraft's autopilot set as a copilot sets it — under the PFD and the dashboard
const mcp = $("mcp");
/** a selector's value turned but not yet sent (sent once the finger rests 400 ms), its time */
const pend: { alt?: number; hdg?: number; spd?: number; at: number } = { at: 0 };
let pendTimer: ReturnType<typeof setTimeout> | undefined;
/** the selectors' targets now: the pending turn, else the pilot's selected, else the flight's own figure */
function mcpNow() {
  const s = snapNow();
  const a = s?.auto,
    f = s?.flight;
  const recent = performance.now() - pend.at < 2500;
  return {
    alt: (recent ? pend.alt : undefined) ?? a?.alt ?? s?.metrics.alt ?? 0,
    hdg: (recent ? pend.hdg : undefined) ?? (a?.hdg != null ? (a.hdg * 180) / Math.PI : f ? (f.hdg * 180) / Math.PI : 0),
    spd: (recent ? pend.spd : undefined) ?? a?.spd ?? f?.tas ?? s?.metrics.speed ?? 0,
  };
}
function sendPend() {
  const args: Args = {};
  if (pend.alt !== undefined) args.alt = Math.round(Math.max(0, Math.min(20_000, pend.alt)));
  if (pend.hdg !== undefined) args.hdgDeg = ((Math.round(pend.hdg) % 360) + 360) % 360;
  if (pend.spd !== undefined) args.spd = Math.round(Math.max(30, Math.min(700, pend.spd)));
  pend.alt = pend.hdg = pend.spd = undefined;
  if (Object.keys(args).length) void fire(mcp.querySelector("[data-act='ap.set']"), "ap.set", args);
}
/** a selector: − and + (held: repeating, faster), its value; turned values sent together once the finger rests */
function selector(key: "alt" | "hdg" | "spd", title: string) {
  const box = el("div", "", "knob");
  box.dataset.key = key;
  const u = () => unitsOf(views.units);
  const step = () => (key === "hdg" ? 1 : key === "alt" ? 100 / u().alt(1) : 5 / u().spd(1));
  const value = el("output", "—", "knob-value");
  const turn = (dir: number, fast: boolean) => {
    const now = mcpNow();
    let v = (pend[key] ?? now[key]) + dir * step() * (fast ? 10 : 1);
    if (key === "hdg") v = ((v % 360) + 360) % 360;
    pend[key] = v;
    pend.at = performance.now();
    clearTimeout(pendTimer);
    pendTimer = setTimeout(sendPend, 400);
    syncMcp();
  };
  const hold = (dir: number, text: string, label: string) => {
    const b = el("button", text, "knob-step") as HTMLButtonElement;
    b.type = "button";
    b.dataset.act = "ap.set";
    b.setAttribute("aria-label", label);
    let timer: ReturnType<typeof setInterval> | undefined;
    let n = 0;
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      n = 0;
      turn(dir, false);
      timer = setInterval(() => turn(dir, ++n > 8), 140);
    });
    for (const ev of ["pointerup", "pointercancel", "pointerleave", "blur"]) b.addEventListener(ev, stop);
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        turn(dir, e.shiftKey);
      }
    });
    return b;
  };
  box.append(el("span", title, "knob-title"), hold(-1, "−", `${title} moins`), value, hold(1, "+", `${title} plus`));
  return box;
}
/** the MCP's kind follows the pilot's craft: an aircraft's autopilot, or a spacecraft's flight computer */
function syncMcpKind() {
  const fam = snapNow()?.caps?.fam ?? [];
  // (the radar's: the weapons' panel, in the F-35 only)
  if (views.view === "radar" || views.view === "air") mcp.hidden = !fam.includes("weapons");
  if (mcp.hidden) return;
  const kind = views.view === "radar" || views.view === "air" ? "arms" : fam.includes("space") && !fam.includes("jet") ? "space" : "jet";
  // (the spacecraft's panel rebuilt for another station or craft — its pops' order, the Endurance's ring)
  const sig = kind === "space" ? `space:${station.id}:${!!snapNow()?.craft?.ring}` : kind;
  if (mcp.dataset.kind === sig && mcp.childElementCount) return;
  if (kind === "arms") buildArms();
  else if (kind === "space") {
    buildFc();
    mcp.dataset.kind = sig;
  } else buildMcp();
}
/** the F-35's weapons (PLAN-CREW-ACTIONS A5), the backseater's: the radar, the weapon, the lock, the shots, the decoys */
function buildArms() {
  mcp.replaceChildren();
  mcp.dataset.kind = "arms";
  const arms = () => snapNow()?.arms;
  const sw = el("div", "", "mcp-sw arms-sw");
  sw.append(
    actGroup("Radar", [
      ["RWS", "wp.radar", { mode: "RWS" }, () => arms()?.mode === "RWS"],
      ["TWS", "wp.radar", { mode: "TWS" }, () => arms()?.mode === "TWS"],
      ["STT", "wp.radar", { mode: "STT" }, () => arms()?.mode === "STT"],
    ]),
    actGroup("Arme", [
      ["AIM-120", "wp.select", { weapon: "aim120" }, () => arms()?.sel === "aim120"],
      ["AIM-9X", "wp.select", { weapon: "aim9x" }, () => arms()?.sel === "aim9x"],
      ["GBU-32", "wp.select", { weapon: "jdam" }, () => arms()?.sel === "jdam"],
      ["JSM", "wp.select", { weapon: "jsm" }, () => arms()?.sel === "jsm"],
    ]),
  );
  const shots = el("div", "", "mcp-sw arms-shots");
  shots.append(
    actButton("Verrouiller", "wp.lock", {}, "wp-lock"),
    holdButton("TIR", "wp.fire", () => ({}), "wp-fire"),
    holdButton("Canon", "wp.gun", () => ({ seconds: 1 }), "wp-gun"),
    actButton("Leurres", "wp.cm", {}, "wp-cm"),
    el("span", "", "arms-state"),
  );
  mcp.append(sw, shots);
  syncActs();
}
function buildMcp() {
  mcp.replaceChildren();
  mcp.dataset.kind = "jet";
  /** a switch: its state the pilot's (4 Hz), but what it was just set to while his instruments catch up (1.5 s) */
  const toggle = (text: string, act: Act, args: (want: boolean) => Args, on: () => boolean, id: string) => {
    let local: { v: boolean; at: number } | null = null;
    let want = false;
    const state = () => (local && performance.now() - local.at < 1500 ? local.v : on());
    const b = actButton(
      text,
      act,
      () => {
        want = !state();
        return args(want);
      },
      id,
      (ok) => {
        if (ok) local = { v: want, at: performance.now() };
      },
    );
    pressedOf.set(b, state);
    return b;
  };
  const a = () => snapNow()?.auto;
  const app = document.createElement("details");
  app.className = "pan-controls mcp-pop";
  app.append(el("summary", "APP"));
  const appBox = el("div");
  const field = document.createElement("input");
  field.placeholder = "OACI (vide : le plus proche)";
  field.setAttribute("aria-label", "Terrain de l'approche ILS");
  appBox.append(
    field,
    actButton("ILS", "ap.ils", () => (field.value.trim() ? { field: field.value.trim().slice(0, 12) } : {}), "mcp-ils"),
    actButton("Annuler l'ILS", "ap.ilsOff", {}, "mcp-ils-off"),
  );
  app.append(appBox);
  const modes = document.createElement("details");
  modes.className = "pan-controls mcp-pop";
  modes.append(el("summary", "Modes"));
  const modeBox = el("div");
  const agl = document.createElement("input");
  agl.type = "number";
  agl.value = "150";
  agl.setAttribute("aria-label", "Hauteur du suivi de terrain en mètres");
  const here = () => {
    const g = model.own()?.geo;
    return g ? { lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5 } : {};
  };
  modeBox.append(
    actButton("Orbite ici", "ap.mode", () => ({ mode: "orbit", ...here() }), "mcp-orbit"),
    actButton("Circuit d'attente", "ap.mode", () => ({ mode: "hold", inboundDeg: Math.round(mcpNow().hdg) % 360 }), "mcp-hold"),
    agl,
    actButton("Suivi de terrain", "ap.mode", () => ({ mode: "tf", aglM: Math.max(0, Math.min(1000, Number(agl.value) || 150)) }), "mcp-tf"),
    actButton("Arrêter l'interception", "ap.traffic", { action: "stop" }, "mcp-stop"),
    actButton("Couper le mode", "ap.mode", { mode: "off" }, "mcp-mode-off"),
  );
  modes.append(modeBox);
  const go = actButton("Remise de gaz", "ap.goAround", {}, "mcp-ga");
  go.classList.add("mcp-ga");
  // the switches on one row (a phone scrolls it), the three selectors on the other
  const sw = el("div", "", "mcp-sw");
  sw.append(
    toggle(
      "AP",
      "ap.engage",
      (w) => ({ ap: w }),
      () => a()?.alt != null || a()?.hdg != null,
      "mcp-ap",
    ),
    toggle(
      "A/THR",
      "ap.engage",
      (w) => ({ athr: w }),
      () => a()?.spd != null,
      "mcp-athr",
    ),
    toggle(
      "LNAV",
      "ap.nav",
      (w) => ({ lnav: w }),
      () => !!a()?.lnav,
      "mcp-lnav",
    ),
    toggle(
      "VNAV",
      "ap.nav",
      (w) => ({ vnav: w }),
      () => !!a()?.vnav,
      "mcp-vnav",
    ),
    app,
    modes,
    go,
  );
  const kn = el("div", "", "mcp-knobs");
  kn.append(selector("spd", "VIT"), selector("hdg", "CAP"), selector("alt", "ALT"));
  mcp.append(sw, kn);
  syncMcp();
}
// ---- the flight computer (PLAN-CREW-ACTIONS A4): a spacecraft's holds, autopilots, manoeuvres and missions
/** a select of choices (their value, their words) */
function choices(items: readonly string[], words: Record<string, string>, label: string, value?: string) {
  const s = document.createElement("select");
  s.setAttribute("aria-label", label);
  for (const v of items) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = words[v] ?? v;
    s.append(o);
  }
  if (value) s.value = value;
  return s;
}
/** a popover of the flight computer's: its summary, its body */
function fcPop(title: string, body: HTMLElement[]) {
  const d = document.createElement("details");
  d.className = "pan-controls mcp-pop fc-pop";
  d.append(el("summary", title));
  const box = el("div");
  box.append(...body);
  d.append(box);
  return d;
}
/** a manoeuvre's or a mission's figures back from the pilot's game, in a small card */
function fcCard(card: HTMLElement, r: { ok: boolean; msg: string; data?: Record<string, string | number | boolean> }) {
  const d = r.data ?? {};
  const rows: [string, string][] = [];
  if (typeof d.dvTotalMs === "number") rows.push(["Δv total", `${Math.round(d.dvTotalMs)} m/s`]);
  if (typeof d.burnsN === "number") rows.push(["Combustions", String(d.burnsN)]);
  if (typeof d.burns1 === "string") rows.push(["Première", d.burns1]);
  if (typeof d.executing === "boolean") rows.push(["Exécution", d.executing ? "en cours" : "non"]);
  card.replaceChildren(
    el("strong", r.ok ? "Aperçu" : "Refusé"),
    ...(r.msg ? [el("p", r.msg)] : []),
    ...rows.map(([k, v]) => {
      const row = el("div", "", "fc-row");
      row.append(el("span", k), el("b", v));
      return row;
    }),
  );
  card.dataset.state = r.ok ? "ok" : "ko";
}
function buildFc() {
  mcp.replaceChildren();
  mcp.dataset.kind = "space";
  const field = (label: string, ph = "", type = "text") => {
    const i = document.createElement("input");
    i.type = type;
    i.placeholder = ph;
    i.setAttribute("aria-label", label);
    return i;
  };
  const num = (i: HTMLInputElement) => (i.value.trim() === "" ? undefined : Number(i.value));
  // the hold
  const hold = choices(HOLDS, { none: "Aucune", ...HOLD_FR }, "Tenue d'attitude", "prograde");
  // the autopilot (a site to land on or enter for, an orbit to take off to)
  const auto = choices(AUTOS, { none: "Aucun", ...AUTO_FR }, "Autopilote", "circularize");
  const site = field("Site d'atterrissage ou de rentrée", "site (atterrir, rentrée)");
  const upAlt = field("Altitude d'orbite au décollage (km)", "orbite km", "number");
  // the manoeuvre and its card
  const op = choices(MANEUVERS, MANEUVER_FR, "Manœuvre", "circularize");
  const where = choices(["now", "pe", "ap"], { now: "maintenant", pe: "au périgée", ap: "à l'apogée" }, "Quand");
  const mAlt = field("Altitude visée (km)", "altitude km", "number");
  const mInc = field("Inclinaison visée (°)", "inclinaison °", "number");
  const mCard = el("div", "", "fc-card");
  const maneuver = (execute: boolean): Args => ({
    op: op.value,
    where: where.value,
    ...(num(mAlt) !== undefined ? { altKm: num(mAlt) } : {}),
    ...(num(mInc) !== undefined ? { incDeg: num(mInc) } : {}),
    execute,
  });
  // the mission and its card
  const target = field("Destination de la mission", "Lune, Mars, ISS…");
  const arrival = choices(
    ["orbit", "flyby", "freeReturn"],
    { orbit: "mise en orbite", flyby: "survol", freeReturn: "retour libre" },
    "Arrivée",
  );
  const sCard = el("div", "", "fc-card");
  const mission = (execute: boolean): Args => ({ target: target.value.trim().slice(0, 32), arrival: arrival.value, execute });
  // the target (sp.target: a body, the station, a craft of the room by its name)
  const tgt = field("Cible", "Lune, Mars, ISS, Endurance…");
  // the systems (X3 · K6): each failure's checklist, its steps ticked here as on the pilot's tablet, its action once
  // all are — rebuilt as the pilot's figures change (syncSys)
  const sys = el("div", "", "fc-sys");
  sys.id = "fc-sys";
  const pops: Record<string, HTMLElement> = {
    hold: fcPop("Tenue", [hold, actButton("Tenir", "sp.hold", () => ({ direction: hold.value }), "fc-hold")]),
    auto: fcPop("Autopilote", [
      auto,
      site,
      upAlt,
      actButton(
        "Engager",
        "sp.auto",
        () => ({
          mode: auto.value,
          ...(site.value.trim() ? { site: site.value.trim().slice(0, 40) } : {}),
          ...(num(upAlt) !== undefined ? { altKm: num(upAlt) } : {}),
        }),
        "fc-auto",
      ),
    ]),
    maneuver: fcPop("Manœuvre", [
      op,
      where,
      mAlt,
      mInc,
      actButton(
        "Aperçu",
        "sp.maneuver",
        () => maneuver(false),
        "fc-preview",
        (_ok, r) => fcCard(mCard, r),
      ),
      actButton(
        "Exécuter",
        "sp.maneuver",
        () => maneuver(true),
        "fc-execute",
        (_ok, r) => fcCard(mCard, r),
      ),
      mCard,
    ]),
    mission: fcPop("Mission", [
      target,
      arrival,
      actButton(
        "Aperçu",
        "sp.mission",
        () => mission(false),
        "fc-mission-preview",
        (_ok, r) => fcCard(sCard, r),
      ),
      actButton(
        "Lancer",
        "sp.mission",
        () => mission(true),
        "fc-mission",
        (_ok, r) => fcCard(sCard, r),
      ),
      sCard,
    ]),
    plan: fcPop("Plan", [
      actButton("Exécuter le plan", "sp.plan", { action: "execute" }, "fc-plan-run"),
      actButton("Effacer le plan", "sp.plan", { action: "clear" }, "fc-plan-clear"),
    ]),
    target: fcPop("Cible", [
      tgt,
      actButton("Prendre pour cible", "sp.target", () => ({ name: tgt.value.trim().slice(0, 32) }), "fc-target"),
    ]),
    dock: fcPop("Amarrage", [
      actButton("Maintien à poste", "sp.dock", { action: "keep" }, "fc-keep"),
      actButton("Désamarrer", "sp.dock", { action: "undock" }, "fc-undock"),
      actButton("Faire le plein", "sp.dock", { action: "refuel" }, "fc-refuel"),
      actButton("Mode RCS", "sp.dock", { action: "rcs" }, "fc-rcs"),
    ]),
    systems: fcPop("Systèmes", [sys]),
    ...(snapNow()?.craft?.ring
      ? {
          ring: fcPop("Anneau", [
            actButton("Anneau −", "sp.ring", { dir: -1 }, "fc-ring-down"),
            actButton("Anneau +", "sp.ring", { dir: 1 }, "fc-ring-up"),
          ]),
        }
      : {}),
  };
  // (the station's own first — PLAN-VAISSEAUX K6: FIDO the trajectory's, GUIDO the attitude's, EECOM the systems')
  const order: Record<StationId, string[]> = {
    copilot: ["hold", "auto", "maneuver", "plan", "dock", "target", "mission", "systems", "ring"],
    nav: ["maneuver", "mission", "plan", "target", "hold", "auto", "dock", "systems", "ring"],
    engineer: ["systems", "ring", "dock", "hold", "auto", "maneuver", "plan", "target", "mission"],
    flight: ["auto", "hold", "maneuver", "mission", "plan", "dock", "systems", "target", "ring"],
    fido: ["maneuver", "mission", "plan", "target", "auto", "hold", "dock", "systems", "ring"],
    guido: ["hold", "auto", "dock", "target", "maneuver", "plan", "mission", "systems", "ring"],
    eecom: ["systems", "ring", "dock", "hold", "auto", "maneuver", "plan", "mission", "target"],
    capcom: ["hold", "auto", "plan", "dock", "systems", "maneuver", "mission", "target", "ring"],
  };
  const sw = el("div", "", "mcp-sw");
  const keys = order[station.id].filter((k) => pops[k]);
  keys.forEach((k, i) => {
    if (i === 0) pops[k]!.classList.add("featured");
    sw.append(pops[k]!);
  });
  sw.append(actButton("Relâcher", "sp.release", {}, "fc-release"));
  mcp.append(sw);
  sysKey = "";
  syncSys();
  syncActs();
}

/** the Systems pop's failures and their checklists from the pilot's figures (K6), rebuilt when they change */
let sysKey = "";
function syncSys() {
  const box = document.getElementById("fc-sys");
  if (!box) return;
  const F = snapNow()?.sysx?.failures ?? [];
  const key = JSON.stringify(F);
  if (key === sysKey) return;
  sysKey = key;
  if (!F.length) {
    box.replaceChildren(el("p", "Aucune panne — systèmes nominaux.", "muted small"));
    return;
  }
  box.replaceChildren(
    ...F.map((f) => {
      const L = CHECKLISTS_FR[f.kind];
      const card = el("div", "", "fc-card");
      card.append(el("strong", L?.title ?? f.kind));
      const ticks = new Set(f.ticks ?? []);
      (L?.steps ?? []).forEach((st, i) => {
        const lab = document.createElement("label");
        lab.className = "fc-step";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = ticks.has(i);
        cb.dataset.testid = `sys-step-${f.kind}-${i}`;
        cb.addEventListener("change", () => void fire(null, "sys.step", { kind: f.kind, step: i, on: cb.checked }));
        lab.append(cb, document.createTextNode(` ${st}`));
        card.append(lab);
      });
      const all = (L?.steps ?? []).every((_, i) => ticks.has(i));
      const b = actButton(f.fixing ? "En cours…" : (L?.action ?? "Action"), "sys.fix", { kind: f.kind }, `sys-fix-${f.kind}`);
      if (!all || f.fixing) b.dataset.held = f.fixing ? "Réparation en cours" : "La checklist d'abord : toutes les étapes cochées";
      card.append(b);
      return card;
    }),
  );
  syncActs();
}

/** the selectors' windows: the pending turn in white, the pilot's selected in cyan, none in grey */
function syncMcp() {
  if (mcp.hidden) return;
  const u = unitsOf(views.units);
  const now = mcpNow();
  const a = snapNow()?.auto;
  const recent = performance.now() - pend.at < 2500;
  for (const box of mcp.querySelectorAll<HTMLElement>(".knob")) {
    const key = box.dataset.key as "alt" | "hdg" | "spd";
    const out = box.querySelector("output")!;
    const v = now[key];
    out.textContent =
      key === "hdg"
        ? String(Math.round(v) % 360).padStart(3, "0")
        : key === "alt"
          ? Math.round(u.alt(v)).toLocaleString("fr-FR")
          : String(Math.round(u.spd(v)));
    const selected = key === "alt" ? a?.alt != null : key === "hdg" ? a?.hdg != null : a?.spd != null;
    out.dataset.state = recent && pend[key] !== undefined ? "turning" : selected ? "selected" : "off";
  }
}

/** the board: the lock's state and the journal of the orders the pilot followed answered */
function board() {
  const own = model.own();
  const caps = own?.snapshot?.caps;
  const state = !net.room || !own ? "" : !caps ? "lecture seule" : caps.on ? "actions" : "verrouillé";
  const s = $("act-state");
  s.textContent = state === "actions" ? "ACTIONS ✓" : state === "verrouillé" ? "VERROUILLÉ" : state ? "LECTURE" : "";
  s.dataset.state = state;
  $("crew-lock").textContent = !own
    ? "Aucun pilote suivi."
    : !caps
      ? "Ce simulateur ne reçoit pas d'ordres : instruments en lecture seule."
      : caps.on
        ? `Vous pouvez agir à bord de ${own.member.name} — tout sauf piloter.`
        : `${own.member.name} a verrouillé les actions de l'équipage.`;
  const list = $("board");
  const key = JSON.stringify(actions.board.slice(0, 12).map((l) => [l.at, l.ok]));
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.replaceChildren(
      ...actions.board.slice(0, 12).map((l) => {
        const li = el("li", "", l.ok ? "ok" : "ko");
        const time = new Date(l.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        li.append(el("time", time), el("strong", l.who), el("span", l.what), ...(l.ok ? [] : [el("em", l.msg || "refusé")]));
        return li;
      }),
    );
    if (!actions.board.length) list.append(el("li", "Aucun ordre pour l'instant.", "empty"));
  }
  syncActs();
}

/** the message to the pilot (K5): live aboard; the light's time late from the ground; behind the wormhole recorded,
 *  delivered (its age with it) when the link comes back */
function sendMessage(text: string) {
  const to = model.selected;
  if (!net.room || to === null) return notice("Aucun pilote suivi.");
  const L = model.linkOf(to);
  if (L.cut) {
    outbox.record(text, Date.now());
    notice("Message enregistré : il partira au retour de la liaison.");
  } else {
    const go = () => net.event({ kind: "crew-msg", v: 1, to, text, rec: 0 });
    if (L.delay > 0) setTimeout(go, L.delay * 1000);
    else go();
    notice(L.delay > 0 ? `Message envoyé : il arrive dans ${dur(L.delay)}.` : "Message envoyé.");
  }
  syncMessages();
}
function syncMessages() {
  const to = model.selected;
  const L = to !== null ? model.linkOf(to) : { delay: 0, cut: false };
  // (the link back: the recorded ones sent, each its age)
  if (!L.cut && outbox.waiting.length && net.room && to !== null)
    for (const m of outbox.flush()) net.event({ kind: "crew-msg", v: 1, to, text: m.text, rec: Math.round((Date.now() - m.at) / 1000) });
  $("msg-state").textContent = L.cut
    ? `Liaison coupée (trou de ver) · ${outbox.waiting.length} message(s) enregistré(s)`
    : station.place === "ground" && L.delay > 0
      ? `Délai lumière ${dur(L.delay)} aller · ${dur(2 * L.delay)} aller-retour`
      : station.place === "ground"
        ? "Liaison directe"
        : "À bord : en direct";
}
$("msg-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const i = $<HTMLInputElement>("msg-text");
  const text = i.value.trim();
  if (!text) return;
  sendMessage(text);
  i.value = "";
});

function refresh() {
  const room = net.room,
    crafts = model.crafts(),
    own = model.own(crafts);
  $("connection").textContent =
    net.status === "offline" ? "Reconnexion…" : room ? `${room.code} · ${room.members.length}/8` : "Hors connexion";
  $("status-dot").className = room && net.status === "online" ? "online" : "";
  $("room-button").textContent = room ? "Salle" : "Rejoindre";
  const pk = JSON.stringify([model.selected, room?.members]);
  if (pk !== pilotKey) {
    pilotKey = pk;
    pilot.replaceChildren();
    for (const m of room?.members ?? [])
      if (m.role === "pilot") {
        const o = document.createElement("option");
        o.value = String(m.slot);
        o.textContent = m.name;
        o.selected = m.slot === model.selected;
        pilot.append(o);
      }
    if (!pilot.options.length) {
      const o = document.createElement("option");
      o.textContent = "En attente d’un pilote";
      pilot.append(o);
    }
  }
  setProfile(profileOf(own?.snapshot));
  syncBadge();
  syncMessages();
  tiles(own);
  alerts(own);
  board();
  syncMcpKind();
  syncMcp();
  syncSys();
  const followed = room?.members.find((m) => m.slot === model.selected);
  $("pilot-dot").style.background = followed?.colour ?? "#4d606b";
  $("freshness").textContent =
    net.status === "offline"
      ? "Connexion interrompue"
      : !own
        ? "En attente de données"
        : model.selected !== null && model.linkOf(model.selected).cut && own.age > 3
          ? "Liaison coupée — derrière le trou de ver"
          : own.age > 3
            ? `Position ancienne · ${Math.round(own.age)} s`
            : own.snapshot
              ? model.selected !== null && model.linkOf(model.selected).delay > 0
                ? `Mesures du pilote · différées de ${dur(model.linkOf(model.selected).delay)} (lumière)`
                : "Mesures du pilote · direct"
              : "Position reçue · mesures détaillées indisponibles";
  $("freshness").classList.toggle("stale", net.status === "offline" || (!!own && own.age > 3));
  const rk = JSON.stringify(room?.members);
  if (rk !== rosterKey) {
    rosterKey = rk;
    const members = $("members");
    members.replaceChildren();
    for (const m of room?.members ?? []) {
      const row = el("div", "", "member");
      row.dataset.slot = String(m.slot);
      row.style.setProperty("--member", /^#[\da-f]{6}$/i.test(m.colour) ? m.colour : "#89dce5");
      const title = el("div", "", "member-title");
      title.append(el("span", "", "member-dot"), el("strong", m.name));
      row.append(title, el("small", m.role === "pilot" ? "Pilote" : m.role === "instruments" ? "Équipage" : "Spectateur"));
      if (m.slot !== room?.slot) {
        const actions = el("div", "", "member-actions");
        if (m.role === "pilot")
          actions.append(
            button("Suivre", () => {
              select(m.slot);
              showCrew(false);
            }),
          );
        const mute = button(radio.isMuted(m.slot) ? "Rétablir" : "Couper", () => {
          const muted = radio.mute(m.slot);
          mute.textContent = muted ? "Rétablir" : "Couper";
          mute.setAttribute("aria-pressed", String(muted));
        });
        mute.setAttribute("aria-pressed", String(radio.isMuted(m.slot)));
        mute.setAttribute("aria-label", `Couper le son de ${m.name}`);
        actions.append(mute);
        row.append(actions);
        const vol = document.createElement("input");
        vol.type = "range";
        vol.min = "0";
        vol.max = "100";
        vol.value = String(radio.volume(m.slot) * 100);
        vol.setAttribute("aria-label", `Volume de ${m.name}`);
        vol.addEventListener("input", () => radio.volume(m.slot, Number(vol.value) / 100));
        const label = el("label", "Volume", "volume-label");
        label.append(vol);
        row.append(label);
      }
      row.append(el("small", "", "member-distance"));
      members.append(row);
    }
    if (!room) members.append(el("p", "Rejoignez une salle pour voir son équipage.", "muted"));
  }
  const contacts = model.contacts();
  const count = (k: (c: (typeof contacts)[number]) => boolean) => String(contacts.filter(k).length);
  const summary: [string, string][] = [
    ["Joueurs", String(crafts.length)],
    ["Avions", count((c) => c.kind === "air")],
    ["Navires", count((c) => c.kind === "sea")],
  ];
  const sk = JSON.stringify(summary);
  if ($("traffic-summary").dataset.key !== sk) {
    $("traffic-summary").dataset.key = sk;
    $("traffic-summary").replaceChildren(
      ...summary.map(([k, v]) => {
        const d = el("div");
        d.append(el("strong", v), el("small", k));
        return d;
      }),
    );
  }
  for (const row of $("members").querySelectorAll<HTMLElement>(".member")) {
    const slot = Number(row.dataset.slot);
    row.classList.toggle("followed", slot === model.selected);
    row.classList.toggle("speaking", slot === room?.slot ? radio.gate.active : radio.speaking(slot));
    const craft = crafts.find((c) => c.member.slot === slot);
    const r = own && craft ? relative(own, craft) : null;
    row.querySelector(".member-distance")!.textContent = craft
      ? `${craft.kind.toUpperCase()}${r ? ` · ${valueText(r.distance / 1000)} km` : ""}${craft.age > 3 ? " · signal ancien" : ""}`
      : "";
  }
  $("network-details").textContent = room
    ? `Aller-retour ${Math.round(net.clock.rtt)} ms · Temps ×${valueText(net.roomWarp())} · ${net.mesh?.peers.size ?? 0} liens WebRTC`
    : "";
  syncRadio();
  const listBox = $("contact-list");
  if (listBox) {
    const sensor = views.sensor && views.view !== "dash";
    const g = own?.geo;
    const near = g
      ? [...contacts].sort((x, y) => Math.hypot(x.lat - g.lat, x.lon - g.lon) - Math.hypot(y.lat - g.lat, y.lon - g.lon)).slice(0, 24)
      : [];
    const items = sensor
      ? (own?.snapshot?.radar?.contacts ?? []).map((p) => ({ id: p.id, name: p.name, slot: -1 }))
      : [
          ...crafts.filter((c) => c !== own).map((c) => ({ id: "", name: `✈ ${c.member.name}`, slot: c.member.slot })),
          ...near.map((c) => ({ id: c.id, name: `${c.kind === "sea" ? "⛴" : c.kind === "ground" ? "◆" : "◇"} ${c.name}`, slot: -1 })),
        ];
    const signature = JSON.stringify([sensor, items]);
    if (listBox.dataset.signature !== signature) {
      listBox.dataset.signature = signature;
      listBox.replaceChildren();
      for (const item of items)
        listBox.append(
          button(item.name, () => {
            if (item.slot >= 0) select(item.slot);
            else views.onContact(item.id);
          }),
        );
      if (!items.length) listBox.append(el("p", sensor ? "Aucune piste reçue du pilote." : "Aucun joueur ni trafic reçu.", "muted"));
    }
  }
  const paint = JSON.stringify(crafts.map((c) => [c.member.slot, c.sample.seq, c.snapshot?.t, Math.floor(c.age)]));
  if (!document.hidden && painted !== paint) {
    painted = paint;
    views.request();
  }
}
const SIDES: Record<string, string> = {
  traffic: "trafic réel",
  hostile: "hostile",
  friend: "ami",
  neutral: "neutre",
  dead: "détruit",
  carrier: "porte-avions",
};
// ---- the context menu (PLAN-CREW-ACTIONS A2): a waypoint, the ground, a contact touched — what can be ordered there
const stage = document.querySelector<HTMLElement>(".stage")!;
let menuEl: HTMLElement | null = null;
function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  if (views.marker) {
    views.marker = null;
    views.request();
  }
}
/** a small menu where the finger touched, kept inside the view; the next touch elsewhere closes it */
function menu(x: number, y: number, title: string, sub: string, items: HTMLElement[]) {
  // (the crosshair just set for this menu kept: only the menu before goes)
  const keep = views.marker;
  closeMenu();
  views.marker = keep;
  const m = el("div", "", "ctx-menu");
  m.setAttribute("role", "menu");
  m.setAttribute("aria-label", title);
  const head = el("div", "", "ctx-head");
  head.append(el("strong", title), ...(sub ? [el("small", sub)] : []));
  const close = button("✕", closeMenu);
  close.className = "ctx-close";
  close.setAttribute("aria-label", "Fermer");
  head.append(close);
  m.append(head, ...items);
  stage.append(m);
  const w = m.offsetWidth,
    h = m.offsetHeight;
  m.style.left = `${Math.max(6, Math.min(stage.clientWidth - w - 6, x + 12))}px`;
  m.style.top = `${Math.max(6, Math.min(stage.clientHeight - h - 6, y - h / 2))}px`;
  menuEl = m;
  syncActs();
  m.querySelector<HTMLElement>("button:not(.ctx-close)")?.focus({ preventScroll: true });
}
$("instruments").addEventListener("pointerdown", closeMenu);
/** orders sent one after the other, stopped at the first refused — one button (its enabling: the first's family) */
function chainButton(text: string, steps: () => [Act, Args][], id?: string) {
  const b = button(
    text,
    async () => {
      const list = steps();
      b.setAttribute("aria-busy", "true");
      let r = { ok: true, msg: "" };
      for (const [act, args] of list) {
        r = await actions.send(act, args);
        if (!r.ok) break;
      }
      b.removeAttribute("aria-busy");
      b.classList.remove("ok", "ko");
      void b.offsetWidth;
      b.classList.add(r.ok ? "ok" : "ko");
      notice(r.ok ? `${text} ✓` : `${text} — ${r.msg || "refusé"}`);
      if (r.ok) closeMenu();
      refresh();
    },
    id,
  );
  b.dataset.act = "nav.add";
  return b;
}
/** a number entered in the units shown, sent in SI: [its field, the SI value read back (NaN: none)] */
function numberField(
  label: string,
  valueSI: number | undefined,
  toShown: (x: number) => number,
  unit: string,
): [HTMLElement, () => number] {
  const box = el("label", "", "ctx-field");
  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = "decimal";
  input.value = valueSI === undefined ? "" : String(Math.round(toShown(valueSI)));
  input.setAttribute("aria-label", label);
  box.append(el("span", label), input, el("em", unit));
  return [box, () => (input.value.trim() === "" ? Number.NaN : input.valueAsNumber / toShown(1))];
}
const where = (at: { lat: number; lon: number }) =>
  `${Math.abs(at.lat).toFixed(3)}° ${at.lat >= 0 ? "N" : "S"} · ${Math.abs(at.lon).toFixed(3)}° ${at.lon >= 0 ? "E" : "O"}`;
const fromCraft = (at: { lat: number; lon: number }) => {
  const g = model.own()?.geo;
  if (!g) return "";
  const q = wgs84Inverse(g.lat, g.lon, at.lat, at.lon);
  const u = unitsOf(views.units);
  return `à ${u.fDist(q.d)} · relèvement ${String(Math.round(((q.az * 180) / Math.PI + 360) % 360)).padStart(3, "0")}°`;
};

views.onWp = (i, x, y) => {
  const snap = snapNow();
  const wp = snap?.route[i];
  if (!wp) return;
  const u = unitsOf(views.units);
  const [altBox, altVal] = numberField("Altitude", wp.alt, u.alt, u.altName.toLowerCase());
  const [spdBox, spdVal] = numberField("Vitesse", wp.spd, u.spd, u.spdName.toLowerCase());
  const row = (box: HTMLElement, set: HTMLElement, clear: HTMLElement) => {
    const r = el("div", "", "ctx-row");
    r.append(box, set, clear);
    return r;
  };
  menu(x, y, `${i + 1}. ${wp.name}`, `${where(wp)} · ${fromCraft(wp)}`, [
    actButton("Direct", "nav.direct", { index: i }, "ctx-wp-direct", (ok) => ok && closeMenu()),
    row(
      altBox,
      actButton(
        "Fixer",
        "nav.point",
        () => (Number.isFinite(altVal()) ? { index: i, alt: Math.round(altVal()) } : { index: i }),
        "ctx-alt-set",
      ),
      actButton("Libre", "nav.point", { index: i, clearAlt: true }),
    ),
    row(
      spdBox,
      actButton("Fixer", "nav.point", () => (Number.isFinite(spdVal()) ? { index: i, spd: Math.round(spdVal()) } : { index: i })),
      actButton("Libre", "nav.point", { index: i, clearSpd: true }),
    ),
    actButton("Supprimer le point", "nav.remove", { index: i }, "ctx-wp-remove", (ok) => ok && closeMenu()),
    el(
      "p",
      views.view === "plan" ? "Sur la carte ou le ND : glisser un point le déplace." : "Glisser le point pour le déplacer.",
      "ctx-hint",
    ),
  ]);
};
views.onMoveWp = (i, at) =>
  void fire(null, "nav.move", { index: i, lat: Math.round(at.lat * 1e5) / 1e5, lon: Math.round(at.lon * 1e5) / 1e5 });
// a body touched on the system map (K6): taken for the target, a mission previewed to it
views.onBody = (id, x, y) => {
  const name = bodyName(id);
  menu(x, y, name, "Carte système", [
    actButton("Prendre pour cible", "sp.target", { name: id }, "ctx-body-target", (ok) => ok && closeMenu()),
    actButton(`Mission vers ${name} — aperçu`, "sp.mission", { target: id, arrival: "orbit", execute: false }, "ctx-body-mission"),
  ]);
};
// a burn dragged along the orbit (K6): its new time
views.onNodeMove = (i, dtS) => void fire(null, "sp.node", { action: "shift", index: i, dtS });
views.onGround = (at, x, y) => {
  const snap = snapNow();
  const own = model.own();
  const route = snap?.route ?? [];
  const active = snap?.nav?.active ?? route.length;
  const p = { lat: Math.round(at.lat * 1e5) / 1e5, lon: Math.round(at.lon * 1e5) / 1e5 };
  views.marker = [x, y];
  views.request();
  menu(x, y, "Point choisi", `${where(p)} · ${fromCraft(p)}`, [
    chainButton(
      "Direct ici",
      () =>
        route.length >= 2
          ? [
              ["nav.add", { ...p, index: active }],
              ["nav.direct", { index: active }],
            ]
          : [
              ...(route.length === 0 && own?.geo ? ([["nav.add", { lat: own.geo.lat, lon: own.geo.lon }]] as [Act, Args][]) : []),
              ["nav.add", p],
              ["nav.direct", { index: Math.max(1, route.length) }],
            ],
      "ctx-direct-here",
    ),
    actButton("Ajouter à la fin du plan", "nav.add", p, "ctx-append", (ok) => ok && closeMenu()),
    ...(route[active]
      ? [actButton(`Insérer avant ${route[active]!.name}`, "nav.add", { ...p, index: active }, undefined, (ok) => ok && closeMenu())]
      : []),
  ]);
};
views.onContact = (id, x = stage.clientWidth / 2, y = stage.clientHeight / 2) => {
  views.selectedContact = id;
  const u = unitsOf(views.units);
  const own = model.own();
  const c = own?.snapshot?.radar?.contacts.find((c) => c.id === id);
  const t = model.contacts().find((t) => t.id === id);
  const name = c?.name ?? t?.name ?? id;
  const info = c
    ? `${u.fDist(Math.hypot(c.e, c.n))} · Δh ${u.fAlt(c.dz)} · ${c.iff}`
    : t
      ? [t.type, SIDES[t.side] ?? t.side, t.alt !== null ? u.fAlt(t.alt) : "", t.spd !== null ? u.fSpd(t.spd) : "", fromCraft(t)]
          .filter(Boolean)
          .join(" · ")
      : "";
  const air = !!c || t?.kind === "air";
  menu(x, y, name, info, [
    actButton("Cibler", "nav.target", { name }, "ctx-target", (ok) => ok && closeMenu()),
    ...(air
      ? [
          actButton("Intercepter", "ap.traffic", { action: "intercept", name }, "ctx-intercept", (ok) => ok && closeMenu()),
          actButton("Rejoindre en formation", "ap.traffic", { action: "join", name }, "ctx-join", (ok) => ok && closeMenu()),
          actButton("Verrouiller", "wp.lock", { target: name }, "ctx-lock", (ok) => ok && closeMenu()),
        ]
      : []),
  ]);
  views.request();
};

document.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    radio.gate.cancel();
    showCrew(false);
    closeMenu();
  }
});
addEventListener("pagehide", () => {
  radio.stop();
  net.close();
});
setInterval(() => {
  if (!document.hidden) refresh();
}, 250);
Object.assign(window, { __crew: { net, model, views, radio, actions, join, setView } });
setUnits(views.units);
setProfile("jet");
setView("air");
refresh();
showLobby();
