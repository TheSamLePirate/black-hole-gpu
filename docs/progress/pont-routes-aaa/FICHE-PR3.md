# Fiche PR3 — Géométrie continue routes/ponts

**Date :** 21 novembre 2026  
**Commit de base :** `86f54c0f` (sortie de PR2)  
**Auteur :** Antigravity  
**Machine de référence :** Mac principal (Apple M1 Max, 32 Go)

---

## 1. Objectif de la phase PR3

Supprimer définitivement les marches d'escalier verticales entre tranches de pont et construire une géométrie 3D continue et fermée :
1. **Élimination des prismes horizontaux disjoints** : L'ancien code découpait le tablier en tranches de 10 m modélisées comme des prismes à dessus plat horizontal (`buildingMesh`), générant des falaises verticales atteignant 2,75 m entre tranches adjacentes sur un ouvrage de 100 m. PR3 introduit un maillage 3D extrudé continu (`buildContinuousSliceMesh`) dont les sommets suivent la pente exacte du profil : les tranches consécutives partagent rigoureusement les mêmes coordonnées 3D à leur frontière, garantissant un ressaut vertical strictement nul ($\Delta z = 0,000$ m).
2. **Culées d'extrémité réelles et conformes aux ports** :
   - Si l'extrémité est un bout terrestre fermé (`!OpenA` / `!OpenB`) : génération d'un mur de culée vertical scellant l'extrémité du tablier jusqu'au sol d'accès.
   - Si l'extrémité est un port ouvert intercellules (`OpenA` / `OpenB`) : la section transversale reste ouverte pour s'apparier de façon invisible avec la tuile adjacente.
3. **Garde-corps / parapets continus** : Les bordures et parapets (`buildContinuousRailMesh`) épousent la courbure et le dénivelé du tablier sans barres horizontales flottantes ni ruptures.
4. **Ancrage physique des piles** : Les fûts de piles (`buildContinuousPierMesh`) s'enracinent solidement dans le terrain ($g - 2,0$ m) et viennent s'ajuster exactement sous l'intrados du tablier ($z_{\text{intrados}} = z_{\text{top}} - \text{thick}$), sans pile flottante ni discontinuité.
5. **Retrait des aires surfaciques OMT concurrentes** : Neutralisation des anciennes dalles plates `bridgeAreas` d'OpenMapTiles lorsque le domaine dispose des ouvrages vectoriels BD TOPO (`cellBridges`).

---

## 2. Réalisations de code

- **[`src/system/bridge-mesh.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/bridge-mesh.ts) :**
  - `buildContinuousSliceMesh(params)` : construction du prisme 3D triangulé pour chaque tranche de tablier avec faces d'intrados, rives latérales, et culées conditionnelles.
  - `buildContinuousRailMesh(params)` : modélisation 3D continue des parapets latéraux suivant le profil en long.
  - `buildContinuousPierMesh(params)` : génération de colonnes de piles avec ancrage en terre et raccord intrados.
  - `computeSlicePlane(pa, pb, top0, top1)` : calcul des coefficients du plan analytique $z = Ax + By + C$ pour le contact CPU et le tracé GPU.
- **[`src/system/scenery-worker.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/scenery-worker.ts) :**
  - Extension de `addSolid` pour accepter un `customMesh` 3D triangulé sans passer par `buildingMesh`.
  - Remplacement dans `deckBridge` des dalles plates de 10 m par le maillage continu 3D de tablier, de parapets et de piles ancrées.
  - Désactivation des polygones plats OMT `bridgeAreas` dans le domaine couvert par les ponts vectoriels.

---

## 3. Preuves et validation

- **[`tests/bridge-mesh.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-mesh.test.ts) :**
  - *Témoin Règle 3 A/A et défaut injecté* : Un test négatif A/A confirme $\Delta = 0$ strict sur maillage identique. L'injection d'un défaut de +40 cm est détectée avec précision ($0,40000$ m).
  - *Témoin de continuité sur ouvrage de 100 m* : Mesure des écarts 3D entre sommets de tranches adjacentes $k \to k+1$ sur 10 tranches consécutives : écart vertical max $< 10^{-6}$ m (contre 2,75 m dans le code legacy).
  - *Témoin de culée* : Vérification de la présence du mur de culée pour un bout fermé (30 indices) et de l'absence pour un port ouvert `OpenA` (24 indices).
  - *Témoin de garde-corps* : Alignement continu sans ressaut ($\Delta z = 0$) sur les têtes de parapet.
  - *Témoin d'ancrage des piles* : Piles pénétrant de 2 m dans le sol et raccordées à l'intrados à la cote exacte.
- **Suite de tests ponts :**
  - `bun test tests/bridges-corpus.test.ts tests/bridge-ports.test.ts tests/bridge-surface.test.ts tests/bridge-mesh.test.ts` : 19 passants, 0 échec (235 assertions).

---

## 4. Retraits effectués

- Retrait des dalles horizontales plates à hauteur médiane constante dans `deckBridge` (`scenery-worker.ts`).
- Retrait de l'écrasement des ponts vectoriels par les dalles de polygones plats OMT `bridgeAreas`.

---

## 5. Prochaine étape

**PR4 — Chaussée et raster communs** :
- Intégration des attributs de marquage routier, texture d'asphalte et shader de pluie/mouillé aux faces supérieures des tabliers de pont.
- Levée du veto global `bridgeCount === 0` dans le dispatch du renderer (`src/renderer.ts`).
