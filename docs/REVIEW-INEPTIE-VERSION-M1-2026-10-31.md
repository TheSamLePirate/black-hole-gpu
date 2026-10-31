# Revue de la branche `Ineptie-Version-m1` (31 octobre 2026)

Branche `origin/Ineptie-Version-m1`, auteur jerem (`jeremy.dicara@hotmail.fr`). Revue faite en lecture seule :
le projet, les tests unitaires et les e2e n'ont pas été lancés. Les constats viennent de la lecture du diff, de
`git merge-tree` contre `main` et de la lecture des sources de `main` à `1f09c35d`. Les numéros de ligne
renvoient à `main`.

Gravité : **Critique** (à régler avant tout merge), **Haute** (bug visible ou coût net), **Moyenne**, **Basse**.

## Conclusions

1. **Le volume est petit** : un seul commit (`1585a325`), 4 fichiers, +28 / −5 lignes. Il mélange deux sujets
   indépendants, des correctifs d'outillage pour Windows et une modification du rendu temps réel.
2. **Les correctifs Windows sont bons et utiles.** Ils sont sans effet sur macOS. Ils rendent `bun run check`
   utilisable sur le PC Windows, alors que `main` concentre aujourd'hui son travail de performance sur cette
   machine. **À prendre.**
3. **La partie rendu part d'une bonne idée**, une reconstruction guidée par la profondeur, technique classique. Mais
   elle contient **deux bugs certains** (netteté au-delà de la plage de RCAS, et netteté renforcée qui reste après
   le mouvement) et **un défaut de conception** : le guide de profondeur est périmé. Elle n'a été ni mesurée ni
   capturée. **À ne pas fusionner en l'état.**
4. **La fusion passe techniquement.** La branche part de `de7b0b6c`, qui a 101 commits de retard sur `main`, mais
   `git merge-tree main origin/Ineptie-Version-m1` ne signale aucun conflit. Aucune des zones touchées n'a bougé
   sur `main`. En revanche, **le contexte a changé** : `main` écrit désormais la profondeur des nuages dans
   `moments.y`, et le guide agirait sur eux sans avoir été pensé pour ça (§3.4).
5. **Proposition : scinder en deux.** Prendre tout de suite les correctifs Windows dans un commit séparé (§4.1).
   Renvoyer la partie rendu pour qu'elle soit reprise, avec les corrections et le protocole de validation du §4.2.

## 1. Contenu de la branche

| Fichier | Lignes | Sujet |
|---|---|---|
| `scripts/check-wgsl.ts` | +1 / −1 | Windows : découpage des chemins sur `\` et `/` |
| `scripts/lib/headless-gpu.ts` | +5 / −1 | Windows : suppression du profil Chrome rendue non fatale |
| `src/shaders/post.wgsl` | +19 / −2 | Rendu : reconstruction `gatherH` / `resolve` guidée par la profondeur |
| `src/renderer.ts` | +3 / −1 | Rendu : RCAS renforcé quand le bloc temps réel grossit |

Message du commit : *« Reconstruction ×6–×8 : gather du tracé guidé par la profondeur, RCAS plus fort quand les rayons
s'espacent »*. La branche ne descend pas de `Ineptie-Version`, malgré son nom.

## 2. Correctifs Windows : audit

### 2.1 `scripts/check-wgsl.ts`, les chemins

```ts
shaders[f.split("/").pop()!]        // avant
shaders[f.split(/[\\/]/).pop()!]    // après
```

`check-wgsl.ts` fait partie de `bun run check` (`biome ci . && tsc --noEmit && bun scripts/check-wgsl.ts`). Il range
chaque shader sous son nom de fichier. Sous Windows, `Glob.scan` renvoie `src\shaders\trace.wgsl`. `split("/")` ne
coupe alors rien, la clé devient le chemin entier, `shaders["trace.wgsl"]` vaut `undefined` et le script plante à
`withForest(shaders[host]!, …)` avant d'avoir validé un seul shader.

- **Effet :** sans ce correctif, `bun run check` échoue toujours sous Windows. Le correctif ne change rien sous macOS.
- **Verdict :** ✅ correct, minimal.

### 2.2 `scripts/lib/headless-gpu.ts`, le nettoyage du profil Chrome

```ts
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  // (Windows: Chrome may still hold its profile for a moment — …)
}
```

`withGpuPage` lance un Chrome sans fenêtre avec un profil temporaire et le supprime dans le `finally`. Sous Windows,
Chrome garde ses fichiers verrouillés un moment après sa fermeture (`EBUSY` / `EPERM`). Une exception levée dans un
`finally` **remplace** le résultat du bloc : une validation réussie finit en échec, et une vraie erreur de shader est
masquée par une erreur de suppression de dossier.

- **Effet :** on garde le vrai verdict. Au pire, un dossier temporaire reste sur le disque. Les bénéficiaires sont
  tous les scripts qui utilisent `withGpuPage` : `check-wgsl.ts`, `check-forest.ts` et `render-music.ts`.
- **Réserve (Basse) :** le `catch {}` vide avale toutes les erreurs, pas seulement le verrou. Un
  `console.warn(\`profile left behind: ${profile}\`)` serait préférable.
- **Verdict :** ✅ correct.

## 3. Rendu : audit

### 3.1 Ce que fait le changement

Quand le GPU peine, le temps réel trace un rayon par bloc de `b × b` px. `BLOCKS = [1, 2, 3, 4, 6, 8]` se trouve à
`renderer.ts:262`. Les pixels sans rayon frais sont reconstruits par convolution normalisée gaussienne séparable :
`gatherH` (`post.wgsl:34`) fait la passe horizontale, `resolve` (`post.wgsl:175`, boucle verticale vers la ligne 274)
la passe verticale.

Le commit multiplie le poids de chaque échantillon par une ressemblance de profondeur :
`max(exp(-rel²), 0.02)` avec `rel = (d_q − d_p) / (0.05·d_p)`, soit environ 5 % de tolérance relative. Il le fait
dans les deux passes, ce qui donne un filtre bilatéral croisé séparable. Le but annoncé est que les horizons, les
crêtes et les bords de nuages ne bavent plus.

Il fait aussi passer la netteté RCAS de `s.sharpen` à `s.sharpen × (1 + 0,6·clamp((bloc − 4)/4, 0, 1))`, soit
×1,3 au bloc 6 et ×1,6 au bloc 8.

### 3.2 Constats

#### R1 (Haute) : la netteté sort de la plage de RCAS et peut casser l'image

`rcasDelta` (`display.wgsl:98`) prévoit `amount ∈ [0, 1]`. Le curseur `sharpen` va de 0 à 1 dans `schema.ts`.

```wgsl
var lobe = max(-0.1875, min(…, 0.0)) * exp2(-2.0 * (1.0 - amount));   // display.wgsl:117
let o = clamp((lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0), …);   // display.wgsl:126
```

Le lobe est d'abord borné à −0,1875, la limite de FSR qui garantit l'absence de halo, **puis** multiplié par
`exp2(−2(1 − amount))`. Ce facteur dépasse 1 dès que `amount > 1` :

- **Au-delà de `amount = 1`**, la garantie « sans halo » ne tient plus. Au bloc 8, c'est le cas dès
  `sharpen > 0,625`.
- **À `amount ≥ 1,2075`**, le dénominateur `4·lobe + 1` peut devenir nul puis négatif (lobe ≤ −0,25). Le texel
  sort alors noir, ou blanc brûlé : avec `o` borné à 0,999, `o/(1 − o)` vaut environ 999. Cela arrive dès
  `sharpen ≥ 0,755` au bloc 8, ou `sharpen ≥ 0,93` au bloc 6.
- **À `sharpen = 1` au bloc 8**, `amount` vaut 1,6, le lobe peut atteindre environ −0,43 et le dénominateur environ
  −0,72.

Avec la valeur par défaut de 0,3, on monte au plus à `amount = 0,48` et le bug ne se déclenche pas. Le commentaire
ajouté (« RCAS is contrast-adaptive: it does not ring the edges ») est faux au-delà de 1.

**Correctif :** `Math.min(1, …)`.

#### R2 (Haute) : la netteté renforcée reste active sur l'image fixe

`realtimeBlockNow` (`renderer.ts:1029`) renvoie `lastBlock`. Ce champ n'est écrit que dans la branche temps réel
(`renderer.ts:8933`) et pas pendant `converging`. Quand la caméra s'arrête et que l'image s'affine en pleine
résolution, elle garde le ×1,6 du dernier bloc temps réel. La netteté d'une image fixe dépend alors de la façon dont
on bougeait juste avant, et l'image finale est sur-accentuée.

**Correctif :** ne renforcer que si `t === this.live && this.lastPhase === "realtime"`. Le champ `lastPhase` existe
déjà (`renderer.ts:1066`). Il reflète l'image précédente, et ce décalage d'une image est acceptable.

#### R3 (Haute, conception) : le guide de profondeur est périmé

Le guide est `dp = moments[idx].y`, la profondeur du pixel **lors de son dernier tracé**. Pour un pixel du traceur,
`moments.y` n'est réécrit que quand un rayon tombe dessus. Au bloc 8, cela peut remonter jusqu'à b² − 1 = 63 images.
Le code de `main` le dit lui-même, au-dessus de la passe `occlusion` (`post.wgsl:918`) : *« Its own was traced one
to b² − 1 frames ago »*. C'est pourquoi cette passe prend la profondeur la plus proche **des coins frais** du réseau
de blocs.

Le schéma a été copié du chemin raster (`RASTER_STALE`, dans `resolve`), où la profondeur **est** réécrite à chaque
image. Pour le traceur, ce n'est pas le cas.

**Conséquence probable :** en mouvement, qui est justement le cas des blocs 6 à 8, un pixel qui était sur la montagne
et qui montre désormais le ciel rejette les échantillons de ciel frais (poids 0,02) et prend ceux de la montagne. La
silhouette laisse une traînée, l'inverse du but recherché. C'est une conclusion tirée de la lecture du code, pas
d'une capture.

#### R4 (Moyenne) : la portée est plus large qu'annoncé

Le titre dit « ×6–×8 », mais le guidage est inconditionnel dans le chemin `2 ≤ bloc < 16`. Les blocs 2, 3 et 4,
c'est-à-dire la plupart des images en temps réel sur une bonne machine, sont donc modifiés aussi, sans mesure.

#### R5 (Moyenne) : la protection est asymétrique

Le guidage exige `dp < 5e8`. Un pixel de ciel (profondeur 1e9) n'est donc pas guidé. Le sol est protégé du ciel,
mais le relief continue de baver dans le ciel au-dessus de l'horizon. Il manque un test « l'échantillon est du
ciel » pour les pixels de ciel.

#### R6 (Moyenne) : surfaces rasantes

Sur un plan vu en incidence rasante, la profondeur varie de plus de 5 % entre deux échantillons distants d'un bloc :
sol bas sur l'horizon, anneaux de Saturne par la tranche. Presque tous les poids tombent alors au plancher, et la
reconstruction ne retient que les échantillons de même profondeur, à peu près une ligne. On risque des stries. Le
chemin raster de `resolve` note déjà ce piège (« a grazing ground's depth changes by more than 5 % a row »).

#### R7 (Basse) : les planchers se multiplient

Les deux passes ont chacune un plancher de 0,02, soit 0,0004 au total. Quand aucun voisin ne ressemble au pixel, la
somme des poids devient très petite devant l'a priori bilinéaire `bil · 0,02` de `resolve`, qui ne tient pas compte
de la profondeur. Le bilinéaire, qui bave, reprend alors le dessus.

#### R8 (Moyenne) : performance

Le changement ajoute environ 2 × (2b + 1) `exp` par pixel reconstruit (34 au bloc 8) et, dans `resolve`, 2b + 1
lectures de `moments` en colonne. Le surcoût est modeste en absolu, mais il tombe sur le chemin lent : les blocs 6 à
8 ne servent que quand le GPU est déjà en difficulté. Aucune mesure n'est fournie (ms, dB, captures), alors que les
commits du dépôt en donnent d'habitude.

### 3.3 Qualité du code

Le code est lisible, ses commentaires suivent le style du projet et le diff est ciblé. Il n'y a ni test, ni
capture, ni mesure. Le commentaire sur RCAS est faux (R1). Le commit mélange outillage et rendu.

### 3.4 Interaction avec `main` à `1f09c35d`

- **Pas de conflit.** `gatherH`, `resolve`, `rcasDelta`, la ligne `s.sharpen`, `check-wgsl.ts` et `headless-gpu.ts`
  sont inchangés sur `main` depuis `de7b0b6c`. Le patch s'applique tel quel, avec exactement la même sémantique
  locale, donc avec **R1 à R8 intacts**.
- **Nouveau risque : les nuages.** `main` écrit désormais la distance des nuages dans `moments.y` pour les pixels du
  traceur couverts à plus de 50 % (`trace.wgsl:12995` : `select(depth, cs.tc…, alpha > 0.5)`). Le guide agira donc
  sur les bords et l'intérieur des nuages. Un bord net entre un nuage et ce qui est derrière pourrait en profiter.
  Mais une distance volumétrique, qui varie d'une image à l'autre, avec une tolérance de 5 %, fait craindre des
  taches et du scintillement dans les nuages. Ce cas n'existait pas sur la base de la branche.
- **Raster.** `main` a ajouté des marques raster (`RASTER_MARK`, `rasterStale`). Les pixels raster sont déjà exclus
  de `gatherH`, donc il n'y a pas d'interaction directe.

## 4. Proposition : scinder en deux

### 4.1 Partie A : correctifs Windows (à prendre maintenant)

```sh
git switch main
git checkout origin/Ineptie-Version-m1 -- scripts/check-wgsl.ts scripts/lib/headless-gpu.ts
# facultatif : console.warn dans le catch de headless-gpu.ts (§2.2)
git commit -m "Scripts sous Windows : chemins des shaders en \\ ou /, profil Chrome laissé s'il est verrouillé" \
  --author="jerem <jeremy.dicara@hotmail.fr>"
```

- **Risque :** nul sous macOS.
- **Validation :** `bun run check` sous macOS (pas de régression) et sur le PC Windows (le script va jusqu'au bout).

### 4.2 Partie B : rendu (à reprendre avant de fusionner)

Ne pas reprendre `src/renderer.ts` ni `src/shaders/post.wgsl` de la branche tels quels. Ordre proposé :

1. **Netteté (R1, R2)**, quelques lignes à `renderer.ts:3659` :
   ```ts
   const boost = t === this.live && this.lastPhase === "realtime"
     ? 0.6 * Math.min(Math.max((this.realtimeBlockNow - 4) / 4, 0), 1) : 0;
   // …
   Math.min(1, s.sharpen * (1 + boost)),
   ```
   À défaut, borner `amount` dans `rcasDelta` lui-même avec `clamp(amount, 0, 1)`, pour se protéger de tout autre
   appelant.
2. **Guide de profondeur (R3)** : remplacer `moments[idx].y` par la profondeur la plus proche des coins frais du
   réseau de blocs, comme le fait déjà la passe `occlusion`. Dans `resolve`, `p00` et `p11` sont déjà calculés. Dans
   `gatherH`, calculer le même réseau, ou écrire le guide une fois dans un tampon commun aux deux passes.
3. **Portée (R4)** : limiter le guidage à `bloc ≥ 6`, comme annoncé, tant que les blocs 2 à 4 n'ont pas été mesurés.
4. **Ciel (R5)** : pour un pixel de ciel, rejeter les échantillons qui ne sont pas du ciel, et inversement.
5. **Nuages (§3.4)** : décider explicitement. Soit exclure du guidage les pixels de nuage, soit élargir la tolérance
   pour eux.
6. **Surfaces rasantes (R6)** : adapter la tolérance au gradient de profondeur local, ou la relever (10 à 20 %) et
   juger sur captures.
7. **Validation**, dans l'esprit des autres commits du dépôt :
   - captures avant/après au bloc 8 **en mouvement** (virage) sur un horizon montagneux, un bord de cumulus, les
     anneaux de Saturne par la tranche, et le disque du trou noir ;
   - PSNR contre l'image fixe, comme dans `schema.ts` (« 30,5 → 32,5 dB ») ;
   - coût GPU des passes `gather` et `resolve` en ms, sur le PC Windows et sur un Mac M1 ;
   - `bun run check && bun test`, et un passage e2e de la campagne rendu (`docs/E2E.md`).

## 5. Récapitulatif

| # | Gravité | Zone | Constat | Statut |
|---|---|---|---|---|
| W1 | — | `check-wgsl.ts` | Chemins Windows | ☐ à prendre (partie A) |
| W2 | Basse | `headless-gpu.ts` | `catch {}` muet, à journaliser | ☐ à prendre (partie A) |
| R1 | Haute | `renderer.ts` / `display.wgsl:117-126` | `amount` > 1 : halos, puis dénominateur négatif | ☐ partie B |
| R2 | Haute | `renderer.ts:1029, 8933` | Netteté renforcée qui reste pendant l'affinage | ☐ partie B |
| R3 | Haute | `post.wgsl` gatherH / resolve | Guide de profondeur périmé (jusqu'à b² − 1 images) | ☐ partie B |
| R4 | Moyenne | `post.wgsl` | Guidage aussi aux blocs 2 à 4, non annoncé | ☐ partie B |
| R5 | Moyenne | `post.wgsl` | Pixels de ciel non guidés | ☐ partie B |
| R6 | Moyenne | `post.wgsl` | Tolérance de 5 % sur les surfaces rasantes | ☐ partie B |
| R7 | Basse | `post.wgsl` | Les planchers multipliés laissent dominer le bilinéaire | ☐ partie B |
| R8 | Moyenne | `post.wgsl` | Coût non mesuré sur le chemin lent | ☐ partie B |
| N1 | Moyenne | `trace.wgsl:12995` (main) | Profondeur des nuages désormais guidée, cas non prévu | ☐ partie B |
