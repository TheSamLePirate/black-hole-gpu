# Fiche PR5 — Usages au bon niveau

**Date :** 21 novembre 2026  
**Commit de base :** `f499cb86` (sortie de PR4)  
**Auteur :** Antigravity  
**Machine de référence :** Mac principal (Apple M1 Max, 32 Go)

---

## 1. Objectif de la phase PR5

Intégrer les usages (véhicules, mobilier urbain, garde-corps, lampadaires) au bon niveau altimétrique et structurel, et éliminer toute contamination entre niveaux superposés ou franchis :
1. **Retrait de `deckHeightAt(x, y)` naïf** : L'ancien code de `scenery-worker.ts` effectuait une recherche aveugle du voisin 2D le plus proche en $(x, y)$ sans vérification d'élévation ni de niveau. Tout élément au sol passant sous un viaduc (véhicule sous le pont, garde-corps au sol) se voyait ainsi téléporté à l'altitude du tablier situé plusieurs mètres au-dessus.
2. **Support canonique multi-niveaux (`SupportSurfaceRegistry`)** : Déploiement d'une requête de surface sensible au niveau (`expectedLevel`) et à l'élévation locale (`expectedZ` avec fenêtre verticale bornée `maxDeltaZ`). Les éléments au sol restent strictement au sol, tandis que les éléments de pont s'ancrent sur le tablier continu.
3. **Séparation stricte des croisements multi-niveaux** : Deux ouvrages se croisant à des niveaux différents (ex. tablier inférieur au niveau 1 et viaduc au niveau 2) conservent leurs flux de circulation et leurs mobiliers respectifs de manière totalement étanche sans saut ni mélange.
4. **Retrait des doublons d'axes OMT en présence de l'autorité BD TOPO** : Lorsque les cellules BD TOPO (`cellBridges`) sont présentes sur la zone, les lignes OMT redondantes dans le même couloir (à moins de 100 m) sont éliminées pour éviter les doublons de maillage et de trafic.

---

## 2. Réalisations de code

- **[`src/system/bridge-surface-service.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/bridge-surface-service.ts) :**
  - Ajout de la méthode `queryBridgeAt(x, y, options)` dans `SupportSurfaceRegistry`, permettant un filtrage précis par niveau (`expectedLevel`) et par fenêtre verticale (`expectedZ`, `maxDeltaZ`).
- **[`src/system/scenery-worker.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/scenery-worker.ts) :**
  - Remplacement de la liste naïve `decks` et de `deckHeightAt` par l'instance `bridgeRegistry` de `SupportSurfaceRegistry`.
  - Intégration de `layer` dans `deckBridge`, `roadLines` et `lampLines`.
  - Dans la génération de trafic : les routes au sol (`!r.bridge`) restent au sol via `heightNow` ; les routes sur pont (`r.bridge`) s'appuient sur `bridgeRegistry.queryBridgeAt(g[0], g[1], undefined, bridgeLayer)`.
  - Dans la pose des garde-corps (`FurnitureKind.Guardrail`) : vérification d'élévation `deckHeightAt(m0[0], m0[1], m0[2])` garantissant que les glissières au sol sous un pont restent au sol et ne sont plus hissées sur le tablier.
  - Dans la pose des lampadaires (`lampLines`) : ancrage au tablier continu avec le niveau approprié `r.layer`.
  - Retrait des lignes OMT `bridgeLines` redondantes lorsque `cellBridges.size > 0` et qu'une structure BD TOPO équivalente existe à moins de 100 m.
- **[`tests/bridge-traffic.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-traffic.test.ts) :**
  - Témoin Règle 3 : le témoin positif reproduit le saut de 8 mètres de l'ancien `deckHeightAt` non borné sur un véhicule au sol ; le témoin négatif confirme l'absence totale de dérive ($A/A = 0$, maintien strict au sol).
  - Validation du maintien du trafic au sol sous les ponts.
  - Validation du suivi de profil pour le trafic sur tablier.
  - Validation de l'isolation complète sur un croisement à deux niveaux ($z=35\text{ m}$ vs $z=44\text{ m}$, écart 9 m sans contamination).
  - Validation du maintien des garde-corps et mobiliers au sol.

---

## 3. Preuves et validation

- **[`tests/bridge-traffic.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-traffic.test.ts) :** 5 tests passants.
- **Suite complète des ponts (6 fichiers) :**
  - `bun test tests/bridges-corpus.test.ts tests/bridge-ports.test.ts tests/bridge-surface.test.ts tests/bridge-mesh.test.ts tests/bridge-material.test.ts tests/bridge-traffic.test.ts` : 29 passants, 0 échec (291 assertions).
- **Compilation des shaders WGSL :**
  - `bun scripts/check-wgsl.ts` : **84 / 84 shaders compilent avec succès**.
- **Contrôle TypeScript et Biome :**
  - 0 erreur, formatage propre.

---

## 4. Retraits effectués

- Retrait de la recherche 2D aveugle `deckHeightAt(x, y)` sans discrimination d'élévation ni de niveau.
- Retrait de la téléportation intempestive des glissières de sécurité et véhicules du sol vers le tablier des viaducs.
- Retrait des tracés d'ouvrages OMT doublant l'autorité BD TOPO migrée sur la même emprise.

---

## 5. Prochaine étape

**PR6 — Structures fidèles** :
- Typologie et travées remarquables (pont Alexandre III, arches surbaissées, viaducs à grandes travées).
- Espacements réels de piles et silhouettes caractéristiques.
