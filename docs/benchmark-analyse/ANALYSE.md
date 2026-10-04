# Analyse des benchmarks externes — 2026-10-04

Sources : `docs/bench-result-externes/kerr-bench-iPad-Pro-m1-2026-10-04.json` et `kerr-bench-nvidia-2026-10-04.json` (schéma `kerr-bench/1`, mode `complete`, 8 scènes, app `cfddcfa`/`49449e9`, référence de score : *Apple M1 Max, Chrome (2026-10) = 1000*).

Outil interactif : voir `README.md` (`bun serve.ts`).

---

## 1. Résumé exécutif

| | iPad Pro M1 | NVIDIA (Blackwell) |
|---|---|---|
| **Score Kerr** | **440** | **3 805** (×8,6) |
| Qualité recommandée | `game` | `ultra` |
| Viewport | 1590×1054 @ 2× (retina) | 2560×1271 @ 1× |
| Navigateur | WebKit (Chrome iOS) | Chrome 154 / Windows |
| GPU (tier mesuré) | Apple GPU, tier 2 (guessed 1) | Blackwell, tier 4 |
| 1ʳᵉ image | **885 ms** | **70,6 s** ⚠ |
| VRAM max | 1 055 MiB | 1 190 MiB |
| Dérive thermique | −1,9 % (2,70 → 2,65 Mray/s) | +0,1 % (12,91 → 12,92 Mray/s) |
| Erreurs GPU / device lost | 0 / non | 0 / non |

**En bref** : les deux runs sont propres (zéro erreur GPU, thermique plate, aucune perte de device). L'écart de score ×8,6 est cohérent avec l'écart de classe matériel (mobile integré vs desktop haut de gamme) et surtout avec les **caps d'affichage** : l'iPad est bridé à ~30 Hz, donc le sweep qualité n'exprime pas son potentiel GPU brut. Le point noir est le **temps de chargement du côté NVIDIA (70 s)**, dominé par la compilation de shaders — probablement un premier lancement à froid (JIT + pipeline cache vide).

---

## 2. Ce que disent les sweeps qualité

### iPad Pro M1 — bridé par l'affichage, pas par la scène

- `game:artemis` : 29,6 → 29,8 → 26,7 → 28,8 fps (low → high → game), realtime 14,2. **~30 fps constant** = cap vertical 30 Hz (écran ProMotion limité en mode bench) : passer de `low` à `high` ne coûte presque rien, le budget frame est déjà saturé.
- `Ranger: approaching Gargantua` : 15,4–15,9 fps sur low/medium/high/realtime, mais **30 fps pile en `game`** (raysPerPx réduit à 0,0078) : le profil `game` compense exactement le budget — c'est le profil bien réglé pour cette machine.
- Sur `Kerr a=0.94` (auto), le moteur descend la densité à **0,0025 rayon/pixel** et reste à 29,8 fps : la résolution dynamique fait son travail, mais la scène Kerr reste la plus lourde.

### NVIDIA — GPU loin d'être saturé, sauf en high

- `game:artemis` : **112–113 fps à toutes les qualités, raysPerPx = 1** : la scène est triviale pour ce GPU (il rend la pleine résolution avec de la marge).
- `Ranger` : 109,9 (low) → 87,5 (medium) → 69,3 (high) → 63,8 (realtime) : c'est la seule scène qui coûte réellement quelque chose quand la densité monte. `game` (127,7 fps, raysPerPx 0,25) reste confortablement au-dessus des caps.
- En mode résolution fixe, la machine atteint **143 fps** (Kerr 143,5, artemis 143,3, p95 ≈ 8 ms) — cohérent avec un écran 144 Hz. La marge de progression du score vient du fait que le sweep qualité plafonne à ~113 fps sur artemis.

---

## 3. Goulots d'étranglement (passes GPU)

Pass dominant par scène (mode auto) :

- **iPad** : `trace` est le goulot sur la quasi-totalité des scènes (ex. Kerr : `display` 9,05 ms > `trace` 7,39 ms en résolution très réduite, mais dès que la densité remonte, `trace` redevient dominant). Sur `game:artemis`, le shading MSAA du Ranger prend 6,95 ms — l'overhead géométrie/shading du vaisseau coûte cher en relatif sur mobile.
- **NVIDIA** : `trace` domine partout (artemis : 6,8 ms sur ~8,5 ms de GPU ; Kerr auto : 6,77 ms). C'est attendu : le ray-tracing géodésique est le cœur du moteur et le reste du pipeline (temporal, resolve, bloom…) est marginal (< 0,2 ms par pass).

Lecture : le moteur scale bien — sur GPU rapide, `trace` absorbe le budget ; sur GPU lent, la résolution dynamique maintient la cadence en sacrifiant la densité de rayons.

---

## 4. Anomalies à creuser

1. **Chargement NVIDIA 70,6 s** : `shaders` = 65,2 s et `pipelines` = 65,1 s (l'iPad : 147 ms / 396 ms). Deux hypothèses : première visite sans cache de compilation (Chrome JIT WGSL) ou boucle de warm-up anormale sur cette config. **Action : re-bencher après un second chargement** et comparer ; si ça persiste, profiler la création de pipelines (elle ne devrait pas être 100× plus lente que l'iPad).
2. **Saccades résiduelles** : NVIDIA `game:artemis` auto a 5 frames > 33 ms (p99 16,4 ms mais pics à 63,5 ms dans les intervalles) et 3 long tasks — probablement GC/compose occasionnels, à surveiller mais non bloquant.
3. **iPad realtime** chute à 14,2 fps sur artemis alors que `high` tient 26,7 : le mode realtime désactive probablement la résolution dynamique (raysPerPx 0,0121 vs 0,031) — vérifier que c'est voulu.
4. **Tier mal deviné sur iPad** (guessed 1, measured 2) : l'heuristique de tier sous-estime l'iPad Pro M1 (8 threads, 8 GB).

---

## 5. Constats et recommandations

1. **Le profil `game` est le bon profil mobile** : il est le seul à tenir 30 fps sur toutes les scènes iPad (Ranger 30 fps, artemis 28,8). Continuer à l'ajuster comme cible mobile.
2. **La résolution dynamique fonctionne** : sur iPad Kerr, elle descend jusqu'à 0,0025 rayon/px sans saccade massive (over33 150 frames sur ~5 s, p50 34 ms — la scène reste au cap 30, seules quelques frames 63 ms).
3. **Le cap vertical masque les différences de qualité** : sur iPad, tester le sweep avec un cap relevé (ou en mode fenêtré 60 Hz) pour mesurer le coût réel des niveaux low/high.
4. **Le GPU NVIDIA a de la marge** : même `high` ne sature pas (69 fps > cap). La qualité `ultra` recommandée est justifiée ; envisager d'ajouter un niveau au-delà (`ultra+` avec raysPerPx > 1 ?) pour les GPU tier 4.
5. **Optimiser le premier lancement desktop** : c'est le seul point où l'expérience est objectivement mauvaise (70 s). Cache de pipelines (WebGPU `pipelineCache` / IndexedDB), compilation en tâche de fond progressive.
6. **Bonne santé thermique mobile** : dérive −1,9 % seulement sur 780 s de bench, un iPad (passif) — le profil `game` est soutenable en session longue.

---

## 6. Méthodologie du run

- `sweepWarmMs` 2 000 / `sweepMs` 5 000 par point de mesure, sous-échantillonnages testés : auto, 1, 2, 3, 4, 6, 8.
- Mode auto = résolution dynamique (blocs/scales adaptatifs, ex. NVIDIA Kerr : 1 114 frames au scale 1.0 avec raysPerPx 0,25).
- Mode fixe : fenêtre 1417×1016 (iPad) / 1703×846 (NVIDIA) pour mesurer le GPU sans résolution dynamique.
- Convergence « still » : spp 32, convergeMs 7,7 s (iPad) vs 367 ms (NVIDIA).
