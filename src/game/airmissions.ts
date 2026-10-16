// The missions given with the game (game/mission.ts: data — the Missions card, TARS, a link): a renegade airliner
// intercepted, identified and escorted to Lyon (a real flight taken over when one is heard about the Alps); a
// strike in Corsica from the Ford, a SAM and its truck, a bandit, back on the deck; an airliner escorted to Ajaccio
// through drones. And S1's (docs/PLAN-AVIATION-AAA.md): a VIP's jet escorted to Nice through an interceptor; Red Air
// (two waves of fighters, a wingman with us); an anti-ship strike on a frigate group (the JSMs); the carrier
// qualifications by day, by night and in a heavy sea; a display team's diamond passes before the crowd at Salon; and
// the team missions for a room — one escorts, the other strikes; two against two; the Ford defended by two CAPs.
// Their words in the language of the moment.

import { tr } from "../i18n";
import type { MissionSpec } from "./mission";

const L = (fr: string, en: string) => tr({ fr, en });

/** Lyon-Saint-Exupéry, Ajaccio: the airfields the missions end at. */
const LFLL = { lat: 45.7256, lon: 5.0811 };
const LFKJ = { lat: 41.9236, lon: 8.8029 };
/** Nice, Salon-de-Provence (the Patrouille de France's home), the Ford's waters off Provence */
const LFMN = { lat: 43.6584, lon: 7.2159 };
const LFMY = { lat: 43.6064, lon: 5.1093 };
const FORD_AT = { lat: 42.6, lon: 7.4 };

/** A carrier qualification as a mission: the F-35C 7 km astern of the Ford, its passes flown and graded. */
function qualMission(id: "day" | "night" | "sea"): MissionSpec {
  const name = { day: L("de jour", "by day"), night: L("de nuit", "by night"), sea: L("par mer forte", "in a heavy sea") }[id];
  return {
    v: 1,
    id: `qual-${id}`,
    title: tf2(L("Qualification d'appontage {0}", "Carrier qualification {0}"), name),
    brief: L(
      "Quatre passages sur le Gerald R. Ford, notés un à un par l'officier d'appontage : la moyenne de 3,0 sans coupure qualifie. Entre deux passages, la catapulte vous relance.",
      "Four passes on the Gerald R. Ford, each graded by the LSO: an average of 3.0 without a cut qualifies. Between passes, the catapult sends you off again.",
    ),
    start: { lat: 42.6, lon: 7.486, alt: 450, hdg: 270, speed: 140, variant: "C", loadout: "aa", fuel: 0.5 },
    time: { localHour: id === "night" ? 23 : 11 },
    weather: id === "sea" ? { preset: "windy", wind: 2, swell: 4.4 } : { preset: "fair", wind: 1, clouds: 0.2 },
    units: [{ id: "ford", kind: "carrier", carrier: "ford", at: FORD_AT, hdg: 270 }],
    objectives: [{ id: "qual", kind: "qual", qual: id, text: tf2(L("Se qualifier {0}", "Qualify {0}"), name) }],
    limit: 3600,
  };
}
const tf2 = (s: string, v: string) => s.replace("{0}", v);

export const AIR_MISSIONS: { id: string; make: () => MissionSpec }[] = [
  {
    id: "renegade",
    make: () => ({
      v: 1,
      id: "renegade",
      title: L("Renegade sur les Alpes", "Renegade over the Alps"),
      brief: L(
        "Un vol de ligne ne répond plus, transpondeur coupé, et quitte sa route au-dessus des Alpes. Alerte : interceptez-le, identifiez-le de près, puis escortez-le jusqu'à Lyon-Saint-Exupéry. Ne tirez pas.",
        "An airliner has stopped answering, its transponder off, and leaves its route over the Alps. Scramble: intercept it, identify it close, then escort it to Lyon-Saint-Exupéry. Hold your fire.",
      ),
      start: { lat: 45.85, lon: 6.75, alt: 6000, hdg: 60, speed: 250, variant: "B", loadout: "aa" },
      time: { localHour: 15 },
      weather: { preset: "fair", wind: 1, clouds: 0.3 },
      units: [
        {
          id: "renegade",
          kind: "traffic",
          name: "AFR4512",
          at: { lat: 46.3, lon: 7.4, alt: 10500 },
          hdg: 230,
          speed: 230,
        },
      ],
      objectives: [
        { id: "ident", kind: "identify", unit: "renegade", within: 900, text: L("Identifier l'appareil", "Identify the aircraft") },
        {
          id: "escort",
          kind: "escort",
          unit: "renegade",
          until: { ...LFLL, radius: 12_000 },
          within: 6000,
          after: "ident",
          text: L("L'escorter jusqu'à Lyon", "Escort it to Lyon"),
        },
        {
          id: "land",
          kind: "land",
          at: { ...LFLL, radius: 4000 },
          after: "escort",
          optional: true,
          points: 50,
          text: L("Se poser à Lyon (bonus)", "Land at Lyon (bonus)"),
        },
      ],
      triggers: [
        {
          id: "gone",
          when: { time: 3 },
          do: [
            {
              say: L(
                "Mother : le vol a coupé son transpondeur et vire au sud. Interceptez.",
                "Mother: the flight has cut its transponder and turns south. Intercept.",
              ),
            },
            { squawk: { unit: "renegade", off: true } },
            { course: { unit: "renegade", hdg: 165, alt: 9000 } },
          ],
        },
        {
          id: "follow",
          when: { done: "ident" },
          do: [
            { say: L("Contact visuel. Il obéit : il vous suit vers Lyon.", "Visual. He complies: he follows you to Lyon.") },
            { squawk: { unit: "renegade", off: false } },
            { course: { unit: "renegade", to: { ...LFLL, alt: 2500 }, speed: 170 } },
          ],
        },
      ],
      limit: 2400,
    }),
  },
  {
    id: "corsica-strike",
    make: () => ({
      v: 1,
      id: "corsica-strike",
      title: L("Frappe en Corse depuis le Ford", "A strike in Corsica from the Ford"),
      brief: L(
        "Depuis le Gerald R. Ford, au large : détruisez la batterie de missiles sol-air de Balagne et son camion de ravitaillement (deux GBU-32), méfiez-vous d'un chasseur ennemi, puis revenez apponter.",
        "From the Gerald R. Ford, offshore: destroy the surface-to-air battery in Balagne and its supply truck (two GBU-32s), beware of an enemy fighter, then come back aboard.",
      ),
      start: { lat: 42.62, lon: 7.55, alt: 2000, hdg: 90, speed: 220, variant: "B", loadout: "ag" },
      time: { localHour: 10 },
      weather: { preset: "fair", wind: 1, clouds: 0.2 },
      units: [
        { id: "ford", kind: "carrier", carrier: "ford", at: { lat: 42.6, lon: 7.4 }, hdg: 270 },
        { id: "sam", kind: "sam", name: "SA-6", at: { lat: 42.5, lon: 8.85 } },
        { id: "truck", kind: "truck", name: L("Camion", "Truck"), at: { lat: 42.47, lon: 8.88 } },
        { id: "bandit", kind: "fighter", name: "Bandit", at: { lat: 42.2, lon: 9.3, alt: 6000 }, hdg: 320, later: true },
      ],
      objectives: [
        { id: "sam", kind: "destroy", units: ["sam"], text: L("Détruire la batterie SA-6", "Destroy the SA-6 battery") },
        { id: "truck", kind: "destroy", units: ["truck"], text: L("Détruire le camion", "Destroy the truck") },
        {
          id: "bandit",
          kind: "destroy",
          units: ["bandit"],
          optional: true,
          points: 50,
          text: L("Abattre le chasseur (bonus)", "Shoot down the fighter (bonus)"),
        },
        { id: "home", kind: "land", carrier: "ford", after: "truck", text: L("Apponter sur le Ford", "Land aboard the Ford") },
      ],
      triggers: [
        {
          id: "coast",
          when: { enter: { lat: 42.5, lon: 8.85, radius: 45_000 } },
          do: [
            {
              say: L(
                "AWACS : un chasseur décolle de l'est, il vient vers vous.",
                "AWACS: a fighter is up from the east, heading your way.",
              ),
            },
            { spawn: "bandit" },
          ],
        },
        {
          id: "rtb",
          when: { done: "truck" },
          do: [{ say: L("Cibles détruites. Retour au Ford.", "Targets destroyed. Return to the Ford.") }],
        },
      ],
      limit: 3000,
    }),
  },
  {
    id: "ajaccio-escort",
    make: () => ({
      v: 1,
      id: "ajaccio-escort",
      title: L("Escorte jusqu'à Ajaccio", "Escort to Ajaccio"),
      brief: L(
        "Un Airbus gouvernemental rejoint Ajaccio. Restez à moins de 8 km de lui jusqu'à l'approche : des drones hostiles sont signalés au large de la Corse.",
        "A government Airbus is bound for Ajaccio. Stay within 8 km of it until its approach: hostile drones are reported off Corsica.",
      ),
      start: { lat: 42.95, lon: 6.95, alt: 7500, hdg: 120, speed: 230, variant: "B", loadout: "aa" },
      time: { localHour: 17 },
      weather: { preset: "fair", wind: 1, clouds: 0.4 },
      units: [
        {
          id: "vip",
          kind: "airliner",
          name: "CTM0001",
          side: "friend",
          at: { lat: 42.9, lon: 7.0, alt: 8000 },
          hdg: 125,
          speed: 220,
          route: [{ ...LFKJ, alt: 2500 }],
        },
        { id: "d1", kind: "drone", name: "Drone 1", at: { lat: 42.3, lon: 8.1, alt: 4000 }, hdg: 330, later: true },
        { id: "d2", kind: "drone", name: "Drone 2", at: { lat: 42.25, lon: 8.3, alt: 3500 }, hdg: 330, later: true },
      ],
      objectives: [
        {
          id: "escort",
          kind: "escort",
          unit: "vip",
          until: { ...LFKJ, radius: 15_000 },
          within: 8000,
          text: L("Escorter l'Airbus jusqu'à Ajaccio", "Escort the Airbus to Ajaccio"),
        },
        {
          id: "drones",
          kind: "destroy",
          units: ["d1", "d2"],
          optional: true,
          points: 60,
          text: L("Abattre les drones (bonus)", "Shoot down the drones (bonus)"),
        },
      ],
      triggers: [
        {
          id: "drones",
          when: { time: 90 },
          do: [
            { say: L("AWACS : deux drones au sud-est, à 60 km.", "AWACS: two drones south-east, 60 km.") },
            { spawn: "d1" },
            { spawn: "d2" },
          ],
        },
      ],
      limit: 2400,
    }),
  },
  {
    id: "vip-escort",
    make: () => ({
      v: 1,
      id: "vip-escort",
      title: L("Escorte du VIP jusqu'à Nice", "The VIP escorted to Nice"),
      brief: L(
        "Un Falcon gouvernemental quitte Toulon pour Nice. Restez à moins de 6 km de lui : un intercepteur hostile est signalé au-dessus des Alpes du Sud. Il ne doit jamais l'approcher à moins de 3 km.",
        "A government Falcon leaves Toulon for Nice. Stay within 6 km of it: a hostile interceptor is reported over the Southern Alps. It must never come within 3 km of it.",
      ),
      start: { lat: 43.08, lon: 6.0, alt: 7500, hdg: 65, speed: 220, variant: "B", loadout: "aa" },
      time: { localHour: 16 },
      weather: { preset: "fair", wind: 1, clouds: 0.3 },
      units: [
        {
          id: "vip",
          kind: "airliner",
          name: "VIP 01",
          side: "friend",
          at: { lat: 43.1, lon: 6.05, alt: 8000 },
          hdg: 65,
          speed: 190,
          route: [{ ...LFMN, alt: 2500 }],
        },
        { id: "bandit", kind: "fighter", name: "Bandit", at: { lat: 44.1, lon: 7.2, alt: 7000 }, hdg: 220, later: true },
      ],
      objectives: [
        {
          id: "escort",
          kind: "escort",
          unit: "vip",
          until: { ...LFMN, radius: 12_000 },
          within: 6000,
          text: L("Escorter le VIP jusqu'à Nice", "Escort the VIP to Nice"),
        },
        { id: "bandit", kind: "destroy", units: ["bandit"], text: L("Abattre l'intercepteur", "Shoot down the interceptor") },
      ],
      triggers: [
        {
          id: "threat",
          when: { time: 60 },
          do: [
            {
              say: L(
                "Darkstar : un chasseur décolle au nord, il vient sur le VIP. Interceptez-le.",
                "Darkstar: a fighter is up to the north, heading for the VIP. Intercept it.",
              ),
            },
            { spawn: "bandit" },
            { course: { unit: "bandit", to: { lat: 43.35, lon: 6.6, alt: 7500 } } },
          ],
        },
        {
          id: "lost",
          when: { near: { unit: "bandit", within: 3000, of: "vip" } },
          do: [{ fail: L("L'intercepteur a atteint le VIP", "The interceptor reached the VIP") }],
        },
      ],
      limit: 1800,
    }),
  },
  {
    id: "red-air",
    make: () => ({
      v: 1,
      id: "red-air",
      title: L("Red Air au large d'Hyères", "Red Air off Hyères"),
      brief: L(
        "Entraînement au combat contre des agresseurs simulés, votre ailier avec vous : une première patrouille de deux chasseurs, puis une seconde. Abattez-les tous.",
        "Combat training against simulated aggressors, your wingman with you: a first pair of fighters, then a second. Shoot them all down.",
      ),
      start: { lat: 42.9, lon: 6.0, alt: 7000, hdg: 180, speed: 240, variant: "B", loadout: "aa", wingmen: 1 },
      time: { localHour: 11 },
      weather: { preset: "fair", wind: 1, clouds: 0.2 },
      units: [
        { id: "r1", kind: "fighter", name: "RED 1", at: { lat: 42.15, lon: 6.1, alt: 7000 }, hdg: 0 },
        { id: "r2", kind: "fighter", name: "RED 2", at: { lat: 42.1, lon: 5.95, alt: 6500 }, hdg: 0 },
        { id: "r3", kind: "fighter", name: "RED 3", at: { lat: 42.0, lon: 6.4, alt: 8000 }, hdg: 330, later: true },
        { id: "r4", kind: "fighter", name: "RED 4", at: { lat: 41.95, lon: 6.55, alt: 7500 }, hdg: 330, later: true },
      ],
      objectives: [
        { id: "w1", kind: "destroy", units: ["r1", "r2"], text: L("Abattre la première patrouille", "Shoot down the first pair") },
        {
          id: "w2",
          kind: "destroy",
          units: ["r3", "r4"],
          after: "w1",
          text: L("Abattre la seconde patrouille", "Shoot down the second pair"),
        },
      ],
      triggers: [
        {
          id: "wave2",
          when: { done: "w1" },
          do: [
            { say: L("Darkstar : deux nouveaux bandits au sud-est, 80 km.", "Darkstar: two new bandits south-east, 80 km.") },
            { spawn: "r3" },
            { spawn: "r4" },
          ],
        },
      ],
      limit: 1800,
    }),
  },
  {
    id: "antiship",
    make: () => ({
      v: 1,
      id: "antiship",
      title: L("Frappe antinavire à l'ouest de la Sardaigne", "An anti-ship strike west of Sardinia"),
      brief: L(
        "Deux frégates hostiles font route au nord-ouest à l'ouest de la Sardaigne. Leurs missiles sol-air portent à 32 km : tirez vos deux JSM de bien plus loin (verrouillez chaque frégate au radar, Tab), puis restez bas et rentrez sur le Ford.",
        "Two hostile frigates steam north-west, west of Sardinia. Their surface-to-air missiles reach 32 km: fire your two JSMs from well beyond (lock each frigate on the radar, Tab), then stay low and come back to the Ford.",
      ),
      start: { lat: 41.9, lon: 6.6, alt: 3000, hdg: 160, speed: 230, variant: "B", loadout: "as" },
      time: { localHour: 9 },
      weather: { preset: "fair", wind: 1, clouds: 0.2 },
      units: [
        { id: "ford", kind: "carrier", carrier: "ford", at: { lat: 42.05, lon: 6.5 }, hdg: 300 },
        { id: "f1", kind: "ship", name: L("Frégate 1", "Frigate 1"), at: { lat: 40.55, lon: 7.25 }, hdg: 300, speed: 9 },
        { id: "f2", kind: "ship", name: L("Frégate 2", "Frigate 2"), at: { lat: 40.5, lon: 7.32 }, hdg: 300, speed: 9 },
      ],
      objectives: [
        { id: "ships", kind: "destroy", units: ["f1", "f2"], text: L("Couler les deux frégates", "Sink both frigates") },
        {
          id: "home",
          kind: "land",
          carrier: "ford",
          after: "ships",
          optional: true,
          points: 50,
          text: L("Apponter sur le Ford (bonus)", "Land aboard the Ford (bonus)"),
        },
      ],
      triggers: [
        {
          id: "range",
          when: { near: { unit: "f1", within: 130_000 } },
          do: [
            {
              say: L(
                "Darkstar : les frégates sont à portée de JSM. Verrouillez, tirez, puis dégagez.",
                "Darkstar: the frigates are within JSM range. Lock, fire, then turn away.",
              ),
            },
          ],
        },
      ],
      limit: 2700,
    }),
  },
  { id: "qual-day", make: () => qualMission("day") },
  { id: "qual-night", make: () => qualMission("night") },
  { id: "qual-sea", make: () => qualMission("sea") },
  {
    id: "display",
    make: () => ({
      v: 1,
      id: "display",
      title: L("Patrouille acrobatique à Salon", "A display team at Salon"),
      brief: L(
        "Vous menez un losange de quatre F-35 devant le public de Salon-de-Provence : trois passages à moins de 300 m au-dessus de la piste, vos trois équipiers à leur place (à moins de 40 m) d'un bout à l'autre de chaque passage.",
        "You lead a diamond of four F-35s before the crowd at Salon-de-Provence: three passes below 300 m over the runway, your three wingmen in their places (within 40 m) from one end of each pass to the other.",
      ),
      start: { lat: 43.6, lon: 4.98, alt: 600, hdg: 90, speed: 180, variant: "B", loadout: "gun", wingmen: 3, formation: "diamond" },
      time: { localHour: 15 },
      weather: { preset: "fair", wind: 1, clouds: 0.1 },
      units: [],
      objectives: [
        {
          id: "passes",
          kind: "show",
          at: { ...LFMY, radius: 1500 },
          below: 300,
          passes: 3,
          wingmen: 3,
          text: L("Passages en losange devant le public", "Diamond passes before the crowd"),
        },
      ],
      triggers: [
        {
          id: "say-smoke",
          when: { time: 2 },
          do: [{ say: L("Leader : fumées… top ! Le public est sur votre gauche.", "Lead: smoke on… now! The crowd is on your left.") }],
        },
      ],
      limit: 1200,
    }),
  },
  {
    id: "team-strike",
    make: () => ({
      v: 1,
      id: "team-strike",
      title: L("En équipe : escorte et frappe en Corse", "Team: escort and strike in Corsica"),
      brief: L(
        "Mission en équipe. Le frappeur détruit le site SAM et le bunker de Solenzara ; l'escorte abat les deux chasseurs qui décolleront à son approche. Seul, vous faites les deux.",
        "A team mission. The striker destroys the SAM site and the bunker at Solenzara; the escort shoots down the two fighters that will scramble as it comes. Alone, you do both.",
      ),
      start: { lat: 42.3, lon: 7.9, alt: 5000, hdg: 90, speed: 230, variant: "B", loadout: "ag" },
      roles: [
        {
          id: "striker",
          name: L("Frappeur", "Striker"),
          brief: L("Deux GBU-32 : le SAM puis le bunker.", "Two GBU-32s: the SAM, then the bunker."),
        },
        {
          id: "escort",
          name: L("Escorte", "Escort"),
          brief: L("Quatre AMRAAM : couvrez le frappeur, abattez les chasseurs.", "Four AMRAAMs: cover the striker, shoot the fighters."),
          start: { lat: 42.36, lon: 7.88, alt: 7000, loadout: "aa" },
        },
      ],
      time: { localHour: 14 },
      weather: { preset: "fair", wind: 1, clouds: 0.3 },
      units: [
        { id: "sam", kind: "sam", name: "SA-11", at: { lat: 41.95, lon: 9.35 } },
        { id: "bunker", kind: "bunker", name: L("Bunker", "Bunker"), at: { lat: 41.92, lon: 9.38 } },
        { id: "b1", kind: "fighter", name: "BANDIT 1", at: { lat: 42.4, lon: 9.6, alt: 6000 }, hdg: 240, later: true },
        { id: "b2", kind: "fighter", name: "BANDIT 2", at: { lat: 42.35, lon: 9.7, alt: 6500 }, hdg: 240, later: true },
      ],
      objectives: [
        { id: "sam", kind: "destroy", units: ["sam"], role: "striker", text: L("Détruire le site SAM", "Destroy the SAM site") },
        {
          id: "bunker",
          kind: "destroy",
          units: ["bunker"],
          role: "striker",
          after: "sam",
          text: L("Détruire le bunker", "Destroy the bunker"),
        },
        {
          id: "air",
          kind: "destroy",
          units: ["b1", "b2"],
          role: "escort",
          text: L("Abattre les deux chasseurs", "Shoot down both fighters"),
        },
      ],
      triggers: [
        {
          id: "scramble",
          when: { enter: { lat: 41.95, lon: 9.35, radius: 70_000 } },
          do: [
            {
              say: L(
                "Darkstar : deux chasseurs décollent de l'est. Escorte, engagez.",
                "Darkstar: two fighters scrambling from the east. Escort, engage.",
              ),
            },
            { spawn: "b1" },
            { spawn: "b2" },
          ],
        },
      ],
      limit: 2700,
    }),
  },
  {
    id: "team-2v2",
    make: () => ({
      v: 1,
      id: "team-2v2",
      title: L("En équipe : deux contre deux", "Team: two against two"),
      brief: L(
        "Mission en équipe. Votre patrouille de deux F-35 contre deux chasseurs adverses au-dessus du golfe du Lion : le leader prend le premier, l'ailier le second. Seul, votre ailier IA vous suit.",
        "A team mission. Your pair of F-35s against two enemy fighters over the Gulf of Lion: the leader takes the first, the wingman the second. Alone, your AI wingman follows you.",
      ),
      start: { lat: 42.9, lon: 3.9, alt: 7500, hdg: 180, speed: 240, variant: "B", loadout: "aa", wingmen: 1 },
      roles: [
        { id: "lead", name: L("Leader", "Lead") },
        { id: "wing", name: L("Ailier", "Wingman"), start: { lat: 42.9, lon: 3.94, wingmen: 0 } },
      ],
      time: { localHour: 12 },
      weather: { preset: "fair", wind: 1, clouds: 0.2 },
      units: [
        { id: "e1", kind: "fighter", name: "BANDIT 1", at: { lat: 42.25, lon: 3.85, alt: 7500 }, hdg: 0 },
        { id: "e2", kind: "fighter", name: "BANDIT 2", at: { lat: 42.22, lon: 4.0, alt: 7000 }, hdg: 0 },
      ],
      objectives: [
        { id: "e1", kind: "destroy", units: ["e1"], role: "lead", text: L("Abattre BANDIT 1", "Shoot down BANDIT 1") },
        { id: "e2", kind: "destroy", units: ["e2"], role: "wing", text: L("Abattre BANDIT 2", "Shoot down BANDIT 2") },
      ],
      limit: 1500,
    }),
  },
  {
    id: "carrier-defence",
    make: () => ({
      v: 1,
      id: "carrier-defence",
      title: L("En équipe : défense du porte-avions", "Team: the carrier defended"),
      brief: L(
        "Mission en équipe. Deux patrouilles aériennes de combat au-dessus du Ford : la CAP nord arrête le premier raid, la CAP sud le second. Aucun raid ne doit approcher le Ford à moins de 25 km. Tenez 15 minutes.",
        "A team mission. Two combat air patrols over the Ford: the north CAP stops the first raid, the south CAP the second. No raid may come within 25 km of the Ford. Hold for 15 minutes.",
      ),
      start: { lat: 42.8, lon: 7.55, alt: 7000, hdg: 90, speed: 230, variant: "B", loadout: "aa" },
      roles: [
        { id: "north", name: L("CAP nord", "North CAP") },
        { id: "south", name: L("CAP sud", "South CAP"), start: { lat: 42.4, lon: 7.55 } },
      ],
      time: { localHour: 17 },
      weather: { preset: "fair", wind: 1, clouds: 0.3 },
      units: [
        { id: "ford", kind: "carrier", carrier: "ford", at: FORD_AT, hdg: 270 },
        { id: "n1", kind: "fighter", name: "RAID N1", at: { lat: 43.3, lon: 8.9, alt: 6000 }, hdg: 240 },
        { id: "n2", kind: "fighter", name: "RAID N2", at: { lat: 43.32, lon: 9.0, alt: 6500 }, hdg: 240 },
        { id: "s1", kind: "fighter", name: "RAID S1", at: { lat: 41.7, lon: 8.8, alt: 5000 }, hdg: 300, later: true },
        { id: "s2", kind: "fighter", name: "RAID S2", at: { lat: 41.65, lon: 8.9, alt: 5500 }, hdg: 300, later: true },
      ],
      objectives: [
        { id: "north", kind: "destroy", units: ["n1", "n2"], role: "north", text: L("Arrêter le raid nord", "Stop the northern raid") },
        { id: "south", kind: "destroy", units: ["s1", "s2"], role: "south", text: L("Arrêter le raid sud", "Stop the southern raid") },
        { id: "hold", kind: "protect", unit: "ford", seconds: 900, text: L("Tenir 15 minutes", "Hold for 15 minutes") },
      ],
      triggers: [
        {
          id: "go-n",
          when: { time: 1 },
          do: [{ course: { unit: "n1", to: { ...FORD_AT, alt: 6000 } } }, { course: { unit: "n2", to: { ...FORD_AT, alt: 6500 } } }],
        },
        {
          id: "raid-s",
          when: { time: 240 },
          do: [
            { say: L("Darkstar : nouveau raid au sud-est, cap sur Mother.", "Darkstar: a new raid south-east, heading for Mother.") },
            { spawn: "s1" },
            { spawn: "s2" },
            { course: { unit: "s1", to: { ...FORD_AT, alt: 5000 } } },
            { course: { unit: "s2", to: { ...FORD_AT, alt: 5500 } } },
          ],
        },
        ...["n1", "n2", "s1", "s2"].map((u) => ({
          id: `leak-${u}`,
          when: { near: { unit: u, within: 25_000, of: "ford" } },
          do: [{ fail: L("Un raid a atteint le Ford", "A raid reached the Ford") }],
        })),
      ],
      limit: 1200,
    }),
  },
];
