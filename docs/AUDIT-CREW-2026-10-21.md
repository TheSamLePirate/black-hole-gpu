# Audit de la console crew — 2026-10-21

**Est-ce complet ?** Non. Le socle fonctionne de bout en bout pour les deux profils, testé en salle réelle, mais pas
tout ce qui est promis :

- **profil F-35 (vol)** ;
- **profil vaisseau (espace)** : 10 vues, 8 postes, délai lumière, checklists partagées, ordres de l'ordinateur de vol.

Il manque :

- ~~le **ravitaillement en vol** (absent du crew)~~ — fait (priorité 2) ;
- l'**image tactique** (PLAN-RADAR-AAA RD0–RD14 non commencé) ;
- ~~l'**anglais** (toute la console est en français)~~ — fait (priorité 3) ;
- ~~une **console propre au Lander**~~ — faite (priorité 4) ;
- ~~des vues justes **côté Gargantua**~~ — faites (priorité 4).

Il y a aussi un **bug d'ordre dangereux** : depuis le crew, « Maintien à poste » désamarre un vaisseau amarré.

Méthode : lecture du code (`crew/`, `src/crew/`, `src/ui/crew-feed.ts`, `src/ui/crew-space.ts`, `src/ui/crew-exec.ts`,
`src/net/crewcmd.ts`, `src/net/instruments*.ts`), comparaison avec `docs/CREW.md`, `PLAN-CREW-ACTIONS.md`,
`PLAN-VAISSEAUX-AAA.md` (K1–K7, N), `PLAN-RADAR-AAA.md`, `F35.md`. Les 8 e2e crew ont été lancés sur kerr-mini.

## Les tests aujourd'hui

8 fichiers e2e lancés sur kerr-mini : **29 tests passent, 0 échec**.

| fichier | tests | durée |
|---|---|---|
| crew | 7 | 18 s |
| crew-actions | 6 | 53 s |
| crew-demo-space | 2 | 49 s |
| crew-space-actions | 4 | 16 s |
| crew-space | 3 | 12 s |
| crew-stations | 2 | 9 s |
| net-crew | 2 | 43 s |
| net-orders | 3 | 212 s |

Mais plusieurs n'assertent pas le contenu :
- `crew-space.e2e.test.ts:245-260` : les 7 vues K4 sont seulement capturées ;
- `crew.e2e.test.ts:89` : « toutes les vues » vérifie la navigation, pas ce qui est dessiné ;
- `crew-actions.e2e.test.ts:166` accepte « Refusé » comme réussite ;
- A5 (`:203`) vérifie `what === "tir"`, pas `ok`, ni le verrou, ni le missile ;
- des clics par `dispatchEvent` au lieu de vrais événements CDP.

Jamais testés depuis le crew sur le vrai jeu :
- **côté avion** : ILS et atterrissage automatique, suivi de terrain, remise de gaz, interception, formation, verrouillage ;
- **côté vaisseau** : exécuter une manœuvre, autopilote d'amarrage ou d'atterrissage, mission, désamarrage, plein,
  anneau ;
- **cas particuliers** : console EN, vaisseau posé, Miller.

## F-35 (vol)

| élément | état | preuve | manque |
|---|---|---|---|
| Flux `instruments` (vol, auto, nav, sys, warn, arms) | ✅ | `src/ui/crew-feed.ts:259-355` | pas de test unitaire de `crewSnapshot` |
| PFD, ND, carte, globe (WGS84) | ✅ | `src/crew/draw/pfd.ts:412-498`, `kit.ts:225` | aucun mode STOVL au bandeau ; `Rb = 6371` (sphère) dans la carte ORBITE de Systèmes (`src/crew/draw/systems.ts:300`) |
| Plan de vol, LNAV/VNAV | ✅ | `src/net/crewcmd.ts`, `src/ui/crew-exec.ts:47-74`, e2e A2 | — |
| MCP : ALT/CAP/VIT, AP, A/THR | 🟡 | `src/crew/main.ts:965-1176`, e2e A3 | état AP/A/THR **déduit** des consignes (`main.ts:1143`) : aucun drapeau envoyé par le jeu |
| ILS, atterrissage automatique | 🟡 | `crewcmd.ts:256`, `crew-exec.ts:84` | ni attente, ni clear, ni statut, ni note ; drapeau `auto` de l'ILS non envoyé (`crew-feed.ts:336`) ; aucun e2e |
| STOVL (stationnaire, atterrissage vertical) | ❌ | lampe seule (`systems.ts:171`) | conv, swivel, hover, vz connus du jeu (`telemetry.ts:235`), ni envoyés ni commandables |
| Porte-avions (récupération, LSO) | 🟡 | navires dans le trafic (`crew-feed.ts:115-128`) | phase de récupération, qualification, note LSO absentes |
| **Ravitaillement en vol** | ✅ (2026-10-21) | bloc `aar` (`controller/aar.ts aarCrew`, `crew-feed.ts`), `ap.mode` `tanker`/`refuelMode`/`tankerOff`, MCP « AAR », PFD, Systèmes, Mission aérienne ; e2e `crew-aar` 3/3 ([fiche](progress/crew/P2-ravitaillement.md)) | ni ravitailleur ni panier en 3D côté crew |
| Armes, radar, verrou | 🟡 | `crew-feed.ts:38-49`, `crew-exec.ts:128-133` | canon et leurres hors bandeau ; panneau visible seulement en Radar et Mission aérienne ; verrou désigné **par nom** |
| Menaces, missiles, leurres, bogey dope | ❌ | alerte `MISSILE` seule (`crew-feed.ts:71`) | rien sur les écrans crew (A5 les promettait) |
| Auto-GCAS / Auto-ACAS | 🟡 | FLY UP / PULL UP / TERRAIN (`crew-feed.ts:67-69`) | l'évitement ACAS (`gcas.escape`) n'est pas envoyé : l'équipier ne sait pas pourquoi l'avion manœuvre |
| Carburant, bingo, carburant à l'arrivée | ✅ | `crew-feed.ts:232-242, 318-335` | — |
| Pannes et dommages | ✅ | `crew-feed.ts:76`, `systems.ts:244` | — |
| Formation, ailiers | 🟡 | `ap.traffic join` (`crewcmd.ts:288`) | ordres de patrouille (`flight_lead`) absents ; ailiers IA non affichés |
| École, défis, missions | 🟡 | `systems.ts:283-287`, `nd.ts:136` | pas de note, médailles ni compte rendu |
| Météo | 🟡 | vent seul (`nd.ts:286`) | plafond, visibilité, turbulence, QNH |
| Unités (`unitsFor`) | 🟡 | tuiles, PFD, ND | mètres codés : suivi de terrain (`main.ts:1120`), message au pilote (`crewcmd.ts:228-230`), `METRICS` en m/s (`model.ts:18-19`) |

## Vaisseau (espace)

| élément | état | preuve | manque |
|---|---|---|---|
| Contrat `space` K1 | ✅ | `src/ui/crew-space.ts:84-256`, `src/net/instruments-space.ts:190-337` | durée des poussées ; angle de phase ; position LVLH au-delà de 5 km |
| Profil vaisseau / F-35 | ✅ | `src/crew/profile.ts:30-65` | — |
| Console propre à Ranger, Lander, Endurance | ✅ (2026-10-21) | `profile.ts craftViews/craftTiles`, `draw/descent.ts`, `sp.lpd` | — ([fiche](progress/crew/P4-vaisseaux.md)) |
| Postes à bord (3) et au sol (5) | 🟡 | `src/crew/station.ts:20-71` | un poste ne change que la vue d'accueil et l'ordre des panneaux : mêmes droits partout ; « à bord » se déclare librement et échappe au délai |
| Délai lumière (données, ordres, réponses, messages) | ✅ | `src/crew/model.ts:100-118`, `src/crew/actions.ts:41-44,99-115` | réglage du pilote, pas de la salle (`src/settings.ts:789`) |
| Liaison coupée derrière le trou de ver | 🟡 | `station.ts:118-129` | la **voix** n'est ni retardée ni coupée (`src/crew/radio.ts`) ; Quindar joué en local seulement |
| Orbite (Pe/Ap, poussées déplaçables, autres vaisseaux) | ✅ | `src/crew/draw/orbit.ts`, `views.ts:131-136` | — |
| Prochaine poussée | 🟡 | `spacestat.ts:70` | pas de tuile ni de compte à rebours dédiés ; rôles et événements bruts en anglais (`depart`, `mcc`, `exit`) au lieu de `roleName` |
| Δv, ergols | ✅ | `spaceviews.ts:95-155` | RCS séparé |
| EECOM, consommables | 🟡 | `spaceviews.ts:158-213` | ni eau ni vivres ; cases cochées absentes de la vue EECOM |
| Pannes et checklists partagées | ✅ | `crewcmd.ts:408-429`, `crew-exec.ts:121-131` | — (checklists FR + EN depuis la priorité 3) |
| Rendez-vous et amarrage | 🟡 | `spaceviews.ts:29-92`, bloc < 5 km (`crew-space.ts:181`) | phases de l'autopilote en anglais brut (`docking.ts` : APPROACH, FINAL, HOLD 10 m) ; l'ISS et les vaisseaux cibles absents de la carte 3D (`sys3d/scene.ts:224`) |
| Carte système 3D WebGPU et repli 2D | 🟡 | `src/crew/sys3d/*`, `draw/system.ts` | les autres joueurs et la cible ISS/vaisseau y sont depuis la priorité 4 ; poussées non déplaçables en 3D |
| Chronologie | 🟡 | `spaceviews.ts:217-272` | fenêtres de lancement |
| Relativité | ✅ corrigé (2026-10-21) | `crew-space.ts clocksStep`, `time.since/lag` | le chiffre était bien faux (âge de la scène) |
| Vue Sol | ✅ (2026-10-21) | toucher → `sp.lpd` | pas de liste de sites |
| Actions (tenues, autopilotes, manœuvres, mission, plan, cible, amarrage, anneau, poussées) | ✅ | `crewcmd.ts:301-406`, `crew-exec.ts:93-119` | — |
| **« Maintien à poste »** | ❌ **bug** | `crew-exec.ts:106` → `keepKey()` (`stationkeep.ts:105-113`) | c'est le ⇧8 du pilote : amarré, il **désamarre** et recule de 30 m. Il faut des ordres `keep` et `undock` explicites. |
| Ordres de flotte | ✅ (2026-10-21) | `sp.fleet`, panneau Flotte | — |
| Côté Gargantua | ✅ (2026-10-21) | `draw/kerr.ts`, `craft.status/where`, amarrage côté Gargantua | pas de carte au sol des mondes de Gargantua |
| Vaisseau posé | ✅ (2026-10-21) | `craft.status`, Orbite et Descente « POSÉ » | — |

## Image tactique et réseau (PLAN-RADAR-AAA)

**Aucune des phases RD0–RD14 n'est faite.** Le plan date du 2026-10-18 et aucun commit ne l'a suivi. Les défauts
qu'il listait sont tous encore là :

- **coupe à 24 contacts sans tri** : le verrou peut sortir de la liste (`crew-feed.ts:361`) ;
- **IFF deviné par la couleur** (`crew-feed.ts:143`) : en combat, les amis et neutres IA paraissent hostiles ;
- **cibles de combat absentes en mission** (`crew-feed.ts:131`) ;
- **unités et cibles sans vitesse** (`crew-feed.ts:111,148`) : elles restent figées 1 s puis sautent ;
- **extrapolation en temps réel**, pas en heure de salle (`src/crew/model.ts:236-252`) : en pause ou en accéléré, les
  contacts dérivent ;
- **joueurs placés sur le dernier échantillon brut** (`model.ts:203`, `remotes.track().latest`) au lieu de la
  prédiction ;
- **événements de plus de 16 384 caractères jetés en silence** par le serveur (`server/rooms.ts:391`), sans aucune
  mesure côté client ;
- **8 pistes seulement** au monde (`src/game/sites.ts`) ; ni radar pour les vaisseaux, ni TCAS (TA/RA) ;
- **Rien sur les radars** : ni traînées, ni missiles ou leurres, ni clic pour sélectionner, ni molette pour zoomer.

Réseau :
- **reconnexion** : `setRoom` remet le pilote suivi à zéro (`model.ts:128`), et le crew retombe sur le premier
  pilote ;
- **passage des commandes** : le crew suit un slot, pas un vaisseau. Le pilote devenu passager n'envoie plus
  d'instruments (`netsession.ts:203`), et le crew reste sur des données périmées. Déduit du code, à vérifier.

## Partout

- **Langue** — ✅ corrigé le 2026-10-21 (priorité 3 : console FR/EN, réponses dans la langue de la console). Constat
  d'origine : la console est **uniquement en français**. `crew/index.html` a `lang="fr"`, aucun fichier de
  `src/crew/` n'importe l'i18n, et les accusés renvoient `sayOf().fr` (`crew-exec.ts:165`). Les réponses des outils du
  jeu arrivent, elles, dans la langue du pilote : la console mélange les deux langues. C'est contraire à la règle FR+EN.
- Aucun TODO, FIXME ni bouchon dans le code crew.

## Priorités

**1. Corrections rapides** (une session, tests compris) :
1. séparer « Maintien à poste » et « Désamarrer » côté crew (`sp.dock` : `keep` explicite, jamais de désamarrage
   implicite) ;
2. trier les contacts radar avant la coupe (verrou d'abord, puis par distance) ;
3. envoyer le camp réel des cibles au lieu de le deviner ;
4. envoyer les cibles de combat même en mission ;
5. utiliser les vrais rôles et événements (`roleName`) dans le Tableau vaisseau ;
6. remplacer `Rb = 6371` par `orbit.radius` ;
7. envoyer les drapeaux AP/A/THR ;
8. passer les mètres codés par `unitsFor` ;
9. resserrer les e2e A5 et EECOM (exiger `ok`, le verrou, le missile).

**2. Ravitaillement en vol au crew** — ✅ fait le 2026-10-21 ([fiche](progress/crew/P2-ravitaillement.md)) :
- un bloc `aar` : phase, mode, carburant transféré, écart au panier ;
- TEXACO au trafic ;
- `ap.mode` accepte `tanker` et `refuelMode` ;
- un e2e.

**3. Console EN** — ✅ fait le 2026-10-21 ([fiche](progress/crew/P3-console-en.md)) : l'i18n de `src/crew/` (vues, panneaux, checklists, phases d'amarrage), et les réponses du jeu dans
la langue de la console.

**4. Vaisseaux par appareil** — ✅ fait le 2026-10-21 ([fiche](progress/crew/P4-vaisseaux.md)) :
- Lander : une vue de descente et le LPD depuis le crew ;
- Endurance : l'anneau et la flotte, des ordres de flotte ;
- côté Gargantua : une orbite de Kerr (r · E · L), des messages justes, l'état posé ;
- vérifier le chiffre de dilatation.

**5. PLAN-RADAR-AAA** : RD0 (la sonde et les mesures P1–P11), puis RD1, puis la suite. Reconnexion et passage des
commandes suivis par le crew.

**6. Postes** : des droits par poste, l'emplacement à bord ou au sol vérifié, le délai réglé par la salle, la voix
retardée ou coupée comme le texte.
