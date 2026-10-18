# Plan — l'écran panoramique du F-35 et le casque, AAA (PCD + HMD)

Sur `main`. Objectif : l'écran panoramique du F-35 (`src/f35/pcd.ts`, dessiné sur un canvas, posé sur la planche
par `ship.wgsl`, matériau 36) et la symbologie du casque (`ui/hud/symbology.ts`) au niveau AAA. L'écran rattrape
tout ce que le F-35 a gagné depuis F5 (radar, armes, missions, ailiers, trafic réel, porte-avions, pilote
automatique, leçons). **Contrainte : aucun impact sur la performance.**

## Décisions (2026-10-18)

| question | réponse |
|---|---|
| style | **les deux, en option, AAA tous les deux** : *réaliste* (le vrai PCD, sobre) et *cinématique* (halo, transitions) |
| lots | **tous** : C perf d'abord, A verre & dalle, B contenu, D le casque aussi |
| pages | **toutes** : radar FCR + armes SMS, TSD enrichi, pilote automatique + mission, DAS/EOTS synthétique |
| verre | **propre** : pas de traces de doigts ni d'usure |
| performance | **aucun impact** : GPU ≤ +0,05 ms, CPU moyen ≤ aujourd'hui, aucun pic |

## État de départ (mesuré le 2026-10-18)

- Canvas 2048 × 768 redessiné en entier à 10 Hz : ~0,2 ms d'enregistrement (médiane), 0,6 ms au 95ᵉ centile.
- Mips refaits sur 10 canvas (`drawImage` en chaîne) puis 11 `copyExternalImageToTexture` : ~1,2 ms de CPU
  toutes les 100 ms (une petite saccade régulière).
- Premier dessin : **58 ms** (polices, canvas à froid) — un à-coup à l'entrée du cockpit.
- Shader : albédo 0,01, rugosité 0,08, émission × 1,3 ; le noir lit gris-brun (4 % du ciel réfléchi, l'ambiant) ;
  pas d'effet de dalle ; textes qui se chevauchent sur FCS (G / AOA / RUD).

## Phases

Chaque phase : un commit, une planche de captures (`docs/progress/pcd/`), FR + EN, les tests et `bunx biome ci .`
verts, poussée sur `main`.

### Q1 — Perf (lot C) — FAIT ([fiche](progress/pcd/Q1.md) : 0,70 → 0,37 ms/image, entrée 94 → 10 ms)

- Mips générés **sur le GPU** (une passe de réduction par niveau, ou une seule passe de calcul) : plus de canvas
  intermédiaires ni de 11 copies.
- Redessin **par zone** : une zone par image au plus (la plus en retard sur son rythme), chaque page à son rythme
  (10 Hz ce qui bouge vite, 2 Hz le carburant ou les check-lists) ; seule la zone redessinée est copiée.
- **Préchauffage** : polices chargées et un dessin hors écran au chargement du F-35 (plus d'à-coup à l'entrée).
- Mesure : avant / après, CPU (performance.now autour du dessin et de la copie) et GPU (passe du vaisseau).

### Q2 — Le verre et la dalle (lot A)

- **Verre traité anti-reflet** : F0 ≈ 0,5 %, noirs profonds, reflet du ciel seulement en rasant ; le soleil direct
  délave l'image (physique : sa lumière réfléchie s'ajoute).
- **Dalle LCD** : sous-pixels RVB visibles seulement de près (fondus selon l'empreinte du pixel), perte de contraste
  hors axe, léger halo des symboles lumineux (lu dans un mip déjà là).
- **Tactile** : un halo sous le doigt au toucher (uniforme : point et instant du dernier toucher).
- **Luminosité** : JOUR / NUIT / NVG + le variateur de la cabine ; automatique selon la lumière.
- **Style** (réglage `f35PcdStyle` : réaliste, cinématique) : le cinématique ajoute halo plus large, balayage
  au changement de page, rémanence.

### Q3 — La mise en page d'un vrai F-35 + ICAWS

- Portails en 1 / 2 / 4 fenêtres (appui long : agrandir), menus en bas de portail, palette fidèle.
- Les chevauchements corrigés (FCS), une grille typographique commune.
- **ICAWS** : la vraie liste des alertes (avertissement, précaution, avis) et les dégâts en combat.

### Q4 — Radar FCR et armes SMS

- **FCR** : B-scope (distance / gisement), modes RWS / TWS / STT, verrou, IFF, portée réglable au toucher.
- **SMS** : les emports (AIM-120, AIM-9X, GBU-32, JSM), le canon et ses obus, les leurres, l'arme choisie, l'état
  du combat ; les touches au doigt (arme, mode radar, leurres — jamais le tir).

### Q5 — Le TSD enrichi

- Côtes et relief simplifiés sous la carte, ailiers et formation, trafic réel, porte-avions, menaces et leurs
  portées, cercle de bingo.

### Q6 — Pilote automatique et mission

- **AP** tactile comme la console équipage (A3) : AP, A/THR, consignes, LNAV / VNAV, ILS, modes.
- **MSN** : objectifs, chronos, leçon en cours et ses étapes.

### Q7 — DAS / EOTS synthétique

- Une « caméra » infrarouge dessinée à partir des pistes et du relief connu : silhouettes chaudes, horizon,
  réticule, zoom — **sans second rendu GPU**.

### Q8 — Le casque (lot D)

- Le même traitement sur la symbologie du casque : phosphore vert réaliste (ou cinématique), halo, lisibilité
  sur ciel clair, sans coût GPU mesurable.

### Q9 — Clôture

- `docs/F35.md` / `F35.fr.md`, e2e (pages au toucher, perf), planche finale.
