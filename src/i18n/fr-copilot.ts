// French for TARS the copilot's hands (docs/PLAN-AVIATION-AAA.md, I2): the threats called, the traffic, the
// weapons — keyed by the English.
export default {
  // the threats (game/threats.ts)
  hot: "de face",
  flanking: "en flanc",
  beam: "travers",
  cold: "de dos",
  "SAM launch, {0} o'clock, {1} — notch it, chaff": "Tir SAM, {0} heures, {1} — mettez-le au travers, paillettes",
  "Missile launch, {0} o'clock, {1} — break right, flares": "Départ missile, {0} heures, {1} — dégagement à droite, leurres",
  "Missile launch, {0} o'clock, {1} — break left, flares": "Départ missile, {0} heures, {1} — dégagement à gauche, leurres",
  "Missile {0} o'clock, close — break now!": "Missile {0} heures, tout près — dégagez maintenant !",
  "Missile decoyed": "Missile leurré",
  "Missile defeated": "Missile évité",
  "We're hit — damage {0} %": "On est touchés — dégâts {0} %",
  "Splash one — {0}": "Un au tapis — {0}",
  "{0}, {1} o'clock, {2}": "{0}, {1} heures, {2}",
  "Bandit close, {0} o'clock, {1}, hot": "Bandit proche, {0} heures, {1}, de face",
  "Bandit, {0}": "Bandit, {0}",
  "{0} bandits, nearest {1}": "{0} bandits, le plus proche {1}",
  // the traffic, the weapons (controller/copilot.ts)
  "No aircraft called {0} about us": "Aucun avion nommé {0} autour de nous",
  "No fight running: the weapons are live in a fight or a mission":
    "Aucun combat en cours : les armes ne sont actives qu'en combat ou en mission",
  "{0}: not on the radar — not seen yet, or a friend's on the datalink":
    "{0} : pas au radar — pas encore vu, ou un ami sur la liaison de données",
  "STT: no track to lock": "STT : aucune piste à verrouiller",
  // the setting
  "Threat calls": "Annonces des menaces",
  "In a fight, TARS calls the threats as a backseater: a missile launched at us (where on the clock, how far, break and flares — or the notch and the chaff for a SAM), closing in, defeated; the bandits new on the radar by their bearing, range, altitude and aspect; a hit, a kill.":
    "En combat, TARS annonce les menaces comme un navigateur en place arrière : un missile tiré sur nous (où sur l'horloge, à quelle distance, dégagement et leurres — ou la mise au travers et les paillettes pour un SAM), qui se rapproche, évité ; les bandits nouveaux au radar par leur relèvement, distance, altitude et aspect ; un coup reçu, une victoire.",
} satisfies Record<string, string>;
