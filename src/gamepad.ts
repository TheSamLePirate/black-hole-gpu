// Game controller (Gamepad API, "standard" mapping: Xbox, PlayStation, …). Polled once per frame.
//
//   left stick      fly: forward / back, left / right (analog)      L3  hold: boost (×4)
//   right stick     around the target: orbit it · free: look         R3  recentre the view
//   RT · LT         up · down                                        LB · RB  roll left · right
//   A  fly to the target   B  gravity   X  auto-orbit   Y  rotation: around ⟷ free
//   D-pad ◀ ▶  previous / next target   ▲ ▼  closer / farther
//   View  run / pause time            Menu  settings

/** Discrete actions (edge-triggered buttons), handled by the app. */
export type PadAction = "focus" | "gravity" | "auto" | "rotation" | "prevTarget" | "nextTarget" | "recentre" | "time" | "settings";

export interface PadState {
  /** [forward, right, up, roll] in −1 … 1, like the flight keys. */
  move: [number, number, number, number];
  /** Right stick: [right, up] in −1 … 1. */
  look: [number, number];
  /** D-pad ▲ (+1) / ▼ (−1), held. */
  zoom: number;
  fast: boolean;
  /** Buttons pressed since the last poll. */
  actions: PadAction[];
  /** Anything moved or pressed this frame. */
  active: boolean;
  id: string;
}

const BUTTONS: Partial<Record<number, PadAction>> = {
  0: "focus", // A
  1: "gravity", // B
  2: "auto", // X
  3: "rotation", // Y
  8: "time", // View / Back
  9: "settings", // Menu / Start
  11: "recentre", // R3
  14: "prevTarget", // D-pad ◀
  15: "nextTarget", // D-pad ▶
};

const DEAD = 0.14;

/** Radial dead zone, rescaled, with a gentle curve for fine control near the centre. */
function stick(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const k = Math.pow(Math.min((m - DEAD) / (1 - DEAD), 1), 1.6) / m;
  return [x * k, y * k];
}

const trigger = (v: number) => (v < 0.06 ? 0 : (v - 0.06) / 0.94);

// ---------------------------------------------------------------------------------------------
// WebHID fallback for wired Xbox 360 pads (045E:028E) in Chromium browsers on macOS: the system's
// own driver presents them as a HID gamepad, but Chromium never hands them to the Gamepad API. Its
// input report (20 bytes, from the device's report descriptor):
//   [0–1] header · [2] D-pad ▲▼◀▶, Start, Back, L3, R3 · [3] LB, RB, Guide, –, A, B, X, Y ·
//   [4] LT · [5] RT (0–255) · [6–13] LX, LY, RX, RY (int16, little endian, +Y = up)
// It is exposed as a pad with the standard mapping.
// ---------------------------------------------------------------------------------------------

interface HidLike {
  vendorId: number;
  productId: number;
  productName: string;
  opened: boolean;
  open(): Promise<void>;
  addEventListener(type: "inputreport", cb: (e: { data: DataView }) => void): void;
}
type HidApi = {
  getDevices(): Promise<HidLike[]>;
  requestDevice(o: { filters: { vendorId: number; productId?: number }[] }): Promise<HidLike[]>;
  addEventListener(type: "disconnect" | "connect", cb: (e: { device: HidLike }) => void): void;
};
const hidApi = (): HidApi | null => (typeof navigator !== "undefined" && (navigator as unknown as { hid?: HidApi }).hid) || null;

const XBOX360: { vendorId: number; productId: number }[] = [
  { vendorId: 0x045e, productId: 0x028e }, // Xbox 360 Controller (wired, and many compatible pads)
  { vendorId: 0x045e, productId: 0x028f }, // Xbox 360 wireless (play & charge cable)
];

/** A gamepad-shaped object fed by WebHID input reports. */
export class HidPad {
  axes = [0, 0, 0, 0];
  buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  connected = true;
  mapping = "standard";
  index = 1000;
  constructor(readonly device: HidLike) {}
  get id() {
    return `${this.device.productName || "Xbox 360 Controller"} (WebHID)`;
  }

  /** Parses one 20-byte report (tolerates a leading report-id-less header of 2 bytes, or none). */
  update(d: DataView) {
    const o = d.byteLength >= 20 ? 0 : d.byteLength >= 18 ? -2 : NaN; // (header present or stripped)
    if (Number.isNaN(o)) return;
    const u8 = (i: number) => d.getUint8(i + o);
    const i16 = (i: number) => d.getInt16(i + o, true);
    const b2 = u8(2);
    const b3 = u8(3);
    const set = (i: number, on: boolean, v = on ? 1 : 0) => (this.buttons[i] = { pressed: on, value: v });
    set(0, !!(b3 & 0x10)); // A
    set(1, !!(b3 & 0x20)); // B
    set(2, !!(b3 & 0x40)); // X
    set(3, !!(b3 & 0x80)); // Y
    set(4, !!(b3 & 0x01)); // LB
    set(5, !!(b3 & 0x02)); // RB
    set(6, u8(4) > 30, u8(4) / 255); // LT
    set(7, u8(5) > 30, u8(5) / 255); // RT
    set(8, !!(b2 & 0x20)); // Back / View
    set(9, !!(b2 & 0x10)); // Start / Menu
    set(10, !!(b2 & 0x40)); // L3
    set(11, !!(b2 & 0x80)); // R3
    set(12, !!(b2 & 0x01)); // D-pad ▲
    set(13, !!(b2 & 0x02)); // ▼
    set(14, !!(b2 & 0x04)); // ◀
    set(15, !!(b2 & 0x08)); // ▶
    set(16, !!(b3 & 0x04)); // Guide
    const ax = (v: number) => Math.max(-1, Math.min(1, v / 32767));
    this.axes = [ax(i16(6)), -ax(i16(8)), ax(i16(10)), -ax(i16(12))]; // standard: +Y = down
  }
}

/** WebHID source: reopens permitted pads on load; `request()` asks for one (needs a click). */
export class HidPads {
  pads: HidPad[] = [];
  onChange?: () => void;
  constructor() {
    const hid = hidApi();
    if (!hid) return;
    hid.getDevices().then((ds) => ds.forEach((d) => this.attach(d))).catch(() => {});
    hid.addEventListener("connect", (e) => this.attach(e.device));
    hid.addEventListener("disconnect", (e) => {
      this.pads = this.pads.filter((p) => p.device !== e.device);
      this.onChange?.();
    });
  }
  static get supported() {
    return !!hidApi();
  }
  /** Asks the user to pick the controller (must run from a click). */
  async request() {
    const hid = hidApi();
    if (!hid) return false;
    const ds = await hid.requestDevice({ filters: XBOX360 });
    for (const d of ds) await this.attach(d);
    return ds.length > 0;
  }
  private async attach(d: HidLike) {
    if (!XBOX360.some((f) => f.vendorId === d.vendorId && f.productId === d.productId)) return;
    if (this.pads.some((p) => p.device === d)) return;
    try {
      if (!d.opened) await d.open();
    } catch {
      return;
    }
    const pad = new HidPad(d);
    d.addEventListener("inputreport", (e) => pad.update(e.data));
    this.pads.push(pad);
    this.onChange?.();
  }
}

export class GamepadInput {
  private prev: boolean[] = [];
  private index = -1;
  /** WebHID pads (Chromium on macOS with wired Xbox 360 pads). */
  readonly hid = new HidPads();

  /** Every pad the browser exposes, plus the WebHID ones. */
  list(): Gamepad[] {
    const native = typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()] : [];
    return [...native.filter((p): p is Gamepad => !!p && p.connected), ...(this.hid.pads as unknown as Gamepad[])];
  }

  /** The first connected pad with the standard mapping (or any pad), or null. */
  private pad(): Gamepad | null {
    const pads = this.list();
    const pad = pads.find((p) => p.index === this.index) ?? pads.find((p) => p.mapping === "standard") ?? pads[0] ?? null;
    this.index = pad ? pad.index : -1;
    return pad;
  }

  get connected() {
    return this.pad() !== null;
  }

  poll(): PadState | null {
    const p = this.pad();
    if (!p) {
      this.prev = [];
      return null;
    }
    const b = (i: number) => p.buttons[i]?.pressed ?? false;
    const v = (i: number) => p.buttons[i]?.value ?? 0;
    const [lx, ly] = stick(p.axes[0] ?? 0, p.axes[1] ?? 0);
    const [rx, ry] = stick(p.axes[2] ?? 0, p.axes[3] ?? 0);
    const up = trigger(v(7)) - trigger(v(6));
    const roll = (b(4) ? 1 : 0) - (b(5) ? 1 : 0);
    const actions: PadAction[] = [];
    for (const [i, a] of Object.entries(BUTTONS)) {
      const n = Number(i);
      if (b(n) && !this.prev[n]) actions.push(a!);
    }
    this.prev = p.buttons.map((x) => x.pressed);
    const zoom = (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
    const move: PadState["move"] = [ly ? -ly : 0, lx, up, roll]; // (no −0: stick up is forward)
    const active = actions.length > 0 || zoom !== 0 || move.some((x) => x !== 0) || rx !== 0 || ry !== 0;
    return { move, look: [rx, ry ? -ry : 0], zoom, fast: b(10), actions, active, id: p.id };
  }

  /** A short rumble, if the pad can (Chrome, Edge, Safari). */
  rumble(strong = 0.35, weak = 0.6, ms = 90) {
    const p = this.pad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null;
    p?.vibrationActuator?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}
