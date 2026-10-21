import { runwaysEvents, setRunwaysBase } from "../world/runways";
import { NetClient } from "../net/client";
import { isCode, normCode } from "../net/proto";
import { serverUrl } from "../net/load";
import { store } from "../util/storage";
import { CrewModel, METRICS, relative, valueText } from "./model";
import { unitsOf } from "../ui/unitsys";
import { wgs84Inverse } from "../system/ellipsoid";
import { CrewRadio } from "./radio";
import { bindTalk } from "./ptt";
import { CrewViews, viewName, type CrewView } from "./views";
import { dur } from "./draw/kit";
import { bodyName } from "./draw/orbit";
import { eventName } from "./draw/spacestat";
import { linkFor, Outbox, type Station, type StationId, STATIONS, stationOf } from "./station";
import { checklistOf } from "./checklists";
import { craftTiles, craftViews, type CrewProfile, profileOf, type TileKey, viewIn } from "./profile";
import { CrewActions, type Done } from "./actions";
import { ACTS, type Act, AUTOS, autoWords, HOLDS, holdWords, MANEUVERS, maneuverWords } from "../net/crewcmd";
import type { Args } from "../ai/tool-schema";
import { applyStatic, L, lang, locale, Lp, onLang, setLang } from "./lang";

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
  id: { device: `crew:${device}`, name: store.get("kerr.crew.name") || L("Équipage", "Crew"), colour: "#89dce5" },
});
const model = new CrewModel(net);
/** the station chosen at the lobby (PLAN-VAISSEAUX K5): aboard, live; on the ground, the light's time late */
let station: Station = stationOf(store.get("kerr.crew.station"));
model.linkFor = (link, accepted) => linkFor(station, link, accepted);
/** the pilots asked to take this screen aboard, their answer (AUDIT-CREW priority 6: aboard on the pilot's agreement) */
const aboardAsked = new Map<number, "asked" | "yes" | "no">();
const outbox = new Outbox();
const views = new CrewViews($<HTMLCanvasElement>("instruments"), model);
const radio = new CrewRadio(net, () => syncRadio());
// (the CAPCOM's Quindar tones, on the radio — in the voice it sends: everyone hears them — AUDIT-CREW priority 6)
radio.quindar = () => station.id === "capcom";
// (a pilot behind the wormhole, this screen on the ground: his voice cut, as his text — never delayed)
radio.cut = (slot) => net.room?.members.find((m) => m.slot === slot)?.role === "pilot" && model.linkOf(slot).cut;
const actions = new CrewActions(net, model, () => unitsOf(views.units));
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
function stationsList() {
  const sel = $<HTMLSelectElement>("station");
  const keep = sel.value || station.id;
  sel.replaceChildren();
  for (const [place, title] of [
    ["aboard", L("À bord", "Aboard")],
    ["ground", L("Au sol — contrôle de mission", "On the ground — mission control")],
  ] as const) {
    const g = document.createElement("optgroup");
    g.label = title;
    for (const st of STATIONS.filter((x) => x.place === place)) {
      const o = document.createElement("option");
      o.value = st.id;
      o.textContent = st.place === "ground" ? `${st.call} — ${Lp(st.title)}` : Lp(st.title);
      o.selected = st.id === keep;
      g.append(o);
    }
    sel.append(g);
  }
  $("station-role").textContent = Lp(stationOf(sel.value).role);
}
$<HTMLSelectElement>("station").addEventListener("change", () => {
  $("station-role").textContent = Lp(stationOf($<HTMLSelectElement>("station").value).role);
});
stationsList();
code.value = normCode(initialParams.get("join") ?? "");
code.addEventListener("input", () => {
  code.value = normCode(code.value).slice(0, 6);
});

function syncRadio() {
  talk.disabled = !radio.gate.ready || !radio.gate.online;
  talk.setAttribute("aria-pressed", String(radio.gate.active));
  $("talk-label").textContent = radio.gate.active
    ? L("TRANSMISSION · vous parlez", "TRANSMITTING · you are talking")
    : toggle.checked
      ? L("Toucher pour parler", "Tap to talk")
      : L("Maintenir pour parler", "Hold to talk");
  $("microphone").textContent = radio.requesting
    ? L("Annuler le micro", "Cancel the mic")
    : radio.gate.ready
      ? L("Couper le micro", "Turn the mic off")
      : L("Activer le micro", "Turn the mic on");
  $("microphone").setAttribute("aria-pressed", String(radio.gate.ready));
  $("listen").setAttribute("aria-pressed", String(radio.listening));
  $("listen").textContent = radio.listening ? L("Écoute activée", "Listening") : L("Écouter", "Listen");
  $("radio-status").textContent =
    radio.error ||
    (!net.room
      ? L("Rejoignez une salle pour communiquer.", "Join a room to talk.")
      : !net.mesh
        ? L(
            "WebRTC indisponible : instruments accessibles, voix indisponible.",
            "WebRTC unavailable: instruments available, voice unavailable.",
          )
        : radio.gate.active
          ? L("Votre microphone est transmis à la salle.", "Your microphone is sent to the room.")
          : radio.gate.ready
            ? L("Micro prêt · émission uniquement sur votre commande.", "Mic ready · transmitting only on your command.")
            : L("Écoute seule · activez le micro pour transmettre.", "Listening only · turn the mic on to transmit."));
}
bindTalk(talk, radio.gate, () => toggle.checked);
toggle.addEventListener("change", () => {
  radio.gate.cancel();
  syncRadio();
});
$("listen").addEventListener("click", () => {
  if (net.room) void radio.listen();
  else notice(L("Rejoignez d’abord une salle.", "Join a room first."));
});
$("microphone").addEventListener("click", () => {
  if (radio.gate.ready || radio.requesting) radio.disableMic();
  else if (net.room) void radio.enableMic();
  else notice(L("Rejoignez d’abord une salle.", "Join a room first."));
});

async function join(roomCode: string, displayName: string, pass = "") {
  if (busy) return;
  const normal = normCode(roomCode);
  if (!isCode(normal)) {
    $("join-error").textContent = L("Saisissez les six caractères du code de la salle.", "Type the room code's six characters.");
    return;
  }
  busy = true;
  $<HTMLButtonElement>("join").disabled = true;
  $("join-error").textContent = L("Connexion…", "Connecting…");
  try {
    if (net.room) {
      radio.stop();
      net.leave();
    }
    // (the station: its call after the name, in the room — FIDO, CAPCOM…)
    station = stationOf($<HTMLSelectElement>("station").value);
    store.set("kerr.crew.station", station.id);
    const bare = displayName.trim().slice(0, 16) || L("Équipage", "Crew");
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
      password: L("Mot de passe incorrect.", "Wrong password."),
      "unknown-room": L("Cette salle n’existe plus.", "This room no longer exists."),
      full: L("La salle accueille déjà huit appareils.", "The room already has eight devices."),
      update: L("Rechargez cette page pour mettre le réseau à jour.", "Reload this page to update the network."),
    };
    const key = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    $("join-error").textContent =
      errors[key] ?? L("Connexion impossible. Vérifiez le réseau et réessayez.", "Cannot connect. Check the network and try again.");
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
// (the controls handed over — N3: the console follows the craft, flown now by the one who took them — RD1)
model.handedTo = (slot) => {
  const who = net.room?.members.find((m) => m.slot === slot)?.name ?? "?";
  notice(L(`Les commandes passent à ${who} : la console suit le vaisseau`, `The controls go to ${who}: the console follows the craft`));
  select(slot);
};
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
const NOTES: Record<CrewView, [string, string]> = {
  air: [
    "Radar et carte côte à côte · l’objectif, les armes, les alertes · toucher un panneau pour l’ouvrir",
    "Radar and map side by side · the objective, the weapons, the alerts · tap a panel to open it",
  ],
  sdash: [
    "L’orbite, l’attitude, l’ordinateur de vol · toucher un panneau pour l’ouvrir",
    "The orbit, the attitude, the flight computer · tap a panel to open it",
  ],
  orbit: [
    "L’orbite vue de dessus de son plan · périapside en haut · les poussées du plan en magenta",
    "The orbit seen from above its plane · periapsis up · the plan's burns in magenta",
  ],
  system: [
    "Glisser pour tourner · pincer pour zoomer · la prédiction à faire défiler",
    "Drag to turn · pinch to zoom · scroll the prediction",
  ],
  navball: [
    "L’attitude contre l’orbite · marqueurs prograde, normal, radial, nœud",
    "The attitude against the orbit · prograde, normal, radial, node markers",
  ],
  dock: [
    "Le couloir d’approche de côté, le réticule de face · limites de vitesse et d’alignement",
    "The approach corridor from the side, the sight head-on · speed and alignment limits",
  ],
  budget: ["Le Δv des ergols contre les poussées du plan · la marge", "The propellant's Δv against the plan's burns · the margin"],
  eecom: ["Énergie, oxygène, épurateurs · les pannes et leurs checklists", "Power, oxygen, scrubbers · the failures and their checklists"],
  timeline: ["Le temps de mission · les événements des heures à venir", "The mission time · the events of the hours ahead"],
  rel: ["Les deux horloges : dτ/dt, γ, le temps écoulé sur Terre", "The two clocks: dτ/dt, γ, the time gone by on Earth"],
  ground: [
    "Le corps survolé : la trace au sol, le point d’atterrissage, la nuit",
    "The body flown over: the ground track, the landing point, the night",
  ],
  descent: [
    "La hauteur, les vitesses, le stationnaire, le point d’atterrissage et sa portée",
    "The height, the speeds, the hover, the landing point and its reach",
  ],
  dash: ["Toucher un panneau pour l’ouvrir · pincer pour la portée", "Tap a panel to open it · pinch for the range"],
  pfd: [
    "Horizon, rubans vitesse et altitude, cap, modes du pilote automatique",
    "Horizon, speed and altitude tapes, heading, autopilot modes",
  ],
  nd: ["Pincer pour la portée · toucher un joueur ou un contact", "Pinch for the range · tap a player or a contact"],
  map: ["Glisser pour déplacer · pincer pour zoomer · toucher un joueur", "Drag to move · pinch to zoom · tap a player"],
  globe: ["Glisser pour tourner · pincer pour zoomer", "Drag to turn · pinch to zoom"],
  radar: ["Pincer pour la portée · toucher un contact", "Pinch for the range · tap a contact"],
  schematic: ["Glisser pour faire défiler les systèmes", "Drag to scroll the systems"],
  plan: ["Profil vertical et branches · glisser pour faire défiler", "Vertical profile and legs · drag to scroll"],
  telemetry: [
    "Glisser pour lire une mesure · historique reçu sur cet écran",
    "Drag to read a measure · the history received on this screen",
  ],
};
function rangeControl() {
  const range = document.createElement("input");
  range.type = "number";
  range.id = "range";
  range.min = "0.5";
  range.max = "20000";
  range.step = "1";
  range.value = String(Math.round((views.range / 1000) * 10) / 10);
  range.setAttribute("aria-label", L("Portée en kilomètres", "Range in kilometres"));
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
          ["body", L("Corps", "Body")],
          ["craft", L("Vaisseau", "Craft")],
          ["sun", L("Soleil", "Sun")],
        ],
        M.focus,
        L("Centre de la carte", "The map's centre"),
        (o) => {
          M.focus = o;
          M.cam.zoom = 1;
          views.request();
        },
      ),
      segmented(
        [
          ["true", L("Vraie", "True")],
          ["log", "Log"],
        ],
        M.cam.log ? "log" : "true",
        L("Échelle", "Scale"),
        (o) => {
          M.cam.log = o === "log";
          views.request();
        },
      ),
      button(
        L("Dessus", "Top"),
        () => {
          M.cam.pitch = 1.55;
          views.request();
        },
        "map-top",
      ),
      button(
        L("Profil", "Edge-on"),
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
    ahead.setAttribute("aria-label", L("Prédiction : temps à venir", "Prediction: time ahead"));
    ahead.addEventListener("input", () => {
      // (the slider's end: the longest path received, six hours at least — squared for a fine start)
      const span = Math.max(views.mapSpan, 6 * 3600);
      M.ahead = span * (Number(ahead.value) / 1000) ** 2;
      views.request();
    });
    bar.append(ahead);
  } else if (v === "map" || v === "globe") {
    bar.append(button(L("Centrer", "Centre"), () => views.reset(), "recenter"));
    const pan = document.createElement("details");
    pan.className = "pan-controls";
    pan.append(el("summary", L("Déplacer", "Move")));
    const directions = el("div");
    for (const [label, east, north] of [
      [L("← Ouest", "← West"), -1, 0],
      [L("↑ Nord", "↑ North"), 0, 1],
      [L("↓ Sud", "↓ South"), 0, -1],
      [L("Est →", "East →"), 1, 0],
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
            ["heading", L("Cap", "Heading")],
            ["north", L("Nord", "North")],
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
          ["players", L("Partagé", "Shared")],
          ["sensor", L("Capteur", "Sensor")],
        ],
        views.sensor ? "sensor" : "players",
        L("Source radar", "Radar source"),
        (o) => {
          views.sensor = o === "sensor";
          views.request();
        },
      ),
      button(L("Ajuster", "Fit"), () => {
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
    q.placeholder = L("OACI, terrain ou lieu", "ICAO, airfield or place");
    q.setAttribute("aria-label", L("Point à ajouter au plan", "Waypoint to add to the plan"));
    q.autocomplete = "off";
    const go = actButton(
      L("Ajouter", "Add"),
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
    cruise.append(el("summary", L("Croisière", "Cruise")));
    const nav = snapNow()?.nav;
    const [altBox, altVal] = numberField(L("Niveau", "Level"), nav?.cruiseAlt, u.alt, u.altName.toLowerCase());
    const [spdBox, spdVal] = numberField(L("Vitesse", "Speed"), nav?.cruiseSpd, u.spd, u.spdName.toLowerCase());
    const body = el("div", "", "cruise-box");
    body.append(
      altBox,
      spdBox,
      actButton(L("Appliquer", "Apply"), "nav.cruise", () => ({
        ...(Number.isFinite(altVal()) ? { alt: Math.round(altVal()) } : {}),
        ...(Number.isFinite(spdVal()) ? { spd: Math.round(spdVal()) } : {}),
      })),
    );
    cruise.append(body);
    // (cleared only on a second press within 3 s)
    const clear = button(
      L("Vider", "Clear"),
      () => {
        if (clear.dataset.armed) {
          delete clear.dataset.armed;
          clear.textContent = L("Vider", "Clear");
          void fire(clear, "nav.clear", {});
        } else {
          clear.dataset.armed = "1";
          clear.textContent = L("Confirmer ?", "Confirm?");
          setTimeout(() => {
            delete clear.dataset.armed;
            clear.textContent = L("Vider", "Clear");
          }, 3000);
        }
      },
      "plan-clear",
    );
    clear.dataset.act = "nav.clear";
    bar.append(add, cruise, actButton(L("Procédures", "Procedures"), "nav.procedures", {}, "plan-procedures"), clear);
  } else if (v === "schematic") {
    // the configuration (PLAN-CREW-ACTIONS A1): what a copilot sets — every switch lit as the pilot's craft is
    const sys = () => snapNow()?.sys;
    bar.append(
      actGroup(L("Train", "Gear"), [
        [L("Rentré", "Up"), "cfg.gear", { down: false }, () => sys()?.gearDown === false],
        [L("Sorti", "Down"), "cfg.gear", { down: true }, () => !!sys()?.gearDown],
      ]),
      actGroup(L("Volets", "Flaps"), [
        ["0", "cfg.flaps", { pos: 0 }, () => (sys()?.flaps ?? -1) === 0],
        ["½", "cfg.flaps", { pos: 0.5 }, () => sys()?.flaps === 0.5],
        [L("Pleins", "Full"), "cfg.flaps", { pos: 1 }, () => sys()?.flaps === 1],
      ]),
      actGroup(L("Aérofrein", "Air brake"), [
        [L("Rentré", "In"), "cfg.brake", { on: false }, () => (sys()?.brake ?? 1) === 0],
        [L("Sorti", "Out"), "cfg.brake", { on: true }, () => (sys()?.brake ?? 0) > 0],
      ]),
      actGroup("SAS", [
        ["Off", "cfg.sas", { on: false }, () => snapNow()?.auto?.sas === false],
        ["On", "cfg.sas", { on: true }, () => !!snapNow()?.auto?.sas],
      ]),
      actButton(L("Acquitter l’alarme", "Silence the alarm"), "cfg.ack", {}, "ack-systems"),
    );
  } else if (v === "telemetry") {
    bar.append(
      selectControl(
        [["multi", L("Vue d’ensemble", "Overview")], ...METRICS.map((m) => [m.key, m.name()] as [string, string])],
        views.channel,
        L("Mesure affichée", "Measure shown"),
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
        L("Fenêtre de temps", "Time window"),
        (w) => {
          views.window = Number(w);
          views.request();
        },
      ),
    );
    const pause = button(
      views.paused ? L("Reprendre", "Resume") : L("Figer", "Freeze"),
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
    cursor.setAttribute("aria-label", L("Instant de la courbe", "The curve's instant"));
    cursor.addEventListener("input", () => {
      views.inspect = Number(cursor.value) / 100;
      views.request();
    });
    views.onInspect = () => {
      cursor.value = String(views.inspect * 100);
    };
    bar.append(pause, cursor, button("CSV", download));
  }
  $("view-note").textContent = L(...NOTES[v]);
}
function setView(view: CrewView) {
  views.setView(view);
  $("view-title").textContent = viewName(view);
  $("instruments").setAttribute(
    "aria-label",
    L(
      `${viewName(view)} du pilote suivi ; contrôles disponibles au-dessus de la vue`,
      `The followed pilot's ${viewName(view)}; controls above the view`,
    ),
  );
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
    "descent",
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
  descent: '<path d="M12 3v11M8 10l4 4 4-4"/><path d="M4 20h16"/><path d="M8 17l-2 3M16 17l2 3"/>',
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
  const link = model.selected !== null ? model.linkOf(model.selected) : { delay: 0, cut: false };
  // (aboard on the pilot's agreement: waiting for it, or refused — then on the ground, its light's time)
  const asked = model.selected !== null ? aboardAsked.get(model.selected) : undefined;
  const accepted = model.selected === null || model.aboardWith(model.selected);
  const where =
    station.place === "aboard" && accepted
      ? L("à bord", "aboard")
      : station.place === "aboard" && asked !== "no"
        ? L("à bord · en attente du pilote", "aboard · waiting for the pilot")
        : link.cut
          ? L("sol · liaison coupée", "ground · link cut")
          : link.delay >= 0.5
            ? `${L("sol", "ground")} +${dur(link.delay)}`
            : L("sol", "ground");
  $("profile-badge").textContent =
    profile === "jet"
      ? `${c?.name ?? "F-35"} · ${L("TACTIQUE", "TACTICAL")}`.toUpperCase()
      : profile === "space"
        ? `${L("VAISSEAU", "SPACECRAFT")} · ${c?.name ?? ""} — ${station.call} · ${where}`.toUpperCase()
        : "";
  $("profile-badge").classList.toggle("cut", link.cut);
}
/** the console's profile now (PLAN-VAISSEAUX K2 — profile.ts): the craft followed's — its views, its tiles, its theme */
let profile: CrewProfile | null = null;
/** the craft followed (its own views and tiles — AUDIT-CREW priority 4: the Lander's descent, the Endurance's ring) */
let craftKey = "";
function setProfile(p: CrewProfile) {
  const craft = snapNow()?.craft;
  const key = `${craft?.id ?? ""}:${!!craft?.lands}:${!!craft?.ring}`;
  if (p === profile && key === craftKey) return;
  profile = p;
  craftKey = key;
  document.body.dataset.profile = p;
  syncBadge();
  $("views").replaceChildren();
  const list = craftViews(p, craft);
  for (const view of list) {
    const b = button("", () => setView(view));
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[view]}</svg><span>${viewName(view)}</span>`;
    b.dataset.view = view;
    $("views").append(b);
  }
  $("metrics").replaceChildren();
  // (the view kept when the other profile has it — the globe, the telemetry —, else the station's, the profile's first)
  const keep = list.includes(views.view) ? views.view : p === "space" && list.includes(station.view) ? station.view : viewIn(p, views.view);
  setView(list.includes(keep) ? keep : list[0]!);
  delete mcp.dataset.sig;
}
views.onOpen = setView;
$("zoom-in").addEventListener("click", () => views.zoomBy(1.333));
$("zoom-out").addEventListener("click", () => views.zoomBy(0.75));
const unitsButton = $("units-button");
function setUnits(sys: "metric" | "imperial") {
  views.units = sys;
  store.set("kerr.crew.units", sys);
  unitsButton.textContent = sys === "metric" ? L("MÉTRIQUE", "METRIC") : L("IMPÉRIAL", "IMPERIAL");
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
const TILES: Record<TileKey, { name: () => string; unit: (u: ReturnType<typeof unitsOf>) => string }> = {
  alt: { name: () => "Altitude", unit: (u) => u.altName.toLowerCase() },
  speed: { name: () => L("Vitesse", "Speed"), unit: (u) => u.spdName.toLowerCase() },
  vz: { name: () => L("Vario", "V/S"), unit: (u) => u.vsName.toLowerCase() },
  mach: { name: () => "Mach", unit: () => "" },
  g: { name: () => L("Charge", "Load"), unit: () => "g" },
  hdg: { name: () => L("Cap", "Heading"), unit: () => "°" },
  fuel: { name: () => L("Carburant", "Fuel"), unit: () => "%" },
  agl: { name: () => L("Hauteur sol", "Height AGL"), unit: (u) => u.altName.toLowerCase() },
  dv: { name: () => L("Δv restant", "Δv left"), unit: () => "m/s" },
  prop: { name: () => L("Ergols", "Propellant"), unit: () => "%" },
  pe: { name: () => L("Périapside", "Periapsis"), unit: () => "km" },
  ap: { name: () => L("Apoapside", "Apoapsis"), unit: () => "km" },
  period: { name: () => L("Période", "Period"), unit: () => "" },
  next: { name: () => L("Prochain", "Next"), unit: () => "" },
  dtau: { name: () => "dτ/dt", unit: () => "" },
  link: { name: () => L("Liaison", "Link"), unit: () => "" },
  hs: { name: () => L("Vitesse horiz.", "Horiz. speed"), unit: (u) => u.spdName.toLowerCase() },
  ring: { name: () => L("Anneau", "Ring"), unit: () => L("tr/min", "rpm") },
};
function tiles(own: ReturnType<typeof model.own>) {
  const box = $("metrics");
  const u = unitsOf(views.units);
  const keys = craftTiles(profile ?? "jet", snapNow()?.craft);
  if (!box.childElementCount)
    for (const k of keys) {
      const e = el("div", "", "metric");
      e.dataset.key = k;
      e.append(el("small", TILES[k].name()), el("strong", "—"), el("em", ""));
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
      : v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
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
        case "agl": {
          // (a spacecraft's descent block first — the flight's radio altimeter else)
          const h = snap?.desc?.agl ?? f?.agl;
          text = snap?.craft?.status === "landed" ? L("posé", "landed") : h != null && h < 30_000 ? fmt0(u.alt(h)) : "—";
          state = h != null && h < 150 && (m.vz ?? 0) < -3 ? "warn" : "";
          break;
        }
        case "hs":
          text = snap?.desc ? fmt0(u.spd(snap.desc.vh), snap.desc.vh < 10 ? 1 : 0) : "—";
          state = snap?.desc && snap.desc.vh > 2 && (snap.desc.agl ?? 1e9) < 50 ? "warn" : "";
          break;
        case "ring":
          text = snap?.ring ? fmt0(snap.ring.rpm, 1) : "—";
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
          if (snap?.craft?.status === "landed") {
            text = L("posé", "landed");
            unit = "";
            break;
          }
          text = fmt0(snap?.orbit?.pe, Math.abs(snap?.orbit?.pe ?? 0) < 100 ? 1 : 0);
          state = snap?.orbit && snap.orbit.pe < 0 ? "alarm" : "";
          break;
        case "ap":
          text = snap?.orbit
            ? snap.orbit.ecc >= 1
              ? L("libre", "escape")
              : fmt0(snap.orbit.ap, Math.abs(snap.orbit.ap) < 100 ? 1 : 0)
            : "—";
          if (snap?.orbit && snap.orbit.ecc >= 1) unit = "";
          break;
        case "period":
          text = dur(snap?.orbit?.period ?? null);
          break;
        case "next":
          // (short: the tile is narrow — 15 min, not 14 min 57)
          text = !snap?.next ? "—" : snap.next.in < 60 || snap.next.in >= 3600 ? dur(snap.next.in) : `${Math.round(snap.next.in / 60)} min`;
          unit = "";
          e.title = snap?.next ? `${eventName(snap.next)} ${L("dans", "in")} ${dur(snap.next.in)}` : "";
          state = snap?.next?.kind === "impact" ? "alarm" : "";
          break;
        case "dtau":
          text = fmt0(snap?.time?.dtau, 4);
          state = snap?.time && snap.time.dtau < 0.99 ? "warn" : "";
          break;
        case "link":
          text = snap?.link ? (snap.link.cut ? L("coupée", "cut") : dur(snap.link.light)) : "—";
          unit = snap?.link && !snap.link.cut ? L("lumière", "light") : "";
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
    ...list.map((w) => el("span", w, `alert${/PULL|FLY|STALL|G-LOC|MISSILE|OVER|IMPACT|FAIL|BREAKAWAY/.test(w) ? " warning" : ""}`)),
    ...(list.length ? [actButton(L("Acquitter", "Silence"), "cfg.ack", {}, "ack-alarm")] : []),
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
  notice(r.ok ? `${What} ✓` : `${What} — ${r.msg || L("refusé", "refused")}`);
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
      notice(L(`${text} : appuyer encore pour confirmer`, `${text}: press again to confirm`));
      setTimeout(() => b.classList.remove("armed"), 1500);
    }
  });
  b.title = L("Maintenir pour tirer", "Hold to fire");
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
      : `${a.live ? L("ARMES ACTIVES", "WEAPONS LIVE") : L("HORS COMBAT", "NO FIGHT")} · 120×${s.aim120 ?? 0} 9X×${s.aim9x ?? 0} JDAM×${s.jdam ?? 0} JSM×${s.jsm ?? 0}${a.lock ? ` · ${L("VERROU", "LOCK")} ${a.lock}` : ""}`;
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
  box.append(
    el("span", title, "knob-title"),
    hold(-1, "−", `${title} ${L("moins", "down")}`),
    value,
    hold(1, "+", `${title} ${L("plus", "up")}`),
  );
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
  const sig =
    kind === "space" ? `space:${station.id}:${snapNow()?.craft?.id ?? ""}:${!!snapNow()?.craft?.ring}:${!!snapNow()?.desc}` : kind;
  if ((mcp.dataset.sig ?? mcp.dataset.kind) === sig && mcp.childElementCount) return;
  // (its kind said plainly — "arms", "space", "jet" —, its signature beside it)
  if (kind === "arms") buildArms();
  else if (kind === "space") buildFc();
  else buildMcp();
  mcp.dataset.sig = sig;
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
    actGroup(L("Arme", "Weapon"), [
      ["AIM-120", "wp.select", { weapon: "aim120" }, () => arms()?.sel === "aim120"],
      ["AIM-9X", "wp.select", { weapon: "aim9x" }, () => arms()?.sel === "aim9x"],
      ["GBU-32", "wp.select", { weapon: "jdam" }, () => arms()?.sel === "jdam"],
      ["JSM", "wp.select", { weapon: "jsm" }, () => arms()?.sel === "jsm"],
    ]),
  );
  const shots = el("div", "", "mcp-sw arms-shots");
  shots.append(
    actButton(L("Verrouiller", "Lock"), "wp.lock", {}, "wp-lock"),
    holdButton(L("TIR", "FIRE"), "wp.fire", () => ({}), "wp-fire"),
    holdButton(L("Canon", "Gun"), "wp.gun", () => ({ seconds: 1 }), "wp-gun"),
    actButton(L("Leurres", "Decoys"), "wp.cm", {}, "wp-cm"),
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
  field.placeholder = L("OACI (vide : le plus proche)", "ICAO (empty: the nearest)");
  field.setAttribute("aria-label", L("Terrain de l'approche ILS", "The ILS approach's airfield"));
  appBox.append(
    field,
    actButton("ILS", "ap.ils", () => (field.value.trim() ? { field: field.value.trim().slice(0, 12) } : {}), "mcp-ils"),
    actButton(L("Annuler l'ILS", "Cancel the ILS"), "ap.ilsOff", {}, "mcp-ils-off"),
  );
  app.append(appBox);
  const modes = document.createElement("details");
  modes.className = "pan-controls mcp-pop";
  modes.append(el("summary", L("Modes", "Modes")));
  const modeBox = el("div");
  // (the terrain following's height: shown in the console's units, kept in metres — syncMcp follows a units switch)
  const agl = document.createElement("input");
  agl.type = "number";
  agl.className = "mcp-agl";
  agl.dataset.si = "150";
  agl.addEventListener("input", () => {
    const v = agl.valueAsNumber / unitsOf(views.units).alt(1);
    if (Number.isFinite(v)) agl.dataset.si = String(Math.max(0, Math.min(1000, v)));
  });
  const here = () => {
    const g = model.own()?.geo;
    return g ? { lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5 } : {};
  };
  modeBox.append(
    actButton(L("Orbite ici", "Orbit here"), "ap.mode", () => ({ mode: "orbit", ...here() }), "mcp-orbit"),
    actButton(
      L("Circuit d'attente", "Holding pattern"),
      "ap.mode",
      () => ({ mode: "hold", inboundDeg: Math.round(mcpNow().hdg) % 360 }),
      "mcp-hold",
    ),
    agl,
    actButton(
      L("Suivi de terrain", "Terrain following"),
      "ap.mode",
      () => ({ mode: "tf", aglM: Math.round(Number(agl.dataset.si) || 150) }),
      "mcp-tf",
    ),
    actButton(L("Arrêter l'interception", "Stop the intercept"), "ap.traffic", { action: "stop" }, "mcp-stop"),
    actButton(L("Couper le mode", "Mode off"), "ap.mode", { mode: "off" }, "mcp-mode-off"),
  );
  modes.append(modeBox);
  // the refuelling (jet_mode's tanker): TEXACO set and joined behind a hose, the way it is flown, let go
  const aar = () => snapNow()?.aar ?? null;
  const fuel = document.createElement("details");
  fuel.className = "pan-controls mcp-pop";
  fuel.append(el("summary", "AAR"));
  const fuelBox = el("div");
  const near = document.createElement("label");
  near.className = "mcp-check";
  const nearBox = document.createElement("input");
  nearBox.type = "checkbox";
  nearBox.id = "mcp-tanker-near";
  near.append(nearBox, L("à 1,5 km, à notre altitude", "1.5 km ahead, at our height"));
  const aarModes = actGroup(L("Conduite", "Flown"), [
    [L("Auto", "Auto"), "ap.mode", { mode: "refuelMode", refuelMode: "auto" }, () => aar()?.mode === "auto"],
    [L("Assisté", "Assisted"), "ap.mode", { mode: "refuelMode", refuelMode: "assisted" }, () => aar()?.mode === "assisted"],
    [L("Manuel", "Manual"), "ap.mode", { mode: "refuelMode", refuelMode: "manual" }, () => aar()?.mode === "manual"],
  ]);
  aarModes.id = "mcp-aar-mode";
  fuelBox.append(
    actButton(
      L("Ravitailleur · tuyau droit", "Tanker · right hose"),
      "ap.mode",
      () => ({ mode: "tanker", side: "right", ...(nearBox.checked ? { near: true } : {}) }),
      "mcp-tanker",
    ),
    actButton(
      L("Tuyau gauche", "Left hose"),
      "ap.mode",
      () => ({ mode: "tanker", side: "left", ...(nearBox.checked ? { near: true } : {}) }),
      "mcp-tanker-left",
    ),
    near,
    aarModes,
    actButton(L("Arrêter le ravitaillement", "Stop the refuelling"), "ap.mode", { mode: "tankerOff" }, "mcp-tanker-off"),
  );
  fuel.append(fuelBox);
  const go = actButton(L("Remise de gaz", "Go-around"), "ap.goAround", {}, "mcp-ga");
  go.classList.add("mcp-ga");
  // the switches on one row (a phone scrolls it), the three selectors on the other
  const sw = el("div", "", "mcp-sw");
  sw.append(
    toggle(
      "AP",
      "ap.engage",
      (w) => ({ ap: w }),
      // (the game's lamp; an older pilot's none: read off the selectors held)
      () => a()?.ap ?? (a()?.alt != null || a()?.hdg != null),
      "mcp-ap",
    ),
    toggle(
      "A/THR",
      "ap.engage",
      (w) => ({ athr: w }),
      () => a()?.athr ?? a()?.spd != null,
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
    fuel,
    go,
  );
  const kn = el("div", "", "mcp-knobs");
  kn.append(selector("spd", L("VIT", "SPD")), selector("hdg", L("CAP", "HDG")), selector("alt", "ALT"));
  mcp.append(sw, kn);
  syncMcp();
}
// ---- the flight computer (PLAN-CREW-ACTIONS A4): a spacecraft's holds, autopilots, manoeuvres and missions
/** a select of choices (their value, their words) */
function choices(items: readonly string[], words: (k: string) => string, label: string, value?: string) {
  const s = document.createElement("select");
  s.setAttribute("aria-label", label);
  for (const v of items) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = words(v);
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
  if (typeof d.burnsN === "number") rows.push([L("Combustions", "Burns"), String(d.burnsN)]);
  if (typeof d.burns1 === "string") rows.push([L("Première", "First"), d.burns1]);
  if (typeof d.executing === "boolean") rows.push([L("Exécution", "Executing"), d.executing ? L("en cours", "yes") : L("non", "no")]);
  card.replaceChildren(
    el("strong", r.ok ? L("Aperçu", "Preview") : L("Refusé", "Refused")),
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
  const hold = choices(
    HOLDS,
    (k) => (k === "none" ? L("Aucune", "None") : Lp(holdWords(k))),
    L("Tenue d'attitude", "Attitude hold"),
    "prograde",
  );
  // the autopilot (a site to land on or enter for, an orbit to take off to)
  // (a craft that never lands — the Endurance —: no landing, no take-off, no entry, no hover)
  const lands = snapNow()?.craft?.lands !== false;
  const autos = AUTOS.filter((k) => lands || !["land", "takeoff", "entry", "hover"].includes(k));
  const auto = choices(autos, (k) => (k === "none" ? L("Aucun", "None") : Lp(autoWords(k))), L("Autopilote", "Autopilot"), "circularize");
  const site = field(L("Site d'atterrissage ou de rentrée", "Landing or entry site"), L("site (atterrir, rentrée)", "site (land, entry)"));
  const upAlt = field(
    L("Altitude d'orbite au décollage (km)", "Orbit altitude for the take-off (km)"),
    L("orbite km", "orbit km"),
    "number",
  );
  // the manoeuvre and its card
  const op = choices(MANEUVERS, (k) => Lp(maneuverWords(k)), L("Manœuvre", "Manoeuvre"), "circularize");
  const when: Record<string, [string, string]> = {
    now: ["maintenant", "now"],
    pe: ["au périgée", "at periapsis"],
    ap: ["à l'apogée", "at apoapsis"],
  };
  const where = choices(["now", "pe", "ap"], (k) => L(...when[k]!), L("Quand", "When"));
  const mAlt = field(L("Altitude visée (km)", "Target altitude (km)"), L("altitude km", "altitude km"), "number");
  const mInc = field(L("Inclinaison visée (°)", "Target inclination (°)"), L("inclinaison °", "inclination °"), "number");
  const mCard = el("div", "", "fc-card");
  const maneuver = (execute: boolean): Args => ({
    op: op.value,
    where: where.value,
    ...(num(mAlt) !== undefined ? { altKm: num(mAlt) } : {}),
    ...(num(mInc) !== undefined ? { incDeg: num(mInc) } : {}),
    execute,
  });
  // the mission and its card
  const target = field(L("Destination de la mission", "The mission's destination"), L("Lune, Mars, ISS…", "Moon, Mars, ISS…"));
  const arr: Record<string, [string, string]> = {
    orbit: ["mise en orbite", "orbit insertion"],
    flyby: ["survol", "flyby"],
    freeReturn: ["retour libre", "free return"],
  };
  const arrival = choices(["orbit", "flyby", "freeReturn"], (k) => L(...arr[k]!), L("Arrivée", "Arrival"));
  const sCard = el("div", "", "fc-card");
  const mission = (execute: boolean): Args => ({ target: target.value.trim().slice(0, 32), arrival: arrival.value, execute });
  // the target (sp.target: a body, the station, a craft of the room by its name)
  const tgt = field(L("Cible", "Target"), L("Lune, Mars, ISS, Endurance…", "Moon, Mars, ISS, Endurance…"));
  // the systems (X3 · K6): each failure's checklist, its steps ticked here as on the pilot's tablet, its action once
  // all are — rebuilt as the pilot's figures change (syncSys)
  const sys = el("div", "", "fc-sys");
  sys.id = "fc-sys";
  // the fleet: the room's other pilots, three orders each (rebuilt as the roster changes — syncFleet)
  const fleetBox = el("div", "", "fc-fleet");
  fleetBox.id = "fc-fleet";
  const pops: Record<string, HTMLElement> = {
    hold: fcPop(L("Tenue", "Hold"), [hold, actButton(L("Tenir", "Hold"), "sp.hold", () => ({ direction: hold.value }), "fc-hold")]),
    auto: fcPop(L("Autopilote", "Autopilot"), [
      auto,
      site,
      upAlt,
      actButton(
        L("Engager", "Engage"),
        "sp.auto",
        () => ({
          mode: auto.value,
          ...(site.value.trim() ? { site: site.value.trim().slice(0, 40) } : {}),
          ...(num(upAlt) !== undefined ? { altKm: num(upAlt) } : {}),
        }),
        "fc-auto",
      ),
    ]),
    maneuver: fcPop(L("Manœuvre", "Manoeuvre"), [
      op,
      where,
      mAlt,
      mInc,
      actButton(
        L("Aperçu", "Preview"),
        "sp.maneuver",
        () => maneuver(false),
        "fc-preview",
        (_ok, r) => fcCard(mCard, r),
      ),
      actButton(
        L("Exécuter", "Execute"),
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
        L("Aperçu", "Preview"),
        "sp.mission",
        () => mission(false),
        "fc-mission-preview",
        (_ok, r) => fcCard(sCard, r),
      ),
      actButton(
        L("Lancer", "Launch"),
        "sp.mission",
        () => mission(true),
        "fc-mission",
        (_ok, r) => fcCard(sCard, r),
      ),
      sCard,
    ]),
    plan: fcPop("Plan", [
      actButton(L("Exécuter le plan", "Execute the plan"), "sp.plan", { action: "execute" }, "fc-plan-run"),
      actButton(L("Effacer le plan", "Clear the plan"), "sp.plan", { action: "clear" }, "fc-plan-clear"),
    ]),
    target: fcPop(L("Cible", "Target"), [
      tgt,
      actButton(L("Prendre pour cible", "Take as target"), "sp.target", () => ({ name: tgt.value.trim().slice(0, 32) }), "fc-target"),
    ]),
    dock: fcPop(L("Amarrage", "Docking"), [
      actButton(L("Maintien à poste", "Station keeping"), "sp.dock", { action: "keep" }, "fc-keep"),
      actButton(L("Désamarrer", "Undock"), "sp.dock", { action: "undock" }, "fc-undock"),
      actButton(L("Faire le plein", "Refuel"), "sp.dock", { action: "refuel" }, "fc-refuel"),
      actButton(L("Mode RCS", "RCS mode"), "sp.dock", { action: "rcs" }, "fc-rcs"),
    ]),
    systems: fcPop(L("Systèmes", "Systems"), [sys]),
    // (the room's fleet — N1: another pilot's spacecraft asked to come to ours, hold on it, dock to it)
    fleet: fcPop(L("Flotte", "Fleet"), [fleetBox]),
    ...(lands
      ? {
          // (the powered descent: the hover, the landing to a point, the point moved 100 m at a time — the LPD)
          descent: fcPop(L("Descente", "Descent"), [
            actButton(L("Stationnaire", "Hover"), "sp.auto", { mode: "hover" }, "fc-hover"),
            actButton(L("Atterrir ici", "Land here"), "sp.auto", { mode: "land" }, "fc-land"),
            el("span", L("Point d’atterrissage (LPD) :", "Landing point (LPD):"), "seg-title"),
            actButton(L("▲ 100 m devant", "▲ 100 m ahead"), "sp.lpd", { fwd: 100, right: 0 }, "fc-lpd-fwd"),
            actButton(L("▼ 100 m derrière", "▼ 100 m back"), "sp.lpd", { fwd: -100, right: 0 }, "fc-lpd-back"),
            actButton(L("◄ 100 m à gauche", "◄ 100 m left"), "sp.lpd", { fwd: 0, right: -100 }, "fc-lpd-left"),
            actButton(L("► 100 m à droite", "► 100 m right"), "sp.lpd", { fwd: 0, right: 100 }, "fc-lpd-right"),
          ]),
        }
      : {}),
    ...(snapNow()?.craft?.ring
      ? {
          ring: fcPop(L("Anneau", "Ring"), [
            actButton(L("Anneau −", "Ring −"), "sp.ring", { dir: -1 }, "fc-ring-down"),
            actButton(L("Anneau +", "Ring +"), "sp.ring", { dir: 1 }, "fc-ring-up"),
          ]),
        }
      : {}),
  };
  // (the station's own first — PLAN-VAISSEAUX K6: FIDO the trajectory's, GUIDO the attitude's, EECOM the systems')
  const order: Record<StationId, string[]> = {
    copilot: ["hold", "auto", "descent", "maneuver", "plan", "dock", "target", "mission", "systems", "ring", "fleet"],
    nav: ["maneuver", "mission", "plan", "target", "hold", "auto", "descent", "dock", "systems", "ring", "fleet"],
    engineer: ["systems", "ring", "dock", "hold", "auto", "descent", "maneuver", "plan", "target", "mission", "fleet"],
    flight: ["auto", "descent", "hold", "maneuver", "mission", "plan", "dock", "fleet", "systems", "target", "ring"],
    fido: ["maneuver", "mission", "plan", "target", "auto", "descent", "hold", "dock", "systems", "ring", "fleet"],
    guido: ["hold", "auto", "descent", "dock", "target", "fleet", "maneuver", "plan", "mission", "systems", "ring"],
    eecom: ["systems", "ring", "dock", "hold", "auto", "descent", "maneuver", "plan", "mission", "target", "fleet"],
    capcom: ["hold", "auto", "descent", "plan", "dock", "fleet", "systems", "maneuver", "mission", "target", "ring"],
  };
  // (a Lander low over a ground: its descent first, whatever the station)
  const desc = !!snapNow()?.desc && snapNow()?.craft?.id === "lander";
  const sw = el("div", "", "mcp-sw");
  const keys = (desc ? ["descent", ...order[station.id].filter((k) => k !== "descent")] : order[station.id]).filter((k) => pops[k]);
  keys.forEach((k, i) => {
    if (i === 0) pops[k]!.classList.add("featured");
    sw.append(pops[k]!);
  });
  sw.append(actButton(L("Relâcher", "Release"), "sp.release", {}, "fc-release"));
  mcp.append(sw);
  sysKey = fleetKey = "";
  syncSys();
  syncFleet();
  syncActs();
}

/** the Fleet pop's pilots (N1): every other pilot of the room, its craft, the three orders to it — said from ours */
let fleetKey = "";
function syncFleet() {
  const box = document.getElementById("fc-fleet");
  if (!box) return;
  const me = model.selected;
  const others = model.crafts().filter((c) => c.member.slot !== me);
  const key = JSON.stringify([lang(), others.map((c) => [c.member.slot, c.member.name, c.snapshot?.craft?.id])]);
  if (key === fleetKey) return;
  fleetKey = key;
  if (!others.length) {
    box.replaceChildren(el("p", L("Aucun autre pilote dans la salle.", "No other pilot in the room."), "muted small"));
    return;
  }
  const W: [string, string, string][] = [
    ["come", "Rejoins-moi", "Come to me"],
    ["hold", "Maintiens-toi sur moi", "Hold on me"],
    ["dock", "Amarre-toi à moi", "Dock to me"],
  ];
  box.replaceChildren(
    ...others.map((c) => {
      const card = el("div", "", "fc-card");
      card.append(el("strong", `${c.member.name}${c.snapshot?.craft ? ` · ${c.snapshot.craft.name}` : ""}`));
      for (const [o, fr, en] of W)
        card.append(
          actButton(
            L(fr, en),
            "sp.fleet",
            { order: o, slot: c.member.slot, name: c.member.name.slice(0, 16) },
            `fleet-${o}-${c.member.slot}`,
          ),
        );
      return card;
    }),
  );
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
    box.replaceChildren(el("p", L("Aucune panne — systèmes nominaux.", "No failure — systems nominal."), "muted small"));
    return;
  }
  box.replaceChildren(
    ...F.map((f) => {
      const cl = checklistOf(f.kind);
      const card = el("div", "", "fc-card");
      card.append(el("strong", cl?.title ?? f.kind));
      const ticks = new Set(f.ticks ?? []);
      (cl?.steps ?? []).forEach((st, i) => {
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
      const all = (cl?.steps ?? []).every((_, i) => ticks.has(i));
      const b = actButton(
        f.fixing ? L("En cours…", "Under way…") : (cl?.action ?? "Action"),
        "sys.fix",
        { kind: f.kind },
        `sys-fix-${f.kind}`,
      );
      if (!all || f.fixing)
        b.dataset.held = f.fixing
          ? L("Réparation en cours", "Repair under way")
          : L("La checklist d'abord : toutes les étapes cochées", "The checklist first: every step ticked");
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
  const agl = mcp.querySelector<HTMLInputElement>(".mcp-agl");
  if (agl && agl.dataset.sys !== u.sys && document.activeElement !== agl) {
    agl.dataset.sys = u.sys;
    agl.value = String(Math.round(u.alt(Number(agl.dataset.si) || 150)));
    agl.title = `${L("Hauteur du suivi de terrain", "Terrain following's height")} (${u.altName.toLowerCase()})`;
    agl.setAttribute("aria-label", agl.title);
  }
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
          ? Math.round(u.alt(v)).toLocaleString(locale())
          : String(Math.round(u.spd(v)));
    const selected = key === "alt" ? a?.alt != null : key === "hdg" ? a?.hdg != null : a?.spd != null;
    out.dataset.state = recent && pend[key] !== undefined ? "turning" : selected ? "selected" : "off";
  }
}

/** the board: the lock's state and the journal of the orders the pilot followed answered */
function board() {
  const own = model.own();
  const caps = own?.snapshot?.caps;
  const state = !net.room || !own ? "" : !caps ? "read" : caps.on ? "actions" : "locked";
  const s = $("act-state");
  s.textContent =
    state === "actions" ? "ACTIONS ✓" : state === "locked" ? L("VERROUILLÉ", "LOCKED") : state ? L("LECTURE", "READ ONLY") : "";
  s.dataset.state = state;
  $("crew-lock").textContent = !own
    ? L("Aucun pilote suivi.", "No pilot followed.")
    : !caps
      ? L("Ce simulateur ne reçoit pas d'ordres : instruments en lecture seule.", "This simulator takes no orders: instruments read only.")
      : caps.on
        ? L(
            `Vous pouvez agir à bord de ${own.member.name} — tout sauf piloter.`,
            `You can act aboard ${own.member.name}'s craft — anything but fly.`,
          )
        : L(`${own.member.name} a verrouillé les actions de l'équipage.`, `${own.member.name} has locked the crew's actions.`);
  const list = $("board");
  const key = JSON.stringify(actions.board.slice(0, 12).map((l) => [l.at, l.ok]));
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.replaceChildren(
      ...actions.board.slice(0, 12).map((l) => {
        const li = el("li", "", l.ok ? "ok" : "ko");
        const time = new Date(l.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        li.append(el("time", time), el("strong", l.who), el("span", l.what), ...(l.ok ? [] : [el("em", l.msg || L("refusé", "refused"))]));
        return li;
      }),
    );
    if (!actions.board.length) list.append(el("li", L("Aucun ordre pour l'instant.", "No order yet."), "empty"));
  }
  syncActs();
}

/** a station aboard: the pilot followed asked once for his agreement (a pilot who asks for it — caps.hold) */
function askAboard() {
  const to = model.selected;
  // (a spacecraft's alone — an aircraft has no light's time to the ground: nothing to agree to)
  if (station.place !== "aboard" || to === null || !net.room || !model.holds(to) || model.aboardWith(to) || aboardAsked.has(to)) return;
  if (model.crafts().find((c) => c.member.slot === to)?.snapshot?.craft?.kind !== "spacecraft") return;
  aboardAsked.set(to, "asked");
  net.event({ kind: "crew-aboard", v: 1, to, station: `${station.call} · ${Lp(station.title)}` });
  notice(L("Demande au pilote : à bord", "Asked the pilot: aboard"));
}
net.on("event", ({ from, ev }) => {
  if (ev.kind !== "crew-aboard-ok" || (ev as { to?: unknown }).to !== net.room?.slot) return;
  const ok = (ev as { ok?: unknown }).ok === true;
  aboardAsked.set(from, ok ? "yes" : "no");
  notice(
    ok
      ? L("Le pilote vous prend à bord : en direct", "The pilot takes you aboard: live")
      : L("Le pilote refuse : vous restez au sol", "The pilot refuses: you stay on the ground"),
  );
  syncBadge();
});
net.on("room", () => aboardAsked.clear());

/** the message to the pilot (K5): live aboard; the light's time late from the ground; behind the wormhole recorded,
 *  delivered (its age with it) when the link comes back */
function sendMessage(text: string) {
  const to = model.selected;
  if (!net.room || to === null) return notice(L("Aucun pilote suivi.", "No pilot followed."));
  const link = model.linkOf(to);
  if (link.cut) {
    outbox.record(text, Date.now());
    notice(L("Message enregistré : il partira au retour de la liaison.", "Message recorded: it will go when the link comes back."));
  } else {
    const go = () => net.event({ kind: "crew-msg", v: 1, to, text, rec: 0 });
    // (a pilot who holds the ground's messages himself: sent at once — an older one: delayed here)
    if (link.delay > 0 && !model.holds(to)) setTimeout(go, link.delay * 1000);
    else go();
    notice(
      link.delay > 0
        ? L(`Message envoyé : il arrive dans ${dur(link.delay)}.`, `Message sent: it arrives in ${dur(link.delay)}.`)
        : L("Message envoyé.", "Message sent."),
    );
  }
  syncMessages();
}
function syncMessages() {
  const to = model.selected;
  const link = to !== null ? model.linkOf(to) : { delay: 0, cut: false };
  // (the link back: the recorded ones sent, each its age)
  if (!link.cut && outbox.waiting.length && net.room && to !== null)
    for (const m of outbox.flush()) net.event({ kind: "crew-msg", v: 1, to, text: m.text, rec: Math.round((Date.now() - m.at) / 1000) });
  $("msg-state").textContent = link.cut
    ? L(
        `Liaison coupée (trou de ver) · ${outbox.waiting.length} message(s) enregistré(s)`,
        `Link cut (wormhole) · ${outbox.waiting.length} message(s) recorded`,
      )
    : station.place === "ground" && link.delay > 0
      ? L(
          `Délai lumière ${dur(link.delay)} aller · ${dur(2 * link.delay)} aller-retour`,
          `Light delay ${dur(link.delay)} one way · ${dur(2 * link.delay)} round trip`,
        )
      : station.place === "ground"
        ? L("Liaison directe", "Direct link")
        : L("À bord : en direct", "Aboard: live");
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
    net.status === "offline"
      ? L("Reconnexion…", "Reconnecting…")
      : room
        ? `${room.code} · ${room.members.length}/8`
        : L("Hors connexion", "Offline");
  $("status-dot").className = room && net.status === "online" ? "online" : "";
  $("room-button").textContent = room ? L("Salle", "Room") : L("Rejoindre", "Join");
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
      o.textContent = L("En attente d’un pilote", "Waiting for a pilot");
      pilot.append(o);
    }
  }
  setProfile(profileOf(own?.snapshot));
  askAboard();
  syncBadge();
  syncMessages();
  tiles(own);
  alerts(own);
  board();
  syncMcpKind();
  syncMcp();
  syncSys();
  syncFleet();
  const followed = room?.members.find((m) => m.slot === model.selected);
  $("pilot-dot").style.background = followed?.colour ?? "#4d606b";
  $("freshness").textContent =
    net.status === "offline"
      ? L("Connexion interrompue", "Connection lost")
      : !own
        ? L("En attente de données", "Waiting for data")
        : model.selected !== null && model.linkOf(model.selected).cut
          ? L("Liaison coupée — derrière le trou de ver : son dernier mot", "Link cut — behind the wormhole: its last word")
          : own.age > 3
            ? L(`Position ancienne · ${Math.round(own.age)} s`, `Old position · ${Math.round(own.age)} s`)
            : own.snapshot
              ? model.selected !== null && model.linkOf(model.selected).delay > 0
                ? L(
                    `Mesures du pilote · différées de ${dur(model.linkOf(model.selected).delay)} (lumière)`,
                    `The pilot's measures · ${dur(model.linkOf(model.selected).delay)} late (light)`,
                  )
                : L("Mesures du pilote · direct", "The pilot's measures · live")
              : L("Position reçue · mesures détaillées indisponibles", "Position received · detailed measures unavailable");
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
      row.append(
        title,
        el(
          "small",
          m.role === "pilot" ? L("Pilote", "Pilot") : m.role === "instruments" ? L("Équipage", "Crew") : L("Spectateur", "Spectator"),
        ),
      );
      if (m.slot !== room?.slot) {
        const actions = el("div", "", "member-actions");
        if (m.role === "pilot")
          actions.append(
            button(L("Suivre", "Follow"), () => {
              select(m.slot);
              showCrew(false);
            }),
          );
        const mute = button(radio.isMuted(m.slot) ? L("Rétablir", "Unmute") : L("Couper", "Mute"), () => {
          const muted = radio.mute(m.slot);
          mute.textContent = muted ? L("Rétablir", "Unmute") : L("Couper", "Mute");
          mute.setAttribute("aria-pressed", String(muted));
        });
        mute.setAttribute("aria-pressed", String(radio.isMuted(m.slot)));
        mute.setAttribute("aria-label", L(`Couper le son de ${m.name}`, `Mute ${m.name}`));
        actions.append(mute);
        row.append(actions);
        const vol = document.createElement("input");
        vol.type = "range";
        vol.min = "0";
        vol.max = "100";
        vol.value = String(radio.volume(m.slot) * 100);
        vol.setAttribute("aria-label", L(`Volume de ${m.name}`, `${m.name}'s volume`));
        vol.addEventListener("input", () => radio.volume(m.slot, Number(vol.value) / 100));
        const label = el("label", "Volume", "volume-label");
        label.append(vol);
        row.append(label);
      }
      row.append(el("small", "", "member-distance"));
      members.append(row);
    }
    if (!room) members.append(el("p", L("Rejoignez une salle pour voir son équipage.", "Join a room to see its crew."), "muted"));
  }
  const contacts = model.contacts();
  const count = (k: (c: (typeof contacts)[number]) => boolean) => String(contacts.filter(k).length);
  const summary: [string, string][] = [
    [L("Joueurs", "Players"), String(crafts.length)],
    [L("Avions", "Aircraft"), count((c) => c.kind === "air")],
    [L("Navires", "Ships"), count((c) => c.kind === "sea")],
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
      ? `${craft.kind.toUpperCase()}${r ? ` · ${valueText(r.distance / 1000)} km` : ""}${craft.age > 3 ? ` · ${L("signal ancien", "old signal")}` : ""}`
      : "";
  }
  $("network-details").textContent = room
    ? L(
        `Aller-retour ${Math.round(net.clock.rtt)} ms · Temps ×${valueText(net.roomWarp())} · ${net.mesh?.peers.size ?? 0} liens WebRTC`,
        `Round trip ${Math.round(net.clock.rtt)} ms · Time ×${valueText(net.roomWarp())} · ${net.mesh?.peers.size ?? 0} WebRTC links`,
      )
    : "";
  syncRadio();
  radio.sync();
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
          ...near.map((c) => ({
            id: c.id,
            name: `${c.kind === "sea" ? "⛴" : c.kind === "ground" ? "◆" : c.kind === "missile" ? "➶" : c.kind === "decoy" ? "✶" : "◇"} ${c.name}`,
            slot: -1,
          })),
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
      if (!items.length)
        listBox.append(
          el(
            "p",
            sensor
              ? L("Aucune piste reçue du pilote.", "No track received from the pilot.")
              : L("Aucun joueur ni trafic reçu.", "No player nor traffic received."),
            "muted",
          ),
        );
    }
  }
  const paint = JSON.stringify(crafts.map((c) => [c.member.slot, c.sample.seq, c.snapshot?.t, Math.floor(c.age)]));
  if (!document.hidden && painted !== paint) {
    painted = paint;
    views.request();
  }
}
const SIDES: Record<string, [string, string]> = {
  traffic: ["trafic réel", "real traffic"],
  hostile: ["hostile", "hostile"],
  friend: ["ami", "friend"],
  neutral: ["neutre", "neutral"],
  dead: ["détruit", "destroyed"],
  carrier: ["porte-avions", "carrier"],
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
  close.setAttribute("aria-label", L("Fermer", "Close"));
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
      notice(r.ok ? `${text} ✓` : `${text} — ${r.msg || L("refusé", "refused")}`);
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
  `${Math.abs(at.lat).toFixed(3)}° ${at.lat >= 0 ? "N" : "S"} · ${Math.abs(at.lon).toFixed(3)}° ${at.lon >= 0 ? "E" : L("O", "W")}`;
const fromCraft = (at: { lat: number; lon: number }) => {
  const g = model.own()?.geo;
  if (!g) return "";
  const q = wgs84Inverse(g.lat, g.lon, at.lat, at.lon);
  const u = unitsOf(views.units);
  return `${L("à", "at")} ${u.fDist(q.d)} · ${L("relèvement", "bearing")} ${String(Math.round(((q.az * 180) / Math.PI + 360) % 360)).padStart(3, "0")}°`;
};

views.onWp = (i, x, y) => {
  const snap = snapNow();
  const wp = snap?.route[i];
  if (!wp) return;
  const u = unitsOf(views.units);
  const [altBox, altVal] = numberField("Altitude", wp.alt, u.alt, u.altName.toLowerCase());
  const [spdBox, spdVal] = numberField(L("Vitesse", "Speed"), wp.spd, u.spd, u.spdName.toLowerCase());
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
        L("Fixer", "Set"),
        "nav.point",
        () => (Number.isFinite(altVal()) ? { index: i, alt: Math.round(altVal()) } : { index: i }),
        "ctx-alt-set",
      ),
      actButton(L("Libre", "Free"), "nav.point", { index: i, clearAlt: true }),
    ),
    row(
      spdBox,
      actButton(L("Fixer", "Set"), "nav.point", () => (Number.isFinite(spdVal()) ? { index: i, spd: Math.round(spdVal()) } : { index: i })),
      actButton(L("Libre", "Free"), "nav.point", { index: i, clearSpd: true }),
    ),
    actButton(L("Supprimer le point", "Remove the waypoint"), "nav.remove", { index: i }, "ctx-wp-remove", (ok) => ok && closeMenu()),
    el(
      "p",
      views.view === "plan"
        ? L("Sur la carte ou le ND : glisser un point le déplace.", "On the map or the ND: drag a waypoint to move it.")
        : L("Glisser le point pour le déplacer.", "Drag the waypoint to move it."),
      "ctx-hint",
    ),
  ]);
};
views.onMoveWp = (i, at) =>
  void fire(null, "nav.move", { index: i, lat: Math.round(at.lat * 1e5) / 1e5, lon: Math.round(at.lon * 1e5) / 1e5 });
// a body touched on the system map (K6): taken for the target, a mission previewed to it
views.onBody = (id, x, y) => {
  const name = bodyName(id);
  menu(x, y, name, L("Carte système", "System map"), [
    actButton(L("Prendre pour cible", "Take as target"), "sp.target", { name: id }, "ctx-body-target", (ok) => ok && closeMenu()),
    actButton(
      L(`Mission vers ${name} — aperçu`, `Mission to ${name} — preview`),
      "sp.mission",
      { target: id, arrival: "orbit", execute: false },
      "ctx-body-mission",
    ),
  ]);
};
// a burn dragged along the orbit (K6): its new time
views.onNodeMove = (i, dtS) => void fire(null, "sp.node", { action: "shift", index: i, dtS });
views.onGround = (at, x, y) => {
  const snap = snapNow();
  // (the Ground view of a spacecraft: the landing point designated where the finger touched — the LPD)
  if (views.view === "ground") {
    const q = { lat: Math.round(at.lat * 1e5) / 1e5, lon: Math.round(at.lon * 1e5) / 1e5 };
    views.marker = [x, y];
    views.request();
    menu(x, y, L("Point choisi", "Point chosen"), `${q.lat.toFixed(4)}° ${q.lon.toFixed(4)}°`, [
      actButton(
        L("Désigner pour l’atterrissage (LPD)", "Designate for the landing (LPD)"),
        "sp.lpd",
        q,
        "ctx-lpd",
        (ok) => ok && closeMenu(),
      ),
    ]);
    return;
  }
  const own = model.own();
  const route = snap?.route ?? [];
  const active = snap?.nav?.active ?? route.length;
  const p = { lat: Math.round(at.lat * 1e5) / 1e5, lon: Math.round(at.lon * 1e5) / 1e5 };
  views.marker = [x, y];
  views.request();
  menu(x, y, L("Point choisi", "Point chosen"), `${where(p)} · ${fromCraft(p)}`, [
    chainButton(
      L("Direct ici", "Direct here"),
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
    actButton(L("Ajouter à la fin du plan", "Add at the plan's end"), "nav.add", p, "ctx-append", (ok) => ok && closeMenu()),
    ...(route[active]
      ? [
          actButton(
            L(`Insérer avant ${route[active]!.name}`, `Insert before ${route[active]!.name}`),
            "nav.add",
            { ...p, index: active },
            undefined,
            (ok) => ok && closeMenu(),
          ),
        ]
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
      ? [
          t.type,
          SIDES[t.side] ? L(...SIDES[t.side]!) : t.side,
          t.alt !== null ? u.fAlt(t.alt) : "",
          t.spd !== null ? u.fSpd(t.spd) : "",
          fromCraft(t),
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const air = !!c || t?.kind === "air";
  menu(x, y, name, info, [
    // (designated to the pilot: selected on all his screens — PLAN-RADAR-AAA RD9)
    actButton(L("Désigner au pilote", "Designate to the pilot"), "wp.designate", { id }, "ctx-designate", (ok) => ok && closeMenu()),
    actButton(L("Cibler", "Target"), "nav.target", { name }, "ctx-target", (ok) => ok && closeMenu()),
    ...(air
      ? [
          actButton(L("Intercepter", "Intercept"), "ap.traffic", { action: "intercept", name }, "ctx-intercept", (ok) => ok && closeMenu()),
          actButton(
            L("Rejoindre en formation", "Join in formation"),
            "ap.traffic",
            { action: "join", name },
            "ctx-join",
            (ok) => ok && closeMenu(),
          ),
          actButton(L("Verrouiller", "Lock"), "wp.lock", { target: name }, "ctx-lock", (ok) => ok && closeMenu()),
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
// ---- the console's language (docs/CREW.md): chosen in its header or its lobby, the browser's by default; every text
// redrawn at once — the page's own, the views' names, the tiles, the panels, the MCP, the journal
const langButton = $("lang-button"),
  langPick = $<HTMLSelectElement>("lang-pick");
function relabel() {
  applyStatic();
  langButton.textContent = lang() === "fr" ? "EN" : "FR";
  langButton.title = L("Passer la console en anglais", "Switch the console to French");
  langPick.value = lang();
  stationsList();
  // (built once with their words: built again)
  const p = profile;
  profile = null;
  setProfile(p ?? "jet");
  $("metrics").replaceChildren();
  mcp.replaceChildren();
  delete mcp.dataset.sig;
  delete $("board").dataset.key;
  delete $("traffic-summary").dataset.key;
  const list = document.getElementById("contact-list");
  if (list) delete list.dataset.signature;
  rosterKey = pilotKey = alertKey = sysKey = fleetKey = "";
  closeMenu();
  setUnits(views.units);
  controls();
  syncRadio();
  views.request();
}
onLang(relabel);
langButton.addEventListener("click", () => setLang(lang() === "fr" ? "en" : "fr"));
langPick.addEventListener("change", () => setLang(langPick.value === "en" ? "en" : "fr"));
applyStatic();
langButton.textContent = lang() === "fr" ? "EN" : "FR";
langPick.value = lang();
// (the world's runways — PLAN-RADAR-AAA RD11 —: from the simulator's site, one level up; a tile in, the views redrawn)
setRunwaysBase(new URL("../runways/v1/", location.href).href);
runwaysEvents.onLoad = () => views.request();
Object.assign(window, { __crew: { net, model, views, radio, actions, join, setView, lang, setLang } });
setUnits(views.units);
setProfile("jet");
setView("air");
refresh();
showLobby();
