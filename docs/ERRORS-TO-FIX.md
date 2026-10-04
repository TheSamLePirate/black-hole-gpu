# Erreurs à corriger

Erreurs constatées, analysées, **pas encore corrigées** — chacune avec ses preuves, sa cause, son impact
et la correction proposée. Une entrée corrigée est retirée (ou marquée corrigée, avec son commit).

---

## E1 — `heightAt` : « Cannot read properties of undefined (reading 'NaN') » après chaque poussée

**Constatée le 2026-10-04**, sur le Mac mini (scripts/remote.ts), dans les vols réels orbite → piste
(`scripts/live-entry.ts`) : 4 vols sur 4 (Edwards ×1, Le Bourget ×3), toujours **2 erreurs**, toujours
**à la fin de la poussée de désorbitation** (1 min 27–29 de vol réel). Code concerné inchangé depuis HEAD
`5c4743a` (motion.ts, pilot.ts, earth-tiles.ts, our-surface.ts).

### Symptôme

```
TypeError: Cannot read properties of undefined (reading 'NaN')
    at … (earth-tiles.ts : la fonction `at` de heightAt)
    at sampleLevel (earth-tiles.ts:459)
    at EarthTiles.heightAt (earth-tiles.ts:367)
    at … earthHeightSampler (terrain.ts:358) → heightOver → gearHeight (our-surface.ts:216)
    at CameraController.flyHome (controller/motion.ts:288)
    at CameraController.fallStep → fall (controller/motion.ts:128)
```

L'atterrissage réussit quand même (Le Bourget : posé à 0,2–0,6 m/s, arrêté sur la piste).

### Cause (prouvée)

Un **dépassement de capacité en virgule flottante** : l'inverse d'une poussée *dénormalisée* vaut
`Infinity`.

1. **Le régime du moteur ne revient jamais à zéro.** `src/pilot.ts:509` le fait tendre vers la manette
   par une fraction de l'écart à chaque image :
   `engineNow = engineNow + (throttle − engineNow) · k`, avec `k = 1 − exp(−Δt_jeu / spool)`
   (`controller/piloting.ts`, `spoolK`; Ranger : `spool` = 0,4 s, `vessels.ts:189`). Manette à 0, il
   décroît géométriquement — ×exp(−Δt/0,4) par image — **sans jamais être ramené à 0** : 10⁻³⁰⁰, 10⁻³¹⁰,
   10⁻³²⁰… jusqu'à ce que les flottants l'arrondissent enfin à 0 (sous 5·10⁻³²⁴).
2. **L'accélération du moteur devient dénormalisée.** `pilot.ts:525` :
   `acc = nez · engineNow · thrustMax` (thrustMax ≈ 3,2·10⁻⁵ c²/M) → `acc` ≈ 10⁻³¹¹, `accel = |acc|` > 0.
3. **Son inverse déborde.** `controller/motion.ts:230` (dans `thrust`, appelé à motion.ts:241) :
   `d = lin(acc, 1 / accel, acc, 0)` — `1 / 1,2·10⁻³¹¹` dépasse le plus grand double (1,8·10³⁰⁸) →
   `Infinity` ; `acc · Infinity` → `[Infinity, …]` ou `NaN` (0 · ∞ sur une composante nulle). La garde
   `if (!(accel > 0)) return v` ne l'arrête pas : `accel` est bien > 0.
4. **La NaN gagne le pas.** `vRep = thrust(simDt)` est NaN → dans `flyHome` le premier sous-pas donne
   `V`, `X`, `t` NaN → `gearHeight(ground, X, t)` → `toBodyFixed` NaN → la direction `q` passée au relief
   est NaN → `heightAt` calcule `px`, `py` NaN → `slotOf(NaN, NaN)` → `L.data[NaN]` est `undefined` →
   l'exception.

La fenêtre dangereuse : `engineNow · thrustMax` entre ~5,6·10⁻³⁰⁹ (où `1/accel` déborde) et 5·10⁻³²⁴ (où
`acc` devient exactement 0). Soit environ 35 ordres de grandeur, ~0,4 × ln(10³⁵) ≈ 32 s de jeu : à ×500
(le temps de la chute vers l'interface de rentrée), **2 à 4 images** — d'où les 2 erreurs. On y entre
~0,4 × ln(1/1,7·10⁻³⁰⁴) ≈ 280 s de jeu après la coupure du moteur : à ×500, une demi-seconde après la fin
de la poussée — ce qu'on voit.

### Preuves (diagnostic du 2026-10-04, hors dépôt, `camera.fall` / `camera.flyHome` enveloppés)

`remote-results/20261004-221454-nan-diag/` et `20261004-221726-nan-diag2/` (logs locaux, ignorés par git) :

| | appel avant | appel avant | **appel qui lève** |
|---|---|---|---|
| `pilot.engineNow` | 2,7·10⁻²⁹⁶ | 6,8·10⁻²⁸⁵ | **3,8·10⁻³⁰⁷** puis **5,2·10⁻³¹⁸** |
| `acc` transmis à `fall` | 8,7·10⁻³⁰¹ | 2,2·10⁻²⁸⁹ | **[1,2·10⁻³¹¹, 1,0·10⁻³¹³, 1,6·10⁻³¹²]** puis **[1,7·10⁻³²², 0, 2·10⁻³²³]** |
| `vRep = thrust(simDt)` | fini | fini | **[NaN, NaN, NaN]** (la vitesse d'entrée `p.vel` finie) |

Contexte au moment de l'erreur : phase `entry`, manette 0, temps ×500, `pilot.burn` null,
`thrustMax` 3,22·10⁻⁵, masse 39 999,9 kg — tout fini sauf `vRep`.

Écarté : `shipTime` vaut NaN dans les captures, mais par construction (remis à NaN à chaque image,
`controller/lens.ts:143`, testé par `Number.isFinite` dans `rotation.ts:350`) — sans rapport.
Écarté aussi : l'aérodynamique à 400 km (au-dessus du sommet de l'air, `airAt` rend le vide et
`aeroForces` une force nulle, `aero.ts:236`, `:398`).

### Impact

- **Constaté** : 2 erreurs JavaScript non rattrapées par vol, dans le journal du jeu (`game.errors`).
  La boucle (`main.ts:1933`) a déjà demandé l'image suivante : le reste de l'image en cours est perdu
  (la physique de cette image, le HUD, le rendu) ; l'image suivante repart.
- **Probable, non mesuré** : le vaisseau ne bouge pas pendant ces images (l'exception part avant
  `setHomePose`), alors que l'horloge de la scène a avancé (`advanceFrameClock`). À ×500, 2 images
  ≈ 20 s de jeu ≈ 150 km d'orbite non parcourus — une petite discontinuité de trajectoire, que le guidage
  de rentrée a corrigée ici. À vérifier : la position avant/après ces images.
- **Probable, non mesuré** : **après toute coupure du moteur**, pas seulement la désorbitation — ~280 s de
  jeu plus tard (≈ 4 min 40 en temps réel, sans accélération) : un accroc de 2–4 images, à chaque fois.
- **Risque** : si le sol interrogé n'est pas la Terre, rien ne lève — le relief (`groundRelief` : les
  cratères de la Lune, de Mars…) rend NaN sans exception, et la NaN pourrait alors être *validée* dans
  l'état du vaisseau (`setHomePose` avec X NaN : vaisseau perdu). Ici, c'est l'exception de `heightAt` qui
  protège par accident. Non vérifié.
- Même motif ailleurs : `controller/motion.ts:145` (près de Gargantua, `dirZ = lin(acc, 1 / accel, acc, 0)`).

### Correction proposée (non appliquée)

1. **À la source — `src/pilot.ts:509`** : ramener le régime à 0 (ou à la manette) sous un seuil, p. ex.
   `if (Math.abs(this.engineNow − throttle) < 1e−6) this.engineNow = throttle;` — un moteur à 10⁻⁶ de
   sa poussée n'a pas de sens physique, et le HUD (`fired.throttle`) n'affichera plus 10⁻³⁰⁷.
2. **À l'usage — `controller/motion.ts:230` et `:145`** : ne pas diviser par une norme minuscule :
   `if (!(accel > 1e-30)) return v;` (et `dirZ = [0,0,0]` sous le même seuil), ou normaliser `acc` par
   ses composantes mises à l'échelle (diviser d'abord par le max des valeurs absolues). Les deux
   corrections sont utiles : la 1 supprime la cause, la 2 la garde contre toute autre poussée infime
   (RCS, autopilotes).
3. **Défense en profondeur** (à discuter) : dans `flyHome`, ne pas valider un état non fini
   (`X`/`V`/`t` NaN → garder l'état précédent et le signaler une fois) ; dans `heightAt`, rendre
   `{ h: 0, res: 0, rem: 1 }` (la carte globale) pour une direction non finie plutôt que de lever.

### Tests à ajouter

- `tests/pilot.test.ts` (ou voisin) : manette 1 → 0, `spoolK` 0,9 et 0,01, 10 000 pas → `engineNow`
  vaut exactement 0, et `acc` est `[0, 0, 0]`.
- Un test de `fallStep` / `thrust` avec `acc = [1e-311, 0, 1e-312]` : la vitesse rendue est finie et
  égale à la vitesse d'entrée.
- Vérification de bout en bout : `bun scripts/remote.ts run -- bun scripts/live-entry.ts --site Bourget
  --inc 52` — plus aucune ligne `PAGE ERROR` (≈ 14 min sur le Mac mini).
