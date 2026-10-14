// Playing together (docs/PLAN-RESEAU.md, R0): the network's panel — who one is (a name, a colour), a room
// created or joined (its code, a link, a password), the rooms one knows, the room one is in (its members, the
// link's quality), leaving it — and the badge of the room one is in. The network module is loaded the first
// time a room is asked for: the solo game never connects.

import "./netpanel.css";
import { t, tf } from "../i18n";
import { loadNet, netLoaded, netParams, serverUrl, type NetModule } from "../net/load";
import { store } from "../util/storage";
import { button, el as h, modal } from "./kit";
import type { NetSession } from "./netsession";

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
      if (this.net?.room && !(document.activeElement instanceof HTMLInputElement && this.body?.contains(document.activeElement)))
        this.render();
    }, 1000);
  }

  private async client(): Promise<Client> {
    if (this.net) return this.net;
    const N = await loadNet();
    const lab = N.parseLab(netParams.get("netlab"));
    const net = new N.NetClient({ url: serverUrl(), build: this.host.build, id: this.id, lab });
    net.on("status", () => this.refresh());
    net.on("roster", () => this.refresh());
    net.on("room", () => this.refresh());
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
    this.badge.textContent =
      n.status === "online"
        ? `● ${r.code} · ${r.members.length} · ${Math.round(n.clock.rtt)} ms`
        : `● ${r.code} · ${t("offline — reconnecting")}`;
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

  /** Our craft put beside another's (ui/netsession.ts), said. */
  teleport(slot: number, gap?: number) {
    const said = this.session?.teleport(slot, gap) ?? t("Not in a room");
    this.host.toast(said);
    this.close?.();
    return said;
  }

  link(code: string) {
    return `${location.origin}${location.pathname}#join=${code}`;
  }

  private render() {
    const B = this.body;
    if (!B) return;
    const focus = (document.activeElement as HTMLElement | null)?.dataset?.testid;
    B.replaceChildren();
    // who one is
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
      b.title = c;
      b.addEventListener("click", () => {
        this.setName(name.value.trim(), c);
        this.render();
      });
      swatches.append(b);
    }
    const me = h("div", "netp-row netp-me");
    me.append(name, swatches);
    B.append(h("div", "netp-sub", t("You")), me);
    const net = this.net;
    const room = net?.room;
    if (room && net) {
      // the room one is in
      const card = h("div", "netp-room");
      const code = h("b", "netp-code", room.code);
      code.dataset.testid = "net-code";
      const copy = button({
        label: t("Copy the link"),
        testid: "net-copy",
        onClick: () => {
          void navigator.clipboard?.writeText(this.link(room.code)).then(
            () => this.host.toast(t("Link copied")),
            () => this.host.toast(this.link(room.code)),
          );
        },
      });
      card.append(h("span", "netp-sub", room.name), code, copy);
      const list = h("ul", "netp-members");
      list.dataset.testid = "net-members";
      for (const m of [...room.members].sort((a, b) => a.slot - b.slot)) {
        const li = h("li", m.slot === room.slot ? "me" : "");
        const dot = h("i", "netp-dot");
        dot.style.background = m.colour;
        li.append(dot, h("span", "", m.name), h("em", "", ROLE_NAMES[m.role]?.() ?? m.role));
        // (the tests': beside another — off its right wing, at its speed)
        if (m.slot !== room.slot && m.role === "pilot")
          li.append(
            button({
              label: t("Beside"),
              title: tf("Put my craft off {0}'s right wing, at its speed", m.name),
              testid: `net-tp-${m.slot}`,
              onClick: () => this.teleport(m.slot),
            }),
          );
        list.append(li);
      }
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
      B.append(card, list, stat, button({ label: t("Leave the room"), kind: "danger", testid: "net-leave", onClick: () => this.leave() }));
    } else {
      // create
      const rname = h("input", "netp-in");
      rname.placeholder = t("Room name (optional)");
      rname.maxLength = 40;
      const rpass = h("input", "netp-in");
      rpass.placeholder = t("Password (optional)");
      rpass.type = "password";
      const create = h("div", "netp-row");
      create.append(
        rname,
        rpass,
        button({
          label: t("Create a room"),
          kind: "primary",
          testid: "net-create",
          onClick: () => void this.create(rname.value.trim(), rpass.value),
        }),
      );
      // join
      const code = h("input", "netp-in netp-codein");
      code.placeholder = t("Code");
      code.maxLength = 7;
      code.dataset.testid = "net-join-code";
      code.addEventListener("input", () => (code.value = code.value.toUpperCase()));
      const jpass = h("input", "netp-in");
      jpass.placeholder = t("Password");
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
      const join = h("div", "netp-row");
      join.append(code, jpass, role, button({ label: t("Join"), testid: "net-join", onClick: go }));
      B.append(h("div", "netp-sub", t("A new room")), create, h("div", "netp-sub", t("Join a room")), join);
      // the rooms one knows
      const K = known();
      if (K.length) {
        const list = h("ul", "netp-known");
        for (const k of K) {
          const li = h("li");
          li.append(
            h("b", "", k.code),
            h("span", "", k.name),
            k.owner ? h("em", "", t("yours")) : h("em"),
            button({ label: t("Join"), testid: `net-rejoin-${k.code}`, onClick: () => void this.join(k.code) }),
            k.owner
              ? button({ icon: "close", title: t("Delete this room"), kind: "danger", onClick: () => void this.remove(k) })
              : h("span"),
          );
          list.append(li);
        }
        B.append(h("div", "netp-sub", t("Your rooms")), list);
      }
      if (this.busy) B.append(h("p", "netp-stat", t("Connecting…")));
    }
    B.append(h("p", "netp-server", tf("Server: {0}", serverUrl())));
    if (focus) (B.querySelector(`[data-testid="${focus}"]`) as HTMLElement | null)?.focus();
  }
}
