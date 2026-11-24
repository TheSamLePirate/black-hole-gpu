// The traffic's focus (Sam, 24 Nov 2026: « les avions et les bateaux toujours actifs, même en caméra libre sans appareil »):
// the one place about which the real traffic is asked (traffic/feed.ts) and the sea's own life made (game/seasim.ts) — the
// flown craft while one is flown and the view is by it; else the view's own eye, from its final pose (the free camera, a
// spectator gone far from the craft, the camera following an airliner or a ship, a tour, a tripod). Pure: main.ts hands it,
// each frame, the craft's and the view's geodetic places (camera.geoNow(): WGS84, the height over the sea — h − N).
//
// - Far from the Earth (no place over it) nothing; the view's own focus off above 160 km, on again under 140 km (a voyage
//   out and back does not flicker it).
// - The view chosen over the flown craft once it is 60 km from it, the craft again under 40 km.
// - Its centre moved only when what it follows has gone a quarter of its radius from it (a free camera flown fast asks
//   no new place each frame — the relay's tiles are half a degree), or its radius changed by a fifth; a move of half its
//   radius or more (a jump: a teleport, a voyage, the view gone from the craft to elsewhere) counted in `jumps`, the feed
//   asking the new place at once (within its own pace — FEED.jumpGap).
// - Its radii by its height: the air's 120 km low down (the overlay's lights reach 80 km), up to 160 km from 15 km up —
//   the horizon farther, the relay's 250 km limit far off; the sea's 60 km, up to 90 km.

/** A place over the Earth: geodetic latitude, longitude [°] (WGS84), its height over the sea [m] (camera.geoNow's). */
export interface FocusGeo {
  lat: number;
  lon: number;
  alt: number;
}

/** The traffic's focus: where it is centred, its radii [km], whom it follows, its jumps so far (a counter). */
export interface Focus extends FocusGeo {
  airR: number;
  seaR: number;
  who: "craft" | "view";
  jumps: number;
}

export const FOCUS = {
  /** the view's own focus off above this height [m], on again under that */
  viewOff: 160_000,
  viewOn: 140_000,
  /** the view preferred to the flown craft this far from it [m]; the craft again under this */
  toView: 60_000,
  toCraft: 40_000,
  /** re-centred once moved this share of its radius; a jump from this share */
  recentre: 0.25,
  jump: 0.5,
  /** a radius changed by more than this ratio: re-centred */
  rStep: 1.2,
  /** the radii [km]: the air's, the sea's — at least, at most, their share of the horizon's distance */
  airMin: 120,
  airMax: 160,
  airK: 0.4,
  seaMin: 60,
  seaMax: 90,
  seaK: 0.25,
} as const;

const D = Math.PI / 180;
/** the WGS84 semi-major axis [m] (the horizon's distance), the mean radius [m] (a distance over the surface: a few tens of
 *  kilometres, flat-scale — no height is taken from it) */
const A = 6_378_137;
const RM = 6_371_008.8;

/** The distance to the horizon from a height [m] over the sea [km]. */
export function horizonKm(alt: number): number {
  const h = Math.max(0, alt);
  return Math.sqrt(2 * A * h + h * h) / 1e3;
}

/** The radii [km] asked about a place at a height [m]. */
export function radiiFor(alt: number): { airR: number; seaR: number } {
  const H = horizonKm(alt);
  return {
    airR: Math.round(Math.min(FOCUS.airMax, Math.max(FOCUS.airMin, FOCUS.airK * H))),
    seaR: Math.round(Math.min(FOCUS.seaMax, Math.max(FOCUS.seaMin, FOCUS.seaK * H))),
  };
}

/** The distance along the surface between two places [m] (the haversine's, on the mean sphere: a distance, never a height). */
export function surfaceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const s1 = Math.sin(((b.lat - a.lat) * D) / 2),
    s2 = Math.sin(((b.lon - a.lon) * D) / 2);
  const h = s1 * s1 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * s2 * s2;
  return 2 * RM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface FocusInput {
  /** the traffic wanted (the setting on, no title screen over the game) */
  on: boolean;
  /** the flown craft over the Earth (null: none flown, or not by the Earth) */
  craft: FocusGeo | null;
  /** the view's eye over the Earth, from its final pose (null: not by the Earth) */
  view: FocusGeo | null;
}

export class TrafficFocus {
  /** the focus now (null: none — off, far from the Earth) */
  now: Focus | null = null;
  /** the place followed now, whether the traffic is on or not (the sea's own life — seatraffic.ts — is made about it) */
  here: FocusGeo | null = null;
  /** the re-centrings so far (a meter: a free camera flown fast must not make one each frame) */
  moves = 0;
  private high = false;
  private jumps = 0;
  private who: Focus["who"] | null = null;

  /** A frame: the focus chosen, re-centred when it has gone far enough. */
  update(i: FocusInput): Focus | null {
    const v = i.view;
    if (v) this.high = this.high ? v.alt > FOCUS.viewOn : v.alt > FOCUS.viewOff;
    const view = v && !this.high ? v : null;
    let who: Focus["who"] | null = null;
    if (i.craft) who = view && surfaceM(i.craft, view) > (this.who === "view" ? FOCUS.toCraft : FOCUS.toView) ? "view" : "craft";
    else if (view) who = "view";
    this.who = who;
    const at = who === "craft" ? i.craft : who === "view" ? view : null;
    this.here = at;
    if (!i.on || !at || !who) {
      this.now = null;
      return null;
    }
    const R = radiiFor(at.alt);
    const c = this.now;
    const moved = c ? surfaceM(c, at) : Infinity;
    if (
      !c ||
      c.who !== who ||
      moved > FOCUS.recentre * c.airR * 1e3 ||
      R.airR > c.airR * FOCUS.rStep ||
      R.airR * FOCUS.rStep < c.airR ||
      R.seaR > c.seaR * FOCUS.rStep ||
      R.seaR * FOCUS.rStep < c.seaR
    ) {
      if (c && moved > FOCUS.jump * c.airR * 1e3) this.jumps++;
      this.moves++;
      this.now = { lat: at.lat, lon: at.lon, alt: at.alt, airR: R.airR, seaR: R.seaR, who, jumps: this.jumps };
    }
    return this.now;
  }
}
