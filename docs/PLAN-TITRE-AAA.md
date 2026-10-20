# Plan — l'écran titre, l'intro, le menu pause et les réglages, AAA

Sur `main`. Objectif : l'arrivée dans le jeu au niveau d'un titre AAA. On part d'un écran noir. Viennent ensuite
une intro (studio, nom, logo), puis un menu titre où l'on choisit **comment jouer** : à pied, en avion, en
vaisseau, en caméra libre. Tout ce parcours se fait **pendant** le chargement des assets et la compilation des
shaders. Le menu pause et les réglages sont refaits dans le même langage visuel.

## Décisions (2026-10-18)

| question | réponse |
|---|---|
| pendant le chargement | **écran noir → fondu vers le nom → puis le logo**, sur un **fond procédural simple mais beau**, avec un **orbe de chargement** ([thinking-orbs](https://github.com/Jakubantalik/thinking-orbs)), comme le démarrage d'un jeu, avec **les crédits (SamLePirate)** : une intro AAA pendant le chargement |
| réglages | **écran joueur + Labo** : un écran plein écran façon console (Jeu, Graphismes, Affichage, Audio, Commandes, Accessibilité, Interface, Réseau) ; le tiroir actuel devient le **Labo** (trou noir, matière, physique, caméra) |
| après le choix du mode | **un écran de lancement par mode** : monde et lieu, activité, vaisseau puis destination, puis un briefing et LANCER |
| son des menus | **pas de musique** ; les sons d'interface déjà présents (`audio/director.ts`) sont gardés |

## État de départ (analysé le 2026-10-18)

Captures : [`progress/title-aaa/before/`](progress/title-aaa/before/).

### Ce qui existe

- **Le chargement** (`index.html` `#loading`, `ui/splash.ts`, `loading.ts`)
  - Un trou noir en CSS pur. Il continue de tourner pendant que le thread principal compile.
  - Un titre KERR, une barre, la liste des étapes (« BOOT SEQUENCE ») et des astuces.
  - Il disparaît à la première image, une fois les assets arrivés (12 s au plus après la première image).
  - Les étapes suivies sont `gpu`, `shaders`, `pipelines`, `ephemeris`, `sky`, `stars`, `maps`, `earth`, puis
    à la demande `scene-tracer`, `ranger`, `endurance` et `iss`.
- **L'écran titre** (`ui/title.ts`, 143 lignes)
  - Cinq entrées : Continuer (seulement s'il y a une sauvegarde automatique), Missions, Explorer, Mode photo,
    Réglages.
  - En pied de page : le lien Kerr Bench (il recharge la page avec `#bench`), FR/EN (qui recharge aussi la
    page) et la version.
  - La scène sauvegardée est chargée derrière, le temps arrêté : Continuer ne fait que lever l'écran.
  - Il n'est construit qu'**après** `await Renderer.create()` et `await ephemerides`
    (`main.ts:7353`–`7443`). Il apparaît sous le splash, puis par-dessus.
- **Les modes** (`game/modes.ts`) : `ship | foot | free | photo`. On en change avec `setGameMode()`
  (`main.ts:3616`) ou F1–F4.
- **Les vaisseaux** (`vessels.ts`) : Ranger, Lander, Endurance et F-35B. Le choix est `settings.vessel` →
  `switchVessel()`. Le F-35 est aligné sur la piste la plus proche (`tools.lineUp`).
- **Le placement** (`game/tools.ts`) : `lineUp`, `flyAt`, `glideTo`, `orbit`, `land`, `walk`, `near`,
  `wormhole`, `preset`, `load`.
- **Les activités existantes, chacune dans sa modale**
  - `MissionSelect` : 6 missions spatiales.
  - `SceneGallery` : 94 scènes, avec vignettes `SCENE_THUMBS`.
  - Missions aériennes : 13, avec `briefMission`.
  - `ChallengePanel` : 6 défis, environ 4 combats, de la voltige.
  - `flightSchool` : environ 8 leçons, en démo, essai ou guidé.
  - Ainsi que `atlas`, `placePanel` et `BenchScreen`.
- **La pause** (`ui/pause.ts`) : 19 entrées à plat sur deux colonnes, plus les sous-pages Sauvegarder et Charger.
- **Les réglages** (`ui/panel.ts`, `ui/schema.ts`)
  - Un tiroir de 340 px à droite, avec 7 onglets et environ **332 contrôles**.
  - La répartition : Caméra 29, Scène 19, Matière 45, Ciel 29, Physique 17, Rendu 31, **Jeu 162**.
  - Une recherche ⌘K, un interrupteur Avancé, l'annuler/rétablir.
- **La manette dans les menus** (`ui/padnav.ts`) : seulement haut/bas, A et B. Le tiroir des réglages et la
  galerie ne mettent pas le jeu en pause, la manette ne peut donc pas s'y déplacer.
- **Le style** (`ui/kit/kit.css`, `ui/menus.css`)
  - Rajdhani en capitales, JetBrains Mono, Inter.
  - Ambre `--k-amber` #ffb35c, cyan `--k-on` #6fd2ff, cadres à crochets.

### Ce qui ne va pas

| # | constat | capture |
|---|---|---|
| 1 | L'écran titre s'affiche **par-dessus** le splash : deux logos KERR, deux listes, un menu à gauche et la « BOOT SEQUENCE » au centre | `01-titre-pendant-chargement.jpg` |
| 2 | Le titre est une liste de boutons en sombre sur sombre : texte centré, indication collée au libellé, pas de hiérarchie, pas d'image. Un menu d'outil plutôt qu'un menu de jeu. | `02-titre.jpg` |
| 3 | Les entrées ne disent pas *comment on joue* (à pied, en avion, en vaisseau, caméra libre) mais *où sont les outils* (Missions, Explorer, Photo) | — |
| 4 | Pause : la colonne de droite est **coupée**. `grid-template-columns: 1fr 1fr` avec des indications en `nowrap` donne 1 130 px de contenu dans 718 px. | `04-pause.jpg` |
| 5 | Pause : 19 entrées au même niveau ; « Télécharger le diagnostic graphique » en 6ᵉ position ; aucun regroupement ni contexte (où je suis, ma mission) | `04-pause.jpg` |
| 6 | Réglages : la physique du trou noir (spin, masse) au même niveau que la vitesse de marche ; « Jeu » compte 162 contrôles ; restes d'anglais en FR (« Browse », « My presets ») ; pas de navigation clavier ni manette | `03-reglages.jpg` |
| 7 | Missions : les libellés sont centrés et coupés (« ERSTELLAR — LE VOYAGE ») | `05-missions.jpg` |
| 8 | Le titre annonce « 79 scènes », la galerie en compte 94 | `02`, `06` |
| 9 | Rien n'est utilisable avant la première image : au premier démarrage sous Windows, plusieurs minutes devant une barre | — |
| 10 | Changer de langue recharge la page | — |

## La proposition

### Direction artistique — « l'observatoire relativiste »

- **Le ton.** Le silence de l'espace, la précision d'un instrument, la chaleur du disque d'accrétion. On vise
  plutôt *Interstellar* que *Star Wars* : peu d'éléments, beaucoup de noir, une seule source de lumière chaude.
- **La palette.**
  - Le noir profond `#020409`.
  - L'ambre du disque (`--k-amber`), réservé à ce qui est **actif ou choisi**.
  - Le blanc chaud `#f3f7ff` pour les titres.
  - Le cyan `--k-on`, gardé pour les **valeurs** et l'instrumentation : il n'apparaît plus comme couleur de
    menu.
- **La typographie.**
  - Le logo : un mot-symbole « KERR » en SVG, dessiné d'après Rajdhani 700, interlettrage 0,32 em, avec une fine
    coupe horizontale qui évoque le disque vu par la tranche.
  - Les titres en Rajdhani 600 capitales ; les textes en Inter ; les valeurs en JetBrains Mono.
  - L'échelle : 120 / 48 / 28 / 18 / 15 / 12 px.
- **Le mouvement.**
  - Une seule courbe, `cubic-bezier(0.16, 1, 0.3, 1)` (sortie expo), sur 180 à 350 ms. Rien ne rebondit.
  - Les entrées de menu arrivent en cascade (40 ms d'écart).
  - Le focus : une barre ambre à gauche, un léger halo, un décalage de 6 px vers la droite. Pas de mise à
    l'échelle sur le texte.
- **La matière.**
  - Grain photographique très léger et vignettage sur les écrans plein écran.
  - Pas de flou d'arrière-plan (`backdrop-filter`) sur le canvas WebGPU : c'est coûteux et cela dégrade le
    tracé. On utilise des dégradés.
- **La zone sûre.** 5 % de marge façon télé ; tout reste lisible sur iPad et au téléphone (`body.mobile`).

### Le parcours

```
[noir] → [SAMLEPIRATE présente] → [K E R R] → [le logo se forme] → MENU TITRE
                                                                     │  (l'orbe de chargement, en bas à droite,
                                                                     │   tant que le jeu se prépare)
 ├─ CONTINUER ───────────────────────────────────────────────→ la partie sauvée (déjà chargée derrière)
 ├─ À PIED ────── monde → lieu → heure & météo ──────────────→ LANCER
 ├─ EN AVION ──── Vol libre | Combat | École de vol | Défis ──→ départ / briefing → LANCER
 ├─ EN VAISSEAU ─ hangar (Ranger, Lander, Endurance) → Missions | Destination libre → LANCER
 ├─ CAMÉRA LIBRE  Trous noirs | Gargantua | Trou de ver | Système solaire | Terre → LANCER
 ├─ PLUS… ─────── Scènes · Charger · Photo & rendus · Jouer ensemble · Éditeur de missions
 │                · Kerr Bench · Comment jouer · Crédits
 └─ RÉGLAGES ──── l'écran joueur (et le Labo)
```

Les **missions existantes** sont rangées par mode, plutôt que de rester dans une entrée « Missions » à part :

| mode | missions et activités |
|---|---|
| vaisseau | les 6 missions spatiales |
| avion | les 13 missions aériennes, les combats, les défis, les leçons |
| caméra libre | les visites de Gargantua et du trou de ver |

« Plus… › Scènes » garde l'accès à toutes les scènes.

### 1. L'intro pendant le chargement

L'intro commence **avant que le JavaScript du jeu ne soit chargé**. Elle est statique dans `index.html`, avec son
CSS critique en ligne, et ne s'anime qu'avec `opacity` et `transform` sur le compositeur. Elle ne saccade donc
jamais, même quand le thread principal compile.

| t | ce qu'on voit |
|---|---|
| 0 – 0,6 s | noir |
| 0,6 – 2,6 s | **SAMLEPIRATE** · *présente*. Petit, centré, blanc chaud : apparition en 0,6 s, tenu 1 s, disparition en 0,4 s |
| 2,8 – 4,8 s | **K E R R**. L'interlettrage se resserre de 0,8 em à 0,32 em, un reflet de lumière passe une fois dans les lettres |
| 4,8 – 6,0 s | **le logo se forme**. L'anneau de photons se trace (SVG `stroke-dashoffset`), le disque se dessine en bas puis par-dessus. Le nom et le logo glissent vers leur place dans le menu |
| 6,0 s → | le **fond procédural** apparaît en fondu ; les entrées du menu arrivent en cascade ; l'**orbe** se pose en bas à droite |

- **Passer l'intro** : n'importe quelle touche, un clic, un toucher ou A amènent au menu en moins de 300 ms.
  L'intro complète ne se joue qu'au **premier lancement de chaque version**. Les fois suivantes, une version
  courte de 1,5 s : noir, puis logo et nom ensemble, puis le menu.
- **`prefers-reduced-motion`** : le menu tout de suite, seulement des fondus.

**Le fond procédural.** Un `<canvas>` passé à un **Worker** avec `transferControlToOffscreen` : son animation ne
dépend pas du thread principal.

- Le contenu, en WebGL2 :
  - trois couches d'étoiles en parallaxe très lente, qui scintillent ;
  - une brume galactique ambre et bleu nuit (fbm à basse fréquence) ;
  - au loin, un **anneau de photons stylisé** qui dévie les étoiles derrière lui (une déviation analytique bon
    marché, pas un tracé de géodésiques) : le jeu annoncé en une image.
- Le budget : demi-résolution, plafonné à 30 i/s, **≤ 0,5 ms de GPU**.
- Repli : canvas 2D, ou un dégradé CSS si le navigateur n'a pas OffscreenCanvas avec WebGL2.
- À la première image du vrai lancer de rayons, **fondu de 1,2 s** vers la scène vivante (la partie sauvée, ou
  une scène d'accueil). Le Worker est alors arrêté.

**L'orbe de chargement** : [thinking-orbs](https://github.com/Jakubantalik/thinking-orbs), licence MIT, © Jakub
Antalik.

- Son entrée `thinking-orbs/engine` est **sans React et sans DOM** : de la géométrie pure qui rend une liste de
  points triés, que l'on dessine nous-mêmes.
- Il est dessiné dans le **même Worker**, sur un second OffscreenCanvas. Il tourne donc pendant la compilation.
- On le teinte nous-mêmes : points blanc chaud, les plus proches en ambre.
- Il fait 96 à 128 px (le profil 64 dessiné à l'échelle ×2), avec à côté le nom de l'étape et le pourcentage.
- Chaque étape de `loading.ts` choisit l'état de l'orbe :

| étape | état de l'orbe |
|---|---|
| `gpu` (adaptateur, device) | `connecting` |
| téléchargements (`ephemeris`, `sky`, `stars`, `maps`, `earth`) | `searching` |
| `shaders` (modules WGSL) | `weaving` |
| `pipelines`, `scene-tracer` (compilation du tracé) | `solving` |
| première image | `composing` |
| prêt | `breathing`, puis l'orbe s'efface en fondu |

- Le détail des étapes (la « BOOT SEQUENCE ») reste disponible : un clic sur l'orbe déplie la liste. Le menu,
  lui, reste propre.
- **Après le démarrage**, l'orbe remplace la petite pastille d'assets (`AssetPill`) quand un vaisseau, une carte
  ou un noyau de scène se charge en jeu.

**Les crédits.**

- La carte « SAMLEPIRATE présente » au début de l'intro.
- La ligne « © SamLePirate · version » en pied du menu.
- Un écran **Crédits** déroulant dans Plus…, qu'on peut passer. Il contient :
  - créé par SamLePirate ;
  - les données : NASA/JPL (DE440, JUP365), ESA Gaia DR2, Hipparcos/HYG, LRO LOLA et MGS MOLA, NASA GIBS,
    OpenStreetMap, Open-Meteo ;
  - les modèles : Ranger, Lander, Endurance, F-35B, l'astronaute, ISS et porte-avions, d'après les README de
    `assets/` ;
  - les polices (OFL) et thinking-orbs (MIT).
- La source unique est un `CREDITS.md`, généré depuis les README des assets.

### 2. Le menu titre

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  ◯ K E R R                                                                               │
│  UN VOL À TRAVERS L'ESPACE-TEMPS DE KERR                                                 │
│                                                                                          │
│  ┌──────────────────────────────────────────────┐                                        │
│  │ ▌CONTINUER   Ranger · orbite basse · 21:40    │   (fond : la scène vivante,           │
│  │             [vignette]  sauvé il y a 2 h      │    ou le fond procédural)             │
│  └──────────────────────────────────────────────┘                                        │
│                                                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                                     │
│  │ [art]    │ │ [art]    │ │ [art]    │ │ [art]    │                                     │
│  │          │ │          │ │          │ │          │                                     │
│  │ À PIED   │ │ EN AVION │ │ EN VAIS- │ │ CAMÉRA   │                                     │
│  │          │ │          │ │ SEAU     │ │          │                                     │
│  │ Marcher  │ │ F-35B ·  │ │ Ranger,  │ │ LIBRE    │                                     │
│  │ sur la   │ │ combat · │ │ Lander,  │ │ Les trous│                                     │
│  │ Terre…   │ │ leçons   │ │ Endurance│ │ noirs    │                                     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                                     │
│                                                                                          │
│  PLUS…   RÉGLAGES                                                                         │
│                                                                                          │
│  © SamLePirate · e664e0aa   FR | EN                  ✺ Compilation du lancer… 84 %       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Les cartes de mode** : portrait 3:4, avec une illustration (key art).

- Au focus, la carte s'élargit (de 1 à 1,25 de largeur, par la grille, pas par une mise à l'échelle) et son
  image bouge lentement (Ken Burns, 12 s).
- Un court texte apparaît, avec les activités du mode.
- Le fond ne change pas : changer la scène vivante demanderait une compilation.

**Continuer** est une large bannière, avec le résumé de la sauvegarde, son ancienneté et une **vignette**. La
vignette est une image 320×180 prise de la vue quand on sauvegarde (pause, F5, sauvegarde automatique au plus une
fois par minute), et rangée avec la sauvegarde.

**La navigation.**

- Les flèches ou le stick se déplacent **en 2D** : la bannière, la rangée de cartes, puis la ligne du bas.
- Entrée ou A valide ; Échap ou B revient.
- La souris met le focus au survol.
- Les indications de touches suivent le **dernier périphérique utilisé** : clavier, manette (glyphes A/B/LB/RB)
  ou toucher (pas d'indications).

**Utilisable pendant le chargement.**

- Le menu est **construit avant `Renderer.create()`**. Il ne dépend que du DOM, de `localStorage` (la
  sauvegarde, les réglages) et des listes statiques : missions, scènes, vaisseaux, leçons.
- Choisir un lancement pendant le chargement **met l'intention en file**. Le bouton LANCER devient
  « LANCEMENT DÈS QUE PRÊT », avec l'orbe à l'intérieur et le pourcentage. L'intention est jouée à la première
  image.
- **Préchargement par intention.**
  - Survoler ou choisir *En avion* lance le téléchargement du GLB du F-35 et de ses textures.
  - *À pied* : l'astronaute. *En vaisseau* : le maillage du vaisseau choisi.
  - Si le noyau spécialisé de la scène n'a pas encore commencé à compiler, il est **reciblé** sur la scène
    choisie. Cela évite une seconde compilation d'environ 30 s (`scene-tracer`). À mesurer en E0.

### 3. Les écrans de lancement

Une même maquette pour tous :

- à gauche, les choix, par étapes (fil d'Ariane : *En vaisseau › Lander › Surface lunaire*) ;
- à droite, une grande image, le titre, la description, les caractéristiques et les commandes utiles ;
- en bas, LANCER (A, Entrée) et RETOUR (B, Échap).

On réutilise **la logique** des modales existantes (`briefMission`, `flightSchool`, `ChallengePanel`,
`MissionSelect`, `SceneGallery`). Seule leur présentation change : elles deviennent des pages du routeur.

**À PIED**

1. **Le monde** : la Terre, la Lune, Mars, puis « Autres mondes » (tous les corps solides où l'astronaute marche).
2. **Le lieu** : des lieux choisis, avec vignettes (les POI de l'Atlas). Ou « Choisir sur la carte » (l'Atlas en
   mode sélection), ou une recherche d'adresse sur Terre (Photon).
3. **L'heure et la météo**, sur Terre :
   - l'heure : maintenant (réelle), aube, midi, crépuscule, nuit ;
   - la météo : claire, réelle, nuageuse, orage.
4. LANCER, avec `tools.walk(body, lat, lon)`.

**EN AVION (F-35B)**, en quatre onglets :

- **Vol libre**
  - Le départ : sur la piste, en vol, en finale ou sur un porte-avions.
  - L'aérodrome : recherche et favoris.
  - L'heure et la météo.
  - Les appels : `lineUp`, `flyAt`, `glideTo`.
- **Combat** : les 13 missions aériennes et les combats libres, avec leur briefing.
- **École de vol** : les leçons, chacune en démo, essai ou guidé.
- **Défis** : les 6 défis et la voltige, avec les meilleurs scores.
- Avec le réseau activé : *En escadrille* (créer ou rejoindre une salle).

**EN VAISSEAU**

1. **Le hangar** : un carrousel Ranger / Lander / Endurance.
   - Chaque vaisseau est une **rotation pré-rendue** (36 vues webp, tournables à la souris ou au stick), donc
     sans GPU et disponible dès l'intro.
   - Sa fiche : rôle, masse, Δv, où il vole.
2. **Missions** du vaisseau (Artemis II, l'amarrage à l'ISS, le décollage lunaire, Interstellar, l'approche de
   Gargantua, le trou de ver), ou **destination libre**. Seules les destinations compatibles sont proposées :
   pas de tir, orbite basse, ISS, orbite lunaire, surface lunaire (Lander), Saturne, Gargantua, trou de ver.
3. Le briefing, puis LANCER, avec `orbit`, `land`, `near`, `wormhole` ou `preset`.

**CAMÉRA LIBRE**

- Les destinations par famille : trous noirs (14), Gargantua (17), trou de ver (6), système solaire (18),
  Terre (21), paysages.
- Une grande image et une description pour chacune, plus « ouvrir en mode photo ».
- C'est la galerie de scènes, refaite en plein écran.

**PLUS…** :

- Toutes les scènes, Charger une partie.
- Mode photo et rendus.
- Jouer ensemble, Éditeur de missions.
- **Kerr Bench**, avec une confirmation : « la page va se recharger ».
- Comment jouer et Découvrir (`docs/comment-jouer.html`, `docs/decouvrir.html`).
- Crédits, Langue.

**L'entrée en jeu.**

- LANCER fait sortir le menu en glissant, puis un fondu au noir de 400 ms.
- Si un noyau compile, un **écran de chargement de scène** prend le relais : l'image du mode, l'orbe, l'étape et
  une astuce qui correspond au mode.
- Puis fondu depuis le noir. Le **HUD s'allume** en 600 ms, élément par élément (son démarrage).

### 4. Le menu pause

```
┌──────────────────────────────────────────────┬───────────────────────────────────────────┐
│  PAUSE                                       │  RANGER · ORBITE BASSE TERRE              │
│  Ranger · 412 km · 18 oct. 21:40 (UTC)       │  ┌─────────────────────────────────────┐  │
│                                              │  │ MISSION  Artemis II                 │  │
│  ▌REPRENDRE                                  │  │ ✓ Ouvrir l'onglet MISSION           │  │
│   SAUVEGARDER                     F5         │  │ ◇ Planifier un retour libre         │  │
│   CHARGER                         F9         │  │ ◇ Passer derrière la Lune           │  │
│   ─────────                                  │  └─────────────────────────────────────┘  │
│   CAPTURE ›     instant · rendu · photo      │  Temps de jeu 1 h 12 · sauvé il y a 3 min │
│   MONDE ›       atlas · placer · heure…      │                                           │
│   CIEL ›        d'ici · observatoire…        │  ASTUCE  O ouvre l'ordinateur de vol      │
│   CHANGER DE MODE ›                          │                                           │
│   ─────────                                  │                                           │
│   RÉGLAGES · COMMANDES                       │                                           │
│   RETOUR AU TITRE                            │                                           │
└──────────────────────────────────────────────┴───────────────────────────────────────────┘
```

- **Le cadre.** Pleine hauteur, à gauche, comme le titre : un dégradé sur la scène figée, pas une modale
  centrée.
- **Les groupes.** Moins de 10 entrées au premier niveau, avec des sous-menus en tiroir (une deuxième colonne et
  un fil d'Ariane ; B ou Échap remonte d'un niveau).
- **La colonne de contexte**, qui change selon le mode :
  - en vol : la mission et ses objectifs ;
  - sans mission : l'état du vol (altitude, vitesse, carburant) ;
  - à pied : le lieu ;
  - partout : le temps de jeu, la dernière sauvegarde et une astuce.
- **Changer de mode ›** ouvre les écrans de lancement (À pied, Avion, Vaisseau, Caméra libre) sans repasser par
  le titre.
- **Rendre les commandes** n'apparaît que si quelque chose est engagé, comme aujourd'hui.
- **Le diagnostic graphique** part dans Réglages › Avancé.
- **Retour au titre** demande une confirmation si la dernière sauvegarde a plus de 5 minutes.
- **En salle réseau**, l'horloge commune ne s'arrête pas. La pause dit « LE JEU CONTINUE » et ne fige pas la
  simulation. Le comportement actuel est à vérifier en E8.
- Le débordement est corrigé (`minmax(0, 1fr)`), avec des indications sur une ligne et des points de suspension.

### 5. Les réglages : l'écran joueur et le Labo

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  RÉGLAGES     [LB]  JEU  GRAPHISMES  AFFICHAGE  AUDIO  COMMANDES  ACCESSIBILITÉ  …  [RB] │
│ ─────────────────────────────────────────────────────────────────────────────────────────│
│  Qualité                  ◂  HAUTE  ▸        │  QUALITÉ                                   │
│  Échelle de rendu         ███████░░░  85 %   │  Le nombre de rayons par pixel et la       │
│  Images par seconde max   ◂  60  ▸           │  précision du tracé. HAUTE : ~45 i/s sur   │
│  Nuages volumétriques     ●  Oui             │  cette machine (mesuré au Kerr Bench).     │
│  ▌Forêts et bâtiments     ◂  DENSES  ▸       │  Coût GPU ●●●○○                            │
│  …                                           │  Par défaut : HAUTE      [image d'aperçu]  │
│ ─────────────────────────────────────────────────────────────────────────────────────────│
│  Échap Retour   R Réinitialiser l'onglet   ⌘K Rechercher                    LABO ›        │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Les onglets.**

| onglet | contenu |
|---|---|
| Jeu | à pied, F-35, Ranger, aides au pilotage, trafic, sauvegardes |
| Graphismes | qualité, rendu temps réel, image convergée |
| Affichage & HUD | aides HUD, affichages, casque, cockpit |
| Audio | son, voix de TARS |
| Commandes | l'écran des commandes et celui des manettes, réunis |
| Accessibilité | — |
| Interface | langue sans rechargement si possible, unités, info-bulles |
| Réseau | — |

**La source reste unique.** On ajoute à chaque `ControlDef` de `ui/schema.ts` un champ `menu?: PlayerTab`, plus
un ordre. Les contrôles non étiquetés restent **dans le Labo seulement**. Aucun réglage n'est écrit deux fois.
Environ 120 contrôles côté joueur, contre 332 au Labo.

**La ligne de réglage.**

- Le libellé, puis une valeur adaptée au type : une barre pour un curseur, `◂ valeur ▸` pour un choix, un point
  pour un interrupteur.
- À droite, un **panneau d'explication** : texte, coût GPU, valeur par défaut, et une image d'aperçu quand c'est
  utile.
- Les changements s'appliquent tout de suite. Les risqués (échelle de rendu, mode d'affichage) **reviennent
  d'eux-mêmes après 15 s** sans confirmation.

**La navigation.** LB/RB changent d'onglet, haut/bas changent de ligne, gauche/droite changent la valeur, Y
réinitialise. La recherche (⌘K) cherche dans les deux écrans.

**Le Labo** est le tiroir actuel, renommé et nettoyé (plus d'anglais en FR), avec ses onglets Caméra, Scène,
Matière, Ciel, Physique et Rendu avancé. On y entre depuis l'écran joueur (LABO ›), par M en caméra libre, et par
⌘K.

### 6. Le socle technique (`src/ui/menu/`)

- **Le routeur** (`router.ts`) : une pile d'écrans (titre, mode, lancement, briefing ; pause et sous-menus ;
  réglages).
  - Les transitions passent par la **View Transitions API** (`document.startViewTransition`, éléments partagés :
    la carte de mode s'agrandit jusqu'à l'écran de lancement), avec un repli en fondu.
  - Le focus est mémorisé par écran.
  - Échap et B sont branchés sur la pile `onEscape` existante.
- **Le focus spatial** (`focus.ts`) : la navigation 2D par géométrie des éléments (`data-nav` pour forcer un
  voisin), au clavier, à la manette et au survol.
- **La manette** (`padnav.ts` étendu) : gauche/droite, LB/RB pour les onglets, Y et X pour les actions
  secondaires, la répétition au maintien. Elle est active dès qu'un écran du routeur est ouvert, et plus
  seulement en pause.
- **Les glyphes** (`glyphs.ts`) : clavier, manette ou toucher, selon le dernier périphérique utilisé. Les
  touches AZERTY sont lues par leur code physique (`input/keymap.ts`).
- **L'intention de lancement** (`intent.ts`) : `{ mode, vessel?, body?, place?, activity?, time?, weather? }`.
  - Elle est jouée tout de suite si le jeu est prêt, sinon à la première image.
  - Elle déclenche les préchargements.
  - Elle est exposée dans `__bh.menu` pour les tests.
- **L'intro** : `index.html` (DOM et CSS en ligne) et `intro/worker.ts` (le fond WebGL2 et l'orbe, sur
  OffscreenCanvas). `ui/splash.ts` est remplacé par `intro/boot.ts`, qui garde l'API `firstImage()`, `gone` et
  `slowStart()`.
- **Les illustrations** (`assets/title/`) :
  - 4 key arts de mode en 1600×2133 webp ;
  - 3 rotations de vaisseau (36 vues 512² dans une planche) ;
  - le logo SVG.
  - Toutes **rendues par notre propre rendu hors ligne** (`renderdialog`), par un script `__bh` ; aucune image
    extérieure.
  - En attendant ces illustrations, on utilise les vignettes `SCENE_THUMBS`.

### 7. Les budgets

| quoi | budget |
|---|---|
| première image | **pas plus tardive** qu'aujourd'hui : A/B sur 5 démarrages, cache froid et chaud |
| fond et orbe de l'intro | ≤ 0,5 ms de GPU ; 0 ms sur le thread principal (Worker) |
| menus | 60 i/s ; aucune tâche longue > 50 ms venant du code des menus ; ouverture d'un écran < 16 ms |
| code ajouté | ≤ 60 Ko gzip pour les menus (chargé avant le jeu) ; thinking-orbs/engine sans React dans le bundle |
| images | ≤ 1,2 Mo pour le titre (illustrations), chargées en parallèle sans retarder DE440 ; le reste à la demande |
| en jeu | le DOM des menus **retiré**, pas seulement caché ; 0 coût par image |

### 8. Accessibilité et plateformes

- Tout se fait au clavier seul, à la manette seule ou au toucher seul.
- Cibles de 48 px au toucher, un focus toujours visible, contraste AA.
- `prefers-reduced-motion`, une option de taille du texte, des étiquettes ARIA.
- **iPad et téléphone** (`body.mobile`) : le titre passe en une colonne, les cartes de mode en carrousel
  horizontal ; l'écran joueur des réglages en pleine page, avec ses onglets en haut.
- Tout en **FR + EN**.

## Phases

Chaque phase : un commit, une planche de captures (`docs/progress/title-aaa/`), FR + EN, `bun test` et
`bunx biome ci .` verts, poussée sur `main`. Taille : **S** = moins d'une demi-journée, **M** = une journée,
**L** = deux jours ou plus.

### E0 — Mesures et socle (M) — FAIT ([fiche](progress/title-aaa/E0.md) : première image 1,3 s à froid sur Mac ; à 20 Mbit/s le titre attend DE440 jusqu'à 9,7 s ; une tâche de 380 ms après `renderer`)

- **Mesurer le démarrage** avec `performance.mark` à chaque étape : les tâches longues du thread principal
  (`PerformanceObserver` enregistré dans `index.html`), la première image à froid et à chaud.
  - Cela décide de ce qui peut être interactif pendant la compilation, et à quel point les clics seront fluides.
- Mesurer le **reciblage du noyau de scène** : peut-on choisir la scène avant que `scene-tracer` compile ?
- Un drapeau de débogage `#slowboot=20` : il retarde la première image de 20 s, pour tester le menu pendant le
  chargement.
- Le socle `ui/menu/` : routeur, focus 2D, glyphes, `padnav` étendu, jetons de design (échelle de texte,
  mouvement).
- Décider pour thinking-orbs : le paquet (`bun add thinking-orbs`, import de `/engine` seul, React absent du
  bundle vérifié), sinon une copie de l'engine sous `src/vendor/` avec sa licence.

### E1 — L'intro et le chargement (L) — FAIT ([fiche](progress/title-aaa/E1.md), [planche](progress/title-aaa/E1.jpg) : studio cinématographique, logo rendu par le lancer de rayons du jeu, fond et orbe dans un Worker, aucun coût sur la première image)

- Noir, SAMLEPIRATE présente, KERR, le logo, puis le menu ; passer l'intro ; la version courte ; le mouvement
  réduit.
- Le Worker du fond procédural et de l'orbe ; les états de l'orbe branchés sur `loading.ts` ; la liste des étapes
  dépliable.
- Le fondu vers la scène vivante à la première image.
- Corrige le constat 1 (deux écrans superposés).
- Une planche de 2 ou 3 variantes du logo à valider.

### E2 — Le menu titre (L) — FAIT ([fiche](progress/title-aaa/E2.md), [planche](progress/title-aaa/E2.jpg) : le titre construit à ~50 ms, un lancement choisi pendant le chargement exécuté avant la première image, aucun coût mesuré)

- Continuer (et sa vignette), les 4 cartes de mode, Plus…, Réglages, le pied de page.
- **Construit avant `Renderer.create()`.** Les intentions en file, les préchargements par intention, LANCER
  pendant le chargement.
- ~~DE440 demandé en premier~~ — FAIT en E0b ([fiche](progress/title-aaa/E0b.md)) : à 20 Mbit/s, la première
  image arrive 6,0 s plus tôt pour un joueur qui revient et 2,8 s plus tôt pour un premier visiteur. En
  contrepartie, ce premier visiteur reçoit le vrai ciel 2,1 s plus tard. **Le fondu vers la scène vivante
  attend donc le vrai ciel.**
- L'intention appliquée **avant la première image** quand elle est connue à temps (une compilation encore en file
  est abandonnée, pas une déjà lancée — fiche E0).
- Corrige les constats 2, 3 et 8.

### E3 — Les illustrations (M) — FAIT ([fiche](progress/title-aaa/E3.md), [planche](progress/title-aaa/E3.jpg) : 4 illustrations et 3 rotations de 36 vues, toutes rendues par le jeu)

- 4 key arts de mode et 3 rotations de vaisseau, rendus par le jeu (script `__bh`, rendu convergé), puis
  compressés.
- Les scènes proposées : l'astronaute sur la Lune avec la Terre basse, le F-35 au-dessus des Alpes au couchant,
  le Ranger devant Saturne, Gargantua.

### E4 — En avion (M) — FAIT ([fiche](progress/title-aaa/E4.md), [planche](progress/title-aaa/E4.jpg) : 4 onglets, le vol libre réglé et gardé, les missions, l'école, les défis ; un clic perdu après une touche corrigé)

- Vol libre (départ, aérodrome, heure, météo), Combat, École de vol, Défis.
- Les modales actuelles deviennent des pages du routeur.

### E5 — En vaisseau (M) — FAIT ([fiche](progress/title-aaa/E5.md), [planche](progress/title-aaa/E5.jpg) : le hangar, les fiches, les missions par vaisseau, les sols fermés à l'Endurance ; le vaisseau choisi enfin celui qu'on place ; constat 7 corrigé)

- Le hangar (les rotations), les fiches, les missions par vaisseau, les destinations libres compatibles.
- Corrige le constat 7 (les libellés des missions).

### E6 — À pied et caméra libre (M) — FAIT ([fiche](progress/title-aaa/E6.md), [planche](progress/title-aaa/E6.jpg) : le monde, le lieu sur son planisphère — POI, adresse, coordonnées, Atlas —, l'heure de son propre jour, la météo ; la galerie plein écran par onglets)

- Monde, lieu (POI, choix sur l'Atlas, adresse), heure et météo.
- Les destinations de la caméra libre (la galerie en plein écran).

### E7 — Plus… et Crédits (S) — FAIT ([fiche](progress/title-aaa/E7.md), [planche](progress/title-aaa/E7.jpg) : Plus… en six groupes, la langue, Kerr Bench confirmé ; le générique déroulant ; `CREDITS.md` généré d'une source unique vérifiée contre les README)

- Scènes, Charger, Photo et rendus, Jouer ensemble, Éditeur, Kerr Bench (avec confirmation), Comment jouer,
  Langue.
- **Crédits** : `CREDITS.md` généré depuis les README des assets, et l'écran déroulant.

### E8 — Le menu pause (M) — FAIT ([fiche](progress/title-aaa/E8.md), [planche](progress/title-aaa/E8.jpg) : la colonne pleine hauteur, cinq tiroirs, la colonne de contexte, Changer de mode ; en salle le jeu continue ; constats 4 et 5 corrigés)

- La colonne pleine hauteur, les groupes et leurs sous-menus, la colonne de contexte, Changer de mode.
- Le cas réseau ; le diagnostic déplacé.
- Corrige les constats 4 et 5.

### E9 — Les réglages : l'écran joueur et le Labo (L) — FAIT ([fiche](progress/title-aaa/E9.md), [planche](progress/title-aaa/E9.jpg) : 8 onglets et 157 réglages rangés depuis le schéma, l'explication, le retour des réglages risqués, la recherche commune, le Labo ; constat 6 corrigé)

- L'étiquetage `menu` dans `schema.ts`, avec un test qui vérifie que chaque contrôle est rangé.
- L'écran plein écran, le panneau d'explication, le retour automatique des réglages risqués.
- Commandes et manettes réunis.
- Le Labo nettoyé ; la recherche commune.
- Corrige le constat 6.

### E10 — L'entrée en jeu (M) — FAIT ([fiche](progress/title-aaa/E10.md), [planche](progress/title-aaa/E10.jpg) : le menu qui glisse, le fondu au noir, l'écran de chargement de scène, le démarrage du HUD, l'orbe dans la pastille)

- La sortie du menu et le fondu au noir ; l'écran de chargement de scène (illustration, orbe, astuce du mode).
- Le démarrage du HUD.
- L'orbe à la place de la pastille d'assets.

### E11 — Clôture (M)

- **Campagne e2e**, en vrais événements CDP :
  - passer l'intro ;
  - pendant `#slowboot`, *En avion › Vol libre › LANCER*, puis le cockpit sur la piste ;
  - *En vaisseau › Lander › Surface lunaire* ;
  - *À pied › Terre › un POI* ;
  - *Caméra libre › Gargantua* ;
  - Continuer ;
  - la pause au clavier et à une fausse manette ;
  - un réglage changé et retrouvé au rechargement ;
  - le téléphone et le mouvement réduit.
- **Mesures** : la première image en A/B contre `e664e0aa`, le coût de l'intro, les tâches longues.
- **Docs** : `docs/MENUS.md` et `MENUS.fr.md`, E2E-CATALOGUE, BH-API (`__bh.menu`). Puis la planche finale.

## Risques

- **Le thread principal bloqué** pendant la compilation des shaders (`getCompilationInfo` sur 9 modules, des
  pipelines synchrones dans les constructeurs : `ship.ts` en a 18).
  - Les clics du menu pendant cette fenêtre peuvent attendre.
  - Parade : l'intro et l'orbe hors du thread principal ; E0 mesure la fenêtre. Si elle dépasse 1 s, on passe en
    `create*PipelineAsync` les pipelines encore synchrones du démarrage.
- **Le reciblage du noyau** n'est peut-être pas possible une fois sa compilation commencée. Dans ce cas, le
  lancement pendant le chargement compile deux fois. On le mesure ; au pire, on le dit (« ~30 s de plus »).
- **WebGL2 dans un Worker en même temps que le device WebGPU** : il faut vérifier que cela ne retarde pas la
  compilation, surtout sous Windows/D3D12. Repli en canvas 2D.
- **Le poids** des illustrations sur une connexion lente. Elles passent après DE440 et ne sont jamais
  bloquantes : les vignettes servent de repli.

## Questions encore ouvertes (à trancher en cours de route)

1. ~~**Le logo**~~ — tranché en E1 : le mot KERR, coupé par le disque, sous un **emblème rendu par le lancer de
   rayons du jeu** (spin 0,6, 87°, disque fin). Les variantes SVG au trait ont été écartées à la demande de
   l'utilisateur.
2. **La carte studio** : « SAMLEPIRATE présente », ou un logo SamLePirate (en existe-t-il un) ?
3. **L'intro complète** une fois par version (proposé) ou à chaque lancement ?
4. **La scène vivante derrière le titre** : la partie sauvée (comme aujourd'hui), ou une scène d'accueil fixe
   (Gargantua) quand il n'y a pas de sauvegarde ?
