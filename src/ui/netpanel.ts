// Playing together (docs/PLAN-RESEAU.md, R0): the network's panel — who one is (a name, a colour), a room
// created or joined (its code, a link, a password), the rooms one knows, the room one is in (its members, the
// link's quality), leaving it — and the badge of the room one is in. The network module is loaded the first
// time a room is asked for: the solo game never connects.

import "./netpanel.css";
import { t, tf } from "../i18n";
import { loadNet, netLoaded, netParams, serverUrl, type NetModule } from "../net/load";
import { store } from "../util/storage";
import { button, el as h, modal } from "./kit";
import { netRadar } from "./hud/symbology";
import type { NetMatch } from "./netmatch";
import type { NetSession } from "./netsession";
import type { NetVoice } from "./netvoice";

type Client = InstanceType<NetModule["NetClient"]>;
type Role = "pilot" | "spectator" | "instruments";

export interface NetHost {
  /** the scene's time now [s] (a new room's clock starts there) */
  time(): number;
  /** the build's id */
  build: string;
  toast(s: string): void;
}

interface Known {
  code: string;
  name: string;
  owner?: string;
  used: number;
}

const ID_KEY = "kerr.net.id";
const ROOMS_KEY = "kerr.net.rooms";
export const NET_COLOURS = ["#7fd4ff", "#ff8a5c", "#8dff9a", "#ffd84d", "#d68bff", "#ff6f91"];

function identity(): { device: string; name: string; colour: string } {
  const id = store.getJSON<{ device?: string; name?: string; colour?: string }>(ID_KEY, {});
  const out = {
    device: id.device || crypto.randomUUID(),
    name: id.name || "",
    colour: id.colour && NET_COLOURS.includes(id.colour) ? id.colour : NET_COLOURS[Math.floor(Math.random() * NET_COLOURS.length)]!,
  };
  if (!id.device) store.setJSON(ID_KEY, out);
  return out;
}

const known = () => store.getJSON<Known[]>(ROOMS_KEY, []).filter((r) => r && typeof r.code === "string");
function remember(r: Known) {
  const list = known().filter((k) => k.code !== r.code);
  const prev = known().find((k) => k.code === r.code);
  list.unshift({ ...prev, ...r, owner: r.owner ?? prev?.owner });
  store.setJSON(ROOMS_KEY, list.slice(0, 20));
}
const forget = (code: string) =>
  store.setJSON(
    ROOMS_KEY,
    known().filter((k) => k.code !== code),
  );

const ROLE_NAMES: Record<Role, () => string> = {
  pilot: () => t("Pilot"),
  spectator: () => t("Spectator"),
  instruments: () => t("Instruments"),
};

const ERRORS: Record<string, () => string> = {
  "unknown-room": () => t("No room with that code"),
  full: () => t("The room is full (8 devices)"),
  "pilots-full": () => t("Four pilots already fly in this room: join as a spectator"),
  password: () => t("Wrong password"),
  owner: () => t("Only the room's owner can delete it"),
  update: () => t("This page is too old for the room server: reload it"),
  limit: () => t("The server holds too many rooms"),
};
const why = (e: unknown) => {
  const code = (e as { code?: string }).code;
  if (code && ERRORS[code]) return ERRORS[code]!();
  return (e as Error).message === "offline" || (e as Error).message === "timeout"
    ? t("The room server cannot be reached")
    : String((e as Error).message ?? e);
};

export class NetPanel {
  /** the network's client, once a room was asked for */
  net: Client | null = null;
  /** flying together this frame (ui/netsession.ts): the others placed, ours sent, the teleport */
  session: NetSession | null = null;
  /** the room's match (ui/netmatch.ts) */
  match: NetMatch | null = null;
  /** the players' voices (ui/netvoice.ts) */
  voice: NetVoice | null = null;
  private close: (() => void) | null = null;
  private body: HTMLElement | null = null;
  private badge = h("button", "net-badge");
  private id = identity();
  private busy = false;
  private pulse: ReturnType<typeof setInterval> | null = null;

  constructor(private host: NetHost) {
    this.badge.type = "button";
    this.badge.hidden = true;
    this.badge.dataset.testid = "net-badge";
    this.badge.addEventListener("click", () => this.open());
    document.body.append(this.badge);
    // (the badge kept fresh: the link's figures, a voice, a speed-up offered)
    setInterval(() => this.net?.room && this.updateBadge(), 1000);
  }

  get isOpen() {
    return !!this.close;
  }

  /** whether the network's code was loaded at all (the solo game: never) */
  get loaded() {
    return netLoaded();
  }

  open() {
    if (this.close) return;
    this.body = h("div", "netp");
    const m = modal({
      title: t("Network — play together"),
      body: [this.body],
      cls: "netp-frame",
      testid: "net-panel",
      onClose: () => {
        this.close = null;
        this.body = null;
        if (this.pulse) clearInterval(this.pulse);
      },
    });
    this.close = m.close;
    this.render();
    // (the link's figures kept fresh while the panel is open)
    // (not while one types: the field would be made again under the caret)
    this.pulse = setInterval(() => {
      const f = document.activeElement;
      if (this.net?.room && !((f instanceof HTMLInputElement || f instanceof HTMLSelectElement) && this.body?.contains(f))) this.render();
    }, 1000);
  }

  private async client(): Promise<Client> {
    if (this.net) return this.net;
    const N = await loadNet();
    const lab = N.parseLab(netParams.get("netlab"));
    const net = new N.NetClient({ url: serverUrl(), build: this.host.build, id: this.id, lab });
    net.on("status", () => this.refresh());
    net.on("roster", (members) => {
      // (one colour each: ours taken by one come before us — another free one taken)
      const me = net.room?.slot;
      const clash = members.some((m) => m.slot !== me && m.slot < (me ?? 0) && m.colour === this.id.colour);
      const free = NET_COLOURS.find((c) => !members.some((m) => m.slot !== me && m.colour === c));
      if (clash && free) this.setName(this.id.name, free);
      this.refresh();
    });
    net.on("room", () => this.refresh());
    net.on("world", () => this.refresh());
    net.on("error", (e) => this.host.toast(ERRORS[e.code]?.() ?? e.msg));
    this.net = net;
    return net;
  }

  private refresh() {
    this.updateBadge();
    if (this.body) this.render();
  }

  private updateBadge() {
    const n = this.net;
    const r = n?.room;
    this.badge.hidden = !r;
    if (!r || !n) return;
    this.badge.dataset.status = n.status;
    const part = (cls: string, text: string, title?: string) => {
      const e = h("span", cls, text);
      if (title) e.title = title;
      return e;
    };
    const kids: HTMLElement[] = [part("nb-led", ""), part("nb-code", r.code)];
    if (n.status === "online") {
      kids.push(part("nb-n", `${r.members.length}`, t("Crew")), part("nb-ms", `${Math.round(n.clock.rtt)} ms`));
      if (this.voice?.on) kids.push(part(`nb-mic${this.voice.talking ? " on" : ""}`, "◉", t("Your microphone is on")));
      // (a speed-up offered: waiting for us — R6)
      const offer = this.session?.offer;
      if (offer) kids.push(part("nb-offer", `×${offer.warp}?`, tf("{0} asks for ×{1}", offer.by.join(", "), offer.warp)));
    } else kids.push(part("nb-off", t("offline — reconnecting")));
    this.badge.replaceChildren(...kids);
    this.badge.title = tf("Room {0}: {1}", r.code, r.members.map((m) => m.name).join(", "));
  }

  setName(name: string, colour = this.id.colour) {
    this.id.name = name.slice(0, 24);
    this.id.colour = colour;
    store.setJSON(ID_KEY, this.id);
    if (this.net?.room) this.net.profile(this.id.name, colour);
  }

  private async run(f: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await f();
    } catch (e) {
      this.host.toast(why(e));
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  /** Creates a room and joins it as its pilot. */
  create(name = "", password = "") {
    return this.run(async () => {
      const net = await this.client();
      const r = await net.create(name || tf("{0}'s room", this.id.name || t("Pilot")), this.host.time(), password || undefined);
      remember({ code: r.code, name: r.room.name, owner: r.owner, used: Date.now() });
      this.host.toast(tf("Room {0} created — share its code or its link", r.code));
    });
  }

  join(code: string, role: Role = "pilot", password = "") {
    return this.run(async () => {
      const net = await this.client();
      const r = await net.join(code.trim(), role, password || undefined);
      remember({ code: r.code, name: r.name, used: Date.now() });
      this.host.toast(tf("In room {0} — {1}", r.code, r.name));
    });
  }

  leave() {
    const code = this.net?.room?.code;
    this.net?.close();
    this.net = null;
    this.refresh();
    if (code) this.host.toast(tf("Out of room {0}: back to the solo game", code));
  }

  private remove(k: Known) {
    if (!k.owner) return;
    if (!confirm(tf("Delete the room {0} for everyone?", k.code))) return;
    return this.run(async () => {
      const net = await this.client();
      await net.remove(k.code, k.owner!);
      forget(k.code);
      if (!net.room) {
        net.close();
        this.net = null;
      }
      this.host.toast(tf("Room {0} deleted", k.code));
    });
  }

  /** the role a screen added joins as (the QR code's link) */
  private screenRole: Role = "spectator";

  crewLink(code = this.net?.room?.code): string | null {
    if (!code) return null;
    return `${new URL("crew/", location.href).href}#join=${code}${netParams.get("server") ? `&server=${encodeURIComponent(netParams.get("server")!)}` : ""}`;
  }

  /** The same screens panel for TARS: a lightweight instruments link and QR. */
  showCrew() {
    this.screenRole = "instruments";
    this.tab = "screens";
    this.open();
    this.render();
    return this.crewLink();
  }

  /**
   * Add a screen: the room's link as a QR code — a phone's, a tablet's camera opens it — for a spectator (every
   * view on a pilot), an instruments screen (his cockpit's) or a pilot.
   */
  private screenSection(code: string) {
    const box = h("div", "netp-screen");
    const role = h("select", "netp-in");
    role.dataset.testid = "net-screen-role";
    for (const r of ["spectator", "instruments", "pilot"] as Role[]) {
      const o = h("option", "", ROLE_NAMES[r]());
      o.value = r;
      o.selected = r === this.screenRole;
      role.append(o);
    }
    role.addEventListener("change", () => {
      this.screenRole = role.value as Role;
      this.render();
    });
    const link =
      this.screenRole === "instruments"
        ? this.crewLink(code)!
        : `${this.link(code)}${this.screenRole === "pilot" ? "" : `&role=${this.screenRole}`}`;
    const img = h("div", "netp-qr");
    img.dataset.testid = "net-qr";
    void loadNet().then((N) => {
      img.innerHTML = N.qrSvg(link, 3);
    });
    const text = h("small", "netp-link", link);
    const col = h("div", "netp-qrside");
    const as = h("label", "nm-field");
    as.append(h("span", "netp-lab", t("Joins as")), role);
    col.append(
      as,
      text,
      button({
        label: t("Copy the link"),
        icon: "copy",
        onClick: () => void navigator.clipboard?.writeText(link).then(() => this.host.toast(t("Link copied"))),
      }),
    );
    const row = h("div", "netp-row netp-qrrow");
    row.append(img, col);
    box.append(
      h(
        "p",
        "netp-hint",
        t(
          "Scan it with a phone's or a tablet's camera: it joins the room as you choose — every view on a pilot, his cockpit's instruments, or a pilot.",
        ),
      ),
      row,
    );
    return box;
  }

  /** The voice's section: the microphone on or off, how it opens (our voice, a key held, always), the radio, the
   *  devices of one network not heard. */
  private voiceSection(V: NetVoice) {
    const box = h("div", "netp-voice");
    const P = V.prefs;
    const mode = h("select", "netp-in");
    mode.dataset.testid = "net-voice-mode";
    for (const [k, label] of [
      ["vad", t("Voice activation")],
      ["ptt", t("Push to talk")],
      ["open", t("Always open")],
    ] as const) {
      const o = h("option", "", label);
      o.value = k;
      o.selected = P.mode === k;
      mode.append(o);
    }
    mode.addEventListener("change", () => {
      P.mode = mode.value as typeof P.mode;
      V.save();
      this.render();
    });
    const toggle = button({
      label: V.on ? t("Turn the microphone off") : t("Turn the microphone on"),
      kind: V.on ? "danger" : "primary",
      testid: "net-voice",
      onClick: () =>
        void (V.on ? (V.disable(), Promise.resolve(true)) : V.enable()).then(() => {
          this.render();
          this.updateBadge();
        }),
    });
    const row = h("div", "netp-row");
    row.append(toggle, mode);
    if (P.mode === "ptt") {
      const key = button({
        label: P.pttKey ? tf("Key: {0}", P.pttKey.replace(/^Key|^Digit/, "")) : t("Choose the key…"),
        testid: "net-voice-key",
        onClick: () => {
          key.textContent = t("Press a key…");
          const grab = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            removeEventListener("keydown", grab, true);
            if (e.code !== "Escape") P.pttKey = e.code;
            V.save();
            this.render();
          };
          addEventListener("keydown", grab, true);
        },
      });
      row.append(key);
    }
    const check = (label: string, on: boolean, set: (v: boolean) => void, id: string) => {
      const l = h("label", "nm-check");
      const c = h("input");
      c.type = "checkbox";
      c.checked = on;
      c.dataset.testid = id;
      c.addEventListener("change", () => {
        set(c.checked);
        V.save();
      });
      l.append(c, h("span", "", label));
      return l;
    };
    const row2 = h("div", "netp-row nm-rules");
    row2.append(
      check(t("Radio effect and Quindar tones"), P.radio, (v) => (P.radio = v), "net-voice-radio"),
      check(t("Not the devices on my network (one room)"), P.sameRoomMute, (v) => (P.sameRoomMute = v), "net-voice-same"),
    );
    box.append(
      h("p", "netp-hint", t("Your voice to the others on the direct links — through a radio, Apollo's tones at each end.")),
      row,
      row2,
    );
    return box;
  }

  /** the panel closed (a match started from it) */
  closePanel() {
    this.close?.();
  }

  /** the others on the F-35's radar this frame (tests) */
  radar() {
    return netRadar;
  }

  /** Our craft put beside another's (ui/netsession.ts), said. */
  teleport(slot: number, gap?: number) {
    const said = this.session?.teleport(slot, gap) ?? t("Not in a room");
    this.host.toast(said);
    this.close?.();
    return said;
  }

  /** Formation flight on another's craft (ui/netsession.ts formation), said. */
  formation(slot: number, o?: { side?: "right" | "left"; gap?: number; back?: number; up?: number }) {
    const said = this.session?.formation(slot, o) ?? t("Not in a room");
    this.host.toast(said);
    this.close?.();
    return said;
  }

  link(code: string) {
    return `${location.origin}${location.pathname}#join=${code}`;
  }

  /** the panel's tab in a room (R8: the crew, the match, the voices, the screens) */
  private tab: "crew" | "match" | "voice" | "screens" = "crew";

  private render() {
    const B = this.body;
    if (!B) return;
    const focus = (document.activeElement as HTMLElement | null)?.dataset?.testid;
    const scroll = B.scrollTop;
    B.replaceChildren();
    B.append(this.youRow());
    const net = this.net;
    const room = net?.room;
    if (room && net) {
      B.append(this.roomCard(net), this.tabStrip(net));
      const pane = h("div", "netp-pane");
      pane.dataset.testid = `net-pane-${this.tab}`;
      if (this.tab === "crew") pane.append(this.crew(net));
      else if (this.tab === "match") pane.append(this.match?.section() ?? h("p", "netp-stat", t("No match here")));
      else if (this.tab === "voice") pane.append(this.voice ? this.voiceSection(this.voice) : h("p", "netp-stat", "—"));
      else pane.append(this.screenSection(room.code));
      B.append(pane);
      // the panel's foot: our craft as we left it in this room (R7), leaving
      const foot = h("div", "netp-foot");
      if (net.mine && room.role === "pilot" && this.session)
        foot.append(
          button({
            label: t("Back to my craft"),
            title: t("Where you left your craft in this room"),
            testid: "net-resume",
            onClick: () => {
              this.host.toast(this.session!.resume());
              this.render();
            },
          }),
        );
      foot.append(
        h("span", "netp-grow"),
        button({ label: t("Leave the room"), kind: "danger", testid: "net-leave", onClick: () => this.leave() }),
      );
      B.append(foot);
    } else this.lobby(B);
    B.append(h("p", "netp-server", tf("Server: {0}", serverUrl())));
    B.scrollTop = scroll;
    if (focus) (B.querySelector(`[data-testid="${focus}"]`) as HTMLElement | null)?.focus();
  }

  /** who one is: a name, a colour */
  private youRow() {
    const name = h("input", "netp-in netp-name");
    name.value = this.id.name;
    name.placeholder = t("Your name");
    name.maxLength = 24;
    name.dataset.testid = "net-name";
    name.addEventListener("change", () => this.setName(name.value.trim()));
    const swatches = h("div", "netp-swatches");
    for (const c of NET_COLOURS) {
      const b = h("button", `netp-swatch${c === this.id.colour ? " on" : ""}`);
      b.type = "button";
      b.style.background = c;
      b.title = t("Your colour");
      b.setAttribute("aria-label", t("Your colour"));
      b.addEventListener("click", () => {
        this.setName(name.value.trim(), c);
        this.render();
      });
      swatches.append(b);
    }
    const me = h("div", "netp-row netp-me");
    me.append(h("span", "netp-lab", t("You")), name, swatches);
    return me;
  }

  /** the room one is in: its name, its code, its link; the link's figures; its pace and a speed-up offered (R6) */
  private roomCard(net: Client) {
    const room = net.room!;
    const card = h("div", "netp-room");
    const code = h("b", "netp-code", room.code);
    code.dataset.testid = "net-code";
    const copy = button({
      label: t("Copy the link"),
      icon: "copy",
      testid: "net-copy",
      onClick: () => {
        void navigator.clipboard?.writeText(this.link(room.code)).then(
          () => this.host.toast(t("Link copied")),
          () => this.host.toast(this.link(room.code)),
        );
      },
    });
    const head = h("div", "netp-roomhead");
    head.append(h("span", "netp-roomname", room.name), h("span", "netp-grow"), h("em", "netp-chip", ROLE_NAMES[room.role]()));
    const codeRow = h("div", "netp-coderow");
    codeRow.append(code, copy);
    const stat = h(
      "p",
      "netp-stat",
      net.status === "online"
        ? tf(
            "Round trip {0} ms · jitter {1} ms · others shown {2} ms late",
            Math.round(net.clock.rtt),
            Math.round(net.clock.jitter),
            Math.round(net.remotes.delay * 1000),
          )
        : t("offline — reconnecting"),
    );
    stat.dataset.testid = "net-stat";
    card.append(head, codeRow, stat);
    // (the room's pace: its warp, and what holds it or is offered)
    const W = net.roomWarp();
    const pace = h("div", "netp-pace");
    pace.append(h("span", "netp-lab", t("Time")), h("b", "", W === 0 ? t("paused") : W === 1 ? t("×1 real time") : `×${W}`));
    const offer = this.session?.offer;
    if (offer) {
      pace.append(
        h("span", "netp-offer", tf("{0} asks for ×{1}", offer.by.join(", "), offer.warp)),
        button({
          label: t("Accept"),
          kind: "primary",
          testid: "net-warp-accept",
          onClick: () => {
            this.session?.acceptWarp();
            this.render();
          },
        }),
      );
    }
    card.append(pace);
    return card;
  }

  /** the room's tabs: the crew (how many), the match (running), the voices (the microphone), the screens */
  private tabStrip(net: Client) {
    const room = net.room!;
    const strip = h("nav", "netp-tabs");
    strip.setAttribute("role", "tablist");
    const tabs: [typeof this.tab, string, string][] = [
      ["crew", t("Crew"), String(room.members.length)],
      ["match", t("Match"), this.match?.match && this.match.phase !== "over" ? "●" : ""],
      ["voice", t("Voice"), this.voice?.on ? "◉" : ""],
      ["screens", t("Screens"), ""],
    ];
    for (const [id, label, badge] of tabs) {
      const b = h("button", `netp-tab${this.tab === id ? " on" : ""}`);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(this.tab === id));
      b.dataset.testid = `net-tab-${id}`;
      b.append(h("span", "", label));
      if (badge) b.append(h("i", "netp-tabbadge", badge));
      b.addEventListener("click", () => {
        this.tab = id;
        this.render();
      });
      strip.append(b);
    }
    return strip;
  }

  /** the crew: each member — his colour, his voice, his name, his role, how his samples come; his volume, and
   *  following him, going beside him */
  private crew(net: Client) {
    const room = net.room!;
    const list = h("ul", "netp-members");
    list.dataset.testid = "net-members";
    for (const m of [...room.members].sort((a, b) => a.slot - b.slot)) {
      const mine = m.slot === room.slot;
      const li = h("li", mine ? "me" : "");
      const dot = h("i", "netp-dot");
      dot.style.background = m.colour;
      const L = net.mesh?.peers.get(m.slot);
      const route = mine
        ? t("you")
        : L?.state === "open"
          ? `${L.route === "host" ? t("direct, local") : L.route === "relay" ? t("relayed") : t("direct")}${Number.isFinite(L.rtt) ? ` · ${Math.round(L.rtt)} ms` : ""}`
          : t("via the server");
      const r = h("small", "netp-route", route);
      r.dataset.testid = `net-route-${m.slot}`;
      const V = this.voice;
      const talk = h("i", `netp-talk${(mine ? V?.talking : V?.speaking(m.slot)) ? " on" : ""}`, "◉");
      talk.title = t("Speaking");
      talk.dataset.testid = `net-talk-${m.slot}`;
      const who = h("div", "netp-who");
      const line = h("div", "netp-whoname");
      line.append(h("span", "", m.name || "—"), h("em", "netp-chip", ROLE_NAMES[m.role]?.() ?? m.role));
      const sub = h("div", "netp-whosub");
      sub.append(r);
      // (aboard another's craft — R5)
      const S = this.session;
      const ride = mine ? (S?.follow?.why === "passenger" ? S.follow.slot : undefined) : S?.aboard.get(m.slot);
      if (ride !== undefined) {
        const pilot = room.members.find((x) => x.slot === ride)?.name ?? `#${ride}`;
        const b = h("em", "netp-aboard", tf("aboard {0}'s craft", pilot));
        b.dataset.testid = `net-aboard-${m.slot}`;
        sub.append(b);
      }
      who.append(line, sub);
      li.append(dot, talk, who);
      const acts = h("div", "netp-acts");
      if (V && !mine) {
        const vol = h("input", "netp-vol");
        vol.type = "range";
        vol.min = "0";
        vol.max = "1.5";
        vol.step = "0.05";
        vol.value = String(V.volume(m.slot));
        vol.title = tf("{0}'s volume", m.name);
        vol.setAttribute("aria-label", tf("{0}'s volume", m.name));
        vol.addEventListener("input", () => V.setVolume(m.slot, Number(vol.value)));
        acts.append(vol);
      }
      // (another pilot followed: every view on him, his instruments — a spectator's, anyone's)
      if (!mine && m.role === "pilot") {
        const following = this.session?.follow?.slot === m.slot;
        acts.append(
          button({
            label: following ? t("Stop following") : t("Follow"),
            icon: "eye",
            on: following,
            title: tf("Every view on {0}'s craft, his instruments", m.name),
            testid: `net-follow-${m.slot}`,
            onClick: () => {
              this.session?.setFollow(following ? null : m.slot);
              this.render();
            },
          }),
        );
      }
      // (beside another — off its right wing, at its speed)
      if (!mine && m.role === "pilot" && room.role === "pilot")
        acts.append(
          button({
            label: t("Beside"),
            title: tf("Put my craft off {0}'s right wing, at its speed", m.name),
            testid: `net-tp-${m.slot}`,
            onClick: () => this.teleport(m.slot),
          }),
          // (formation: the autopilot flying a slot off his wing — rejoining from where we are, Beside first if far)
          (() => {
            const on = this.session?.formSlot() === m.slot;
            return button({
              label: on ? t("Leave formation") : t("Formation"),
              on,
              title: on
                ? t("The formation let go: altitude, heading and speed held")
                : tf("The autopilot flies our place in the formation chosen on {0} and holds it there (the stick lets go)", m.name),
              testid: `net-form-${m.slot}`,
              onClick: () => this.formation(m.slot),
            });
          })(),
        );
      li.append(acts);
      list.append(li);
    }
    const box = h("div", "netp-crew");
    box.append(list);
    if (room.members.length < 2)
      box.append(h("p", "netp-hint", t("Alone for now: share the room's code, its link — or its QR code in Screens.")));
    return box;
  }

  /** out of a room: a new one, joining one, the rooms one knows */
  private lobby(B: HTMLElement) {
    const rname = h("input", "netp-in");
    rname.placeholder = t("Room name (optional)");
    rname.maxLength = 40;
    const rpass = h("input", "netp-in");
    rpass.placeholder = t("Password (optional)");
    rpass.type = "password";
    const create = h("div", "netp-card");
    create.append(
      h("div", "netp-sub", t("A new room")),
      h("p", "netp-hint", t("Two to four pilots, spectators and screens: its code or its link brings them in.")),
      rname,
      rpass,
      button({
        label: t("Create a room"),
        kind: "primary",
        testid: "net-create",
        onClick: () => void this.create(rname.value.trim(), rpass.value),
      }),
    );
    const code = h("input", "netp-in netp-codein");
    code.placeholder = t("Code");
    code.maxLength = 7;
    code.dataset.testid = "net-join-code";
    code.addEventListener("input", () => (code.value = code.value.toUpperCase()));
    const jpass = h("input", "netp-in");
    jpass.placeholder = t("Password (if any)");
    jpass.type = "password";
    const role = h("select", "netp-in");
    role.dataset.testid = "net-role";
    for (const r of ["pilot", "spectator", "instruments"] as Role[]) {
      const o = h("option", "", ROLE_NAMES[r]());
      o.value = r;
      role.append(o);
    }
    const go = () => code.value.trim() && void this.join(code.value, role.value as Role, jpass.value);
    code.addEventListener("keydown", (e) => e.key === "Enter" && go());
    const join = h("div", "netp-card");
    join.append(
      h("div", "netp-sub", t("Join a room")),
      h("p", "netp-hint", t("Its six-letter code — or open its link.")),
      code,
      jpass,
      role,
      button({ label: t("Join"), kind: "primary", testid: "net-join", onClick: go }),
    );
    const cards = h("div", "netp-cards");
    cards.append(create, join);
    B.append(cards);
    // the rooms one knows
    const K = known();
    if (K.length) {
      const list = h("ul", "netp-known");
      for (const k of K) {
        const li = h("li");
        li.append(
          h("b", "", k.code),
          h("span", "", k.name),
          h("small", "netp-when", ago(k.used)),
          k.owner ? h("em", "netp-chip", t("yours")) : h("span"),
          button({ label: t("Join"), testid: `net-rejoin-${k.code}`, onClick: () => void this.join(k.code) }),
          k.owner ? button({ icon: "close", title: t("Delete this room"), kind: "danger", onClick: () => void this.remove(k) }) : h("span"),
        );
        list.append(li);
      }
      B.append(h("div", "netp-sub", t("Your rooms")), list);
    }
    if (this.busy) B.append(h("p", "netp-stat", t("Connecting…")));
  }
}

/** how long ago [a time in ms], said short */
function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (!(s > 0)) return "";
  if (s < 3600) return tf("{0} min ago", Math.max(1, Math.round(s / 60)));
  if (s < 86400) return tf("{0} h ago", Math.round(s / 3600));
  return tf("{0} d ago", Math.round(s / 86400));
}
