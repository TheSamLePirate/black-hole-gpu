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
  /** FlightGear's Systems/a320-cockpit.xml: an animation's property eased from a system's — [output, input, rate
   *  (1/s: a first-order lag), rate limit (/s, 0: none)] */
  lags: [string, string, number, number][];
  /** the texts (FlightGear's osgText: the FCU's windows, the radios, the clock…): a quad each in the deck, its characters
   *  drawn in its slot of the displays' atlas (du/texts.ts) */
  texts: DeckText[];
}

/** An osgText of the deck: its value (a property by a printf format, or a literal), its alignment, its font's kind,
 *  its slot in the atlas (u0, v0, w, h — 0…1). */
export interface DeckText {
  name: string;
  kind: string;
  format: string;
  prop: string;
  text: string;
  align: string;
  font: string;
  slot: [number, number, number, number];
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
    lags?: [string, string, number, number][];
    texts?: DeckText[];
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
    lags: meta.lags ?? [],
    texts: meta.texts ?? [],
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

/** The deck's properties from the flight, as FlightGear's systems write them (their paths without a leading "/" nor
 *  an index [0]: scripts/build-a320-cockpit.py), and the animations' eased from them by the lags of
 *  Systems/a320-cockpit.xml (the deck's: DeckMesh.lags). The switches' own properties are the controls'
 *  (deckctl.ts), in the same bag. */
export class DeckPoser {
  props: Props = {
    // (the aircraft's options: the CFM56's overhead plugs, no head-up display, the displays drawn inside)
    "options/eng": "CFM",
    "options/enable-hud": 0,
    "options/hide-canvas-outside": 0,
    "sim/current-view/internal": 1,
    "controls/switches/annun-test": 0,
    // (the EFIS: the ND in ARC at 40 NM, as FlightGear starts it)
    "instrumentation/efis/nd/display-mode": "ARC",
    "instrumentation/efis/mfd/pnl_mode-num": 3,
    "instrumentation/efis/inputs/range-nm": 40,
    "instrumentation/efis[1]/nd/display-mode": "ARC",
    "instrumentation/efis[1]/mfd/pnl_mode-num": 3,
    "instrumentation/efis[1]/inputs/range-nm": 40,
  };
  /** the lags (the deck's, once loaded) */
  lags: DeckMesh["lags"] = [];

  step(i: DeckInputs): Props {
    const P = this.props;
    // (FlightGear's: the elevator > 0 the stick forward; the aileron > 0 to the right)
    P["controls/flight/elevator"] = -clamp(i.stick[0], -1, 1);
    P["controls/flight/aileron"] = clamp(i.stick[1], -1, 1);
    P["systems/fbw/sidestick/yaw-input-cmd"] = clamp(i.pedals, -1, 1);
    P["systems/fbw/tiller-handle-cmd"] = clamp(i.tiller, -1, 1);
    // (the thrust levers at their angles — a function, not a lag —, the reversers' levers lifted)
    const ang = leverAngle(i.lever) / 45;
    P["controls/cockpit/throttle-lever"] = ang;
    P["controls/cockpit/throttle-lever[1]"] = ang;
    P["controls/engines/engine/throttle"] = P["controls/engines/engine[1]/throttle"] = i.lever;
    P["systems/fadec/reverse-1/throttle-lever"] = P["systems/fadec/reverse-2/throttle-lever"] = clamp(i.reverse, 0, 1);
    P["controls/flight/flaps-input"] = clamp(i.flapLever, 0, 4);
    P["fdm/jsbsim/spoilers/lever-cmd"] = clamp(i.speedBrake, 0, 1);
    P["controls/flight/speedbrake-arm"] = i.spoilersArmed ? 1 : 0;
    P["controls/gear/brake-parking"] = i.parkBrake ? 1 : 0;
    // (the gear lever: pulled out, moved, pushed in — FlightGear's 0 … 3)
    P["controls/gear/lever-cockpit"] = i.gearDown ? 3 : 0;
    // (the autobrake's buttons, pressed in, and their lights)
    const ab = i.fcs?.autobrake ?? 0;
    P["controls/cockpit/autobrake-lo-translate"] = ab === 1 ? 1 : 0;
    P["controls/cockpit/autobrake-med-translate"] = ab === 2 ? 1 : 0;
    P["controls/cockpit/autobrake-max-translate"] = ab === 3 ? 1 : 0;
    P["controls/indicators/autobrake-low-on"] = ab === 1 ? 1 : 0;
    P["controls/indicators/autobrake-med-on"] = ab === 2 ? 1 : 0;
    P["controls/indicators/autobrake-max-on"] = ab === 3 ? 1 : 0;
    // (the buses powered — A10's electrics to come: all of them —, the lights may show, the displays and the MCDUs
    // answer; the displays' brightness knobs at full until turned)
    for (const b of ["ac-1", "ac-2", "ac-ess", "ac-ess-shed", "ac-si-bus"]) P[`systems/electrical/bus/${b}`] = i.powered ? 115 : 0;
    for (const b of ["dc-1", "dc-2", "dc-bat", "dc-ess", "dc-ess-shed", "dc-hot-1", "dc-hot-2", "dc-service-bus"])
      P[`systems/electrical/bus/${b}`] = i.powered ? 28 : 0;
    for (const d of ["dcdul", "dcdur", "du1", "du2", "du3", "du4", "du5", "du6", "iesi", "mcdu1", "mcdu2"])
      P[`controls/lighting/DU/${d}`] ??= 1;
    // (the animations eased after their systems: a first-order lag, a rate limit first where there is one; the first
    // frame where they are)
    for (const [out, src, c1, rate] of this.lags) {
      const x = P[src];
      if (typeof x !== "number") continue;
      const v = P[out];
      if (typeof v !== "number") {
        P[out] = x;
        continue;
      }
      let w = v;
      if (rate > 0) w += clamp(x - w, -rate * i.dt, rate * i.dt);
      else w += (x - w) * (1 - Math.exp(-c1 * i.dt));
      P[out] = w;
    }
    return P;
  }
}
