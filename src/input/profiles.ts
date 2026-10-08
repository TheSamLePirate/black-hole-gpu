// The known controllers' profiles (PLAN-HOTAS H3): HOTAS sticks, throttles and pedals recognised by their
// vendor and product ids (or their names) — a starting point: the axes' order varies with the browser and the
// system, the controls screen (H4) moves any binding by detection. A flight device not known — a stick, a
// throttle, pedals by its name — gets a generic profile; a pad without the standard mapping is left to the
// pad path as before. The standard pads (Xbox, PlayStation) keep their built-in mapping (gamepad.ts): their
// template here seeds a player's own profile from the controls screen.

import { type Binding, type DeviceSnapshot, type Profile, type Shape, SHAPE_DEFAULT } from "./axes";

const inv: Shape = { ...SHAPE_DEFAULT, invert: true };
const lever: Shape = { dead: 0, curve: 0, invert: true };
const toe: Shape = { dead: 0.05, curve: 0, invert: false };

const ax = (index: number) => ({ kind: "axis" as const, index });
const btn = (index: number) => ({ kind: "button" as const, index });

/** a stick's: X roll, Y pitch (pulled back +: nose up), its twist the rudder; the trigger's thumb button: SAS */
function stick(twist: number | null, throttle: number | null): Binding[] {
  const b: Binding[] = [
    { target: "roll", source: ax(0) },
    { target: "pitch", source: ax(1) },
    { action: "sas", source: btn(1) },
  ];
  if (twist !== null) b.push({ target: "yaw", source: ax(twist), shape: { ...SHAPE_DEFAULT, dead: 0.12 } });
  if (throttle !== null) b.push({ target: "throttle", source: ax(throttle), shape: lever });
  return b;
}

/** a throttle's: its lever (forward −1), a rocker the rudder, a mini-stick the RCS's translations */
function throttle(leverAxis: number, rocker: number | null, mini: [number, number] | null): Binding[] {
  const b: Binding[] = [{ target: "throttle", source: ax(leverAxis), shape: lever }];
  if (rocker !== null) b.push({ target: "yaw", source: ax(rocker), shape: { ...SHAPE_DEFAULT, dead: 0.1 } });
  if (mini) b.push({ target: "rcsX", source: ax(mini[0]) }, { target: "rcsY", source: ax(mini[1]), shape: inv });
  return b;
}

/** pedals': the toe brakes (resting at −1: absolute), the rudder */
function pedals(left: number, right: number, rudder: number): Binding[] {
  return [
    { target: "brakeL", source: ax(left), shape: toe },
    { target: "brakeR", source: ax(right), shape: toe },
    { target: "yaw", source: ax(rudder) },
  ];
}

interface Known {
  /** vendor:product ids (lower case) */
  ids: string[];
  /** or the name */
  name?: RegExp;
  label: string;
  bindings: Binding[];
}

export const KNOWN: Known[] = [
  { ids: ["044f:b10a"], name: /t\.?16000m/i, label: "Thrustmaster T.16000M", bindings: stick(5, null) },
  { ids: ["044f:b687"], name: /twcs/i, label: "Thrustmaster TWCS Throttle", bindings: throttle(2, 5, [0, 1]) },
  {
    ids: ["044f:b679", "044f:b67f"],
    name: /t\.?flight rudder|tfrp|t-rudder/i,
    label: "Thrustmaster rudder pedals",
    bindings: pedals(0, 1, 5),
  },
  { ids: ["044f:b108", "044f:b68f", "044f:b67b"], name: /t\.?flight hotas/i, label: "Thrustmaster T.Flight HOTAS", bindings: stick(5, 2) },
  { ids: ["044f:0402"], name: /warthog.*(joystick|stick)/i, label: "Thrustmaster HOTAS Warthog (stick)", bindings: stick(null, null) },
  { ids: ["044f:0404"], name: /warthog.*throttle/i, label: "Thrustmaster HOTAS Warthog (throttle)", bindings: throttle(2, null, [0, 1]) },
  { ids: ["06a3:0255", "06a3:075c", "06a3:0762"], name: /x52/i, label: "Saitek / Logitech X52", bindings: stick(5, 2) },
  { ids: ["0738:2221"], name: /x56.*stick/i, label: "Logitech X56 (stick)", bindings: stick(5, null) },
  { ids: ["0738:a221"], name: /x56.*throttle/i, label: "Logitech X56 (throttle)", bindings: throttle(2, null, [3, 4]) },
  { ids: ["06a3:0763"], name: /pro flight rudder|saitek.*pedal/i, label: "Saitek / Logitech rudder pedals", bindings: pedals(0, 1, 5) },
  { ids: ["046d:c215"], name: /extreme 3d/i, label: "Logitech Extreme 3D Pro", bindings: stick(5, 6) },
  { ids: ["231d:0200", "231d:0201", "231d:0126", "231d:0127"], name: /vkb|gladiator/i, label: "VKB Gladiator", bindings: stick(5, 2) },
];

/** the names that say a flight device (not a pad): its generic profile */
const FLIGHT = /joystick|flight ?stick|hotas|throttle|rudder|pedal|yoke|x52|x56|t\.?16000|gladiator|vkb|warthog|extreme 3d|sidewinder/i;

/** A flight device not known, by its name and its axes: a throttle (its lever), pedals (toe brakes and the
 *  rudder), a stick (roll, pitch, the twist on the 6th axis, a throttle on the 3rd when it has one). */
function generic(d: DeviceSnapshot): Profile | null {
  if (d.standard || !FLIGHT.test(d.name)) return null;
  const n = d.axes.length;
  let bindings: Binding[];
  if (/rudder|pedal/i.test(d.name)) bindings = n >= 3 ? pedals(0, 1, n >= 6 ? 5 : 2) : [{ target: "yaw", source: ax(0) }];
  else if (/throttle/i.test(d.name)) bindings = throttle(n >= 3 ? 2 : 0, n >= 6 ? 5 : null, null);
  else bindings = stick(n >= 6 ? 5 : n >= 4 ? 3 : null, n >= 3 ? 2 : null);
  return { model: d.model, name: `${d.name} (générique · generic)`, bindings };
}

/** A device's known profile (by its ids, else its name), its generic one, or none. */
export function presetFor(d: DeviceSnapshot): Profile | null {
  if (d.standard) return null;
  const k = KNOWN.find((x) => x.ids.includes(d.model)) ?? KNOWN.find((x) => x.name?.test(d.name));
  if (k) return { model: d.model, name: k.label, bindings: k.bindings };
  return generic(d);
}

/** The standard pad's flight (gamepad.ts's built-in mapping) as a profile: what a player's own pad profile
 *  starts from on the controls screen — left stick pitch and yaw, the bumpers roll, the triggers the
 *  throttle (incremental there: here the held keys), A SAS. */
export function standardTemplate(d: DeviceSnapshot): Profile {
  return {
    model: d.model,
    name: d.name,
    bindings: [
      { target: "pitch", source: ax(1) },
      { target: "yaw", source: ax(0) },
      { held: "rollLeft", source: btn(4) },
      { held: "rollRight", source: btn(5) },
      { held: "throttleUp", source: btn(7) },
      { held: "throttleDown", source: btn(6) },
      { action: "sas", source: btn(0) },
      { target: "lookX", source: ax(2) },
      { target: "lookY", source: ax(3), shape: inv },
    ],
  };
}
