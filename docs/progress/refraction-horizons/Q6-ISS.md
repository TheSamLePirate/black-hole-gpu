# Q6-ISS — les vraies caméras de l'ISS (en cours : ISS0)

Plan : [PLAN-REFRACTION-HORIZONS.md](../../PLAN-REFRACTION-HORIZONS.md), volet Q6-ISS (décision 39, Sam, 4 novembre). Sources
revérifiées le 4 novembre 2026 ; aucune calibration encore.

## ISS0 — le corpus reproductible (première tranche, le 4 novembre)

### Les sources, revérifiées

| Caméra / famille | Ce que la source établit | Source |
|---|---|---|
| **NASA — externe Harmony** (flux « Live High-Definition Views from the ISS », `ROboUHfPUrU`, en direct depuis le 22 octobre 2026) | « an external camera mounted on the station's **Harmony module** … **looking forward at an angle so that International Docking Adapter 2 is visible** » ; une boucle « Previously Recorded » quand elle n'est pas disponible | description du flux officiel (YouTube @NASA) — l'identifiant cité au plan (`aB1yRz0HhdY`) n'existe plus |
| NASA — « Live Video from the ISS » (`M3HKLzjvKPc`) | l'intérieur quand l'équipage est en service, sinon une caméra extérieure non nommée ; écran bleu aux pertes de signal | description du flux officiel |
| **Sen — SpaceTV-1** (flux 24/7 `fO9e9jnhYK8`, 1080p30 sur YouTube) | trois caméras 4K **à l'extérieur, sur la plateforme Bartolomeo** (fixée au module Columbus — Space.com dit « sur Columbus » : la même chose), « not behind a window » : **Nadir** (droit vers la Terre), **Horizon** (vers le limbe), **Docking** (le long de la structure, le port d'amarrage avant) ; non orientables ; rien sur le champ, la focale ni la cadence | [sen.com/mission/stv-1](https://www.sen.com/mission/stv-1) ; CRS-30, mars 2024 (Space.com) |
| NASA — HDEV (historique) | sur la plateforme externe de Columbus ; actif du 30 avril 2014 au 18 juillet 2019, fin de vie le 22 août 2019 ; la page ne liste pas ses quatre caméras (le rapport final à lire) | [eol.jsc.nasa.gov/esrs/hdev](https://eol.jsc.nasa.gov/esrs/hdev/) |

### Les archives repérées (Sen, mono-caméra d'abord)

Métadonnées lues par `yt-dlp -j` (aucun téléchargement) ; les compilations hebdomadaires de 15 min (« This Week in Orbit »,
« 15 Minutes of Earth From Space ») **mêlent caméras et accélérés** : réservées à l'inventaire, pas à la calibration.

| Vidéo | Date | Durée · format | Caméra probable (à vérifier image par image) | Usage |
|---|---|---|---|---|
| `OjpoaQPp4xM` — Dragon CRS-35 approche (15 oct. 2026) | 2026-10-15 | 234 s · 2160p25 | Docking / Nadir (Dragon 1 km sous la station) | géométrie : un véhicule de taille connue, la structure |
| `ARfNTE-3OPA` — Crew-13, approche et amarrage, 24 min | 2026-10-05 | 1 490 s · 2160p25 | Docking (le port avant) | ISS2 : structure, port, véhicule amarré |
| `eA3wBLdnfIU` — Soyuz MS-29 sous l'ISS (Atlantique, Cap-Vert) | 2026-07-15 | 263 s · 2160p25 | Nadir | ISS2 : côtes (Cap-Vert) + véhicule |
| `sRmsKE-CPu4` — Crew-12 1 km sous l'ISS | 2026-02-14 | 157 s · 2160p25 | Nadir | validation |
| `Q297BuAhqH0` — 90 clips en 30 min | 2026-07-11 | 1 831 s · 2160p30 | mêlées | inventaire seulement |

Les archives n'ont pas d'UTC de prise de vue à la seconde (la date du descriptif seulement) : pour la géométrie fine, préférer
le direct.

### Le direct, horodaté

- **Trouvé** : l'habillage du direct Sen **incruste l'UTC de l'image** (« TIME UTC 03:03:18 » pour une saisie à 03:03:37 —
  **~19 s de retard** du direct), avec le lieu survolé, jour/nuit, la vitesse : chaque image porte son instant. Le jeu propage
  l'ISS par SGP4 sur les derniers éléments CelesTrak (`src/system/iss.ts`, récupérés au lancement) : pour un direct, l'orbite du
  jour même — le meilleur cas de la précaution 1 du plan.
- **Outil** : `scripts/iss-capture.ts` — une image de chaque direct toutes les N secondes pendant M minutes, nommée par l'UTC de
  saisie, un manifeste TSV ; **hors du dépôt** (`~/.kerr-lab/iss-corpus` : les images Sen ne sont pas à redistribuer ; celles de la
  NASA sont du domaine public). Première capture lancée le 4 novembre à 03 h 30 UTC, 60 s × 115 min (au moins un passage de jour).
- **Reste d'ISS0** : identifier la caméra de chaque image Sen (l'habillage ne la nomme pas : nadir / horizon / docking au contenu),
  les coupes et les « Previously Recorded » de la NASA ; choisir les extraits de calibration et ceux réservés à la validation ;
  le rapport final HDEV (ses quatre caméras) ; les droits et crédits notés avant toute image versée au dépôt.
