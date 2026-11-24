# Fiche — revue A (défauts du jalon) et demande B (revêtement, routes intelligentes, ponts remarquables)

**Date :** 24 novembre 2026 · **Branche :** de l'agent (worktree), non poussée · **Mode :** normal (aucun e2e lancé ici : la
campagne finale est celle du lead) · **Base :** `d11d75d1` (après le jalon `b192a361..e633d82b`).

## 1. Ce que la revue a trouvé et ce qui est corrigé (partie A)

| # | Défaut | Correction (code) | Preuve |
|---|---|---|---|
| A1 | Pont coupé par un bord de tuile z 14 : chaque moitié posée au sol à son bout ouvert | `bridge-ports.ts joinBridgeHalves` (ports appariés : même genre, même niveau, ≤ 3 m) avant tout profil ; cellule voisine lue pour un bout ouvert ; `clipLineToTile` pour OMT ; bout ouvert non apparié tenu au dégagement, horizontal | unitaires : jonction, isolement route/rail/niveau, continuité C0/C1 à la coupe, témoin positif (moitié seule au sol) |
| A2 | Contact = boîte plate de chaque tranche de 10 m (marches de 1–1,5 m) | chaque tranche de tablier/parapet porte le plan de son dessus (`DECK_PLANE`, vec4 après ses arêtes) ; `scenery-contact.ts topAt` le lit | unitaire : contact = maillage à < 2 cm sur 10 %, témoin positif (ancienne boîte > 0,5 m) |
| A3 | Le worker du décor préparait lui-même des cellules « rue » incomplètes et les mettait en cache | retiré ; cellules absentes/incomplètes nommées (`streetMissing`), scène redemandée à leur arrivée par le pool (`streetCellArrived`, ≤ 1/20 s) ; `CellStreetFlag.Built` + `streetCellComplete` : les entrées empoisonnées sont refaites | tsc ; parcours non mesuré (e2e du lead : `streetMissing` → 0) |
| A4 | Glissières de pont posées au sol (requête sur la hauteur du sol) ; balayage O(n·m) | registre indexé par grille 64 m ; glissière de pont trouvée par position (`FurnitureFlag.OnBridge`, heuristique « parallèle et dans la largeur » pour les cellules anciennes), poutre inclinée suivant le tablier avec son plan | unitaires du registre ; vue Millau à juger |
| A5 | Routes de tablier lues comme routes au sol (arbres, décalques) | `ROAD_ON_BRIDGE` nommé (`road-markings.ts`), filtré : exclusion des arbres, décalques, contact « exclu » ; un tablier n'écarte les arbres que si son intrados est à < 25 m du sol | tsc, lecture |
| A6 | Couleur du tablier contaminée (eau, occupation du sol) ; marche du décor sur tout pixel de tablier | tablier : genres 1 et 5 seulement ; marche seulement sous 2 m de pied de pixel à < 2,5 km | test statique sur le vrai WGSL ; tailles inlinées (§3) |
| A7 | Bosses (600 m → 18 m, 1 200 m → 36 m), pentes d'extrémité 10–15 % | courbe verticale bornée : rampes smoothstep + plateau, pentes d'approche aux bouts (Hermite), pente ≤ 5 % (voies rapides) / 8 % / 3,5 % (rail) ; dégagement par le plateau, pas par une bosse | unitaires 600/1 200 m (sommet < 2,5 m, pente ≤ 5 %), pont court plafonné, pentes d'approche exactes |
| A8 | `bridge-lod.ts` non branché, test d'invariance tautologique, corpus en `src` | `selectBridgeLOD` branché (stations 10/20/40 m, parapets) ; culling par enveloppe retiré (jamais branché) ; corpus déplacé en `tests/fixtures` ; test LOD maillage contre maillage | unitaires |
| A9 | Bandes de requête ≠ maillage ; premier pont trouvé ; couche 1 partout ; pylônes sur un seul primitif ; piles non orientées ; faces CW ; doublons OMT O(n·m) ; aires de ponts retirées en bloc | bandes = maillage (parapet `railW`/`railH`, pas de +0,15 m) ; ordre niveau puis axe le plus proche ; vraie couche ; un solide par pylône ; pile orientée = sa bande de collision ; faces CCW, coins mitrés ; doublons par la grille du registre ; aire retirée seulement si couverte ; lampadaires ramenés sur le tablier (`snapOnDeck`) | unitaires (enroulement, piles, mitres, registre) |
| A10 | Test matériau qui réimplémentait le shader ; e2e à `sleep` 2 × 60 s, `catch` muets, `nearCells=0` | test statique sur le vrai `trace.wgsl` + modèle d'inlining ; tranche GPU `road-pavement-slice.e2e` ; `bridges.e2e` réécrit (attentes conditionnelles bornées, réglages par défaut, temps GPU, captures) | gardes e2e (bannière, honnêteté, attentes, catalogue) vertes ; **e2e non lancés** |

**Vérité sur l'historique (A8)** : `farBridges` (dalles lointaines dans le chemin des voitures) avait été déclaré retiré par
PR7/PR-R puis rétabli par `e633d82b` ; il **reste** (visibilité lointaine des ponts au-delà de la scène). Le culling par
enveloppes 3D de PR7 n'a jamais été branché : retiré. Les chiffres « ~0,6 ms gagnés » de FICHE-PR-R n'ont pas de mesure
retrouvable dans le dépôt.

## 2. Demande de Sam (partie B)

- **B1 — revêtement** : `road-surface.ts` (matériau : données BD TOPO `nature`, OMT `surface`/`subclass`, puis règle de
  classe et de lieu, documentée) ; `trace.wgsl roadPavement` (shadeLite seul) : enrobé (granulat, bandes de roulement
  polies, fissures, rapiéçages), béton (dalles 4,5 m, joints), pavés, gravier, terre ; pluie par matériau (assombrissement,
  flaques dans ornières/joints, brillance). Chaque détail rejoint sa moyenne avec le pied de pixel (tranche GPU écrite
  pour le vérifier).
- **B2 — routes intelligentes** : tirets continus le long de la route (`data[11]`), coudes arrondis (Bézier quadratique,
  trois morceaux), lignes qui s'arrêtent aux carrefours selon le rôle des branches (`armRoles`), cédez-le-passage/stop sur
  les branches secondaires (ville et campagne), aucune ligne entre égaux (priorité à droite), passages piétons en ville.
  **Non fait** : aplanissement du terrain sous la chaussée (les routes sont peintes sur le sol : ni flottantes ni enterrées ;
  RP3 reste à faire), flèches directionnelles (absentes du jeu).
- **B3 — ponts remarquables** : familles suspendu et à haubans ; catalogue sourcé (Golden Gate, Normandie, Tancarville,
  Millau, Brooklyn, Akashi Kaikyō) ; tours, entretoises, poutre, ancrages, câbles paraboliques, suspentes, haubans ; câbles
  rendus en paires élargies au pixel (couverture, sans scintillement) ; tours visibles jusqu'à 45 km (dans la scène) ;
  tablier roulable et tours collidables. **Non catalogués** : Øresund, Bay Bridge (positions des pylônes inconnues), Tower
  Bridge (bascule).

## 3. Mesuré / non mesuré

- **Mesuré (statique)** : tailles inlinées (`scripts/wgsl-inline-size.ts`, earth-raster) — `shadeLite` 8 528 → 8 793
  lignes (+3 %), `shade` 27 225 → 27 073, `main` 42 601 → 42 449, `env` 59 316 → 58 860 ; autres corps `shadeLite` en
  baisse (le matériau ne compile qu'avec le décor). `check-wgsl` 85/85. Tests unitaires ponts/routes verts.
- **Non mesuré** : tout coût GPU, toute image. Aucun e2e lancé (consigne).

## 4. Vues que le lead doit juger (e2e `bridges.e2e.test.ts`)

1. Pont de Grenelle (Paris, coupé par le bord de tuile z 14 à 48,85026° N) : un seul tablier, sans chute au milieu.
2. Pont Alexandre III : quatre pylônes distincts, arche, tablier sans couleur d'eau.
3. Viaduc de Millau : mâts, haubans en un plan, glissières sur le tablier (pas au sol), piles à leur place (±20–50 m).
4. Golden Gate depuis les Marin Headlands (~2 km) : tours International Orange, câbles et suspentes fins sans scintiller ;
   et depuis ~30 km en mer : tours et câbles visibles. Vérifier la position des tours (dérivée, ±20–50 m).
5. Rue de Rivoli sous la pluie : enrobé mouillé, bandes de roulement, flaques, reflets.
6. Contrôle de coût : `lastGpuMs` p50/p95 par vue (rendu par l'e2e).

## 5. Limites et suites

Positions de tours dérivées (pas de levé) ; hauteurs de tablier des ancrages supposées (Akashi, Brooklyn) ; profil des
ponts remarquables limité à 6,5 % (Normandie : sommet plus bas que le réel si les rives sont basses) ; géoïde par le plan
local de la scène (≲ 1 m à 45 km) ; pas d'ombre des tours au-delà de la carte d'ombre ; pas de culling arrière (pipeline
partagé avec les bâtiments) ; RP3 (aplanissement) à faire ; flèches à faire.
