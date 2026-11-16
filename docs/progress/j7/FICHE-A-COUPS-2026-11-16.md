# Fiche des à-coups — PLAN-J7 J7-0 (16 novembre 2026)

**Machine** : kerr-mini (M1, 8 cœurs GPU), plein écran. **Code** : 23ea4135 (avant J7-1). **Sonde** : `tests/e2e/lib/hitch-probe.ts`
(`E2E_HITCH=1`), témoins passés le même matin (run `20261116-060710-hitch-probe` : 200 ms injectées vues en un écart de 200 ms attribué au
thread principal ; A/A d'un vol tenu 2 × 20 s, 1 117 et 1 143 images, aucun écart > 100 ms). **Source** : run `20261116-060822-j7-hitches`
(les neuf e2e de parcours de J6, 05:08–05:40 UTC), `remote-results/…/hitches/*.jsonl`. Un écart = deux images rAF à plus de 50 ms ; sa
cause = ce qui a changé de part et d'autre (compilation, tâche longue du thread principal, tas JS en baisse, tuiles, journal, vue, appareil
GPU, temps GPU), jugée 300 ms après. Le temps de démarrage (« boot », avant la prise en main) est compté à part.

## 1. Par parcours (hors démarrage)

| Parcours | écarts > 50 ms | > 100 ms | max [ms] | causes des écarts > 100 ms |
|---|---:|---:|---:|---|
| `parcours-ville` (décoller, virer bas sur Toulon) | 567 | 12 | 500 | thread principal (+GPU) 6, compilation 2, le premier passage de génération 1, tuiles 2 |
| `parcours-meteo` (ILS sous la météo réelle) | 217 | 11 | 467 | compilation 3, thread principal (+tuiles, +GPU) 7, tuiles 1 |
| `parcours-debarquer` (se poser, marcher, repartir) | 335 | 10 | 433 | thread principal 6, compilation 2, GPU + tuiles 2 |
| `parcours-reprise` (recharger un avion au sol) | 43 | 16 | 550 | chargement de la sauvegarde 3, thread principal 5, collection 3, tuiles 3, première génération 1, inconnu 1 |
| `parcours-camera` (caméra libre, mode photo) | 91 | 30 | 450 | **GPU + tuiles après le placement 18**, thread principal 5, compilation 2, inconnu 2 (le mode photo) |
| `parcours-gpu` (perte du GPU en vol) | 166 | 116 | 450 | **GPU pendant l'arrivée des données sur les Maures (80–100 s) 97**, thread principal 9, compilation 4, perte injectée 1 |
| `parcours-gpu-salle` (perte du GPU en salle) | 154 | 31 | 784 | thread principal (+GPU) 23 (deux pages, la perte et sa reprise), compilation 3, collection 4 |
| `parcours-tars` (TARS pendant une transition) | 46 | 12 | 433 | thread principal (+tuiles) 8, compilation 3 |
| `parcours-orbite` (le pas de tir à l'orbite) | 79 | 56 | 867 | **artefact du test** : ses tranches de 300 pas de `__bh.step` exécutées d'un bloc (~600 ms chacune, hors de la vue de la sonde) ; le décollage automatique 867 ms (thread principal + journal) |

## 2. Les à-coups qui reviennent (classés)

1. **Le premier noyau de la scène, au début de la partie : 433–784 ms de thread principal**, dans chaque parcours, ~1,6 s après la prise en
   main (« compile started ; main thread 446 ms »). Puis **~200 ms à chaque changement d'appareil** (Ranger → F-35 : « compile started ;
   main thread 199 ms »). La part synchrone de la création du module ou du pipeline (l'analyse du WGSL côté page) : le joueur la voit, une
   image est déjà là. Hors J7-2 tel qu'écrit (la météo) : **à ajouter au plan** (la compilation d'un appareil anticipée, ou la création
   déplacée hors du moment où l'image est attendue).
2. **Après un placement (flyAt) : des images GPU de 150 à 290 ms pendant plusieurs secondes**, le temps que le relief et les photos
   arrivent (`parcours-gpu` 80–100 s : 97 écarts ; `parcours-camera` 26–30 s : 18). Le coût GPU de l'arrivée des données (envois de tuiles,
   niveaux du raster refaits) — non détaillé par la sonde (il faudrait les passes GPU de ces images-là).
3. **Le début du vol** (« IN FLIGHT | In the air — by hand ») : 150–217 ms de thread principal avec l'arrivée de 300 tuiles (272 → 592) —
   `parcours-meteo`, `-debarquer`, `-ville`, `-camera`.
4. **Recharger une sauvegarde** : 417 ms (thread principal 106 ms, le reste hors du thread : la reprise des tuiles), puis 184 et 282 ms
   (`parcours-reprise`).
5. **Le mode photo, son entrée ou sa sortie** : 300 et 182 ms sans cause lue (`parcours-camera`, 112 s) — la sonde ne lisait pas le mode ;
   **ajouté depuis** (le mode du jeu et le rendu hors ligne, `mode`, `offline`).
6. **L'arrivée de la météo réelle** (J7-2) : **aucun écart > 100 ms** sur ce passage (le plus grand après la prise en main : 100,3 ms, des
   tuiles) — les 84–433 ms de J6-2 ne se reproduisent pas ici ; à rejouer à froid (son noyau peut-être déjà dans le cache de shaders du
   mini) avant de conclure.
7. **Le retour par F1** (J7-3) : **83 ms au plus** sur ce passage (« back aboard », gap max) — les 317 ms de J6-5 ne se reproduisent pas.
8. Les pertes du GPU (injectées) : 500–584 ms, attendues (la reprise tenue, J6-6).

## 3. Ce que dit la fiche aux lots suivants

- **J7-2** (la météo) et **J7-3** (F1) : leurs à-coups **ne se reproduisent pas** dans ce passage ; les rejouer à froid (profil neuf déjà ;
  le cache de shaders du mini à vérifier) avant d'ouvrir — sinon leur plafond lu ici est ~0.
- **Les plus gros à-coups vus** sont ailleurs : le premier noyau de la scène et le changement d'appareil (433–784 ms, ~200 ms), l'arrivée des
  données après un placement (GPU 150–290 ms par image pendant des secondes), le début du vol, le chargement. Proposés à la session
  d'analyse comme lots de J7 (rien ouvert ici).
- **Non vérifié** : la cause fine des images GPU lentes à l'arrivée des données ; la part synchrone exacte de la création des noyaux (un
  profil CPU le dirait) ; une seule passe par parcours (aucune répétition) ; `parcours-ville` a échoué sur son assertion des bâtiments
  proches à l'arrivée (0 — PROBLEMES « le décor ne suit pas un vol rapide », variance connue), sans lien avec la sonde.

## 4. Le rejeu à froid (16 novembre, 07:11 UTC — décision de la session d'analyse)

kerr-mini, run `20261116-072108-j7-cold` (arbre 42c5887f) : avant chaque passage à froid, le cache Metal du processus GPU de Chrome vidé
(`$(getconf DARWIN_USER_CACHE_DIR)com.google.Chrome.helper/com.apple.metal`, 982 Mo — le profil neuf de chaque e2e ne l'isole pas) ; puis
les mêmes à chaud. Les six passages verts. Écarts > 100 ms après la mise en place (sonde) :

| Moment | À froid | À chaud | Cause lue |
|---|---|---|---|
| **L'arrivée de la météo réelle** (J7-2) | 499 ms (+ 200 ms) | 350 ms | froid : collection de 635 Mo, thread principal 160 ms ; chaud : une image GPU de 401 ms, des tuiles — **pas une compilation** |
| **Le retour par F1** (J7-3, « back aboard ») | 650 ms (`compile: main`, GPU 645 ms) | 250 ms (GPU 245 ms, collection, tuiles) | froid : le noyau principal recompilé au retour ; chaud : l'image du retour |
| Le mode photo | 155 ms au plus | 255 ms ; 600 ms à sa sortie (GPU 597 ms) | images GPU lentes — l'image fixe du mode photo |
| Le début du vol (J7-8) | 750, 416, 516, 416 ms (thread principal 357–563 ms, compilations `shadeLiteFinish`) | — (sous 100 ms) | à froid : la compilation des noyaux du vol |
| Après un placement (J7-9) | des dizaines d'images GPU de 130–345 ms pendant ~20 s | 16 images de 100–290 ms pendant ~4 s ; « Under 10 images/s: the flight runs at 55 % of real time » | le GPU pendant l'arrivée des données |
| Au démarrage (sous l'écran de chargement) | 683–2 150 ms de thread principal | — | les compilations à froid, sous l'écran |

**Conclusion pour le plan** : **J7-2 et J7-3 se reproduisent** (à froid et à chaud) — leurs lots tels qu'écrits, mais leurs causes ne
sont pas celles supposées par J6 : la météo, une image GPU lourde et une collection (pas la compilation de son noyau, déjà prêt) ; F1, la
recompilation du noyau principal à froid et une image lourde à chaud.

## 5. Relus de près (09:22 UTC) — J7-3 et J7-2 ne tiennent pas à ce que §4 en disait

- **Le retour par F1 ne recompile rien.** e2e `j7-f1-return` (kerr-mini, à froid — cache Metal vidé — puis à chaud, run `…-j73-map`) : la
  clé de la scène (`renderer.featureKey`) inchangée de la caméra libre au retour, aucune compilation lancée ; à froid **aucune image
  > 100 ms**, à chaud **une seule, 116 ms**, 1,2 s après le retour (une image GPU de 71 ms). **Correction de §4** : les 650 ms
  « compile: main » de `parcours-camera` à froid n'étaient pas le retour par F1 (une recompilation à un autre moment du vol) ; et sur les
  passages suivants, le retour fait 66–83 ms (« back aboard »), 200 ms une fois à froid.
- **L'arrivée de la météo, relue passe par passe** (e2e `j7-weather-arrival`) : le premier passage a montré l'image de 399 ms, son GPU à
  67 ms, au moment où la nouvelle clé (bit 1024, la météo non calme) crée ses ~30 pipelines (32 → 62 compilations, sortis du cache) ;
  puis **quatre passages A/B** (le départ des compilations rythmé contre libre) : **aucune image > 100 ms** (84 ms au plus), et la part
  synchrone de chaque départ mesurée ~0 ms — ce n'est pas la création des pipelines qui coûtait. Le rythme, sans effet mesuré, retiré.
- **Conclusion** : J7-2 et J7-3 sont **intermittents** — un à-coup de 116 à 400 ms une fois sur plusieurs passages, au même moment, sans
  cause unique lue ; ni compilation au retour par F1, ni coût de création à l'arrivée de la météo.
