// The flight's manoeuvres (docs/PLAN-AVIATION-AAA.md, F4): a place changed without a jump — the slot flown moving
// to the new one at a few metres a second, and to the other side of the leader under and behind him (a
// cross-under), never through him —; a tactical formation's turn — past 60°, its wingmen swap sides (a cross turn),
// the outside one no longer left far behind —; the places on the runway for a formation take-off, and on the final
// for a formation landing. Pure.

import type { FormSlot } from "./formation";
import { FORMATIONS, type FormationId } from "./formations";

const D = Math.PI / 180;
const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

export const FLOW = {
  /** the slot's move toward the new one [m/s] */
  rate: 12,
  /** the cross-under: behind the leader by this at least [m], below the lower of the two places by this [m]; sides
   *  crossed only farther out than this across [m] */
  underBack: 40,
  underDrop: 10,
  side: 6,
  /** a close formation's places within this across [m] (beyond: a tactical one's) */
  closeOut: 100,
  /** a turn: begun past this acceleration across [m/s²], ended under this; the sides swapped past this [rad] */
  turnOn: 2.5,
  turnOff: 1,
  swapAt: 60 * D,
} as const;

/**
 * The slot flown, `dt` [s] on: moved toward `target` at `rate` — across the leader's track only behind and below
 * him (first back and down on its own side, then across, then to the place).
 */
export function easeSlot(cur: FormSlot, target: FormSlot, dt: number, rate: number = FLOW.rate): FormSlot {
  // (a close formation's places: crossed under and behind; a tactical one's, hundreds of metres out: straight, at a
  // pace by their distance)
  const close = Math.abs(cur.right) < FLOW.closeOut && Math.abs(target.right) < FLOW.closeOut;
  const crossing =
    close && Math.sign(cur.right) !== Math.sign(target.right) && Math.abs(cur.right) > FLOW.side && Math.abs(target.right) > FLOW.side;
  const back = Math.max(target.back, FLOW.underBack);
  // (below the lower of the place and the leader's own level)
  const up = Math.min(target.up, 0) - FLOW.underDrop;
  if (!close) rate = Math.max(rate, Math.min(Math.hypot(target.right - cur.right, target.back - cur.back, target.up - cur.up) / 20, 60));
  let aim = target;
  if (crossing) {
    const under = cur.back >= back - 1 && cur.up <= up + 1;
    aim = under ? { right: target.right, back, up } : { right: cur.right, back, up };
  } else if (Math.abs(cur.right - target.right) > 1 && (cur.back > target.back + 1 || cur.up < target.up - 1)) {
    // (across first, then forward and up to the place: coming out from under him)
    aim = { right: target.right, back: cur.back, up: cur.up };
  }
  const d = [aim.right - cur.right, aim.back - cur.back, aim.up - cur.up];
  const l = Math.hypot(d[0]!, d[1]!, d[2]!);
  const k = l > 1e-9 ? Math.min(1, (rate * dt) / l) : 0;
  return { right: cur.right + d[0]! * k, back: cur.back + d[1]! * k, up: cur.up + d[2]! * k };
}

/** A tactical formation's turn: its state (the heading the turn began on, the sides swapped). */
export interface CrossTurn {
  h0: number | null;
  swapped: boolean;
  mirror: boolean;
}

export const crossTurnNew = (): CrossTurn => ({ h0: null, swapped: false, mirror: false });

/**
 * A frame of the cross turn: the leader's heading [rad] and his acceleration across [m/s²]. A tactical formation's
 * sides swapped once the turn passes 60°; its slot (mirrored or not) out.
 */
export function crossTurnStep(T: CrossTurn, shape: FormationId, hdg: number, aLat: number, slot: FormSlot): FormSlot {
  if (!FORMATIONS[shape].close) {
    if (Math.abs(aLat) > FLOW.turnOn) {
      if (T.h0 === null) T.h0 = hdg;
      if (!T.swapped && Math.abs(wrap(hdg - T.h0)) > FLOW.swapAt) {
        T.mirror = !T.mirror;
        T.swapped = true;
      }
    } else if (Math.abs(aLat) < FLOW.turnOff) {
      T.h0 = null;
      T.swapped = false;
    }
  } else T.mirror = false;
  return T.mirror ? { ...slot, right: -slot.right } : slot;
}

/** The places on the runway for a formation take-off [m]: Two beside the leader, the second element 200 m behind. */
export const TAKEOFF_SLOTS: Record<number, FormSlot> = {
  2: { right: 15, back: 0, up: 0 },
  3: { right: 0, back: 200, up: 0 },
  4: { right: 15, back: 200, up: 0 },
};
/** the second element's roll: after the leader's by this [s]; the rotation's speed [m/s] */
export const TAKEOFF = { delay: 8, vRotate: 70 } as const;

/** The places on the final for a formation landing: Two beside and a little behind, the second element 900 m back on
 *  the glide path (3°: the height behind it). */
export function landingSlot(pos: number): FormSlot {
  const s = { 2: { right: 15, back: 20 }, 3: { right: 0, back: 900 }, 4: { right: 15, back: 920 } }[pos] ?? { right: 15, back: 20 };
  return { ...s, up: s.back * Math.tan(3 * D) };
}
