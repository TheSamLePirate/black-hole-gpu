# RD7 — Les traînées

*2026-10-21, `main` — PLAN-RADAR-AAA.*

Chaque piste de l'image tactique garde son historique. On le voit derrière elle sur tous les radars et toutes les
cartes, pilote et crew.

**Côté pilote**, `TrailStore` (`radar/picture.ts`) est tenu à chaque image par `controller/radar.ts` :
- un point à chaque nouvelle mesure du radar ;
- sinon, un point toutes les 2 s, ou toutes les 0,25 s pour un missile ;
- au plus 120 points par piste et 400 pistes ;
- l'historique d'une piste disparue est oublié 3 minutes après son dernier point.

L'horloge de l'historique s'arrête en pause et suit l'accélération du temps.

**Les réglages**, côté joueur (Réglages › Radar, FR + EN) :
- `radarTrails` : aucune traînée, 30 s ou 3 min ;
- `radarTrailLock` : l'historique du verrou et de la sélection gardé (30 s) même quand les traînées sont coupées ;
- `radarTrailMissiles` : les 5 dernières secondes d'un missile toujours dessinées, le chemin de sa fumée.

`trailSpan` donne la durée affichée pour chaque piste. Il est commun au pilote et au crew.

**Les écrans du pilote** :
- **le scope du HUD** : les échos passés en points qui pâlissent ;
- **le TSD du PCD** : les mêmes points, dans le repère de la carte ;
- **la carte tactique** : une ligne qui s'efface dans le passé, à la couleur du symbole. Un missile a un trait plus épais.

**Le crew** construit les traînées depuis les places reçues : un point toutes les 2 s, ou chaque envoi pour un missile,
120 au plus (`crew/model.ts`). Il les dessine sur la carte, le ND et le radar (`trailDots`, `crew/draw/kit.ts`). Le
choix (aucune, 30 s, 3 min) se fait dans la barre de la vue et il est gardé.

**Reste pour RD5** : le rattrapage. Un crew qui arrive en cours de vol commence avec des traînées vides. Le flux
compact de RD5 enverra l'historique récent à la connexion.

**Vérification** :
- unitaire : `tests/radar-picture.test.ts` (un point par mesure, la durée selon les réglages, l'oubli) ;
- e2e `radar-select` sur kerr-mini :
  - traînées coupées : le verrou garde 5 points, les autres pistes aucun ;
  - à 30 s : 5 pistes avec leur traînée ;
- `jetmap`, `crew` et `radar-sync` repassés : 20/20.
