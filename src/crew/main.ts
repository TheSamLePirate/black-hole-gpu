import { NetClient } from "../net/client";
import { isCode, normCode } from "../net/proto";
import { serverUrl } from "../net/load";
import { store } from "../util/storage";
import { CrewModel, METRICS, relative, valueText } from "./model";
import { unitsOf } from "../ui/unitsys";
import { CrewRadio } from "./radio";
import { bindTalk } from "./ptt";
import { CrewViews, VIEW_NAMES, type CrewView } from "./views";

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
const lobby = $<HTMLDialogElement>("lobby"),
  tars = $<HTMLDialogElement>("tars");
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
const views = new CrewViews($<HTMLCanvasElement>("instruments"), model);
const radio = new CrewRadio(net, () => syncRadio());
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
name.value = net.o.id.name;
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
    net.profile(displayName.trim().slice(0, 24) || "Équipage", "#89dce5");
    await net.join(normal, "instruments", pass || undefined);
    store.set("kerr.crew.name", net.o.id.name);
    const params = new URLSearchParams({ join: normal });
    if (initialParams.has("server")) params.set("server", initialParams.get("server")!);
    history.replaceState(null, "", `#${params}`);
    lobby.close();
    rosterKey = "";
    pilotKey = "";
    refresh();
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
  if (v === "map" || v === "globe") {
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
  document.querySelector<HTMLElement>(".zoom")!.hidden = view === "pfd";
  $("views").querySelector<HTMLElement>(`[data-view=${view}]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  controls();
  showCrew(false);
}
const ICONS: Record<CrewView, string> = {
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
for (const view of Object.keys(VIEW_NAMES) as CrewView[]) {
  const b = button("", () => setView(view));
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[view]}</svg><span>${VIEW_NAMES[view]}</span>`;
  b.dataset.view = view;
  $("views").append(b);
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

/** the strip's tiles: the measures a glance needs, their state (amber, red) and trend */
const TILES: { key: string; name: string; unit: (u: ReturnType<typeof unitsOf>) => string }[] = [
  { key: "alt", name: "Altitude", unit: (u) => u.altName.toLowerCase() },
  { key: "speed", name: "Vitesse", unit: (u) => u.spdName.toLowerCase() },
  { key: "vz", name: "Vario", unit: (u) => u.vsName.toLowerCase() },
  { key: "mach", name: "Mach", unit: () => "" },
  { key: "g", name: "Charge", unit: () => "g" },
  { key: "hdg", name: "Cap", unit: () => "°" },
  { key: "fuel", name: "Carburant", unit: () => "%" },
  { key: "agl", name: "Hauteur sol", unit: (u) => u.altName.toLowerCase() },
];
function tiles(own: ReturnType<typeof model.own>) {
  const box = $("metrics");
  const u = unitsOf(views.units);
  if (!box.childElementCount)
    for (const t of TILES) {
      const e = el("div", "", "metric");
      e.dataset.key = t.key;
      e.append(el("small", t.name), el("strong", "—"), el("em", ""));
      box.append(e);
    }
  const live = !!own && own.age < 3;
  const m = own?.metrics ?? {},
    f = own?.snapshot?.flight,
    sys = own?.snapshot?.sys;
  const fmt0 = (v: number | undefined, d = 0) =>
    v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  for (const t of TILES) {
    const e = box.querySelector<HTMLElement>(`[data-key=${t.key}]`)!;
    let text = "—",
      state = "",
      unit = t.unit(u);
    if (live) {
      switch (t.key) {
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
  );
}

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
  tiles(own);
  alerts(own);
  const followed = room?.members.find((m) => m.slot === model.selected);
  $("pilot-dot").style.background = followed?.colour ?? "#4d606b";
  $("freshness").textContent =
    net.status === "offline"
      ? "Connexion interrompue"
      : !own
        ? "En attente de données"
        : own.age > 3
          ? `Position ancienne · ${Math.round(own.age)} s`
          : own.snapshot
            ? "Mesures du pilote · direct"
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
views.onContact = (id) => {
  views.selectedContact = id;
  const u = unitsOf(views.units);
  const own = model.own();
  const c = own?.snapshot?.radar?.contacts.find((c) => c.id === id);
  const t = model.contacts().find((t) => t.id === id);
  if (c) notice(`${c.name} · ${u.fDist(Math.hypot(c.e, c.n))} · Δh ${u.fAlt(c.dz)} · ${c.iff}`);
  else if (t) {
    const parts = [t.name, t.type, SIDES[t.side] ?? t.side];
    if (t.alt !== null) parts.push(u.fAlt(t.alt));
    if (t.spd !== null) parts.push(u.fSpd(t.spd));
    notice(parts.filter(Boolean).join(" · "));
  }
  views.request();
};

/** TARS uses the same local actions as touch controls and only the received measurements. */
async function askTars(input: string): Promise<string> {
  const q = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const options: [RegExp, CrewView][] = [
    [/tableau|dashboard|ensemble des instruments/, "dash"],
    [/plan de vol|\bplan\b|profil|route/, "plan"],
    [/\bpfd\b|horizon|\bvol\b|attitude/, "pfd"],
    [/navigation|\bnd\b/, "nd"],
    [/carte|\bmap\b/, "map"],
    [/globe/, "globe"],
    [/radar/, "radar"],
    [/schema|schematic|systeme|moteur/, "schematic"],
    [/telemetr|courbe/, "telemetry"],
  ];
  for (const [pattern, view] of options)
    if (pattern.test(q)) {
      setView(view);
      if (/courbes\b|ensemble/.test(q) && view === "telemetry") {
        views.channel = "multi";
        controls();
        return "Vue d’ensemble des courbes.";
      }
      if (!q.includes("courbe")) return `Vue ${VIEW_NAMES[view]} affichée.`;
    }
  if (/imperial|pieds|noeuds/.test(q)) {
    setUnits("imperial");
    return "Unités impériales : pieds, nœuds, milles nautiques.";
  }
  if (/metrique|metres/.test(q)) {
    setUnits("metric");
    return "Unités métriques : mètres, m/s, kilomètres.";
  }
  if (/trafic|traffic|avions|bateaux|navires/.test(q)) {
    const c = model.contacts();
    const air = c.filter((x) => x.kind === "air").length,
      sea = c.filter((x) => x.kind === "sea").length,
      hostile = c.filter((x) => x.side === "hostile").length;
    return `${model.crafts().length} joueur(s), ${air} avion(s), ${sea} navire(s)${hostile ? `, ${hostile} hostile(s)` : ""}.`;
  }
  if (/suivre|follow/.test(q)) {
    const m = net.room?.members.find(
      (m) =>
        m.role === "pilot" &&
        q.includes(
          m.name
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase(),
        ),
    );
    if (m) {
      select(m.slot);
      return `Je suis ${m.name}.`;
    }
    return "Indiquez le nom d’un pilote connecté.";
  }
  if (/zoom/.test(q)) {
    views.zoomBy(/moins|out|−|-/.test(q) ? 0.75 : 1.333);
    return "Zoom ajusté.";
  }
  if (/centr|recentr/.test(q)) {
    views.reset();
    return "Vue centrée sur le pilote.";
  }
  if (/ajust|fit/.test(q)) {
    views.fit();
    return "Portée ajustée aux joueurs.";
  }
  if (/portee|range/.test(q)) {
    const n = Number(q.match(/[\d.]+/)?.[0]);
    if (n >= 0.1 && n <= 20000) {
      views.range = n * 1000;
      controls();
      views.request();
      return `Portée ${n} km.`;
    }
    return "Indiquez une portée entre 0,1 et 20 000 km.";
  }
  if (/nord|\bcap\b/.test(q)) {
    views.north = q.includes("nord");
    views.request();
    return views.north ? "Nord en haut." : "Cap en haut.";
  }
  if (/capteur|joueurs/.test(q)) {
    views.sensor = q.includes("capteur");
    setView("radar");
    return views.sensor ? "Radar reçu du pilote." : "Positions partagées des joueurs.";
  }
  if (/pause|figer|direct|reprendre/.test(q)) {
    const pause = /pause|figer/.test(q);
    if (pause !== views.paused) views.togglePause();
    controls();
    return pause ? "Consultation figée. La radio reste active." : "Mesures en direct.";
  }
  if (/ecouter|listen/.test(q)) {
    await radio.listen();
    return radio.error || "Écoute activée.";
  }
  if (/couper.*micro/.test(q)) {
    radio.disableMic();
    return "Microphone coupé.";
  }
  if (/activer.*micro/.test(q)) {
    await radio.enableMic();
    return radio.error || "Microphone prêt. Maintenez le bouton radio pour parler.";
  }
  if (/csv|export/.test(q)) {
    download();
    return "Historique exporté.";
  }
  const metric =
    [...METRICS]
      .sort((a, b) => b.name.length - a.name.length)
      .find((m) =>
        q.includes(
          m.name
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase(),
        ),
      ) ?? METRICS.find((m) => q.split(/\W+/).includes(m.key));
  if (metric && /courbe/.test(q)) {
    views.channel = metric.key;
    controls();
    views.request();
    return `Courbe ${metric.name}.`;
  }
  const own = model.own();
  if (!own) return "Je ne reçois pas encore de pilote. Rejoignez une salle et choisissez un pilote.";
  if (own.age > 3) return "Le signal est ancien. Je ne peux pas confirmer les valeurs actuelles.";
  return `${own.member.name} · ${own.kind.toUpperCase()} · ${own.body}\n${(metric ? [metric] : METRICS.slice(0, 7)).map((m) => `${m.name} : ${valueText(own.metrics[m.key], m.k)} ${m.unit}`).join("\n")}`;
}
$("tars-button").addEventListener("click", () => {
  radio.gate.cancel();
  tars.showModal();
});
$("close-tars").addEventListener("click", () => tars.close());
$("tars-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void askTars($<HTMLInputElement>("tars-input").value).then((text) => {
    $("tars-output").textContent = text;
  });
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    radio.gate.cancel();
    showCrew(false);
  }
});
addEventListener("pagehide", () => {
  radio.stop();
  net.close();
});
setInterval(() => {
  if (!document.hidden) refresh();
}, 250);
Object.assign(window, { __crew: { net, model, views, radio, join, setView, askTars } });
setUnits(views.units);
setView("dash");
refresh();
showLobby();
