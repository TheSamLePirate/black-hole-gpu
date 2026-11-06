# Plan : la seconde vue — capteurs et caméra secondaire

**Statut : plan, rien d'implémenté.** Rédigé le 6 novembre 2026 à la demande de Sam :

> « Je veux pas de particules… Il faudra un instrument en fausse couleur, photo, infrarouge, false-colour mode (AM8,
> Hubble/Juno ultraviolet, JWST infrared)… en option dans la vue. On en fabriquera un capteur qui montre toute donnée
> scientifique non visible à l'œil nu (à faire plus tard). Comme une seconde vue, comme dans Predator. Puis caméra
> secondaire (radar style, méga-zoom, infrarouge, magnétosphère, potentiel gravitationnel, et plein d'autres trucs…).
> Créer un plan pour ça. AAA + perf (la seconde caméra peut être de moins bonne qualité ou fps si besoin). »

## 0. Décisions de Sam (6 novembre 2026)

1. **Pas de particules** dans le schéma des magnétosphères (AM7 : giration, rebond, dérive abandonnés).
2. **AM8 (fausses couleurs « instrument ») devient un mode de ce plan**, pas un lot des aurores : l'ultraviolet de
   Hubble et de Juno, l'infrarouge de JWST, en option dans la vue.
3. **Un capteur « seconde vision »** — montrer ce que l'œil ne voit pas — en plein écran, à la manière de la vision
   thermique de Predator : plus tard, après la caméra secondaire.
4. **Une caméra secondaire** : radar, méga-zoom, infrarouge, magnétosphère, potentiel gravitationnel, et d'autres
   canaux. Elle peut être **de moindre qualité ou de moindre cadence** que la vue principale.
5. AAA et performance : la seconde vue ne doit pas faire tomber la vue principale sous son palier de cadence.

## 1. Raccord à la destination (ANALYSE-STRATEGIE-RENDU-2026-11-03)

- **Une responsabilité, plusieurs lecteurs (§7).** Le monde, la simulation et les données gardent leurs sources ;
  chaque canal est un *lecteur* : il ne recalcule pas un modèle à part. Le magnétisme vient d'AM0
  (`magnetic-fields.ts`), le vent solaire de `solar-wind.ts`, les aurores de `aurora-lines.ts` / `aurora-bodies.ts`,
  la gravité des éphémérides et des masses du jeu, le radar de PLAN-RADAR-AAA, le relief et le sol de leurs
  fournisseurs communs.
- **Le renderer possède ses cibles (§7).** La caméra secondaire est une **seconde cible** du même renderer (comme le
  rendu hors ligne et les sondes des planètes : ses propres paramètres, sa propre soumission), pas un second moteur.
- **Préparer avant la frame (§8).** Les noyaux d'un canal sont compilés **à l'ouverture du capteur**, pas au premier
  regard ; les tables (palettes, champs, potentiels) sont prêtes en worker. Leçon de ce jour : le noyau de Jupiter
  proche met ~200 s à compiler à froid (`docs/PROBLEMES-A-REGLER.md`) — une seconde vue ne doit pas ajouter de telles
  attentes.
- **Pas d'opaque en double (§20).** Un canal qui a besoin de la géométrie lit la profondeur, l'identité et les
  normales de la vue qui le porte ; il n'ajoute pas un second rendu opaque permanent du même domaine.
- **Provenance visible (§13.4 de la recherche de données).** Chaque canal dit ce qu'il montre : *observé* (une donnée
  mesurée datée), *modèle* (un calcul physique), *schéma* (une représentation choisie) ou *scénario* (une hypothèse
  déclarée). Une fausse couleur n'est jamais présentée comme une vue réelle.

## 2. Ce qui existe et sera réutilisé

| Brique | Où | Ce qu'elle apporte |
|---|---|---|
| Cibles de rendu multiples | `renderer.ts` (rendu hors ligne, `probe: { cam, hide }` des planètes) | une seconde caméra, ses paramètres, sa soumission à part |
| Téléobjectif et posemètre propre | `photo/plans.ts` (C9 : chaque disque pris au téléobjectif, son propre posemètre) | le méga-zoom, l'exposition d'une petite vue |
| Calque de lignes avec profondeur | `chartoverlay.ts`, `overlay.wgsl` (AM7) | dessiner des données 3D derrière ce qui les cache |
| Passe de volume légère | `overlay.wgsl` `fsMagVol` (AM7) | couches émissives, demi-résolution, arrêtées à la profondeur |
| Schéma de la magnétosphère | `magneto-lines.ts`, AM7 | le canal « magnétosphère » tel quel |
| Radar | PLAN-RADAR-AAA | le canal « radar » (pistes, balayage, symbologie) |
| DAS/EOTS synthétique | PLAN-PCD-AAA Q7 | l'habillage « caméra infrarouge » du F-35, sans second rendu |
| Pages des écrans de cockpit | `ui/cockpitscreens.ts`, PCD | un écran où afficher la caméra secondaire |
| Console d'équipage | `crew/` | un poste « capteurs » pour un équipier |
| TARS agent | PLAN-TARS-AGENT | les actions (pointer, zoomer, changer de canal, capturer) |

## 3. Les deux présentations

**A. La caméra secondaire (d'abord).** Une fenêtre incrustée (et une page d'écran de cockpit, un poste d'équipage)
montrant **une autre pose** que la vue principale : asservie à la vue, à une cible, à la nacelle d'un capteur du
vaisseau, ou libre. Champ de 90° à 0,005° (méga-zoom). Résolution réduite (par défaut 640×360, jusqu'à 960×540) et
cadence réduite (par défaut 20 Hz, rendue une image principale sur trois), sous un budget GPU.

**B. La seconde vision (plus tard).** Le même canal appliqué **à la vue principale**, en plein écran, avec une
transition (balayage, bruit de capteur) : on bascule de l'œil au capteur. Elle réutilise les canaux de A ; seule la
présentation change.

## 4. Les canaux

| Canal | Ce qu'il montre | Source (un lecteur) | Provenance | Coût |
|---|---|---|---|---|
| **Visible / méga-zoom** | la même image, autre pose, champ jusqu'à 0,005° | le traceur, seconde cible | réel du jeu | un rendu réduit |
| **Magnétosphère** | lignes, frontières, ceintures, tore (AM7), vent réel | AM0, `solar-wind.ts` | modèle + observé (vent) + schéma | calque + volume ½ rés. |
| **Ultraviolet (Hubble, Juno UVS)** | aurores en UV (H₂ Lyman–Werner de Jupiter, Saturne, Uranus ; LBH terrestre), lueur de jour, albédo UV | `aurora-bodies.ts` avec les kR UV (MR), raies UV | modèle (observé quand calibré, lot G) | une variante du noyau |
| **Infrarouge proche/moyen (JWST, JIRAM)** | H₃⁺ des géantes à 3–4 µm, bande du méthane, volcans d'Io | aurores (AM3–AM5), cartes de surface | modèle / observé daté | une variante du noyau |
| **Infrarouge thermique (8–14 µm)** | températures : sol jour/nuit, mers, nuages froids, moteurs et panaches chauds, rentrées | un modèle de température par matériau (cycle diurne, inertie), les moteurs du jeu | modèle | une variante du noyau |
| **Potentiel gravitationnel** | isopotentielles, accélération, marées, points de Lagrange ; près de Gargantua : décalage gravitationnel, entraînement des référentiels | masses et éphémérides du jeu, métrique de Kerr | modèle | une passe plein écran analytique, sans traceur |
| **Radar** | balayage, échos du relief et des cibles, réflectivité de la météo | PLAN-RADAR-AAA, relief, météo | modèle | une passe à partir de la profondeur |
| **Profondeur / lidar** | distance, relief en courbes | profondeur de la cible | réel du jeu | quasi nul |
| **Vitesse / Doppler** | décalage spectral de chaque pixel (relativiste près du trou noir) | le traceur (déjà calculé) | modèle | une sortie de plus |
| **Atmosphère** | colonne d'air, aérosols, ozone, lumières des villes | tables d'air partagées (Q5) | modèle | une passe |

Chaque canal a : une **palette** (colorimétrie choisie, légende graduée, unités métriques), une **échelle**
(linéaire, log, auto) et une **étiquette de provenance**. Les canaux « observés » portent leur date et leur source.

## 5. Architecture

1. **Un contrat `SensorChannel`** (`src/sensors/`) : identifiant, données lues, palette, unités, provenance, classe de
   coût, et ce qu'il demande au renderer (une variante de noyau, une passe sur la profondeur, un calque).
2. **Une seconde cible** dans le renderer : sa caméra (pose, champ), sa taille, sa cadence, son posemètre, son
   historique temporel à elle (pas celui de la vue principale), ses noyaux spécialisés par canal (constantes : le
   canal hors des noyaux de la vue principale, aucun coût quand le capteur est fermé).
3. **Un ordonnanceur** : la seconde cible rendue entre deux images principales, dans un budget (par défaut 15 % du
   temps GPU de l'image principale, ajusté par la résolution puis la cadence), jamais au détriment du palier de la
   vue principale ; arrêtée quand elle est cachée.
4. **Les sorties** : une texture lue par la fenêtre incrustée, la page de cockpit, le poste d'équipage et les
   captures ; la même texture pour la seconde vision (plein écran) avec sa transition.
5. **Les commandes** : une barre de la fenêtre (canal, zoom, asservissement, palette), les mêmes actions pour TARS,
   le clavier, le HOTAS et l'équipage — un seul jeu d'actions métier.

## 6. Les lots

| Lot | Contenu | Fait quand | Mesure |
|---|---|---|---|
| **S0** | Le contrat `SensorChannel`, la seconde cible (visible), la fenêtre incrustée (taille, position, masquer), l'asservissement à la vue | une fenêtre montre la scène sous une autre pose, sans artefact, réglage « Caméra secondaire » | coût de la seconde cible : A/B mini, 640×360 à 20 Hz |
| **S1** | Méga-zoom : champ jusqu'à 0,005°, nacelle stabilisée, poursuite d'une cible (corps, avion, navire, satellite), posemètre propre | l'ISS suivie depuis le sol, un atterrissage sur la Lune vu depuis la Terre | stabilité (gigue en pixels), coût |
| **S2** | Canal magnétosphère (AM7 dans la seconde vue) | le schéma dans la fenêtre pendant que la vue principale reste réaliste | coût |
| **S3** | Canal potentiel gravitationnel (passe analytique : isopotentielles, accélérations, Lagrange ; Gargantua : décalage et entraînement) | les cinq points de Lagrange Terre–Lune visibles et légendés ; l'ergosphère près de Gargantua | coût de la passe |
| **S4** | Canal radar (balayage, échos du relief et des cibles, météo) relié à PLAN-RADAR-AAA | un radar en balayage dans la fenêtre, cohérent avec la page radar du F-35 | coût |
| **S5** | Canal infrarouge thermique (température par matériau, cycle diurne, moteurs et panaches) — remplace à terme l'EOTS synthétique de PCD Q7 | un F-35 chaud sur un sol froid de nuit ; un retour de rentrée | coût de la variante |
| **S6** | Canaux UV et IR astronomiques (l'ancien AM8) : aurores UV de Jupiter, Saturne, Uranus (H₂), IR H₃⁺, Io en IR | les aurores d'Uranus et de Neptune enfin visibles, en fausse couleur, étiquetées « UV — modèle » | coût |
| **S7** | La seconde vision plein écran (Predator) : bascule, transition, bruit de capteur, légende | basculer œil ↔ capteur sans à-coup de cadence | cadence pendant la bascule |
| **S8** | TARS, HOTAS, page de cockpit, poste d'équipage, captures et replay du capteur | TARS pointe la caméra sur une cible et change de canal par la parole | — |
| **S9** | Campagne de performance et documentation (`docs/CAPTEURS.md` FR/EN), planche finale | toutes les mesures A/B, aucune régression de la vue principale | A/B complet |

L'ordre : **S0 → S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9**. Le capteur « seconde vision » (S7) vient après les
canaux, comme Sam l'a demandé (« à faire plus tard »).

## 7. Performance

- **Budget** : la seconde vue prend au plus 15 % du temps GPU de l'image principale (par défaut 640×360 à 20 Hz) ; au
  besoin elle baisse sa résolution, puis sa cadence, jamais la vue principale.
- **Rien quand c'est fermé** : canaux hors des noyaux de la vue principale (constantes), passes non encodées.
- **Compilations anticipées** : à l'ouverture du capteur et au choix d'un canal, en tâche de fond, avec un état
  lisible (« compilation du canal… ») ; aucune attente silencieuse.
- **Mesures** : chaque lot avec un A/B sur kerr-mini (Nominal), ABAB, médiane, échelle de rendu notée (méthode
  d'`aurora-cost.e2e.test.ts`) ; les chiffres dans le journal, pas de gain revendiqué sans mesure.

## 8. Ce qui reste à décider (Sam)

- La place par défaut de la fenêtre (coin, taille) et son raccourci clavier.
- Les palettes : « scientifique » (viridis, échelles graduées) ou « tactique » (vert phosphore, blanc chaud), ou les deux.
- Pour l'infrarouge thermique : quelle source de températures de surface d'abord (modèle diurne seul, ou climatologies
  observées — recherche de données § 12.6).
