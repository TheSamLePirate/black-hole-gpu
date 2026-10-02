# TODO

Écarts entre le code et la documentation, relevés le 2026-10-02 pendant la mise à jour des docs
(commit e3a778f). À corriger dans le code.

- [ ] **Aide‑mémoire des touches : `/` ne cherche plus dans les réglages.**
  `src/ui/panel.ts:1015` (`showShortcuts`, section *Interface*) affiche `["M · /", "Settings · search them"]`,
  mais `/` (code `Slash`) remet le temps réel dans tous les modes (`src/main.ts`, gestionnaire `keydown`).
  La recherche se fait avec ⌘K / Ctrl+K. → remplacer par `["M · ⌘K", "Settings · search them"]`.

- [ ] **Aide du réglage Son : la vue « nose » n'existe pas.**
  `src/ui/schema.ts:1027` (help du réglage *Sound*) parle des vues côté cabine « dorsal, belly, nose », alors que
  `src/audio/director.ts:12` définit `ON_HULL = new Set(["dorsal", "belly", "rear"])` (Rear = le nez, regard
  vers l'arrière). → écrire « dorsal, belly, rear ».
  À trancher en même temps : Cockpit et Cabin ne sont pas dans `ON_HULL`, donc le vaisseau s'y entend
  « de dehors » (lointain, étouffé). Voulu ?

- [ ] **Fenêtre d'outils : textes anciens.**
  - Les infobulles du bouton Outils ne citent pas l'onglet *Perf* :
    `index.html:67` (`data-tip`) et `src/ui/flighthud.ts:341` —
    « status, place, target, time, saves, audit, journal » → ajouter *perf*.
  - `src/ui/gametools.ts:1` (commentaire d'en‑tête) parle du « 🛠 button of the mission bar » : ce symbole
    n'existe plus, c'est le bouton Outils (icône clé) de la barre de mission.

## Relevés de l'analyse du code (docs/systemes, 2026-10-02)

Trouvés à la lecture du code, **non vérifiés en jeu**. Le détail est dans la section « Pièges et limites »
de la fiche indiquée.

### Bugs probables

- [ ] **Éclat de la coque plafonné** (fiche 7) — `ship.wgsl` écrit `o/(1+L)` (lissage MSAA, 7c99547) mais la
  passe `comp` qui l'inverse n'est plus appelée depuis 45d11f5 ; `display.wgsl:269` et `post.wgsl:240`
  lisent l'image sans inverser → luminance < 1, reflets écrasés, bloom affaibli.
- [ ] **Lueur de notre bouche jamais dessinée** (fiche 3) — `throatLight` (`src/system/scene-bodies.ts:153`)
  cherche un Soleil d'orbite `"fixed"`, alors qu'il est `"solar"` → `P.bodyCfg.z` toujours 0.
- [ ] **Saut de l'ISS à 14 jours de l'époque** (fiche 3) — `src/system/iss.ts:99` passe de SGP4 avec traînée
  à SGP4 sans traînée sans raccord.
- [ ] **Rayonnement de retour ignoré en qualité *low*** (fiche 1) — compilé seulement dans le pipeline
  qualité, lancé seulement si `adaptiveIntegrator` (ou tolérance > 0 hors ligne).
- [ ] **Mission automatique avec le moteur Crew** (fiche 6) — le préréglage de mission ne fixe pas `engine` ;
  avec `crew`, `planTransfer` passe par `planLowThrust` qui ne crée aucun nœud → les phases raise / align /
  transfer ne pilotent pas.
- [ ] **Plan exécutable réservoir vide** (fiche 6) — `thrustMax()` = 0 → `aMax = 1e-9`, durée de poussée
  gigantesque.
- [ ] **Volets : premier appui perdu** (fiche 5) — `airFlight.cfg.flaps` part de `undefined` ; le premier P
  donne « Flaps up ».
- [ ] **Autosave trop fréquente en vol** (fiche 8) — `guiDirty` → `scheduleUrlSave()` toutes les 0,15 s
  (`src/main.ts:1669`) → `autosaveNow()` toutes les ~2 s au lieu de `autosaveEvery` (10 s).
- [ ] **Filtre du Journal remis à « all »** (fiche 9) — `log.on` reconstruit l'onglet ; `body.dataset.filter`
  jamais écrit (`src/ui/gametools.ts`).
- [ ] **Deux tables `SITES` divergentes** (fiche 9) — `src/ui/gametools.ts` vs `src/game/sites.ts`
  (Huygens 167,7° E / 192,32° E ; Jezero, KSC).
- [ ] **Atlas : « Planche undefined »** pour 25–32 (`roman()` s'arrête à XXIV) et planches « v3 » sans plein
  écran (`gallery/index.html`, fiche 9).
- [ ] **Son « wormhole » jamais joué ?** (fiche 9) — le statut passe par « throat » pendant la traversée.
- [ ] **Export EXR sans le Ranger ni ses jets** (fiche 2) — composé seulement par la passe d'affichage.
- [ ] **Rendu hors ligne : export ≠ aperçu** (fiche 2) — l'export prend les réglages live, l'aperçu ceux
  figés au lancement.
- [ ] **`SkyTextureBuilder.build` rogne** une image trop grande au lieu de la réduire (fiche 2).
- [ ] **`guessTier` ne renvoie jamais 4** (`src/tier.ts`) → plafond 3,5 Mpx en qualité game (fiches 2, PERFORMANCE).
- [ ] **Build de la cabine non reproductible** (fiche 7) — `cockpit-convert.py` utilise `hash(ob.name)`
  (aléatoire par lancement Python).
- [ ] **`bun run build` incomplet** (fiche 9) — ni `ktx-worker.js` ni `basis_transcoder.wasm` ; seul
  `build:pages` est complet.
- [ ] **`constellations.json` non reconstructible** (fiche 3) — `scripts/build-constellations.ts` lit
  `assets/etoiles/`, non commité.

### Robustesse et échelle

- [ ] `492.5490947` (seconde en M pour 10⁸ M☉) en dur dans `src/controls.ts` (`dockWant`, `railsLimit`) et
  `M_SECONDS`/`M_METRES` dans `src/system/solar.ts`, alors que `clock.ts` suit `s.massSolar` (fiches 3, 4).
- [ ] `flyShip` modifie `TUNING.turnRate/turnAccel` autour de `pilot.step` sans `try/finally` (fiches 4, 5).
- [ ] Feed‑forward des autopilotes atterrissage/décollage sur une traînée simplifiée (`ballistic`) alors que
  le vol applique l'aéro complète (fiche 5).
- [ ] Côté Gargantua, planificateurs et `refreshPlan` sur le thread principal ; `planCost` mesuré seulement
  de notre côté (fiche 6).
- [ ] JUP365 refit seulement 2040–2100 : en 2026, les lunes galiléennes passent aux éléments moyens (fiche 3).
- [ ] Endurance pilotée sans niveaux de détail ; niveau fin de l'ISS jamais libéré ; versions RNGR/LNDR non
  vérifiées au chargement (fiche 7).

### Tests

- [ ] `tests/entry.test.ts` « the guidance brings the handover over its aim » : 29 s pour une limite de 20 s.
- [ ] `tests/aero.test.ts:71` compare `heatFlux(x)/heatFlux(x)` à 1 (toujours vrai).
- [ ] Son, fenêtre F2, sauvegardes et audit : aucun test.

### Commentaires et textes périmés

- [ ] `FLAG_ADAPTIVE_RK` (`trace.wgsl:123`), `settings.ts` et l'UI parlent de « step‑doubling + Richardson » /
  « RK4 tolerance » : l'intégrateur est un Dormand–Prince 5(4).
- [ ] Clamp temporel annoncé « ± 1.25 σ », valeur réelle 2.0 (`post.wgsl`).
- [ ] En‑tête de `src/ui/flighthud.ts` : « N cycles the density » → `²` (Backquote).
- [ ] Menu du panneau : « Copy share link — URL with every non-default setting » produit un `#save=` ;
  `saveToUrl` (`src/urlstate.ts`) n'est plus appelée.
- [ ] Astuce du splash : « Settings › Scenes » n'existe plus.
- [ ] Aides FC « Apoapsis / Periapsis (or now) » sans bouton NOW.
- [ ] En‑tête de `scripts/gallery.ts` (320×180, SSIM 0,9 → 160×90, 0,85) ; en‑tête de
  `scripts/build-ephemeris.ts` (tolérances ≠ table `FITS`).
- [ ] JSDoc orphelines ou déplacées : `controls.ts:102, :199`, `fleet.ts:274`, `planOurTransfer`,
  `planIssRendezvous`, `plan-worker.ts`, `precessionNutation`, `issStart`, plusieurs dans `renderer.ts`.
- [ ] `settings.ts` situe `MOUNTS` dans `ship.ts` (il est dans `mounts.ts`).

### Code mort et doublons

- [ ] Morts : pipeline `pipes.comp` (`ship.ts:405`), `glyph()` (`ship.wgsl`), uniformes `dash0/dash1`,
  `MISSION_PRESET`, `extendOurs`, `de440.ts:covers`, `saveToUrl`, sélecteurs CSS `#btn-fly`, `#btn-target`,
  `#btn-rotation`, `#btn-orbit`, `#btn-dive`, `#btn-gravity`, `#btn-journey`, `scripts/captions.py` (lit un
  `caps.json` que rien ne produit).
- [ ] Doublons : `src/fc/kepler.ts` / `src/game/kepler.ts` ; points d'attache du Ranger dans `mounts.ts` et
  `vessels.ts` ; `BODY_COLOURS` / `OUR_COLOURS` ; deux `seenFrom` et deux `poleAxes` ; `cycleVessel` vs
  `VESSEL_IDS` ; `renderdialog.ts` (`btnStart.onclick` recopie `options()`, `"Close" : "Close"`).
- [ ] `cinematicSpeed` : 40 max dans le panneau caméra, 60 dans le schéma.
