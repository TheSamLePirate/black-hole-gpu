// PLAN-PONT-ROUTES-AAA B3 (24 Nov 2026) — a small catalogue of famous bridges, their structures drawn by bridge-notable.ts over the
// deck the scene builds (scenery-worker.ts). Neither source names a structure (OpenMapTiles' transportation has no bridge:structure,
// the BD TOPO none), so the figures are the references' — each cited —, kept to what they give:
//  - spans, heights, widths, clearances: Wikipedia's articles (their infoboxes and text) and Structurae, as fetched on 24 Nov 2026;
//    a figure one source gives and another contradicts is noted where it is used;
//  - the towers' places: NO source publishes them. They are DERIVED — from OpenStreetMap's deck geometry (its pylon vertices, its
//    anchorage nodes) or from the bridge's centre and its bearing with its main span — to about ±20–50 m, not checked against imagery:
//    the e2e's views judge them. The ends (anchorages, abutments) derived from the towers and the side spans the same way.
//  - the cables' and suspenders' diameters and spacings: commonly cited figures, not in the pages fetched (an order of size: their
//    pixel's coverage is what the eye sees of them);
//  - heights are over the mean sea level (the scene adds the geoid's N): a tower « above the water » taken as over the MSL — the high
//    tide's metre or two within the sources' own spread.
// Not catalogued: the Øresund's cable-stayed span (its pylons' places unknown), the San Francisco–Oakland Bay Bridge (centres only),
// Tower Bridge (a bascule's family the structures here do not draw).
//
// Map data © OpenStreetMap contributors (ODbL) — the derived places; figures © their sources.

import { BridgePaint, type NotableBridge } from "./bridge-notable";

export const NOTABLE_BRIDGES: NotableBridge[] = [
  {
    id: "golden-gate",
    name: "Golden Gate Bridge",
    family: "suspension",
    // (the towers derived from OSM way 537838948's deck axis about Wikipedia's centre 37.81972 N, −122.47861 ± 640 m; the anchorages the
    // side spans out — 343 m each, 1 125 ft: widely cited, not in the pages fetched)
    towers: [
      { lat: 37.81399, lon: -122.47794 },
      { lat: 37.82545, lon: -122.47928 },
    ],
    ends: [
      { lat: 37.81092, lon: -122.47758 },
      { lat: 37.82852, lon: -122.47964 },
    ],
    // (clearance 67.1 m at high tide under the truss 7.6 m deep: the roadway's crest ~77 m; OSM's deck `ele` 62.7–81.3 m)
    deckEnds: [64, 64],
    deckCrest: 77,
    deckWidth: 27.4,
    girderDepth: 7.6,
    truss: true,
    towerTop: 227,
    towerShape: "portal",
    legFoot: [16.5, 10],
    legTop: [9.5, 6],
    legOffset: 14.6,
    struts: [32, 68, 104, 142],
    cableDiameter: 0.92,
    suspenderSpacing: 15.24,
    suspenderDiameter: 0.07,
    towerPaint: BridgePaint.InternationalOrange,
    cablePaint: BridgePaint.InternationalOrange,
    girderPaint: BridgePaint.InternationalOrange,
    sources: [
      "https://en.wikipedia.org/wiki/Golden_Gate_Bridge (main span 1 280 m, towers 227 m above the water, clearance 67.1 m, width 27.4 m, International Orange)",
      "https://www.openstreetmap.org/way/537838948 (deck axis — the towers derived)",
    ],
  },
  {
    id: "pont-de-normandie",
    name: "Pont de Normandie",
    family: "cable-stayed",
    // (its pylons where OSM way 440837974's deck outline has its vertex pairs, 856 m apart — the main span; its ends Wikipedia's centre
    // 49.43226 N, 0.27403 E ± 1 070 m — 2 141 m in all, the infobox's)
    towers: [
      { lat: 49.42841, lon: 0.27457 },
      { lat: 49.43611, lon: 0.27349 },
    ],
    ends: [
      { lat: 49.42267, lon: 0.27537 },
      { lat: 49.44185, lon: 0.27269 },
    ],
    // (its ends on the banks' ground; its crest the deck's 59 m over the Seine — Structurae; Wikipedia's clearance 52 m — within the
    // drivable deck's grade the scene allows: lower where it cannot climb so far)
    deckEnds: [Number.NaN, Number.NaN],
    deckCrest: 59,
    deckWidth: 23.6,
    girderDepth: 3,
    truss: false,
    // (214.77 m in all, 155.70 m over the deck — Structurae)
    towerTop: 214.8,
    towerShape: "inverted-y",
    legFoot: [12, 8],
    legTop: [7, 5],
    legOffset: 13,
    stays: "semi-harp",
    // (184 stays — Structurae —: 23 a side in each of two planes, two pylons)
    staysPerSide: 23,
    stayPlanes: 2,
    stayDiameter: 0.2,
    towerPaint: BridgePaint.Concrete,
    cablePaint: BridgePaint.White,
    girderPaint: BridgePaint.Concrete,
    sources: [
      "https://en.wikipedia.org/wiki/Pont_de_Normandie (main span 856 m, width 23.6 m, inverted-Y pylons, length 2 141.25 m)",
      "https://structurae.net/fr/ouvrages/pont-de-normandie (pylons 214.77 m, 155.70 m above the deck; semi-harp, 184 stays)",
      "https://www.openstreetmap.org/way/440837974 (deck outline — the pylons derived)",
    ],
  },
  {
    id: "pont-de-tancarville",
    name: "Pont de Tancarville",
    family: "suspension",
    // (OSM way 568546496's outline vertex pairs 622 m apart, scaled to the 608 m main span about their middle; anchorages 176 m out —
    // Structurae's side spans)
    towers: [
      { lat: 49.47032, lon: 0.46709 },
      { lat: 49.47487, lon: 0.46241 },
    ],
    ends: [
      { lat: 49.46901, lon: 0.46844 },
      { lat: 49.47618, lon: 0.46106 },
    ],
    // (clearance 50.85 m — Structurae; 50 m — Wikipedia)
    deckEnds: [45, 47],
    deckCrest: 54,
    deckWidth: 12.5,
    girderDepth: 3,
    truss: true,
    towerTop: 123,
    towerShape: "portal",
    legFoot: [8, 6],
    legTop: [5, 4],
    legOffset: 7.5,
    struts: [28, 66],
    cableDiameter: 0.6,
    suspenderSpacing: 12,
    suspenderDiameter: 0.06,
    towerPaint: BridgePaint.Concrete,
    cablePaint: BridgePaint.DarkSteel,
    girderPaint: BridgePaint.Silver,
    sources: [
      "https://en.wikipedia.org/wiki/Pont_de_Tancarville (main span 608 m, width 12.5 m)",
      "https://structurae.net/fr/ouvrages/pont-de-tancarville (side spans 176 m, pylons 123 m, clearance 50.85 m)",
      "https://www.openstreetmap.org/way/568546496 (deck outline — the towers derived, weakly)",
    ],
  },
  {
    id: "viaduc-de-millau",
    name: "Viaduc de Millau",
    family: "cable-stayed",
    // (its seven piers derived along OSM way 440836275's curved outline at 204 + 342 (k − 1) m from its south end; its ends 204 m past
    // the first and the last — 2 460 m in all)
    towers: [
      { lat: 44.0709, lon: 3.0241 },
      { lat: 44.0739, lon: 3.0237 },
      { lat: 44.077, lon: 3.0229 },
      { lat: 44.08, lon: 3.0224 },
      { lat: 44.0831, lon: 3.022 },
      { lat: 44.0861, lon: 3.0216 },
      { lat: 44.0891, lon: 3.0213 },
    ],
    ends: [
      { lat: 44.06907, lon: 3.02434 },
      { lat: 44.09093, lon: 3.02112 },
    ],
    // (its deck from one plateau to the other — their ground —, straight between; 270 m over the Tarn on average)
    deckEnds: [Number.NaN, Number.NaN],
    deckCrest: Number.NaN,
    deckWidth: 32,
    girderDepth: 4.2,
    truss: false,
    towerTop: 0,
    // (the masts 87 m over the deck — Wikipedia)
    towerAboveDeck: 87,
    towerShape: "pier-mast",
    legFoot: [17, 9],
    legTop: [10, 4],
    legOffset: 5,
    stays: "semi-fan",
    // (« 11 pairs of stays » a mast, in one central plane — Wikipedia)
    staysPerSide: 11,
    stayPlanes: 1,
    stayDiameter: 0.25,
    stayReach: 150,
    towerPaint: BridgePaint.White,
    pierPaint: BridgePaint.Concrete,
    cablePaint: BridgePaint.White,
    girderPaint: BridgePaint.Silver,
    sources: [
      "https://en.wikipedia.org/wiki/Millau_Viaduct (2 460 m, spans 204 + 6 × 342 + 204 m, 7 piers, masts 87 m, width 32.05 m)",
      "https://www.openstreetmap.org/way/440836275 (deck outline — the piers derived)",
    ],
  },
  {
    id: "brooklyn-bridge",
    name: "Brooklyn Bridge",
    family: "suspension",
    // (the towers Wikipedia's centre 40.7057 N, −73.9964 ± 243 m along OSM way 46177152's bearing ~316°; the anchorages 283 m out — 930
    // ft side spans, a search summary's, not checked)
    towers: [
      { lat: 40.70723, lon: -73.9984 },
      { lat: 40.70407, lon: -73.99444 },
    ],
    ends: [
      { lat: 40.70907, lon: -74.00071 },
      { lat: 40.70223, lon: -73.99213 },
    ],
    // (clearance 38.7 m above the mean high water; towers 82.9 m — the infobox — or 84.8 m — the text)
    deckEnds: [30, 30],
    deckCrest: 43,
    deckWidth: 25.9,
    girderDepth: 4,
    truss: true,
    towerTop: 84,
    towerShape: "gothic",
    legFoot: [16, 12],
    legTop: [12, 9],
    legOffset: 10,
    struts: [28],
    cableDiameter: 0.4,
    suspenderSpacing: 7.6,
    suspenderDiameter: 0.05,
    towerPaint: BridgePaint.Granite,
    cablePaint: BridgePaint.Ochre,
    girderPaint: BridgePaint.Ochre,
    sources: [
      "https://en.wikipedia.org/wiki/Brooklyn_Bridge (main span 486.3 m, towers 82.9/84.8 m, clearance 38.7 m, width 25.9 m)",
      "https://www.openstreetmap.org/way/46177152 (roadway bearing — the towers derived)",
    ],
  },
  {
    id: "akashi-kaikyo",
    name: "Akashi Kaikyō Bridge",
    family: "suspension",
    // (its anchorages OSM way 400448368's end nodes, 3 952 m apart — 3 911 m stated —; its towers their middle ± 995.5 m along them)
    towers: [
      { lat: 34.60955, lon: 135.01478 },
      { lat: 34.62417, lon: 135.02736 },
    ],
    ends: [
      { lat: 34.60235, lon: 135.0086 },
      { lat: 34.63137, lon: 135.03353 },
    ],
    // (clearance 65 m under its truss, ~14 m deep; the anchorages' deck height an assumption)
    deckEnds: [50, 50],
    deckCrest: 80,
    deckWidth: 35.5,
    girderDepth: 14,
    truss: true,
    towerTop: 282.8,
    towerShape: "portal",
    legFoot: [14, 10],
    legTop: [9, 7],
    legOffset: 17,
    struts: [40, 90, 140, 190],
    cableDiameter: 1.12,
    suspenderSpacing: 14.2,
    suspenderDiameter: 0.09,
    towerPaint: BridgePaint.GreyGreen,
    cablePaint: BridgePaint.GreyGreen,
    girderPaint: BridgePaint.GreyGreen,
    sources: [
      "https://en.wikipedia.org/wiki/Akashi_Kaiky%C5%8D_Bridge (main span 1 991 m, side spans 960 m, towers 282.8 m above sea level, clearance 65 m, width 35.5 m)",
      "https://www.openstreetmap.org/way/400448368 (anchorage nodes — the towers derived)",
    ],
  },
];
