// French for the flight of two to four: its formations, the leader's orders, the AI wingmen (docs/PLAN-AVIATION-AAA.md, F1–F4) — keyed by the English.
export default {
  "Formation {0} on {1} — #{2}": "Formation {0} sur {1} — n° {2}",
  "The formation flown (the room's Formation, the wingmen): each place numbered — the leader 1, his wingman 2, the element 3 and 4 — and flown by the formation autopilot. The leader's orders change it for the whole flight.":
    "La formation volée (la Formation du salon, les ailiers) : chaque poste numéroté — le leader 1, son ailier 2, l'élément 3 et 4 — et volé par le pilote automatique de formation. Les ordres du leader la changent pour toute la patrouille.",
  Spacing: "Écartement",
  "How far apart the places are: tight, normal (a wingspan and 15 m in the close formations, some 300 m to 1.5 km in the tactical ones), wide.":
    "L'écart entre les postes : serré, normal (une envergure et 15 m dans les formations serrées, 300 m à 1,5 km dans les tactiques), large.",
  Tight: "Serré",
  Wide: "Large",
  "My place": "Mon poste",
  "Our number in the flight when we fly on another's wing: 2 his wingman, 3 the element's leader, 4 the element's wingman.":
    "Notre numéro dans la patrouille quand on vole sur l'aile d'un autre : 2 son ailier, 3 le chef de l'élément, 4 l'ailier de l'élément.",
  "Echelon right": "Échelon droite",
  Fingertip: "Fingertip",
  "Echelon left": "Échelon gauche",
  Vic: "Triangle",
  Diamond: "Losange",
  "Line abreast": "Ligne de front",
  Trail: "Colonne",
  "Combat spread": "Patrouille étalée",
  "The flight's leader: the orders' wheel (rejoin, formation, tighten, loosen, attack my target, engage, cover me, hold here, RTB, break) — to the room's wingmen and the AI wingmen; its key (F13) given another in the controls, or a HOTAS button":
    "Le leader de la patrouille : la roue des ordres (rejoindre, formation, serrer, s'écarter, attaquer ma cible, engager, me couvrir, tenir ici, rentrer, dégagement) — aux ailiers du salon et aux ailiers IA ; sa touche (F13) à réassigner dans les commandes, ou un bouton du HOTAS",
  "Tab held › Flight · F13": "Tab maintenu › Patrouille · F13",
  "Attack: lock a target first (Tab)": "Attaque : verrouillez d'abord une cible (Tab)",
  "Hold: in the air": "Attente : en vol",
  "The break: in the air": "Le dégagement : en vol",
  "Holding — inbound {0}°": "En attente — axe d'arrivée {0}°",
  "RTB: in the air": "Retour base : en vol",
  "RTB — {0}, {1} km, course {2}°": "Retour base — {0}, {1} km, route {2}°",
  "AI wingmen: {0}": "Ailiers IA : {0}",
  "AI wingmen: none": "Ailiers IA : aucun",
  "AI wingmen": "Ailiers IA",
  "F-35s flying with yours in the Earth's air — Two, Three, Four — each its place in the formation chosen, flown with the real aircraft's forces; they obey the leader's orders (Tab held › Flight), call their contacts, fight in a fight and can be lost.":
    "Des F-35 qui volent avec le vôtre dans l'air de la Terre — Deux, Trois, Quatre — chacun à son poste dans la formation choisie, volés avec les forces du vrai avion ; ils obéissent aux ordres du leader (Tab maintenu › Patrouille), annoncent leurs contacts, se battent en combat et peuvent être perdus.",
  Traffic: "Trafic",
  "Real traffic": "Trafic réel",
  "The real aircraft (ADS-B: adsb.lol, OpenSky) and ships (AIS: aisstream.io) about your craft, live — through the game's relay, refreshed every few seconds. Off: none asked. Offline: none.":
    "Les avions (ADS-B : adsb.lol, OpenSky) et les navires (AIS : aisstream.io) réels autour de votre appareil, en direct — par le relais du jeu, rafraîchis toutes les quelques secondes. Désactivé : rien n'est demandé. Hors ligne : rien.",
  "Aircraft delayed": "Avions en différé",
  "How far behind the real time the real aircraft are drawn: delayed, each flies the smoothest path through its known positions (its turns, its climbs as they were), banked and nose-up as the flight's laws ask; live, it is carried on from its last report and corrected at each new one.":
    "De combien de temps les avions réels sont montrés en retard sur le temps réel : en différé, chacun vole la trajectoire la plus lisse par ses positions connues (ses virages, ses montées tels qu'ils ont été), incliné et cabré comme le veulent les lois du vol ; en direct, il est prolongé depuis son dernier message et corrigé à chaque nouveau.",
  "Sea waves by FFT": "Vagues de la mer par FFT",
  "The sea's waves computed each frame from the real sea state (its wind sea and swell): from the long swell to the ripples, their whitecaps where they break, their relief near a low aircraft. Off: twelve simple wave trains, lighter for small GPUs.":
    "Les vagues de la mer calculées à chaque image d'après l'état réel de la mer (mer du vent et houle) : de la longue houle aux vaguelettes, leurs moutons où elles déferlent, leur relief près d'un avion à basse altitude. Désactivé : douze trains de vagues simples, plus légers pour les petits GPU.",
  "1 min": "1 min",
  "2 min": "2 min",
  "Formation on the lock: lock an airliner first (Tab)": "Formation sur la cible : verrouillez d'abord un avion de ligne (Tab)",
} satisfies Record<string, string>;
