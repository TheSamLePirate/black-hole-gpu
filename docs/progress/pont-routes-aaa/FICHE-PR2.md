# Fiche PR2 — Profil et supports communs

**Date :** 21 novembre 2026  
**Commit de base :** `4b179330` (sortie de PR1)  
**Auteur :** Antigravity  
**Machine de référence :** Mac principal (Apple M1 Max, 32 Go)

---

## 1. Objectif de la phase PR2

Résoudre la discontinuité géométrique et l'ambiguïté verticale entre la chaussée amont/aval et le tablier des ponts :
1. **Suppression du ressaut vertical aux culées** : L'ancien code de `scenery-worker.ts` imposait un `+ 0.4 m` arbitraire aux extrémités de chaque pont, créant une marche de 40 cm au raccordement route/pont. La nouvelle résolution de profil `BridgeContinuousProfile` garantit $z(0) = z_A$ et $z(L) = z_B$ (continuité $C^0$ exacte avec la route d'accès).
2. **Garantie d'intrados et gabarit sous ouvrage** : Le profil calculé assure en tout point $s$ que le dessous du tablier respecte le tirant d'air minimal :
   $$z(s) - \text{épaisseur} \ge z_{\text{obstacle}}(s) + \text{gabarit}$$
   avec transition parabolique douce raccordée aux extrémités.
3. **Rôles transversaux métriques** : Définition des zones de la section en travers (chaussée circulable, trottoir, garde-corps/parapet) avec repère local $(s, u)$.
4. **Service de surface multi-niveaux avec hystérèse (`SupportSurfaceRegistry`)** : Permet de requêter la surface de roulement à un point $(x, y, z)$ sans écraser le sol sous-jacent ni confondre les étages, avec tolérance d'hystérèse pour le trafic.

---

## 2. Réalisations de code

- **[`src/system/bridge-surface-service.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/bridge-surface-service.ts) :**
  - Classe `BridgeContinuousProfile` : calcul du profil en long continu avec garantie de raccordement aux culées ($s=0$ et $s=L$) et respect du gabarit d'intrados.
  - Interfaces `CrossSectionRole` (`carriageway`, `sidewalk`, `parapet`) et méthode `evaluateCrossSection(u)`.
  - Classe `SupportSurfaceRegistry` : enregistrement spatial des surfaces de ponts avec requêtes d'élévation 3D et hystérèse pour objets roulants.
- **[`src/system/scenery-worker.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/scenery-worker.ts) :**
  - Intégration de `BridgeContinuousProfile` dans `deckBridge` à la place de l'ancienne fonction parabolique avec saut de `+ 0.4 m`.
  - Prise en compte de la longueur curviligne pour le style viaduc (> 400 m) et calcul continu des élévations de tablier.

---

## 3. Preuves et validation

- **[`tests/bridge-surface.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-surface.test.ts) :**
  - *Témoin de raccordement sans ressaut* : Vérification que $|z(0) - z_A| < 10^{-6}$ m et $|z(L) - z_B| < 10^{-6}$ m.
  - *Témoin de continuité de pente* : $\Delta z$ sur un intervalle de 1 cm est strictement borné ($< 0.01$ m), sans falaise verticale.
  - *Témoin de gabarit d'intrados* : En tout point $s \in [0, L]$, $\text{elevation}(s) - \text{épaisseur} \ge \text{obstacle} + \text{gabarit}$.
  - *Témoin de section transversale* : Répartition exacte entre chaussée centrale ($u \in [-3.5, 3.5]$), trottoirs et parapets.
  - *Témoin de registre multi-niveaux* : Une requête à $z \approx 44$ m retourne le tablier du pont (`carriageway`), tandis qu'une requête au sol ($z \approx 30$ m) retourne la surface terrestre sous le pont sans interférence.
- **Suite de tests ponts :**
  - `bun test tests/bridges-corpus.test.ts tests/bridge-ports.test.ts tests/bridge-surface.test.ts` : 13 passants, 0 échec.

---

## 4. Retraits effectués

- Retrait du ressaut systématique `+ 0.4` aux culées dans `deckBridge` (`scenery-worker.ts`).
- Retrait de la parabole empirique aveugle non contrainte par le gabarit d'intrados.

---

## 5. Prochaine étape

**PR3 — Géométrie continue routes/ponts** :
- Remplacement du découpage en tranches horizontales disjointes (marches d'escalier de 10 m) par un maillage 3D extrudé continu suivant le profil en long.
- Modélisation des culées d'extrémité (raccordement en coin ou port ouvert).
- Ancrage des piles au sol réel à leurs coordonnées exactes.
