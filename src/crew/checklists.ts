// The failures' checklists in French for the crew's EECOM view (PLAN-VAISSEAUX K4): the game's own (game/systems.ts
// CHECKLISTS) as its French dictionary has them — the console is French and loads no dictionary; a test keeps the two
// in step.
export const CHECKLISTS_FR: Record<string, { title: string; steps: string[]; action: string }> = {
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
