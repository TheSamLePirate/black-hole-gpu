// The F-35's fights (docs/PLAN-F35.md, F10): each over a real range of the Mojave — the R-2508 complex round
// Edwards and China Lake —, its anchor (the local frame's origin), the player's start in it, its loadout, its
// targets (game/combat.ts). Won when every target that counts is destroyed; lost when the player is.

import type { Text } from "../i18n";
import type { Loadout, TargetSpec } from "./combat";

export interface Scenario {
  id: string;
  title: Text;
  brief: Text;
  /** the frame's origin: latitude, longitude [°] */
  anchor: { lat: number; lon: number };
  /** the player's start: east, north [m] from the anchor, its height over the ground [m], heading [°], speed [m/s] */
  start: { e: number; n: number; agl: number; hdg: number; speed: number };
  loadout: Loadout["id"];
  targets: TargetSpec[];
  /** a time limit [s] */
  limit: number;
  /** a mission's fight (controller/mission.ts): won or lost by its objectives, not by its targets all down */
  mission?: boolean;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "drones",
    title: { fr: "Chasse aux drones", en: "Drone hunt" },
    brief: {
      fr: "Cinq drones cibles au-dessus du lac Rogers. Radar (Tab), AIM-120 au-delà de 15 km, AIM-9X de près, canon (Ctrl) pour finir.",
      en: "Five target drones over Rogers Dry Lake. Radar (Tab), AIM-120 beyond 15 km, AIM-9X close in, the gun (Ctrl) to finish.",
    },
    anchor: { lat: 34.95, lon: -117.8 },
    start: { e: -30_000, n: -22_000, agl: 4500, hdg: 50, speed: 240 },
    loadout: "aa",
    targets: [
      { kind: "drone", at: [0, 0, 4000], hdg: 90, name: "BQM-1" },
      { kind: "drone", at: [6000, 4000, 3000], hdg: 200, name: "BQM-2" },
      { kind: "drone", at: [-5000, 7000, 5500], hdg: 30, name: "BQM-3" },
      { kind: "drone", at: [9000, -6000, 2500], hdg: 300, name: "BQM-4" },
      { kind: "drone", at: [14_000, 9000, 6000], hdg: 160, speed: 160, name: "BQM-5" },
    ],
    limit: 600,
  },
  {
    id: "guns",
    title: { fr: "Duel au canon", en: "Guns only" },
    brief: {
      fr: "Un contre un au-dessus de la vallée de Panamint, au canon seul : l'agresseur tourne serré et tire. Ne restez pas devant lui.",
      en: "One against one over the Panamint Valley, guns only: the aggressor turns hard and shoots. Don't stay before its nose.",
    },
    anchor: { lat: 36.1, lon: -117.25 },
    start: { e: 0, n: -9000, agl: 4000, hdg: 0, speed: 250 },
    loadout: "gun",
    targets: [{ kind: "fighter", at: [1500, 9000, 4200], hdg: 180, speed: 250, name: "BANDIT" }],
    limit: 420,
  },
  {
    id: "bvr",
    title: { fr: "Interception à deux contre un", en: "Two-ship intercept" },
    brief: {
      fr: "Deux agresseurs armés de missiles infrarouges arrivent du nord. Tirez au-delà de leur portée, leurrez (−) ce qui vous poursuit.",
      en: "Two aggressors with infrared missiles inbound from the north. Shoot beyond their reach, decoy (−) what chases you.",
    },
    anchor: { lat: 35.75, lon: -117.6 },
    start: { e: 0, n: -40_000, agl: 7000, hdg: 0, speed: 260 },
    loadout: "aa",
    targets: [
      { kind: "fighter", at: [-3000, 30_000, 7000], hdg: 180, speed: 260, name: "BANDIT 1" },
      { kind: "fighter", at: [4000, 34_000, 6500], hdg: 180, speed: 260, name: "BANDIT 2" },
    ],
    limit: 600,
  },
  {
    id: "strike",
    title: { fr: "Frappe au sol", en: "Ground strike" },
    brief: {
      fr: "Un site SA-11, ses camions, un bunker près de China Lake. Volez bas sous son radar (150 m), larguez les JDAM (Entrée) sur le verrou.",
      en: "An SA-11 site, its trucks, a bunker near China Lake. Fly low under its radar (150 m), release the JDAMs (Enter) on the lock.",
    },
    anchor: { lat: 35.68, lon: -117.75 },
    start: { e: -2000, n: -45_000, agl: 600, hdg: 5, speed: 240 },
    loadout: "ag",
    targets: [
      { kind: "sam", at: [0, 0, 0], name: "SA-11" },
      { kind: "truck", at: [120, 80, 0], name: "TEL 1" },
      { kind: "truck", at: [-150, 60, 0], name: "TEL 2" },
      { kind: "bunker", at: [1800, -900, 0], name: "BUNKER" },
    ],
    limit: 600,
  },
  {
    // (the war mode — Sam, 6 Nov 2026 —: the National Training Center's range at Fort Irwin, where armour trains: an armoured
    // column on its road, two SA-11 batteries covering it — their launchers' turrets turning onto the jet, their missiles
    // leaving the rails —, the trucks of its supply, two bunkers)
    id: "war",
    title: { fr: "Guerre : colonne blindée", en: "War: armoured column" },
    brief: {
      fr: "Une colonne de chars, ses camions et ses bunkers sur le champ de tir de Fort Irwin, sous la protection de deux batteries SA-11. Restez sous 150 m pour leur échapper, détruisez les lanceurs d'abord, puis la colonne aux JDAM.",
      en: "A column of tanks, its trucks and bunkers on the Fort Irwin range, covered by two SA-11 batteries. Stay under 150 m to slip them, kill the launchers first, then the column with the JDAMs.",
    },
    anchor: { lat: 35.3, lon: -116.62 },
    start: { e: -6000, n: -38_000, agl: 400, hdg: 10, speed: 230 },
    loadout: "ag",
    targets: [
      { kind: "sam", at: [-2500, 3000, 0], hdg: 190, name: "SA-11 NORTH" },
      { kind: "sam", at: [3200, -1500, 0], hdg: 220, name: "SA-11 EAST" },
      ...[0, 1, 2, 3, 4, 5].map((k) => ({
        kind: "tank" as const,
        at: [-400 + 22 * k, -1200 + 60 * k, 0] as [number, number, number],
        hdg: 20,
        name: `TANK ${k + 1}`,
      })),
      ...[0, 1, 2, 3].map((k) => ({
        kind: "truck" as const,
        at: [-480 + 18 * k, -1500 - 45 * k, 0] as [number, number, number],
        hdg: 20,
        name: `TRUCK ${k + 1}`,
      })),
      { kind: "bunker", at: [900, 1800, 0], hdg: 180, name: "BUNKER 1" },
      { kind: "bunker", at: [1100, 1650, 0], hdg: 180, name: "BUNKER 2" },
    ],
    limit: 900,
  },
  {
    // (the war mode's airfield — Sam, 6 Nov 2026: « des bâtiments à détruire, des aéroports » —: Bicycle Lake Army Airfield in
    // the Fort Irwin range, its hardened shelters in a row, its tower, its fuel farm, an SA-11 battery covering it — the
    // bombs' craters left on the ground)
    id: "war-airbase",
    title: { fr: "Guerre : base aérienne", en: "War: airbase" },
    brief: {
      fr: "La base de Bicycle Lake, ses abris durcis, sa tour, ses réserves de carburant, défendue par une batterie SA-11. Neutralisez le lanceur, puis détruisez abris, tour et carburant aux JDAM.",
      en: "Bicycle Lake airbase, its hardened shelters, its tower, its fuel farm, defended by an SA-11 battery. Take out the launcher, then destroy the shelters, the tower and the fuel with the JDAMs.",
    },
    anchor: { lat: 35.2803, lon: -116.6291 },
    start: { e: 3000, n: -32_000, agl: 500, hdg: 355, speed: 230 },
    loadout: "ag",
    targets: [
      { kind: "sam", at: [1800, 2200, 0], hdg: 200, name: "SA-11" },
      ...[0, 1, 2].map((k) => ({
        kind: "bunker" as const,
        at: [-700 + 45 * k, 420, 0] as [number, number, number],
        hdg: 180,
        name: `SHELTER ${k + 1}`,
        mesh: "gu-has",
      })),
      { kind: "bunker", at: [250, 260, 0], hdg: 180, name: "TOWER", mesh: "gu-tower" },
      { kind: "bunker", at: [-1000, -350, 0], hdg: 0, name: "FUEL 1", mesh: "gu-fuel" },
      { kind: "bunker", at: [-975, -385, 0], hdg: 0, name: "FUEL 2", mesh: "gu-fuel" },
      { kind: "truck", at: [-860, -300, 0], hdg: 90, name: "TANKER TRUCK" },
    ],
    limit: 900,
  },
];
