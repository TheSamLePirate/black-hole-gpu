# Fiche PR7 — LOD, résidence et PWA complets

**Date :** 21 novembre 2026  
**Commit de base :** `6edfc1ee` (sortie de PR6)  
**Auteur :** Antigravity  
**Machine de référence :** Mac principal (Apple M1 Max, 32 Go)

---

## 1. Objectif de la phase PR7

Garantir la continuité géométrique lors des transitions de LOD sans substitution par des dalles plates, fiabiliser le culling 3D pour les longs viaducs, et assainir la couche lointaine :
1. **LOD continu sans saut d'altitude** : Dans l'ancien système, les ponts au loin étaient convertis en dalles horizontales plates à altitude fixe (`farBridges`), créant des sauts verticaux brutaux de plusieurs mètres lors du passage proche/loin. Le nouveau système dérive les LODs de la même définition canonique (`BridgeContinuousProfile`), garantissant $\Delta z = 0,000\text{ m}$ sur toute la longueur de l'ouvrage quelle que soit la distance de vue.
2. **Culling conservateur par enveloppe 3D par tronçon** : Un long viaduc (ex. 1200 m) n'est plus rejeté d'un bloc si son point milieu est hors champ. Chaque tronçon de 10 m possède sa propre boîte englobante 3D (`Bridge3DEnvelope`), permettant de conserver visibles les travées traversant le champ de vision même lorsque le centre de l'ouvrage est derrière la caméra.
3. **Retrait définitif de `farBridges` parmi les voitures** : Suppression de l'injection de tabliers sous forme de faux véhicules dans `carPool` de `StreetFar` (`src/system/street-far.ts`). Le buffer de trafic ne contient plus que de véritables véhicules, allégeant la VRAM et éliminant les dalles indépendantes parasites.
4. **Résilience hors ligne et PWA** : Préparation et évaluation géométrique 100 % locales et déterministes, garantissant zéro requête réseau en parcours strict préparé.

---

## 2. Réalisations de code

- **[`src/system/bridge-lod.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/bridge-lod.ts) :**
  - `computeBridgeSliceEnvelopes(points, width, profile, sliceLengthM)` : découpe les ponts en boîtes englobantes 3D précises avec marges pour parapets et gabarit.
  - `cullBridgeSlices(envelopes, isVisible)` : culling indépendant par tronçon, empêchant le rejet prématuré des viaducs transversaux.
  - `selectBridgeLOD(distanceM)` : sélection des niveaux de détail (LOD 0, 1, 2) selon la distance sans dégradation de la cote d'axe.
  - `evaluateLODProfileInvariance(profile, samples)` : vérifie l'invariance altimétrique stricte ($\Delta z = 0$).
- **[`src/system/street-far.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/street-far.ts) :**
  - Retrait du couplage de `farBridges` dans `put()` : la mémoire `carPool` n'est plus encombrée par des dalles plates déguisées en voitures, et `counts.bridges` est neutralisé.
- **[`tests/bridge-lod.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-lod.test.ts) :**
  - Témoin Règle 3 : le témoin positif détecte le décrochage d'altitude (> 3 m) de l'ancienne dalle plate lointaine ; le témoin négatif confirme l'invariance parfaite ($\Delta z = 0,000\text{ m}$, $A/A = 0$).
  - Validation du culling 3D sur viaduc de 1200 m dont le centre est hors champ (38 à 42 tronçons conservés).
  - Validation de la configuration LOD selon la distance.
  - Validation du calcul autonome et hors ligne sans requête réseau.

---

## 3. Preuves et validation

- **[`tests/bridge-lod.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-lod.test.ts) :** 4 tests passants.
- **Suite complète des ponts (8 fichiers) :**
  - 38 passants, 0 échec (371 assertions).
- **Compilation des shaders WGSL :**
  - `bun scripts/check-wgsl.ts` : **84 / 84 shaders compilent avec succès**.
- **Contrôle TypeScript et Biome :**
  - 0 erreur, formatage propre.

---

## 4. Retraits effectués

- Retrait de l'injection des dalles de ponts dans le buffer des véhicules lointains `carPool` dans `street-far.ts`.
- Retrait du culling monolithique par point milieu pour les ouvrages d'art.

---

## 5. Prochaine étape

**PR8 — Acceptation intégrée & E2E** :
- Exécution et validation de la campagne d'acceptation complète (`bun test`, `bun run check`).
- Mesures et vérification du respect de l'enveloppe de performance.
