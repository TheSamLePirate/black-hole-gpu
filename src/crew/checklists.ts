// The failures' checklists for the crew's EECOM view (PLAN-VAISSEAUX K4), in the console's two languages: the game's
// own (game/systems.ts CHECKLISTS) in English, and as its French dictionary has them — the console loads neither the
// game's systems nor its dictionaries; a test keeps the three in step.
import { lang } from "./lang";

type Checklist = { title: string; steps: string[]; action: string };
export const CHECKLISTS_FR: Record<string, Checklist> = {
  engine: {
    title: "MOTEUR PRINCIPAL ÉTEINT",
    steps: ["Gaz à zéro", "Vérifier la pression d'alimentation en ergols", "Attendre 30 s que la chambre refroidisse", "Allumeurs armés"],
    action: "RALLUMER",
  },
  rcsStuck: {
    title: "PROPULSEUR RCS BLOQUÉ OUVERT",
    steps: ["Identifier le bloc par la dérive", "Tenir l'attitude au SAS", "Fermer les vannes d'isolement du bloc"],
    action: "ISOLER LE BLOC",
  },
  gyro: {
    title: "DÉRIVE DE LA CENTRALE INERTIELLE",
    steps: ["Comparer l'attitude au viseur d'étoiles", "Relâcher les maintiens", "Sélectionner la centrale de secours"],
    action: "PASSER SUR LA CENTRALE DE SECOURS",
  },
  bus: {
    title: "COURT-CIRCUIT DU BUS PRINCIPAL",
    steps: [
      "Délester les charges non essentielles",
      "Ouvrir le disjoncteur du bus en défaut",
      "Basculer les charges essentielles sur le bus B",
    ],
    action: "COUPLAGE DES BUS",
  },
  o2Leak: {
    title: "FUITE D'OXYGÈNE CABINE",
    steps: [
      "Scaphandres, casques fermés",
      "Localiser la fuite par la chute de pression",
      "Fermer la vanne d'intercommunication du réservoir",
    ],
    action: "FERMER LA VANNE",
  },
  scrubber: {
    title: "ÉPURATEUR DE CO₂ EN PANNE",
    steps: ["Vérifier la pression partielle de CO₂", "Monter l'adaptateur de la cartouche de secours", "Relancer le ventilateur"],
    action: "MONTER LA CARTOUCHE DE SECOURS",
  },
};

export const CHECKLISTS_EN: Record<string, Checklist> = {
  engine: {
    title: "MAIN ENGINE OUT",
    steps: ["Throttle to zero", "Check propellant feed pressure", "Wait 30 s for the chamber to cool", "Igniters armed"],
    action: "RELIGHT",
  },
  rcsStuck: {
    title: "RCS THRUSTER STUCK OPEN",
    steps: ["Identify the quad by the drift", "Hold the attitude with the SAS", "Close the quad's isolation valves"],
    action: "ISOLATE THE QUAD",
  },
  gyro: {
    title: "IMU DRIFT",
    steps: ["Compare the attitude with the star tracker", "Release the holds", "Select the backup IMU"],
    action: "SWITCH TO THE BACKUP IMU",
  },
  bus: {
    title: "MAIN BUS SHORT",
    steps: ["Shed the non-essential loads", "Open the faulty bus's breaker", "Tie the essential loads to bus B"],
    action: "BUS TIE",
  },
  o2Leak: {
    title: "CABIN OXYGEN LEAK",
    steps: ["Suits on, helmets closed", "Find the leak by the pressure drop", "Close the tank's cross-feed valve"],
    action: "CLOSE THE VALVE",
  },
  scrubber: {
    title: "CO₂ SCRUBBER FAILED",
    steps: ["Check the CO₂ partial pressure", "Fit the spare cartridge's adapter", "Restart the fan"],
    action: "FIT THE SPARE CARTRIDGE",
  },
};
/** a failure's checklist in the console's language (none: an unknown failure, a newer pilot's) */
export const checklistOf = (kind: string): Checklist | undefined => (lang() === "fr" ? CHECKLISTS_FR : CHECKLISTS_EN)[kind];
