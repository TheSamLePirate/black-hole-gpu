# Plan HOTAS — M7 du plan Monde (8 octobre 2026)

Suite de [`PLAN-MONDE.md`](PLAN-MONDE.md), phase **M7 : les entrées HOTAS**. Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

## Décisions du propriétaire (08/10/2026)

- **Tous les périphériques combinés** : chaque axe et chaque bouton de chaque périphérique branché (manche, manette des gaz, palonnier : souvent trois prises USB) peut être affecté ; le jeu les lit tous à chaque image ; les réglages sont mémorisés par modèle (son identifiant).
- **La détection et des profils connus** : un écran « Manettes » — cliquer une commande, puis bouger l'axe ou presser le bouton voulu ; des profils prêts pour la manette Xbox et des HOTAS courants (T.16000M et TWCS, X52, X56, VKB, palonniers) quand leur nom est reconnu ; par axe une courbe, une zone morte, l'inversion.
- **La manette des gaz absolue** : sa position = les gaz (0–100 %), un cran au ralenti (0 % garanti en bas) ; les touches et les gâchettes de la manette Xbox restent incrémentales.
- **Des vibrations réglables** : le moteur (sa poussée), le plasma et les secousses de la rentrée, le toucher et le roulage, les bangs, l'amarrage ; une intensité (0 : aucune).

## État de départ (inventaire du 08/10/2026)

- `gamepad.ts` : une seule manette lue, celle au mapping « standard » d'abord (Xbox, PlayStation) — 4 axes (sticks), les gâchettes, les boutons d'une table fixe ; un HOTAS (mapping non standard, 6 à 8 axes, des dizaines de boutons) ignoré si une manette standard est là, sinon lu comme une manette standard (ses axes au hasard) ; la manette Xbox 360 filaire par WebHID sur macOS (Chromium).
- `piloting.ts pilotInput` : clavier + tactile + la manette (tangage, lacet, roulis, gaz incrémentaux).
- `input/bindings.ts`, `ui/controls-screen.ts` : le clavier seulement (les touches tenues et les actions), pas d'axes.
- `rumble()` existe, jamais appelé en vol.

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| H1 | **Le modèle des entrées** | `input/devices.ts` : tous les périphériques (Gamepad API et WebHID), leur modèle (fournisseur, produit, nom), leurs axes et boutons ; `input/axes.ts` (pur, testé) : un axe transformé — calibration (son étendue apprise), zone morte, courbe, inversion, le demi-axe, la manette des gaz absolue et son cran ; les affectations (une commande ← un axe, un bouton, un demi-axe, un chapeau) et leur stockage par modèle | **fait** : `input/axes.ts` (pur, 7 unitaires) — le modèle d'un périphérique d'après l'identifiant du navigateur (fournisseur et produit pour Chrome et Firefox, le nom pour Safari) ; un axe centré (calibration, inversion, zone morte, courbe x·(1 − c) + x³·c : la pleine course gardée), un levier absolu (le cran du ralenti en bas : 4 %), un chapeau lu comme un axe (ses huit positions) ; les affectations (une commande ← un axe, un demi-axe, un bouton, un chapeau ; une action du clavier ou une touche tenue ← un bouton) lues sur tous les périphériques ensemble (sommées, bornées) ; les fronts des boutons ; **la détection** (l'axe bougé le plus depuis le repos : un demi-axe pour un manche bougé d'un côté, l'axe entier pour un levier) ; `input/devices.ts` — les instantanés des périphériques, les profils du joueur par modèle (dans le navigateur), un périphérique qui a un profil **réclamé** : la manette standard (`gamepad.ts`) ne le lit plus (un HOTAS était lu comme une manette, ses axes au hasard). Planche `h1-modele.jpg` |
| H2 | **Dans le vol** | `pilotInput` lit toutes les affectations : tangage, roulis, lacet, gaz absolus (le dernier bougé l'emporte sur les touches), translations RCS, regard ; les boutons sur n'importe quelle action du clavier (`keymap.ts`) ou une touche tenue ; e2e avec des périphériques simulés (un HOTAS en trois pièces) | **fait** : les périphériques lus une fois par image (`lens.ts`, à côté de la manette) ; `pilotInput` y ajoute le tangage (manche tiré : nez haut), le roulis, le lacet (la torsion et le palonnier sommés), les translations RCS ; **la manette des gaz absolue**, sa position = les gaz, **reprise comme un fader** — une fois les gaz mis ailleurs par les touches (ou au branchement), le levier ne les reprend qu'en y passant (sinon, à son premier mouvement, ils sautaient de 30 % à plein) ; les touches tenues par des boutons ; les boutons sur les actions du clavier (`main.ts` : la même que la touche) ; le regard (un chapeau, un mini-manche) ; **les freins aux pieds** du palonnier, ajoutés à ceux de l'arrêt (`motion.ts`). e2e `hotas` (un HOTAS simulé en trois pièces dans la page) : les trois réclamés, aucun lu comme une manette ; le manche fait rouler ; le levier, sa reprise ; un bouton bascule le SAS une fois ; les freins aux pieds. Planche `h2-vol.jpg` |
| H3 | **Les profils connus** | manette standard (Xbox, PlayStation : le mapping d'aujourd'hui), T.16000M + TWCS, X52, X56 (manche et manette), VKB Gladiator, palonniers (TFRP, T-Rudder, Saitek) ; reconnus par l'identifiant ; un manche inconnu : un profil générique (roulis, tangage, torsion en lacet, la manette des gaz s'il y en a une) | à faire |
| H4 | **L'écran Manettes** | les périphériques branchés et leurs axes et boutons en direct ; chaque commande : « affecter » puis bouger ou presser (le plus grand mouvement l'emporte), la courbe tracée, la zone morte, l'inversion, la calibration ; le profil remis à zéro ; FR + EN, au clavier et au toucher | à faire |
| H5 | **Les vibrations** | le moteur, le plasma et les secousses, le toucher et le roulage, les bangs, l'amarrage — `dual-rumble` (et `trigger-rumble` quand il y en a) ; un réglage d'intensité ; e2e (l'actionneur simulé) | à faire |
| H6 | **Labo, finitions** | un vol au HOTAS simulé au labo (décollage, virage, atterrissage), `docs/HOTAS.md`, i18n, planche finale | à faire |

Chaque étape : un commit, une planche dans `docs/progress/hotas/`, FR + EN.
