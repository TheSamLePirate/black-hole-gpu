# TODO

Écarts entre le code et la documentation, relevés le 2026-10-02 pendant la mise à jour des docs
(commit e3a778f). À corriger dans le code.

Revu le 2026-10-10 : les points cochés sont corrigés dans le code. Les fiches 1 à 9 datent du 2 octobre ;
les fichiers ajoutés depuis sont recensés dans [`docs/systemes/11-ajouts-depuis-octobre.md`](docs/systemes/11-ajouts-depuis-octobre.md).

- [x] **Aide‑mémoire des touches : `/` ne cherche plus dans les réglages.** *(Corrigé : l'aide est tirée de `src/input/keymap.ts`, « M · ⌘K ».)*
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
- [x] **`bun run build` incomplet** *(corrigé : workers, WASM, Service Worker et PWA copiés)* (fiche 9) — ni `ktx-worker.js` ni `basis_transcoder.wasm` ; seul
  `build:pages` est complet.
- [ ] **`constellations.json` non reconstructible** (fiche 3) — `scripts/build-constellations.ts` lit
  `assets/etoiles/`, non commité.

### Robustesse et échelle

- [ ] `492.5490947` (seconde en M pour 10⁸ M☉) *(depuis : une seule fois, `M_SECONDS` dans `src/units.ts` — reste qu'elle ne suit pas `s.massSolar`)* en dur dans `src/controls.ts` (`dockWant`, `railsLimit`) et
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
- [x] Astuce du splash : « Settings › Scenes » n'existe plus. *(Corrigé : la phrase n'existe plus.)*
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

## Après le plan des noyaux maigres (2026-10-27)

Le plan [PLAN-LEAN-TRACER-KERNELS](docs/PLAN-LEAN-TRACER-KERNELS.md) est fini (P0–P10). Journal :
[docs/progress/kernels/PROGRESS.md](docs/progress/kernels/PROGRESS.md) ; mesures : [BASELINE.md](docs/progress/kernels/BASELINE.md).
Ce qui reste :

- [x] **Mesurer sur un vrai PC Windows.** Fait le 28/10 sur kerr-pc (RTX 5070 Ti) : l'image de la Terre attend
  ~2 min (118–151 s), pas ~9 s — le proxy était 3,4 × trop optimiste (même source : ~moitié pilote NVIDIA, ~moitié DXC
  de Chrome plus lent). Et le relancement ne gagne rien : le cache de Chrome ne garde pas les gros noyaux sous Windows,
  et le bac à sable empêche le cache du pilote. Détail : [BASELINE.md](docs/progress/kernels/BASELINE.md), « Windows,
  measured ».
- [x] **Sous Windows, montrer le sol raster sans attendre le `main` du traceur.** Fait le 28/10 (`skyFill`) : la Terre à
  7,5 s au lieu de 122 s sur kerr-pc. `shadeLite` est prêt en 4,5 s, mais
  la première image raster arrive après le `main` (~2 min). Un ciel simple en attendant ramènerait la Terre à quelques
  secondes au premier lancement comme aux suivants. Le plus gros levier Windows.
- [x] **Réduire les trois gros noyaux** (P11, 28/10) : l'autre univers (Kerr, disque épais) hors des noyaux temps réel
  quand la Terre est proche, `shade` sans le bruit du relief — sur kerr-pc `main` 120 → 72 s, `env` 85 → 41 s, `shade`
  145 → 60 s, tout compilé 408–526 → 208–220 s ; images identiques au bruit près.
- [x] **Pourquoi le cache Dawn de Chrome rate sous Windows** (28/10, BASELINE.md) : une limite par entrée (un `main`
  de 920 Ko de DXIL n'est jamais gardé ; après P11 le DXIL l'est, le pilote recompile) et, dans le jeu, le total du cache
  WebGPU (~10 Mo) dépassé par tous ses pipelines : un cache LRU demandé dans le même ordre n'en rend aucun.
- [ ] **Faire tenir les pipelines du jeu dans le cache de Chrome sous Windows** (plus tard). But : qu'au relancement sous
  Windows tout revienne du cache en secondes au lieu de ~3,5 min. Le cache WebGPU de Chrome fait ~10 Mo ; le jeu en
  demande plus au lancement et, toujours dans le même ordre, chaque nouvelle compilation chasse la suivante : rien ne
  revient (mesures : docs/progress/kernels/BASELINE.md, « Why Chrome's cache gives nothing back »). Étapes :
  1. mesurer (~½ j) : tout ce que le jeu compile au lancement et la taille de chacun (traceur, post, raster, avion,
     cockpit) — dit si < 10 Mo est réaliste ; à faire seul d'abord, puis décider ;
  2. demander moins au départ (½–1 j) : la clé d'orbite et celle du vol compilent deux jeux de gros noyaux — un seul
     tant que l'autre ne sert pas ; regrouper les pipelines presque identiques ;
  3. réduire encore les gros noyaux (plusieurs jours, incertain) : la 3e copie d'`ourSegment`, d'autres doublons, chaque
     coupe vérifiée par `raster-companion` / `kernel-golden`.
  Limites : seulement les relancements ; le pilote NVIDIA recompile quand même (bac à sable GPU de Chrome) → environ
  la moitié du gain ; la taille du cache peut changer avec Chrome. Sinon : signaler à Chromium.
- [ ] **La troisième copie de `ourSegment` (dans `dnegTrace`).** Chaque site d'appel est une copie complète une fois
  inliné par D3D12 (~19k lignes) ; P9 a fusionné les deux appels de `traceLook`, celui de l'intégration du trou de ver
  reste. Dans tous les noyaux du jeu (son univers a le trou de ver), environ un tiers du code (estimé, pas mesuré).
  Piste simple : une version allégée de `ourSegment` pour ce site (nos corps y sont lointains : sans le sol détaillé ni
  le décor, comme `earthLookFar`), vérifiée par `kernel-golden` sur Interstellar ; la fusion complète demanderait
  d'interrompre et de reprendre l'intégration de `dnegTrace`. Gain surtout au premier lancement sur Windows.
- [ ] **Les FPS en vol (~23 FPS sur kerr-mini, cible 60 = 16,7 ms).** Vol cockpit à Tarifa : image 42,6 ms, dont le
  traceur seulement 5,8 ms (`docs/progress/kernels/perf-p10.txt`). Les leviers ne sont plus dans le traceur :
  - mesurer proprement le coût de l'avion et du cockpit (ombrage MSAA, carte d'ombres) — sur Apple, les horodatages des
    passes de rendu se chevauchent (`ship: shading` affiche ~38 ms, presque toute l'image) : il faut une mesure par
    ablation (passe coupée, A/B) ;
  - l'ombrage du sol rastérisé (`earth lite`, 13 ms), le plus gros poste mesuré ;
  - la mer (`earth water` 5,3 ms, `sea fft` 2,2 ms) et les nuages (`clouds` 4,9 ms).
- [ ] **Une variante de plus au relancement à pied.** Au second lancement sur le même profil, la Terre tracée a compilé
  une clé que le premier n'avait pas vue (67113952 : le décor pas encore là, 14 s) — selon le rythme du chargement.
  Mineur ; un profil stable pour la Terre tracée (comme le profil Terre-raster de P3) le supprimerait.
