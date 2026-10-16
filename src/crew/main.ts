import { NetClient } from "../net/client";
import { isCode, normCode } from "../net/proto";
import { serverUrl } from "../net/load";
import { store } from "../util/storage";
import { CrewModel, METRICS, relative, valueText } from "./model";
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
function controls() {
  const bar = $("view-controls");
  bar.replaceChildren();
  bar.append(
    button("−", () => views.zoomBy(0.75), "zoom-out"),
    button("+", () => views.zoomBy(1.333), "zoom-in"),
  );
  $("zoom-out").setAttribute("aria-label", "Dézoomer");
  $("zoom-in").setAttribute("aria-label", "Zoomer");
  if (views.view === "map" || views.view === "globe") {
    bar.append(button("Centrer / suivre", () => views.reset(), "recenter"));
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
    $("view-note").textContent = "Glisser pour déplacer · pincer pour zoomer · toucher un joueur";
  } else if (views.view === "radar" || views.view === "schematic") {
    const range = document.createElement("input");
    range.type = "number";
    range.min = "0.1";
    range.max = "20000";
    range.step = "0.1";
    range.value = String(views.range / 1000);
    range.style.width = "90px";
    range.setAttribute("aria-label", "Portée en kilomètres");
    range.addEventListener("change", () => {
      const v = range.valueAsNumber;
      if (Number.isFinite(v)) views.range = Math.max(100, Math.min(2e7, v * 1000));
      views.request();
    });
    const label = el("label", "km");
    label.prepend(range);
    bar.append(
      label,
      selectControl(
        [
          ["north", "Nord en haut"],
          ["heading", "Cap en haut"],
        ],
        views.north ? "north" : "heading",
        "Orientation",
        (v) => {
          views.north = v === "north";
          views.request();
        },
      ),
      button("Ajuster", () => {
        views.fit();
        range.value = String(Math.round(views.range / 100) / 10);
      }),
    );
    if (views.view === "radar")
      bar.append(
        selectControl(
          [
            ["players", "Positions joueurs"],
            ["sensor", "Capteur du pilote"],
          ],
          views.sensor ? "sensor" : "players",
          "Source radar",
          (v) => {
            views.sensor = v === "sensor";
            views.request();
          },
        ),
      );
    const contacts = document.createElement("details");
    contacts.className = "pan-controls";
    contacts.append(el("summary", "Contacts"));
    const list = el("div");
    list.id = "contact-list";
    contacts.append(list);
    bar.append(contacts);
    $("view-note").textContent = "Pincer pour régler la portée · équipage pour sélectionner un contact";
  } else {
    bar.append(
      selectControl(
        METRICS.map((m) => [m.key, m.name]),
        views.channel,
        "Mesure affichée",
        (v) => {
          views.channel = v;
          views.request();
        },
      ),
    );
    bar.append(
      selectControl(
        [
          ["60", "1 minute"],
          ["600", "10 minutes"],
          ["3600", "1 heure"],
        ],
        String(views.window),
        "Fenêtre de temps",
        (v) => {
          views.window = Number(v);
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
    $("view-note").textContent = "Glisser pour lire une mesure · historique reçu sur cet écran";
  }
}
function setView(view: CrewView) {
  views.setView(view);
  $("view-title").textContent = VIEW_NAMES[view];
  $("instruments").setAttribute("aria-label", `${VIEW_NAMES[view]} du pilote suivi ; contrôles disponibles au-dessus de la vue`);
  for (const b of $("views").querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.view === view);
    b.setAttribute("aria-pressed", String(b.dataset.view === view));
  }
  controls();
  showCrew(false);
}
for (const view of Object.keys(VIEW_NAMES) as CrewView[]) {
  const b = button(VIEW_NAMES[view], () => setView(view));
  b.dataset.view = view;
  $("views").append(b);
}
function download() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([model.csv()], { type: "text/csv" }));
  a.download = `kerr-crew-${model.selected ?? "flight"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  const metrics = ["alt", "speed", "mach", "fuel", "g", "tau"];
  if (!$("metrics").childElementCount)
    for (const key of metrics) {
      const m = METRICS.find((m) => m.key === key)!;
      const e = el("div", "", "metric");
      e.dataset.key = key;
      e.append(el("small", m.name), el("strong", "—"), el("em", m.unit));
      $("metrics").append(e);
    }
  for (const m of METRICS) {
    const e = $("metrics").querySelector(`[data-key=${m.key}] strong`);
    if (e) e.textContent = own && own.age < 3 ? valueText(own.metrics[m.key], m.k) : "—";
  }
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
  for (const row of $("members").querySelectorAll<HTMLElement>(".member")) {
    const slot = Number(row.dataset.slot);
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
  const contacts = $("contact-list");
  if (contacts) {
    const sensor = views.sensor && views.view === "radar";
    const items = sensor
      ? (own?.snapshot?.radar?.contacts ?? []).map((p) => ({ id: p.id, name: p.name }))
      : crafts.filter((c) => c !== own).map((c) => ({ id: String(c.member.slot), name: c.member.name }));
    const signature = JSON.stringify([sensor, items]);
    if (contacts.dataset.signature !== signature) {
      contacts.dataset.signature = signature;
      contacts.replaceChildren();
      for (const item of items)
        contacts.append(
          button(item.name, () => {
            if (sensor) views.onContact(item.id);
            else select(Number(item.id));
          }),
        );
      if (!items.length) contacts.append(el("p", sensor ? "Aucune piste reçue du pilote." : "Aucun autre pilote connecté.", "muted"));
    }
  }
  const paint = JSON.stringify(crafts.map((c) => [c.member.slot, c.sample.seq, c.snapshot?.t, Math.floor(c.age)]));
  if (!document.hidden && painted !== paint) {
    painted = paint;
    views.request();
  }
}
views.onContact = (id) => {
  views.selectedContact = id;
  const c = model.own()?.snapshot?.radar?.contacts.find((c) => c.id === id);
  if (c) notice(`${c.name} · ${valueText(Math.hypot(c.e, c.n) / 1000)} km · Δh ${valueText(c.dz)} m · ${c.iff}`);
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
    [/carte|\bmap\b/, "map"],
    [/globe/, "globe"],
    [/radar/, "radar"],
    [/schema|schematic/, "schematic"],
    [/telemetr|courbe/, "telemetry"],
  ];
  for (const [pattern, view] of options)
    if (pattern.test(q)) {
      setView(view);
      if (!q.includes("courbe")) return `Vue ${VIEW_NAMES[view]} affichée.`;
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
setView("map");
refresh();
showLobby();
