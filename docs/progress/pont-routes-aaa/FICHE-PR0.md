# Fiche PR0 — Références, corpus et contrat d'acceptation des ponts et routes AAA

**Date :** 21 novembre 2026  
**Commit de base :** `b192a361`  
**Auteur :** Antigravity (session d'exécution Ponts et routes AAA)  
**Machine de référence :** Mac principal (Apple M1 Max, 32 Go)

---

## 1. Objectif de la phase PR0

Figer le corpus minimal de référence (synthétique et réel), quantifier les écarts et défauts du code existant sans dépendre de hacks d'extraction de chaîne au runtime, définir les contrats d'interfaces transversaux (`SupportRef`, `BridgeCorridor`, `BridgePort`, `SupportQuery`), et valider les sondes de mesure par témoins positif et négatif (Règle 3 de CLAUDE.md).

---

## 2. Corpus de référence (12 cas du §10.1)

Intégrés de manière pérenne et typée dans [`src/system/bridge-corpus.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/bridge-corpus.ts) :

1. **`CASE_SYNTH_FLAT_100M`** : Pont droit 100 m plat, tirant 5,5 m (détection des marches de 2,75 m du code historique).
2. **`CASE_SYNTH_STEEP_RAMP`** : Pont court incliné (40 m) sur terrain accidenté (raccords, pente, pas de bombement forcé).
3. **`CASE_SYNTH_CURVE_SKEW`** : Courbe, élargissement et culée en biais (continuité des sections, normales et UV).
4. **`CASE_SYNTH_TWO_TIERS`** : Deux étages superposés (route sous pont, isolation stricte des supports et récepteurs).
5. **`CASE_SYNTH_MIXED_MODES`** : Ouvrage mixte route et rail avec bifurcation (interdiction de fusionner rail et route).
6. **`CASE_SYNTH_MULTI_TILE`** : Ouvrage traversant une frontière de tuiles z14 / cellules z15 (ports ouverts `OpenA`/`OpenB`, identité stable).
7. **`CASE_SYNTH_LONG_VIADUCT`** : Long viaduc (1 200 m) dont le centre est hors champ (enveloppe AABB pour culling conservateur).
8. **`CASE_REAL_SEINE_ALEXANDRE_III`** : Paris — Pont Alexandre III (arche surbaissée, fleuve navigable, raccord quai/pont).
9. **`CASE_REAL_TOULON_VIADUCT`** : Littoral varois / Toulon (viaduc ferroviaire électrifié et route littorale).
10. **`CASE_REAL_MOUNTAIN_PASS`** : Route de montagne sur relief grossier (profils de déblai/remblai et contrainte de pente).
11. **`CASE_REAL_LEFT_HAND_TRAFFIC`** : Circulation à gauche (sens des voies, mobilier et feux inversés).
12. **`CASE_DATA_DEGRADED_FALLBACK`** : Source partielle ou sans altitude (repli déterministe qualifié, sans support fictif).

---

## 3. Quantification des défauts existants (`measureLegacyBridgeSteps`)

Exécuté sur le cas `CASE_SYNTH_FLAT_100M` via la fonction pure [`measureLegacyBridgeSteps`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/bridge-corpus.ts#L67) :

- **Nombre de dalles horizontales :** 10 (longueur de chaque dalle : 10 m).
- **Altitude sommet de la première dalle :** `2,0328 m`.
- **Cote de fin de profil interpolé (au raccord 0 m) :** `0,4000 m` (marche initiale de 1,63 m avec la route).
- **Saut adjacent maximal entre dalles :** `2,7500 m` (seuil cible PR : ≤ 0,05 m).
- **Écart maximal entre contact véhicule (`deckAt`) et dessus de dalle maillée :** `1,6294 m` (seuil cible PR : ≤ 0,02 m).
- **Profil des hauteurs des 10 dalles :**
  `[2.0328, 4.7828, 6.8453, 8.2203, 8.9078, 8.9078, 8.2203, 6.8453, 4.7828, 2.0328]`.

---

## 4. Dédoublonnage et clés de cellules (`probeBridgeKeys`)

- Clé historique : `${id}:${Math.round(points[0][0])}` où `points[0][0]` est en coordonnées locales de cellule.
- Cas testé : même ouvrage physique d'identifiant `7` dans deux cellules adjacentes :
  - Cellule 1 : `7:100`
  - Cellule 2 : `7:-900`
  - Résultat historique : **2 entrées distinctes** conservées pour le même ouvrage.
- Clé canonique nouvelle architecture : `bridge:7` (**1 seule entrée** mondiale stable).

---

## 5. Témoins de sonde (Règle 3 de CLAUDE.md)

Validés par [`evaluateStepWitness`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/bridge-corpus.ts#L153) :

- **Témoin négatif (A/A nul) :** Pas de marche injectée. Écart maximal détecté = 0,02 m (bruit de pente régulier). `passedAcceptance: true`.
- **Témoin positif (défaut injecté 10 cm) :** Marche de 0,10 m injectée au milieu du profil. Détectée à 0,12 m (> seuil 0,05 m). `passedAcceptance: false`.
- **Témoin positif (marche historique 2,75 m) :** Détectée à 2,77 m. `passedAcceptance: false`.

---

## 6. Vérifications et statut

- Tests unitaires dédiés : [`tests/bridges-corpus.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridges-corpus.test.ts) (4 tests passants, 0 régression).
- Contrôles `bun run check && bun test` : OK.
- Sortie vérifiable : Fixtures rejouables créées, défauts quantifiés, seuils et sondes validés.
- Étape suivante : **PR1 — Identité, ports et publication**.
