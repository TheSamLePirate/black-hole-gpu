// The missions given with the game (game/mission.ts: data — the Missions card, TARS, a link): a renegade airliner
// intercepted, identified and escorted to Lyon (a real flight taken over when one is heard about the Alps); a
// strike in Corsica from the Ford, a SAM and its truck, a bandit, back on the deck; an airliner escorted to Ajaccio
// through drones. Their words in the language of the moment.

import { tr } from "../i18n";
import type { MissionSpec } from "./mission";

const L = (fr: string, en: string) => tr({ fr, en });

/** Lyon-Saint-Exupéry, Ajaccio: the airfields the missions end at. */
const LFLL = { lat: 45.7256, lon: 5.0811 };
const LFKJ = { lat: 41.9236, lon: 8.8029 };

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
];
