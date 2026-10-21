# RD5 · RD6 — Le flux crew compact et la console qui affiche l'image

*2026-10-21, `main` — PLAN-RADAR-AAA.*

## RD5 — L'image tactique envoyée au crew (`src/net/picture.ts`)

Le bloc `pic` de l'événement `instruments`, quatre fois par seconde, porte l'image tactique du pilote, pas une
reconstruction à part :

- **une ligne par piste**, quantifiée :
  - sa place en 1e-5° depuis celle du pilote ;
  - sa hauteur en m ;
  - sa vitesse vraie en dm/s (est, nord, haut) ;
  - la fraîcheur de sa dernière mesure ;
  - un entier qui porte sa nature, son camp, son IFF, son état, ses capteurs, le verrou, la sélection et l'avis TCAS ;
  - en plus, une ligne d'arme pour un missile (sa cible, son temps, ses drapeaux) ou un leurre (sa vie) ;
- **un dictionnaire** (id, nom, type), envoyé une fois par piste, puis de nouveau à un crew qui arrive ;
- **par priorité** : le verrou, la sélection, les hostiles, les missiles et les leurres, le datalink et ce qui est à
  moins de 40 km, dans chaque bloc ; le reste à tour de rôle, au plus 220 lignes par bloc ;
- **les ids perdus**, dits deux fois ;
- **le mode et le faisceau du radar**, la portée réelle du scope du pilote (son choix automatique compris) ;
- **le rattrapage** : à l'arrivée d'un crew, les deux dernières minutes de chaque traînée, un point toutes les 2 s,
  étalées sur quelques blocs. Le reste de RD7 est ainsi fait.

**Taille** : 300 pistes tiennent dans 5,8 Ko par bloc, et toutes sont nommées en 2 s. En combat de drones, le bloc
fait environ 400 caractères.

**Correctif** : l'image place chaque piste à sa vraie position, mais lui donnait la vitesse estimée par le radar,
nulle en RWS. Le crew ne prolongeait plus le contact entre deux blocs : il prenait du retard, puis sautait (33 sauts
mesurés). La piste porte maintenant aussi sa vitesse vraie (`vt`), et c'est elle qui est envoyée : 0 saut.

**Avec l'image**, les anciens blocs ne sont plus envoyés : la liste radar du pilote, le combat (`tracks`) et le trafic
de `traffic`. Seuls restent les unités de mission et les zones, qui ne sont pas dans l'image.

## RD6 — La console crew (`src/crew/tracks.ts`)

- **`TrackStore`** décode les blocs de chaque pilote et fusionne les pistes par id : la mesure la plus fraîche gagne.
  Une piste perdue par son pilote tombe aussitôt, une piste de vérité après 8 s sans nouvelles.
- **Les deux vues sont deux filtres de la même liste** :
  - **Capteur** : ce que tiennent les capteurs du pilote, aux couleurs de leur IFF. Le scope montre son vrai
    secteur de ±60° autour de son nez et son vrai faisceau.
  - **Partagé** : toute la vérité, même en match. Ce que ses capteurs ne tiennent pas est estompé, et il n'y a plus
    de faux balayage.
  - Le ND et la carte suivent la même règle.
- **La liste des contacts** est triée par menace, puis par distance : le verrou, un missile sur le pilote, les
  missiles, les hostiles, le reste.
- **Les ordres visent un id** (`wp.lock`, `ap.traffic`, `nav.target`, `wp.designate`) ; le nom ne sert plus qu'en
  repli (constat 20). Pour verrouiller, la piste est d'abord sélectionnée chez le pilote, puis le verrou la prend.
- **Gardés d'une visite à l'autre** : la portée, le nord en haut et la vue Capteur ou Partagé (constat 21).
- **La molette** : la portée change par les pas du jeu (1 … 320 km, puis 1 000 et 10 000 km), un cran par pas. Le
  pincement se cale sur le pas le plus proche (P11).
- **Le bundle du crew** passe de 320 à 326 Ko (le décodeur, le magasin de pistes) ; sa borne est relevée à 360 Ko.

## Vérification

- **Unitaire** : `net-picture` (aller-retour à moins d'un mètre et de 0,05 m/s, 300 pistes sous 16 Ko, le verrou dans
  chaque bloc, chacune envoyée en une seconde, les disparitions, le rattrapage, un bloc hostile refusé).
- **La sonde `radar-sync`** sur kerr-mini, qui mesure maintenant P2 comme le plan le définit (le crew contre la place
  chez le pilote) :

  | critère | mesure |
  |---|---|
  | P1 même image | 0,9 % d'écarts (pistes nées ou perdues dans un bloc) |
  | P3 sauts | 0 |
  | P4 pause | 0 m de dérive ; ×4 : ×3,95 |

- `crew`, `crew-actions` (passés à l'image), `crew-en` et `missile-cues` (le crew) sont repassés.
