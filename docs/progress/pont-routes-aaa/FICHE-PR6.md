# Fiche PR6 — Structures fidèles

**Date :** 21 novembre 2026  
**Commit de base :** `64800f18` (sortie de PR5)  
**Auteur :** Antigravity  
**Machine de référence :** Mac principal (Apple M1 Max, 32 Go)

---

## 1. Objectif de la phase PR6

Remplacer les heuristiques génériques d'espacement des piles par une résolution architecturale fidèle par travée et typologie d'ouvrage, et implémenter la silhouette remarquable du pont Alexandre III à Paris :
1. **Typologie et classification des familles d'ouvrages (`classifyBridgeStructure`)** :
   - Reconnaissance géographique et toponymique de l'ouvrage d'art remarquable (ex. pont Alexandre III à Paris sur la Seine : coordonnées $[48.8637^\circ\text{ N}, 2.3135^\circ\text{ E}]$).
   - Détection des grands viaducs ($L > 400\text{ m}$) et des ponts en arc.
2. **Fidélité architecturale du pont Alexandre III (Paris)** :
   - Arc unique en acier surbaissé enjambant la Seine d'une seule travée de 107,5 m : suppression totale des piles intermédiaires dans le fleuve (`computeStructurePierLocations` retourne `[]`), préservant le chenal de navigation.
   - Les quatre pylônes monumentaux d'angle de 17 mètres de haut : générés aux culées avec piédestaux en pierre de taille, fût sculpté s'élevant 14 m au-dessus du tablier (`buildAlexandreIIIPylonsMesh`), et chapiteaux supportant les Renommées en bronze doré.
   - Nervures d'arcs métalliques sous tablier (`buildArchRibsMesh`) : 3 nervures d'acier parallèles suivant la parabole surbaissée sous l'intrados.
3. **Fidélité des grands viaducs** :
   - Espacement des piles calibré sur les normes du génie civil des viaducs ferroviaires et autoroutiers français (espacement de 130 m, `VIADUCT_PIER_SPACING_M`), avec fûts élargis (5,5 m) et ancrages profonds.

---

## 2. Réalisations de code

- **[`src/system/bridge-structures.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/bridge-structures.ts) :**
  - `classifyBridgeStructure(params)` : classe les ponts selon leur famille (`monumental_alexandre_iii`, `viaduct`, `arch`, `girder`).
  - `computeStructurePierLocations(totalLength, family)` : renvoie `[]` pour Alexandre III (aucun appui dans la Seine), 130 m pour les viaducs, 34 m pour les poutres courantes.
  - `buildAlexandreIIIPylonsMesh(params)` : produit le maillage 3D des 4 pylônes monumentaux aux culées avec orientation selon l'axe et le travers.
  - `buildArchRibsMesh(params)` : produit le maillage 3D extrudé des 3 nervures d'arc paraboliques sous le tablier.
- **[`src/system/scenery-worker.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/scenery-worker.ts) :**
  - Intégration de la classification de structure dans `deckBridge` avec passage des coordonnées géographiques `geoPoints`.
  - Remplacement de l'appel direct `pierPlaces(total, viaduct)` par `computeStructurePierLocations(total, family)`.
  - Génération conditionnelle des pylônes monumentaux et des nervures d'arc d'Alexandre III en maillages 3D rastérisés complets (`addSolid`).
- **[`tests/bridge-structures.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-structures.test.ts) :**
  - Témoin Règle 3 : le témoin positif détecte 4 piles génériques polluant le fleuve ; le témoin négatif confirme l'absence totale de dérive ($A/A = 0$, zéro pile en fleuve).
  - Classification fidèle d'Alexandre III, des viaducs et des ponts en arc.
  - Espacement régulier des piles de viaduc à ~130 m.
  - Dimensions et hauteur (+14 m) des 4 pylônes monumentaux.
  - Silhouette et profil continu de l'arc surbaissé.

---

## 3. Preuves et validation

- **[`tests/bridge-structures.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-structures.test.ts) :** 5 tests passants.
- **Suite complète des ponts (7 fichiers) :**
  - 34 passants, 0 échec (353 assertions).
- **Compilation des shaders WGSL :**
  - `bun scripts/check-wgsl.ts` : **84 / 84 shaders compilent avec succès**.
- **Contrôle TypeScript et Biome :**
  - 0 erreur, formatage propre.

---

## 4. Retraits effectués

- Retrait des piles génériques artificielles dans le lit de la Seine sous le pont Alexandre III.
- Retrait de la restriction d'espacement uniforme à 34 m pour tous les ponts.

---

## 5. Prochaine étape

**PR7 — LOD, résidence et PWA complets** :
- Maillage et profil unifiés proche/loin sans dalles plates de substitution.
- Enveloppe d'englobement 3D par tronçon pour le culling des longs viaducs.
- Retrait de `farBridges` parmi les voitures et de ses dalles indépendantes.
