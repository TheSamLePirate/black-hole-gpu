# Benchmark-analyse — outil d'analyse comparative Kerr-Bench

Outil local pour **analyser, afficher et comparer** les résultats de benchmarks du moteur black-hole-gpu (`kerr-bench/1`), avec moteur d'analyse automatique.

Thème et design system repris de `docs/comment-jouer.html` (Gargantua) : fond `#07080c`, cartes `#121623`, accent ambre `#ffb347` (disque d'accrétion), accent bleu `#6fd3ff`, hero « trou noir + disque + étoiles », nav sticky en pills, notes à liseré gauche, tables à en-têtes uppercase.

## Démarrer

```sh
cd docs/benchmark-analyse
bun serve.ts        # → http://localhost:5177
```

Le serveur Bun sert l'interface + les JSON de `docs/bench-result-externes/` (pas de CORS, pas de build).

Alternatives :
- **`bun test`** — teste le moteur d'analyse (`analysis.ts`) sur les vrais JSON de `data/`.
- **Glisser-déposer** — déposez n'importe quel fichier `kerr-bench-*.json` dans la page pour l'ajouter à la comparaison (marche aussi hors serveur).

## L'outil

Interface en 6 vues (boutons en haut de page) — le **Dashboard** est la vue d'accueil :

| Vue | Contenu |
|---|---|
| **Dashboard** | Cockpit AAA : hero par machine (score animé en count-up, badges qualité/GPU/1ʳᵉ image, barre de score), 8 KPI (scores, Mray/s min-max, cap détecté, saccades, thermique, VRAM), **radar 6 axes** (score, débit, fluidité, chargement, thermique, convergence), **cœur du réacteur** (frame-times de la pire scène, échelle p99 pour ne pas écraser par les outliers), distribution des frame-times (2 machines colorées), anatomie du chargement en étages, **système des scènes** (planètes classées du plus dur au plus facile, taille = difficulté), rythme du moteur (temps GPU/frame lissé). Animations d'entrée partout. |
| **Vue d'ensemble** | Fiche par machine : score Kerr vs référence 1000, GPU, viewport/DPR, 1ʳᵉ image, VRAM max, dérive thermique, rés. fixe max + cap détecté, erreurs GPU, graphique des scores. |
| **Comparaison** | Sweep qualité (fps par scène × qualité, caps verticaux détectés), débit Mray/s par scène, auto vs résolution fixe, frames > 33 ms, densité raysPerPx par qualité, tableau métrique par métrique avec Δ, détail du chargement par étape. |
| **Scènes** | Explorateur scène par scène : mode auto (fps, p50/p95/p99, Mray/s, rayons/pixel), mode fixe, convergence still ; **timeline des frame-times** (intervalle CPU et temps GPU par frame, pointillé 33 ms), **histogramme des frame-times** (buckets du rapport, recalculés depuis les intervals), **courbes subsampling** (fps et Mray/s selon ×N), top 10 des passes GPU, temps CPU par tâche. |
| **Subsampling** | Pour **chaque scène** : mini-graphe fps par mode (auto, ×1, ×2, ×3, ×4, ×6, ×8) sur les 8 scènes ; puis pour la scène sélectionnée, 4 graphiques (fps, Mray/s, p95, frames > 33 ms), le **tableau complet** par machine × mode et le **simulateur de budget frame** (curseur cible fps → densité de rayons requise par interpolation log-log, mode d'accumulation recommandé, plages de validité). |
| **Tendances** | Historique multi-runs par machine (groupés par machineLabel) : courbe du score Kerr, Δ run précédent → dernier, Mray/s, et **table de régression/gain par scène**. S'alimente automatiquement via le watch mode. |
| **Analyse** | Conclusions générées automatiquement : cap vertical, goulot d'étranglement (pass dominant), thermique, saccades, part des frames < 16,7 ms, subsampling nécessaire, chargement, erreurs, synthèse comparative inter-machines. |
| **Données brutes** | Toute la config système du rapport, **matrice des features WebGPU** (✓/— par machine), **limits WebGPU** comparées, config du run (viewport, sweep, erreurs). |

Les onglets sous le titre activent/désactivent chaque machine dans la comparaison ; le bouton ✕ la retire. Toute erreur runtime s'affiche dans une bannière en haut de page.

## Interactivité AAA

- **Tooltip flottant** sur tout élément portant `data-tip` : KPI, cartes machine, barres de tous les graphiques, étages de chargement, lignes d'histogramme, toiles du radar (valeurs brutes), passbars, planètes.
- **Crosshair multi-séries** sur chaque `lineChart` : suivi du curseur frame par frame, points colorés par machine, tooltip avec la valeur de chaque série (frame-time CPU et GPU, subsampling, rythme du moteur).
- **Clic sur une machine** : carte du hero / fiche Vue d'ensemble / onglet = bascule la machine dans toute la comparaison (protégé : au moins une machine reste active).
- **Planètes cliquables** : ouvre la vue Scènes directement sur la bonne scène.
- **Légendes cliquables** : masquer/afficher une série dans les graphiques (`data-series-toggle`), surlignage au survol, estompage des autres éléments (CSS `:hover` en cascade).
- **Watch mode** : le serveur expose `/api/watch` (empreinte mtime du dossier) ; l'app sonde toutes les 4 s et recharge + notifie (toast) dès qu'un nouveau `kerr-bench-*.json` atterrit dans `docs/bench-result-externes/`.
- **Analyses dérivées** (cartes de scène) : verdict **GPU-bound / CPU-bound** (part du frame budget GPU vs CPU), **jitter** (σ, spikes > 2× médiane, p99.9), **marge vs cap** (% du budget d'affichage consommé).
- **Simulateur de budget frame** : régression log-log fps vs densité de rayons sur la courbe subsampling, cible fps au curseur → densité requise + mode recommandé ; l'interpolation est bornée à la plage mesurée (pas d'extrapolation absurde).

## Fichiers

```
benchmark-analyse/
├── serve.ts            # serveur Bun (API /api/benchs, /api/bench/:file)
├── dashboard.ts        # vue Dashboard AAA (hero, KPI, radar, planètes, animations)
├── index.html          # squelette de l'interface
├── style.css           # thème « trou noir »
├── app.ts              # UI : chargement, vues, interactions
├── analysis.ts         # moteur d'analyse (fonctions pures, testées)
├── analysis.test.ts    # bun test — valider le moteur sur les vrais JSON
├── types.ts            # types du schéma kerr-bench/1
├── ANALYSE.md          # analyse écrite des 2 runs du 2026-10-04
└── data/               # copies locales des JSON (fallback sans serveur)
```

## Ajouter un nouveau benchmark

1. Copier le `kerr-bench-*.json` produit par la page de bench dans `docs/bench-result-externes/` (source de vérité) et dans `data/` (fallback).
2. Relancer `bun serve.ts` (ou glisser-déposer le fichier).
3. L'outil le détecte via `/api/benchs` — nom = nom de fichier sans `kerr-bench-` ni `.json`.

## Schema analysé (kerr-bench/1)

Champs exploités : `score`, `machineLabel`, `system.{gpu,screen,tier,browser,cpuThreads}`, `load.{firstImageMs,stages}`, `scenes[]` (`gpuPasses`, `cpu`, `auto`, `fixed`, `subsampling`, `vramMiB`, `worstLoopMs`), `quality[]`, `thermal`, `peakVramMiB`, `errors`, `durationS`, `run.viewport`.
