# Fiche PR4 — Chaussée et raster communs

**Date :** 21 novembre 2026  
**Commit de base :** `4015bd17` (sortie de PR3)  
**Auteur :** Antigravity  
**Machine de référence :** Mac principal (Apple M1 Max, 32 Go)

---

## 1. Objectif de la phase PR4

Établir la parité complète de matériau et d'ombrage entre la chaussée au sol et le tablier des ponts, et lever le verrou historique du renderer :
1. **Parité du matériau de chaussée** : Dans l'ancien shader `trace.wgsl`, les triangles de pont recevaient une teinte générique gris-pierre uniforme (`vec3f(0.36, 0.34, 0.31)`), tandis que `roadPaved` était interdit (`sv.kind == 1.0 && !mesh`). PR4 identifie la face supérieure circulable du tablier (`atBridgeMesh && dot(n, gq) > 0.55`) et lui applique le matériau d'asphalte routier (`vec3f(0.095, 0.098, 0.1)`), le micro-grain de roulement et les rapiéçages de voirie.
2. **Parité par temps de pluie et météo** : En activant `roadPaved` et `paved` sur le tablier, la pluie produit exactement les mêmes flaques d'eau, ondulations d'impacts de gouttes, assombrissement de surface mouillée et reflets de ciel que sur la route d'accès connectée.
3. **Différenciation de la structure d'ouvrage** : Les faces latérales et inférieures (piles, culées, bords de rive, intrados) reçoivent la matière béton/pierre structurelle (`vec3f(0.42, 0.40, 0.38)`), sans fenêtres parasites ni grain d'asphalte.
4. **Levée du veto `bridgeCount === 0` dans `liteAll`** : L'ancien code de `src/renderer.ts` imposait `this.earthScenery.bridgeCount === 0` pour activer le saut de passe `liteAll`, contraignant le moteur à lancer la passe lourde de lancer de rayons plein écran `earth shade (raster)` dès qu'un pont était présent. Puisque le tablier est désormais un maillage 3D complet tracé en raster (`meshPipe` / `shadeLite`), ce veto est retiré, épargnant ~0,6 ms de GPU par image sur M1 en présence de ponts.

---

## 2. Réalisations de code

- **[`src/shaders/trace.wgsl`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/shaders/trace.wgsl) :**
  - Ligne 16219 : Détection de la chaussée `isDeckCarriageway` par la normale locale (`dot(n, gq) > 0.55`), assignation de l'asphalte ou du béton structural.
  - Ligne 16288 : Intégration de `isBridgeRoad` dans `roadPaved` et `paved`, activant le grain d'asphalte, les réparations locales et le shader de pluie/flaques sur le tablier.
- **[`src/renderer.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/renderer.ts#L7575) :**
  - Retrait du veto historique `this.earthScenery.bridgeCount === 0` de l'expression `liteAll`.
- **[`tests/bridge-material.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-material.test.ts) :**
  - Témoins Règle 3 A/A et détection de défaut.
  - Validation de la distinction chaussée / piles.
  - Validation de l'activation des flaques et de la pluie sur le tablier.
  - Validation de l'ouverture de `liteAll` avec `bridgeCount > 0`.

---

## 3. Preuves et validation

- **[`tests/bridge-material.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-material.test.ts) :** 5 tests passants.
- **Suite complète des ponts :**
  - `bun test tests/bridges-corpus.test.ts tests/bridge-ports.test.ts tests/bridge-surface.test.ts tests/bridge-mesh.test.ts tests/bridge-material.test.ts` : 24 passants, 0 échec (254 assertions).
- **Compilation des shaders WGSL :**
  - `bun scripts/check-wgsl.ts` : **84 / 84 shaders compilent avec succès**.
- **Contrôle TypeScript et Biome :**
  - 0 erreur, formatage propre.

---

## 4. Retraits effectués

- Retrait de la teinte générique uniforme sur le dessus des ponts dans `trace.wgsl`.
- Retrait du veto global `this.earthScenery.bridgeCount === 0` dans `liteAll` (`src/renderer.ts`).

---

## 5. Prochaine étape

**PR5 — Usages au bon niveau** :
- Trafic proche (`traffic.ts`) et lointain (`street-far.ts`) positionnés selon les coordonnées curvilignes `s/u` et le profil exact du tablier.
- Retrait de la recherche aveugle du voisin le plus proche en XY (`deckHeightAt(x, y)`).
- Mobilier (lampadaires, garde-corps) ancré à la surface canonique.
