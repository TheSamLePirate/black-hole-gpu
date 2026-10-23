// The CameraController — what the replay's tape keeps of the flown craft each frame (game/replay.ts, S3): where it is
// on the WGS84 Earth (body-fixed metres), its axes on the local east, north, up, its height over the ground, its
// speed, Mach and load; what it does (the gun, the afterburner, a touchdown, wingmen close). The launches and the
// explosions the fight's events (main.ts adds them).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { isAircraft } from "../vessels";
import { EV, type TapeSample, type V3 } from "../game/replay";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { toBodyFixed } from "../system/our-surface";
import { M_METRES } from "../units";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    replaySample: typeof replaySample;
    replayEvents: typeof replayEvents;
  }
}

/** The flown craft for the tape, near the Earth (else null). */
function replaySample(this: CameraController): TapeSample | null {
  if (!this.piloting) return null;
  const cam = cameraFrame(this.s);
  const nav = this.ourNav(cam);
  const fr = this.sfFrame(cam);
  if (!nav || nav.ref !== "earth" || !fr) return null;
  const q = toBodyFixed("earth", nav.X, nav.t);
  const p: V3 = [q[0] * M_METRES, q[1] * M_METRES, q[2] * M_METRES];
  const g = cartToGeodetic(WGS84_A, WGS84_F, p);
  const d = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const ax = this.shipAxesLocal(cam)
    .map((a) => fr.fromLocal(a))
    .map((a) => [d(a, fr.east), d(a, fr.north), d(a, fr.up)] as V3) as [V3, V3, V3];
  const air = this.airInfo();
  return {
    p,
    ax,
    lat: (g.lat * 180) / Math.PI,
    lon: (g.lon * 180) / Math.PI,
    alt: g.h,
    agl: this.aglNow(cam, g.h),
    speed: air.speed || Math.hypot(...(fr.vRel as V3)),
    mach: air.mach,
    nz: air.nz,
  };
}

/** What the craft does this frame (EV bits): the gun, the afterburner, a touchdown after a flight, wingmen close. */
function replayEvents(this: CameraController): number {
  let ev = 0;
  const W = this.combat?.world;
  if (W?.firing && W.stores.gun > 0) ev |= EV.FIRE;
  if (this.jetThrust() > 1.01) ev |= EV.AB;
  if ((this.wing?.list ?? []).some((w) => w.alive && w.dist < 40)) ev |= EV.FORM;
  const contact = (this.gearLast?.contact ?? 0) > 0;
  const now = performance.now();
  if (!contact) this.replayAir ??= now;
  else {
    // (on the ground after 3 s in the air: a touchdown, a trap)
    if (this.replayAir !== null && now - this.replayAir > 3000) ev |= EV.TOUCH;
    this.replayAir = null;
  }
  // (a spacecraft's moments — X7: a docking's capture, a burn begun)
  const links = fleet.links.length;
  if (this.replayLinks !== null && links > this.replayLinks) ev |= EV.DOCK;
  this.replayLinks = links;
  const lit = !isAircraft(fleet.active) && this.pilot.engineNow > 0.3;
  if (lit && !this.replayLit) ev |= EV.BURN;
  this.replayLit = lit;
  return ev;
}

export function installReplay(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { replaySample, replayEvents });
}
