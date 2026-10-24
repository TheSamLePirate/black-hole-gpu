# Les menus — intro, titre, écrans de lancement, pause, réglages

*[English version](MENUS.md)* — *à jour au 2026-10-20*

Comment on entre dans KERR et comment on s'y déplace : l'intro qui joue pendant le chargement, le titre par façon de
jouer, un écran de lancement par façon de jouer, l'entrée en jeu, la pause, les réglages du joueur et le Labo. Un
seul langage visuel (noir profond, l'ambre du disque pour ce qui est choisi, capitales Rajdhani), un seul routeur, un
seul focus en deux dimensions pour le clavier, la souris, le toucher et la manette.

- Le plan : [PLAN-TITRE-AAA.md](PLAN-TITRE-AAA.md) (phases E0–E11) et ses fiches, une par phase, avec leurs images
  et leurs mesures : [`docs/progress/title-aaa/`](progress/title-aaa/) — l'ensemble dans
  [FINAL.jpg](progress/title-aaa/FINAL.jpg).
- Les crédits : [CREDITS.md](../CREDITS.md), écrit depuis `src/ui/title/credits.ts`.

## Le parcours

| moment | ce qu'on voit | code |
|---|---|---|
| **Intro** | le noir ; SAMLEPIRATE en carton de film ; KERR ; l'emblème (le trou noir du jeu lui-même) ; un fond procédural et l'orbe de chargement. Une touche, un clic ou un toucher la passe ; la version courte une fois vue. Tout est statique dans `index.html` et animé sur le compositeur : elle joue avant que le script du jeu n'arrive | `index.html`, `src/intro/` (intro.ts, intro.css ; worker.ts et painter.ts dessinent le fond et l'orbe sur un OffscreenCanvas) |
| **Titre** | l'emblème et KERR (glissés depuis l'intro) ; Continuer ; quatre façons de jouer en cartes — À pied, En avion, En vaisseau, Caméra libre — ; Plus… ; Réglages. Construit au début de la page et utilisable pendant le chargement : un lancement choisi entre-temps est gardé et joué avant la première image | `src/ui/title/title.ts`, `activities.ts`, `art.ts` |
| **À pied** | un onglet par monde (Terre, Lune, Mars), le lieu (les destinations de l'Atlas, une adresse, des coordonnées) épinglé sur son planisphère, l'heure du jour propre au lieu, la météo (Terre) | `src/ui/title/foot.ts` |
| **En avion** | Vol libre (aérodrome, départ, heure, météo, carburant — gardés), Combat (les missions aériennes, les combats), École de vol, Défis (avec leurs meilleurs résultats). Un vol commence dans le cockpit | `src/ui/title/plane.ts` |
| **En vaisseau** | le hangar : un onglet par vaisseau avec sa fiche et sa rotation, les destinations qu'il peut atteindre (un sol fermé à l'Endurance, et pourquoi), ses missions et ses scènes | `src/ui/title/ship.ts` |
| **Caméra libre** | la galerie en plein écran, un onglet par sorte (trous noirs, Gargantua, trou de ver, système solaire, Terre, paysages), la scène du focus derrière | `src/ui/title/free.ts` |
| **Plus…** | Jouer (toutes les scènes, charger), Créer (photo, missions), Ensemble, Apprendre (comment jouer, découvrir, commandes), Mesurer (le Kerr Bench, confirmé), Le jeu (crédits, langue) ; le générique déroulant | `title.ts` (moreScreen, creditsScreen), `credits.ts` |
| **Entrée en jeu** | le menu glisse, le noir monte (400 ms), le lancement se fait dessous ; un écran de chargement si le noyau de la scène doit compiler (son image, l'orbe, l'étape, une astuce) ; le noir se lève et le HUD s'allume élément par élément | `src/ui/entry.ts` |
| **Pause** | Échap (Start) : une colonne à gauche — reprendre, sauvegarder, charger, rendre les commandes, cinq tiroirs (Capture, Monde, Ciel, Changer de mode, Réglages), jouer ensemble, le titre —, le contexte à droite (la mission et ses objectifs, ou l'état du vol ; le temps de jeu, la dernière sauvegarde, une astuce). En salle réseau, le jeu continue | `src/ui/pause.ts`, `pausemenu.ts` |
| **Réglages** | neuf onglets (Jeu, Graphismes, Affichage & HUD, Audio, Commandes, Accessibilité, Interface, Réseau, Hors ligne), une ligne par réglage, celui du focus expliqué, les risqués revenus après 15 s sauf s'ils sont gardés, R réinitialise l'onglet, ⌘K cherche ici et au Labo ; le coût GPU d'un réglage graphique (mesuré sur kerr-mini, `costs.ts`) ; la langue changée sur place — les menus et le Labo aussitôt, le HUD au prochain chargement ; Hors ligne construit à la main : le stockage, le cache automatique et son budget, les zones hors ligne (leur progression, la pause, la mise à jour, la suppression demandée deux fois) et l'ajout d'une zone (un lieu — cherché, la position actuelle, ou posé sur une carte, son cercle à son rayon au-dessus des zones gardées —, un profil, un rayon, estimés avant de télécharger) — Monde › Garder cette zone hors ligne, dans la pause, l'ouvre sur la position actuelle | `src/ui/settings/` (menu.ts — quels réglages, depuis le schéma —, values.ts, player.ts, offline.ts) |
| **Labo** | le tiroir de tous les contrôles (caméra, scène, matière, ciel, physique, rendu, jeu), sa recherche, ses préréglages et son historique — par LABO › des réglages, leur recherche, ⇧M, ou Réglages › Labo dans la pause | `src/ui/panel.ts`, `src/ui/schema.ts` |

## Les touches

| | clavier | manette |
|---|---|---|
| se déplacer | flèches (le focus en deux dimensions) | croix, stick gauche |
| choisir | Entrée, un clic | A |
| revenir (hors d'un tiroir, d'un écran ; hors de la pause depuis sa première colonne) | Échap | B |
| onglet (écran d'un mode, réglages, vaisseau du hangar) | Q / E (A / E en AZERTY : par leur place), Page ↑ / ↓ | LB / RB |
| changer la valeur d'un réglage | ← → | croix ← → |
| réinitialiser l'onglet des réglages | R | Y |
| chercher un réglage (dans les deux écrans) | ⌘K / Ctrl+K | — |

Les invites en pied de chaque écran suivent le dernier périphérique utilisé (`ui/menu/glyphs.ts`).

## Le socle (`src/ui/menu/`)

- **Le routeur** (`router.ts`) : une pile d'écrans dans un hôte, chacun se souvient de l'élément qui avait le focus.
  Échap et B passent par la pile d'Échap du jeu : un écran peut le garder (un tiroir, une confirmation). Les écrans
  changent par une View Transition quand le navigateur en a ; ceux de la pause et des réglages changent tout de
  suite (`cut`).
- **Le focus** (`focus.ts`) : l'élément le plus proche dans la direction pressée, d'après la géométrie.
- **Les actions** (`actions.ts`) : un seul sens par touche, pour le clavier et la manette.
- **La manette** (`ui/padnav.ts`) : ses boutons envoyés comme ces touches tant qu'un menu est ouvert — en entier
  sur le titre, la pause et les réglages.

## Pour les tests : `__bh.menu`, `__bh.entry`

- `__bh.menu.state()` → `{ title, pause, settings, entry }`. Il donne l'écran du titre (`"title"`, `"mode:ship"`,
  `"plane:field"`…), celui de la pause (`"pause"`, `"pause:save"`…), l'onglet des réglages, et si le voile de
  l'entrée est levé ; null quand c'est fermé. `__bh.menu.title(mode?)`, `pause()` et `settings(tab?)` les
  ouvrent.
- `__bh.entry.busy` ; `__bh.entry.compile(ms)` tient l'étape du noyau de scène, pour montrer l'écran de
  chargement.
- Les e2e : `title`, `title-plane`, `title-ship`, `title-foot`, `title-more`, `pause`, `settings`, `entry`, `pad`,
  `intro`, et le parcours entier dans `menus-campaign` ([E2E-CATALOGUE.md](E2E-CATALOGUE.md)).

## Mesures

Le titre et l'intro ne coûtent rien à la première image. C'est mesuré en A/B sur kerr-mini à chaque phase (E1, E2,
E3), puis contre le code d'avant les menus à la clôture (E11, `bun scripts/ab-commit.ts e664e0aa` : à froid
1 341 ms contre 1 355, à chaud 865 contre 933 — médianes de 6 démarrages sur kerr-mini). Le titre répond
170–180 ms après le début de la page à froid, 40 ms à chaud, bien avant les graphismes.
