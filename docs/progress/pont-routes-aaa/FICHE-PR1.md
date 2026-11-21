# Fiche PR1 — Identité, ports et publication multi-tuiles

**Date :** 21 novembre 2026  
**Commit de base :** `532b1ca7` (sortie de PR0)  
**Auteur :** Antigravity  
**Machine de référence :** Mac principal (Apple M1 Max, 32 Go)

---

## 1. Objectif de la phase PR1

Résoudre les défauts fondamentaux d'assemblage, d'identité mondiale et de frontières de tuiles/cellules :
1. **Isolation stricte des modes de transport** dans le chaînage d'ouvrages (`chainBridges`) : interdire la fusion d'un tronçon ferroviaire et d'un tronçon routier au même niveau.
2. **Déterminisme d'assemblage** : tri strict des fragments de pont aux embranchements (même voie prioritaire, tangence la plus directe, départage déterministe par `roadId`), indépendance de l'ordre d'arrivée des fragments.
3. **Identité canonique mondiale** : remplacement de l'ancienne clé locale `${id}:${Math.round(x)}` (qui provoquait des doublons d'ouvrages entre cellules adjacentes) par une clé canonique WGS84 stable (`bridgeCanonicalKey`).
4. **Gestion explicite des ports intercellules et bouts ouverts** : propagation de `BridgeFlag.OpenA` et `BridgeFlag.OpenB` pour distinguer une continuation de tablier d'une culée de sol.

---

## 2. Réalisations de code

- **[`src/system/bridge-ports.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/bridge-ports.ts) :**
  - Fonction `bridgeCanonicalKey(id, firstPointWgs84)` : produit une clé mondiale `bridge:<id>:<lat1e5>:<lon1e5>` invariante par rapport aux repères locaux de cellules.
  - Fonction `matchInterCellPorts(ports, maxDistM)` : appariement déterministe des ports ouverts traversant les frontières de tuiles par niveau et mode.
- **[`src/system/street-detail-prep.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/street-detail-prep.ts#L327) :**
  - Séparation des modes dans `chainBridges` : `others` n'associe les morceaux que si `isRail` et `isFoot` correspondent exactement.
  - Ordonnancement déterministe des pièces : départage par `roadId >>> 0`.
  - Sélection aux bifurcations : continuité de cap (produit scalaire avec la tangente courante) et même voie prioritaire.
- **[`src/system/scenery-worker.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/src/system/scenery-worker.ts#L1352) :**
  - Dédoublonnage mondial des ponts de cellules : `bridgeCanonicalKey(br.id, g0)` avec conversion WGS84 `fromCell`.
  - Transmission des drapeaux (`e.b.flags`) à `deckBridge` pour préserver `BridgeFlag.OpenA` / `BridgeFlag.OpenB`.

---

## 3. Preuves et validation

- **[`tests/bridge-ports.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/bridge-ports.test.ts) :**
  - *Témoin d'isolation des modes* : Un tronçon route et un tronçon rail coïncidents au niveau 1 produisent 2 ponts séparés (`BridgeKind.Road` et `BridgeKind.Rail`), aucun pont hybride erroné.
  - *Témoin de déterminisme* : L'ordre aléatoire des pièces d'entrée produit une séquence d'ouvrages, des longueurs et des identifiants rigoureusement identiques.
  - *Témoin de clé canonique* : Un même ouvrage évalué depuis deux cellules d'origines différentes génère la même clé `bridge:12345:4885920:229550`.
  - *Témoin d'appariement de ports* : Appariement correct des ports ouverts routiers à travers la frontière, refus d'apparier un port rail proche.
- **Non-régression :**
  - [`tests/street-detail-prep.test.ts`](file:///Users/olivierveinand/Documents/DEV/black-hole-gpu/tests/street-detail-prep.test.ts) : 12/12 passants.
  - `bun test tests/bridge-ports.test.ts tests/street-detail-prep.test.ts` : 17 pass, 0 fail.

---

## 4. Retraits effectués

- Retrait de la clé locale basée sur le $x$ local de cellule (`${br.id}:${Math.round(br.points[0]![0])}`) dans `scenery-worker.ts`.
- Retrait du chaînage aveugle inter-modes de `chainBridges`.

---

## 5. Prochaine étape

**PR2 — Profil et supports communs** : résolution conjointe des accès et du profil du tablier, service de surface `SupportRef` et requêtes d'élévation indépendantes de la caméra.
