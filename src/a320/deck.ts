// The A320's flight deck (docs/PLAN-A320.md, A5): assets/a320/a320-cockpit.bin, as scripts/build-a320-cockpit.py
// writes it — FlightGear's cockpit and its displays' screens in the ship's frame, its rig (every switch, knob and lever,
// the lights shown or hidden: src/a320/rig.ts evaluates it), its controls (FlightGear's picks and knobs: their actions,
// their tooltips), each triangle's object (what a click meets); and the properties its rig reads from the flight
// (FlightGear's own paths, Systems/a320-cockpit.xml's): the side sticks, the thrust levers at their angles, the flap and
// speed brake levers, the gear lever, the pedals, the tiller, the options (the CFM's overhead, no HUD). Pure.

import type { A320Mesh, Cond, Props, RigNode } from "./rig";
import type { A320Fcs } from "./fcs";
import { leverAngle } from "./fadec";

type V3 = [number, number, number];

/** A FlightGear binding of a control's action (its command and its arguments, as the XML has them). */
export interface DeckBinding {
  command: string;
  property?: string;
  step?: string;
  min?: string;
  max?: string;
  wrap?: string;
  factor?: string;
  offset?: string;
  script?: string;
  value?: string | string[];
  condition?: Cond;
}
/** A control (FlightGear's pick, knob or slider): the objects it lives on, its actions by mouse button (0 the click,
 *  3 / 4 the wheel), a knob's property and drag, its tooltip. */
export interface DeckControl {
  type: "pick" | "knob" | "slider";
  objects: string[];
  prop?: string;
  drag?: string;
  actions: { button: number[]; repeatable?: boolean; kind?: "increase" | "decrease"; bindings: DeckBinding[]; up?: DeckBinding[] }[];
  label?: string;
  labelProp?: string;
}

export interface DeckMesh extends A320Mesh {
  controls: DeckControl[];
  objects: string[];
  /** per triangle its object's index (objects) */
  triObj: Uint16Array;
  /** the displays' cells in their atlas (u0, v0, w, h — 0…1) by name: PFD1, ND1, UECAM, LECAM, ND2, PFD2, MCDU1, MCDU2,
   *  IESI, DCDU1, DCDU2 */
  screens: Record<string, [number, number, number, number]>;
}

export function parseDeck(buf: ArrayBuffer): DeckMesh {
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
  if (magic !== "A32C") throw new Error("bad a320-cockpit.bin");
  const [, nv, ni] = new Uint32Array(buf, 4, 3) as unknown as [number, number, number];
  const b = new Float32Array(buf, 16, 6);
  let off = 40;
  const n = new Uint32Array(buf, off, 1)[0]!;
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 4, n))) as {
    nodes: RigNode[];
    controls: DeckControl[];
    objects: string[];
    screens: Record<string, [number, number, number, number]>;
  };
  off += 4 + n;
  const verts = new Float32Array(buf.slice(off, off + nv * 40));
  off += nv * 40;
  const idx = new Uint32Array(buf.slice(off, off + ni * 4));
  off += ni * 4;
  const triObj = new Uint16Array(buf.slice(off, off + (ni / 3) * 2));
  return {
    verts,
    idx,
    lo: [b[0]!, b[1]!, b[2]!] as V3,
    hi: [b[3]!, b[4]!, b[5]!] as V3,
    nodes: meta.nodes,
    lamps: [],
    controls: meta.controls,
    objects: meta.objects,
    triObj,
    screens: meta.screens,
  };
}

/** What the flight gives the deck's rig each frame. */
export interface DeckInputs {
  dt: number;
  /** the side stick's deflection −1…1 (pitch: aft > 0; roll: right > 0), the pedals' (right > 0), the tiller's */
  stick: [number, number];
  pedals: number;
  tiller: number;
  /** the gear lever down */
  gearDown: boolean;
  /** the systems flown (the levers' positions, the flaps' lever, the speed brakes, the autobrake) */
  fcs: A320Fcs | null;
  lever: number;
  reverse: number;
  flapLever: number;
  speedBrake: number;
  spoilersArmed: boolean;
  parkBrake: boolean;
  /** the DC essential bus powered (the lights may show) */
  powered: boolean;
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The deck's properties from the flight (FlightGear's Systems/a320-cockpit.xml's, eased as its lag filters ease them). */
export class DeckPoser {
  props: Props = {
    // (the aircraft's options: the CFM56's overhead plugs, no head-up display, the displays drawn inside)
    "options/eng": "CFM",
    "options/enable-hud": 0,
    "options/hide-canvas-outside": 0,
    "sim/current-view/internal": 1,
    "controls/switches/annun-test": 0,
  };
  private gear = 0;

  step(i: DeckInputs): Props {
    const P = this.props;
    const k = Math.min(i.dt * 20, 1);
    const ease = (key: string, to: number, kk = k) => {
      const v = Number(P[key] ?? to);
      P[key] = v + (to - v) * kk;
    };
    // (FlightGear's: elevator > 0 is the stick forward; aileron > 0 to the right)
    ease("controls/cockpit/elevator-sidestick-capt", -clamp(i.stick[0], -1, 1));
    ease("controls/cockpit/aileron-sidestick-capt", clamp(i.stick[1], -1, 1));
    ease("controls/cockpit/rudder-pedal", clamp(i.pedals, -1, 1));
    ease("controls/cockpit/tiller-handle", clamp(i.tiller, -1, 1));
    const ang = leverAngle(i.lever) / 45;
    ease("controls/cockpit/throttle-lever[0]", ang, 1);
    ease("controls/cockpit/throttle-lever[1]", ang, 1);
    ease("controls/cockpit/reverse-lever[0]", clamp(i.reverse, 0, 1));
    ease("controls/cockpit/reverse-lever[1]", clamp(i.reverse, 0, 1));
    ease("controls/cockpit/flaps-lever-rotate", clamp(i.flapLever, 0, 4));
    ease("controls/cockpit/spoilers-lever-rotate", clamp(i.speedBrake, 0, 1));
    ease("controls/cockpit/spoilers-lever-translate", i.spoilersArmed ? 1 : 0);
    ease("controls/cockpit/park-brk-rotate", i.parkBrake ? 1 : 0, Math.min(i.dt * 10, 1));
    // (the gear lever: pulled out, moved down, pushed in — FlightGear's 0 … 3, 4.5 a second)
    this.gear += clamp((i.gearDown ? 3 : 0) - this.gear, -4.5 * i.dt, 4.5 * i.dt);
    P["controls/cockpit/gear-lever"] = this.gear;
    // (the autobrake's buttons, pressed in)
    const ab = i.fcs?.autobrake ?? 0;
    P["controls/cockpit/autobrake-lo-translate"] = ab === 1 ? 1 : 0;
    P["controls/cockpit/autobrake-med-translate"] = ab === 2 ? 1 : 0;
    P["controls/cockpit/autobrake-max-translate"] = ab === 3 ? 1 : 0;
    P["controls/indicators/autobrake-low-on"] = ab === 1 ? 1 : 0;
    P["controls/indicators/autobrake-med-on"] = ab === 2 ? 1 : 0;
    P["controls/indicators/autobrake-max-on"] = ab === 3 ? 1 : 0;
    // (the essential bus: the lights may show)
    P["systems/electrical/bus/dc-ess"] = i.powered ? 28 : 0;
    P["systems/electrical/bus/ac-ess-shed"] = i.powered ? 115 : 0;
    return P;
  }
}
