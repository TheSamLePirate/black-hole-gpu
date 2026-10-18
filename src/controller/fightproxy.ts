// The free fight's outside craft (docs/PLAN-AVIATION-AAA.md — a room's F-35s, ui/netmatch.ts's free fight): every
// craft the radar sees may be shot — the real airliners (trf:), the ships (ais:), the carriers and their escorts
// (cv:), another player's AI wingmen (rwg:). The one locked, and any within 6 km (the gun's), is taken into the
// fight's world as a target standing in for it — a proxy: placed each frame where the radar's picture has it (from
// our own place in the fight's frame), not flown by the fight, not drawn while alive (its own drawing is). Hit, it
// takes the damage; destroyed, the real one is gone (the traffic taken, the ship sunk, the carrier struck) and its
// wreck is the fight's — the room told, each page hiding it too. Our own AI wingmen are the world's already (wng:).
// (Plain functions on the controller: called by controller/combat.ts and controller/radar.ts.)
import type { V3 } from "../game/combat";
import type { CameraController } from "../controls";

/** The radar ids that stand for an outside craft. */
const PROXY = /^(trf|ais|cv|rwg):/;
/** taken in within this range [m] (the gun's reach and some), the lock at any range */
const NEAR = 6000;

declare module "../controls" {
  interface CameraController {
    /** a real ship sunk in a fight (its AIS id): not drawn again */
    seaTaken?: Set<string>;
    /** an outside craft destroyed (its radar id, its name; by us): the room told (ui/netmatch.ts) */
    onProxyDown?: (key: string, name: string) => void;
    /** an outside craft hit by us (another's wingman: the hit his — ui/netmatch.ts) */
    onProxyHit?: (key: string, damage: number, by: string) => void;
  }
}

/** The fight's world id a radar track stands for (its own targets, our wingmen, a proxy), or null. */
export function worldIdOf(c: CameraController, track: string | null): number | null {
  if (!track) return null;
  const C = c.combat;
  if (!C) return null;
  if (track.startsWith("cmb:")) return Number(track.slice(4));
  // (our own wingmen: the world's 20 000 + their number — game/combat.ts setWingmen)
  if (track.startsWith("wng:")) {
    const id = 20_000 + Number(track.slice(4));
    return C.world.target(id) ? id : null;
  }
  return C.proxies?.get(track) ?? null;
}

/**
 * A frame of the free fight's proxies: the outside craft wanted (the lock, those near) taken in, the others' places
 * set from the radar's picture, those gone dropped (a wreck left to fall).
 */
export function proxyStep(c: CameraController) {
  const C = c.combat;
  const P = C?.last;
  if (!C?.free || !P) return;
  const W = C.world;
  const M = (C.proxies ??= new Map());
  const objs = new Map(c.radarObjects.filter((o) => PROXY.test(o.id)).map((o) => [o.id, o]));
  const want = new Set<string>();
  const lock = c.radar.lock;
  if (lock && objs.has(lock)) want.add(lock);
  for (const o of objs.values()) if (Math.hypot(...o.r) < NEAR) want.add(o.id);
  for (const key of new Set([...want, ...M.keys()])) {
    const id = M.get(key);
    const q = id !== undefined ? W.target(id) : undefined;
    // (a wreck falls on its own; its source gone with it)
    if (q && !q.alive) continue;
    const o = objs.get(key);
    if (!o) {
      if (q) W.targets = W.targets.filter((x) => x !== q);
      M.delete(key);
      continue;
    }
    const p: V3 = [P.p[0] + o.r[0], P.p[1] + o.r[1], P.p[2] + o.r[2]];
    const v: V3 = [o.v[0], o.v[1], o.v[2]];
    const sp = Math.hypot(v[0], v[1], v[2]);
    const fwd: V3 = sp > 1 ? [v[0] / sp, v[1] / sp, v[2] / sp] : q ? q.fwd : [0, 1, 0];
    if (!q) {
      if (!want.has(key)) continue;
      const sea = o.kind === "sea";
      const nid = W.addTarget({
        kind: sea ? "ship" : "airliner",
        at: [p[0], p[1], 0],
        hdg: (Math.atan2(fwd[0], fwd[1]) * 180) / Math.PI,
        speed: sp,
        name: o.name,
        mesh: key.startsWith("trf:")
          ? (c.trafficNow().find((x) => `trf:${x.id}` === key)?.mesh ?? undefined)
          : key.startsWith("rwg:")
            ? "f35"
            : undefined,
      });
      const t = W.target(nid)!;
      t.proxy = key;
      t.neutral = o.iff !== "hostile";
      // (a ship taken in fires nothing back: its SAMs the frigates' own in a mission)
      t.site = undefined;
      // (a carrier: as hard to sink as five of the others)
      if (key.startsWith("cv:") && !key.includes(":esc")) t.hp *= 5;
      M.set(key, nid);
      Object.assign(t, { p, v, fwd });
      continue;
    }
    q.p = p;
    q.v = v;
    q.fwd = fwd;
    q.up = [0, 0, 1];
  }
}

/** An outside craft destroyed: the real one gone from this page (the traffic taken, the ship sunk, the carrier
 *  struck — its escorts the radar's still). */
export function proxyGone(c: CameraController, key: string) {
  if (key.startsWith("trf:")) (c.trafficTaken ??= new Set()).add(key.slice(4));
  else if (key.startsWith("ais:")) (c.seaTaken ??= new Set()).add(key.slice(4));
  else if (key.startsWith("cv:") && !key.includes(":esc")) {
    const kind = key.slice(3);
    c.carriers = (c.carriers ?? []).filter((x) => x.kind !== kind);
  }
}
