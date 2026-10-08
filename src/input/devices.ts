// The game controllers as the game reads them (PLAN-HOTAS H1): every device plugged in (the Gamepad API's,
// the WebHID pads') snapshotted each frame, read through its profile (input/axes.ts) — the player's own
// for its model (kept in the browser), else a known model's (input/profiles.ts) — into commands; the
// buttons' presses found against the last frame's. A device with a profile is claimed: the old pad path
// (gamepad.ts poll — the camera, the menus) leaves it alone, so nothing is read twice.

import { sharedPad } from "../gamepad";
import { store } from "../util/storage";
import { type Commands, type DeviceSnapshot, deviceModel, pressedEdges, type Profile, readCommands } from "./axes";
import type { KeyAction } from "./keymap";
import { presetFor } from "./profiles";

const STORE = "kerr.pads";

/** The browser's devices now, as snapshots (their model from their id). */
export function snapshotDevices(list: readonly Gamepad[]): DeviceSnapshot[] {
  return list.map((g) => {
    const { model, name } = deviceModel(g.id);
    return {
      model,
      name,
      standard: g.mapping === "standard",
      axes: [...g.axes],
      buttons: g.buttons.map((b) => b.value || (b.pressed ? 1 : 0)),
    };
  });
}

/** The player's own profiles, by model. */
export function storedProfiles(): Map<string, Profile> {
  try {
    const raw = JSON.parse(store.get(STORE) ?? "[]") as Profile[];
    return new Map(raw.filter((p) => p && typeof p.model === "string" && Array.isArray(p.bindings)).map((p) => [p.model, p]));
  } catch {
    return new Map();
  }
}

function saveAll(m: Map<string, Profile>) {
  store.set(STORE, JSON.stringify([...m.values()]));
}

/** A profile kept (the player's, for its model). */
export function saveProfile(p: Profile) {
  const m = storedProfiles();
  m.set(p.model, p);
  saveAll(m);
}

/** A model's own profile dropped (back to its known one, if any). */
export function forgetProfile(model: string) {
  const m = storedProfiles();
  m.delete(model);
  saveAll(m);
}

/** A known model's profile, from the device (input/profiles.ts sets it: H3) — none by default. */
export type PresetFor = (d: DeviceSnapshot) => Profile | null;

/** What the controllers ask this frame: the commands, the actions pressed now (with their arguments). */
export interface PadFrame {
  commands: Commands;
  pressed: { action: KeyAction; arg?: string }[];
  /** the devices read (with their profile's name) */
  devices: { model: string; name: string; profile: string | null }[];
}

export class PadControls {
  private before = new Map<string, boolean>();
  private own = storedProfiles();
  /** the known models' profiles (input/profiles.ts — H3) */
  presetFor: PresetFor = presetFor;
  last: PadFrame | null = null;
  /** the controllers screen open: the devices read, nothing flown (a button pressed to be bound must not fire
   *  its action — a HOTAS's SAS toggled while being set) */
  suspended = false;

  constructor(private list: () => readonly Gamepad[] = () => sharedPad().list()) {
    // (a device with a profile is claimed: the pad path leaves it — not a standard pad: its camera, its menus
    // stay the pad path's; a profile of the player's for it flies it instead of the built-in mapping)
    sharedPad().claimed = (g) => g.mapping !== "standard" && this.profileOf(snapshotDevices([g])[0]!) !== null;
  }

  /** A standard pad flown through the player's own profile (its id): the pad path's flight mapping skipped. */
  flightOwned(id: string): boolean {
    return this.own.has(deviceModel(id).model);
  }

  /** The player's profiles changed (the controls screen): read anew. */
  reload() {
    this.own = storedProfiles();
  }

  /** A device's profile: the player's for its model, else its known one, else none. */
  profileOf(d: DeviceSnapshot): Profile | null {
    return this.own.get(d.model) ?? this.presetFor(d);
  }

  /** Every device read through its profile; the actions pressed since the last frame. */
  read(): PadFrame {
    const devices = snapshotDevices(this.list());
    const profiles = new Map<string, Profile>();
    for (const d of devices) {
      const p = this.profileOf(d);
      if (p) profiles.set(d.model, p);
    }
    const commands = this.suspended
      ? { axes: {}, actions: new Map<string, boolean>(), held: new Set<never>() }
      : readCommands(devices, profiles);
    const pressed = pressedEdges(commands.actions, this.before).map((k) => {
      const i = k.indexOf(":");
      return i < 0 ? { action: k as KeyAction } : { action: k.slice(0, i) as KeyAction, arg: k.slice(i + 1) };
    });
    this.before = commands.actions;
    this.last = {
      commands,
      pressed,
      devices: devices.map((d) => ({ model: d.model, name: d.name, profile: profiles.get(d.model)?.name ?? null })),
    };
    return this.last;
  }
}
