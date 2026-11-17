// PLAN-J8 J8-A — the demonstration's tracks (Sam, 16 Nov 2026: « un vol au-dessus de Paris et au-dessus de Toulon-Hyères avec un max
// de buildings, tous chargés avant le vol, en jour et nuit »; ~17:18 UTC « ok couloir »: the zone a corridor along the track). One
// authority for both readers: the e2e that flies them (it never leaves the corridor) and zones.add (the corridor's fine levels 1–2 km
// wide, « overflight » elsewhere, the far cells to 20 km — PLAN-J8 J8-9 (2)). Positions WGS84 geodetic [°]; heights over the sea
// (MSL — the autopilots' holds, geoNow().alt), never over the ellipsoid; speeds true airspeed [m/s].

export interface J8ATrack {
  /** its name: the e2e's and the zone's */
  name: string;
  /** what it shows */
  label: string;
  /** its points, flown in order: [lat °, lon °, altitude over the sea m] */
  points: readonly (readonly [number, number, number])[];
  /** the speed it is flown at [m/s] */
  speedMps: number;
  /** the corridor's half-width for the fine levels [m] (Sam: 1–2 km wide) */
  halfWidthM: number;
  /** the hours it is flown at (UTC): by day, by night */
  dates: { day: string; night: string };
}

export const J8A_TRACKS: readonly J8ATrack[] = [
  {
    name: "paris",
    label: "Paris le long de la Seine : Saint-Germain, la Défense, la tour Eiffel, Notre-Dame, Bercy, puis Montmartre",
    points: [
      [48.898, 2.095, 600],
      [48.892, 2.236, 550],
      [48.858, 2.294, 500],
      [48.853, 2.35, 500],
      [48.835, 2.39, 500],
      [48.886, 2.343, 550],
    ],
    speedMps: 120,
    halfWidthM: 1000,
    dates: { day: "2026-07-10T13:30:00Z", night: "2026-07-10T21:30:00Z" },
  },
  {
    name: "toulon-hyeres",
    label: "Hyères et Toulon : de Hyères-le-Palyvestre par Hyères et La Crau, Toulon, la rade, puis La Seyne",
    points: [
      [43.097, 6.146, 500],
      [43.12, 6.13, 500],
      [43.13, 6.07, 500],
      [43.125, 5.98, 500],
      [43.125, 5.93, 500],
      [43.1, 5.93, 500],
      [43.1, 5.88, 500],
    ],
    // (100 m/s: the autopilot banks 25° at most — jetmodes.ts —, a turn ~2.2 km round; at 150 m/s ~4.9 km, the rade's two right-angle
    // corners 2.8 km apart cut ~2 km inside, off the corridor's 1 km — J8-A flown, 17 Nov 2026: its last legs off the zone)
    speedMps: 100,
    halfWidthM: 1000,
    dates: { day: "2026-07-10T13:30:00Z", night: "2026-07-10T21:00:00Z" },
  },
];

/** a track by its name */
export function j8aTrack(name: string): J8ATrack {
  const t = J8A_TRACKS.find((k) => k.name === name);
  if (!t) throw new Error(`j8a-tracks: no track "${name}"`);
  return t;
}
