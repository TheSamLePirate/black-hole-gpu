# Priorité 5 — PLAN-RADAR-AAA : RD0, RD1 et le minimum réseau

*2026-10-21, `main` — `docs/AUDIT-CREW-2026-10-21.md`, priorité 5.*

Le détail est dans les fiches du plan radar : [RD0](../radar/RD0.md) (la sonde et le point de départ) et
[RD1](../radar/RD1.md) (les correctifs et leurs mesures).

| demandé (minimum de la priorité 5) | fait |
|---|---|
| extrapolation en heure de salle (`roomNow`, `roomWarp`) | ✅ en pause rien ne bouge (3 mm, contre 18,8 m), à ×4 ×3,96 |
| joueurs placés par la prédiction `remotes.at()` | ✅ place propre du crew à 2,5 m du pilote (p50) |
| vitesses des unités | ✅ bloc `tracks` à chaque envoi : cibles et unités de mission avec vitesse et cap, ids stables |
| contrôle de taille des événements (< 16 384, compteur client) | ✅ `NetClient.event` refuse et compte (`sent.oversize`), `fitSnapshot` allège avant l'envoi |
| reconnexion qui garde le pilote suivi | ✅ retrouvé par son appareil — e2e `net-crew` (coupure du lien de la console) |
| le crew suit le vaisseau lors d'un passage des commandes | ✅ `helm` / `board gone` — e2e `net-crew` |
| missiles et leurres sur les écrans crew | ✅ radar (Partagé et Capteur), ND, carte, liste — sonde : 3/3 |

En plus, la cause des 90 m d'écart des cibles a été trouvée et corrigée : un décalage plat en latitude/longitude au lieu
du problème direct de la géodésique (WGS84). P2 passe de p95 170 m à 53 m.

Ce qui reste du plan radar : les constats côté pilote 15, 18, 19, puis RD2 à RD14 (l'image unique, la symbologie
commune, les capteurs par vaisseau, le flux `pic`, les traînées, la sélection et la molette, les pistes du monde). RD10
demandera l'accord de l'utilisateur avant tout téléchargement d'OurAirports.
