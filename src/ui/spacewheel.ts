// The spacecraft's wheel (PLAN-VAISSEAUX X5): Tab held in the Ranger, the Lander, the Endurance — the F-35 has its
// own (main.ts jetWheel). Built from what the craft is and does now (its holds, its autopilots, its systems, its
// docking, its fleet), each craft its own: the Endurance's ring, the Lander's descent, the Ranger's aircraft entries
// only while it flies as a plane. Pure: the state and the actions in, the wheel's items out (ui/wheel.ts draws them).

import type { VesselId } from "../vessels";
import type { Auto, Hold } from "../pilot";
import type { WheelItem } from "./wheel";

export type SpaceAssistLevel = "manual" | "realistic" | "assisted" | "beginner";
export type ComputerTab = "orbit" | "target" | "land" | "mission";

/** What the wheel reads of the flight now. */
export interface SpaceWheelState {
  vessel: Exclude<VesselId, "f35">;
  /** the Ranger flown as a plane in the air (its aircraft entries back) */
  planeMode: boolean;
  /** the craft lands (the Lander, the Ranger): its gear, its descent */
  lands: boolean;
  sas: boolean;
  hold: Hold;
  auto: Auto;
  docked: boolean;
  rcsTranslate: boolean;
  gearDown: boolean;
  navLights: boolean;
  landingLights: boolean;
  /** the mission plan's burns */
  nodes: number;
  mapOpen: boolean;
  /** the Endurance's ring [rpm] (null: no ring) */
  ringRpm: number | null;
  /** the craft one can fly instead (the fleet's: docked to us, or near) */
  vessels: { id: VesselId; name: string }[];
  assist: SpaceAssistLevel;
  /** failures under way (X3) */
  failures: number;
  course: boolean;
  challenge: boolean;
  mission: boolean;
  route: boolean;
  ils: boolean;
}

/** What its items do (main.ts's). */
export interface SpaceWheelActions {
  sas(): void;
  hold(h: Hold): void;
  auto(a: Auto): void;
  keep(): void;
  undock(): void;
  refuel(): void;
  recover(): void;
  computer(tab: ComputerTab): void;
  missionPlan(): void;
  execute(): void;
  gear(): void;
  lights(which: "nav" | "landing"): void;
  rcsMode(): void;
  systems(): void;
  ack(): void;
  ring(dir: 1 | -1): void;
  nextTarget(): void;
  vessel(id: VesselId): void;
  map(): void;
  place(): void;
  assist(level: SpaceAssistLevel): void;
  flightMode(): void;
  hudKind(): void;
  precision(): void;
  school(): void;
  challenges(): void;
  missions(): void;
  nextView(): void;
  photo(): void;
  replay(trailer: boolean): void;
  route(): void;
  missionMap(): void;
  ilsToggle(): void;
  hub(): void;
}

const HOLDS: [Hold, string, string, string][] = [
  ["prograde", "Prograde", "Prograde", "1"],
  ["retrograde", "Rétrograde", "Retrograde", "2"],
  ["radialOut", "Radial extérieur", "Radial out", "3"],
  ["radialIn", "Radial intérieur", "Radial in", "4"],
  ["normal", "Normal", "Normal", "5"],
  ["antinormal", "Anti-normal", "Anti-normal", "6"],
  ["target", "Vers la cible", "To the target", "7"],
  ["antiTarget", "Dos à la cible", "Away from the target", ""],
  ["maneuver", "Nœud de manœuvre", "Manoeuvre node", ""],
];

const ASSISTS: [SpaceAssistLevel, string, string, string, string][] = [
  ["manual", "Manuel", "Manual", "Pas de SAS : la rotation garde son élan", "No SAS: the turn keeps going"],
  ["realistic", "Réaliste", "Realistic", "Le SAS du pilote (T)", "The pilot's SAS (T)"],
  ["assisted", "Assisté", "Assisted", "SAS toujours, la dérive tenue près d'une cible", "SAS always, the drift held near a target"],
  ["beginner", "Débutant", "Beginner", "Le même, des rotations douces, pas de pannes", "The same, gentle turns, no failures"],
];

/** The wheel of a spacecraft. */
export function spaceWheel(S: SpaceWheelState, A: SpaceWheelActions): WheelItem[] {
  const auto = (a: Auto, fr: string, en: string, key?: string, hint?: [string, string]): WheelItem => ({
    label: { fr, en },
    ...(key ? { key } : {}),
    on: S.auto === a,
    run: () => A.auto(a),
    ...(hint ? { hint: { fr: hint[0], en: hint[1] } } : {}),
  });
  const endurance = S.vessel === "endurance";
  const items: WheelItem[] = [
    { label: { fr: "SAS", en: "SAS" }, key: "T", on: S.sas, run: A.sas },
    // (the nine holds and manual)
    {
      label: { fr: "Maintiens", en: "Holds" },
      on: S.hold !== "none",
      sub: [
        ...HOLDS.map(([h, fr, en, key]) => ({ label: { fr, en }, ...(key ? { key } : {}), on: S.hold === h, run: () => A.hold(h) })),
        { label: { fr: "Manuel", en: "Manual" }, on: S.hold === "none", run: () => A.hold("none") },
      ],
    },
    // (every autopilot the craft has: the Endurance neither lands nor takes off)
    {
      label: { fr: "Autopilotes", en: "Autopilots" },
      on: S.auto !== "none",
      sub: [
        auto("circularize", "Circulariser", "Circularize", "9"),
        auto("node", "Exécuter le nœud", "Execute the node", undefined, ["La prochaine poussée du plan", "The plan's next burn"]),
        auto("transfer", "Transfert", "Transfer"),
        auto("approach", "Approche", "Approach", "0"),
        auto("orbit", "Orbiter la cible", "Orbit the target", "⇧0"),
        {
          label: { fr: "Rendez-vous et amarrage", en: "Rendezvous & docking" },
          key: "B",
          on: S.auto === "dock",
          hint: {
            fr: "Au-delà de 3 km : le rendez-vous planifié, puis l'amarrage",
            en: "Beyond 3 km: the rendezvous planned, then docked",
          },
          run: () => A.auto("dock"),
        },
        { label: { fr: "Maintien à poste", en: "Station keeping" }, key: "⇧8", on: S.auto === "keep", run: A.keep },
        ...(S.lands
          ? [
              auto("hover", "Stationnaire", "Hover", "8"),
              auto("land", "Descente et atterrissage", "Descent & landing", "F7"),
              auto("takeoff", "Décoller vers l'orbite", "Take off to orbit", "U"),
            ]
          : []),
        ...(S.vessel === "ranger" ? [auto("entry", "Rentrée", "Entry", "⇧G")] : []),
        { label: { fr: "Coupé", en: "Off" }, on: S.auto === "none", run: () => A.auto("none") },
      ],
    },
    // (the flight computer: its tabs, the mission plan, the next burn flown)
    {
      label: { fr: "Ordinateur de vol", en: "Flight computer" },
      on: S.nodes > 0,
      sub: [
        { label: { fr: "ORBITE", en: "ORBIT" }, run: () => A.computer("orbit") },
        { label: { fr: "CIBLE", en: "TARGET" }, run: () => A.computer("target") },
        ...(S.lands ? [{ label: { fr: "ATTERRIR", en: "LAND" }, run: () => A.computer("land") }] : []),
        { label: { fr: "MISSION", en: "MISSION" }, run: () => A.computer("mission") },
        { label: { fr: "Plan de mission", en: "Mission plan" }, key: "⇧O", on: S.nodes > 0, run: A.missionPlan },
        ...(S.nodes > 0
          ? [{ label: { fr: "Exécuter", en: "Execute" }, on: S.auto === "node" || S.auto === "transfer", run: A.execute }]
          : []),
      ],
    },
    // (the systems: the gear, the lights, the RCS's mode, the X3 page, the alarm, the ring)
    {
      label: { fr: "Systèmes", en: "Systems" },
      on: S.failures > 0 || S.rcsTranslate,
      sub: [
        {
          label: { fr: "Mode RCS (translation)", en: "RCS mode (translation)" },
          key: "⇧9",
          on: S.rcsTranslate,
          run: A.rcsMode,
        },
        {
          label: {
            fr: S.failures ? `Systèmes · ${S.failures} panne(s)` : "Systèmes",
            en: S.failures ? `Systems · ${S.failures} failure(s)` : "Systems",
          },
          hint: { fr: "Énergie, oxygène, pannes et checklists", en: "Power, oxygen, failures and checklists" },
          on: S.failures > 0,
          run: A.systems,
        },
        { label: { fr: "Acquitter l'alarme", en: "Acknowledge the alarm" }, run: A.ack },
        { label: { fr: "Stopper la rotation", en: "Stop the tumble" }, key: "⇧X", run: A.recover },
        ...(S.lands ? [{ label: { fr: "Train", en: "Gear" }, key: "G", on: S.gearDown, run: A.gear }] : []),
        ...(S.vessel === "ranger"
          ? [
              { label: { fr: "Feux de navigation", en: "Navigation lights" }, on: S.navLights, run: () => A.lights("nav") },
              { label: { fr: "Phares", en: "Landing lights" }, on: S.landingLights, run: () => A.lights("landing") },
            ]
          : []),
        ...(endurance && S.ringRpm !== null
          ? [
              {
                label: { fr: `Anneau + (${S.ringRpm.toFixed(1)} tr/min)`, en: `Ring + (${S.ringRpm.toFixed(1)} rpm)` },
                key: "⇧]",
                run: () => A.ring(1),
              },
              { label: { fr: "Anneau −", en: "Ring −" }, key: "⇧[", run: () => A.ring(-1) },
            ]
          : []),
      ],
    },
    // (docking: the port, the target, keeping station, the propellant)
    {
      label: { fr: "Amarrage", en: "Docking" },
      on: S.docked || S.auto === "dock" || S.auto === "keep",
      sub: [
        ...(S.docked
          ? [
              { label: { fr: "Désamarrer", en: "Undock" }, run: A.undock },
              { label: { fr: "Faire le plein", en: "Refuel" }, run: A.refuel },
              {
                label: { fr: "Désamarrer et tenir à 30 m", en: "Undock, hold 30 m off" },
                key: "⇧8",
                run: A.keep,
              },
            ]
          : [
              { label: { fr: "Amarrer", en: "Dock" }, key: "B", on: S.auto === "dock", run: () => A.auto("dock") },
              { label: { fr: "Maintien à poste", en: "Station keeping" }, key: "⇧8", on: S.auto === "keep", run: A.keep },
            ]),
        { label: { fr: "Cible suivante", en: "Next target" }, key: "Tab", run: A.nextTarget },
      ],
    },
    // (the fleet: the craft one can fly instead — the room's orders come with the network's phase)
    {
      label: { fr: "Flotte", en: "Fleet" },
      sub: S.vessels.map((v) => ({ label: { fr: v.name, en: v.name }, on: v.id === S.vessel, run: () => A.vessel(v.id) })),
    },
    {
      label: { fr: "Navigation", en: "Navigation" },
      on: S.mapOpen || S.route || S.ils,
      sub: [
        { label: { fr: "Carte", en: "Map" }, key: "M", on: S.mapOpen, run: A.map },
        { label: { fr: "Placer", en: "Place" }, run: A.place },
        { label: { fr: "Cible suivante", en: "Next target" }, key: "Tab", run: A.nextTarget },
        // (the aircraft's ways: only while the Ranger flies as a plane)
        ...(S.planeMode
          ? [
              { label: { fr: "Plan de vol", en: "Flight plan" }, on: S.route, run: A.route },
              { label: { fr: "Carte de mission", en: "Mission map" }, on: S.mission, run: A.missionMap },
              { label: { fr: "Approche ILS", en: "ILS approach" }, on: S.ils, run: A.ilsToggle },
              { label: { fr: "Préparer un vol", en: "Prepare a flight" }, run: A.hub },
            ]
          : []),
      ],
    },
    {
      label: { fr: "École et défis", en: "School & challenges" },
      on: S.course || S.challenge || S.mission,
      sub: [
        { label: { fr: "École de vol", en: "Flight school" }, on: S.course, run: A.school },
        { label: { fr: "Missions", en: "Missions" }, on: S.mission, run: A.missions },
        { label: { fr: "Défis", en: "Challenges" }, on: S.challenge, run: A.challenges },
      ],
    },
    {
      label: { fr: "Caméra", en: "Camera" },
      sub: [
        { label: { fr: "Vue suivante", en: "Next view" }, key: "V", run: A.nextView },
        { label: { fr: "Photo", en: "Photo" }, run: A.photo },
        { label: { fr: "Replay", en: "Replay" }, run: () => A.replay(false) },
        { label: { fr: "Bande-annonce", en: "Trailer" }, run: () => A.replay(true) },
      ],
    },
    // (the craft: its assistance, its flight law in the air, its HUD, the fine controls)
    {
      label: { fr: "Vaisseau", en: "Craft" },
      sub: [
        {
          label: { fr: "Assistance", en: "Assistance" },
          sub: ASSISTS.map(([lv, fr, en, hf, he]) => ({
            label: { fr, en },
            hint: { fr: hf, en: he },
            on: S.assist === lv,
            run: () => A.assist(lv),
          })),
        },
        ...(S.vessel === "ranger" ? [{ label: { fr: "Mode de vol (air)", en: "Flight mode (air)" }, key: "F", run: A.flightMode }] : []),
        { label: { fr: "HUD suivant", en: "Next HUD" }, key: "⇧²", run: A.hudKind },
        { label: { fr: "Commandes fines", en: "Fine controls" }, key: "Caps", run: A.precision },
      ],
    },
  ];
  return items;
}
