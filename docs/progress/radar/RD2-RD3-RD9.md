# RD2, RD3, RD9 — L'image unique, la symbologie commune, la sélection par clic

*2026-10-21, `main` — PLAN-RADAR-AAA.*

## RD2 — L'image tactique unique (`src/radar/picture.ts`)

Une seule liste de pistes par pilote, construite à chaque image après le balayage du radar. C'est elle que lisent le
scope du HUD, les pages du PCD (TSD, FCR, DAS), le crew et `__bh.radar`. Chaque piste porte :

- **sa vérité** : son camp, sa vraie place `rt`, et sa latitude, sa longitude et sa hauteur exactes sur l'ellipsoïde
  WGS84, depuis le point fixe Terre de l'avion ;
- **ce qu'en savent les capteurs** : les bits RADAR, DATALINK, TCAS, AIS, DAS, EOTS et BRIEF ; l'IFF connue ; l'état
  (`firm`, `coast`, `datalink` ou `truth`) ; l'estimation du radar `r`.

Les missiles (`msl:`) et les leurres (`cm:`) sont des pistes comme les autres :
- **un missile** porte son autodirecteur, sa cible, son temps avant impact et s'il est leurré ;
- **un leurre** porte sa vie restante.

**Constat 11 corrigé** : les cibles, les missiles et les leurres du combat ne sont plus pris dans son repère plat. Ils
repassent par sa carte vers la latitude et la longitude, puis par le repère exact de l'avion. Conséquences :
- un ravitailleur à 25 km est 49 m « plus bas » que l'horizontale locale, la courbure prise en compte ;
- la borne du test du ravitailleur suit le vrai critère de l'étape « tuyau » (dans les 70 m derrière le panier, soit
  moins de 110 m du centre).

Le crew reçoit les places de l'image (`tracksOf`), les mêmes que celles du pilote. `__bh.radar` : `picture()`,
`track(id)`, `select(id)`, `hits()`, `stats()`.

## RD3 — La symbologie commune (`src/radar/symbols.ts`)

Une palette et une seule façon de dessiner une piste :
- **les formes OTAN simplifiées** : l'avion ouvert en bas (arc ami, chevron hostile, boîte ouverte inconnu ou neutre) ;
  le navire et l'unité au sol pleins ; le losange TCAS pour le trafic ;
- **les armes et leurres** : le missile en dard, la fusée en étoile, les paillettes en nuage ;
- **les états** : mesuré plein, prolongé estompé, datalink tireté, vérité seule pâle ;
- **le verrou** cerclé, **la sélection** en anneau ambre tireté.

Elle sert au scope du HUD, au TSD, au FCR, au DAS et à toute la console crew (`unitSymbol` passe par `drawSym`). Le
test P5 vérifie qu'aucune des anciennes couleurs IFF ne reste dans ces écrans.

## RD9 — La sélection par clic

Décision du 2026-10-21 : **un clic sélectionne seulement**.

- **Un clic** sur une piste (dans la vue 3D, sur le scope du HUD, sur le TSD ou le FCR du PCD) la sélectionne sur tous
  les écrans du pilote. La vue la marque d'un losange ambre avec sa fiche : nom, type, relèvement, distance, altitude,
  aspect, rapprochement. Hors champ, une flèche ambre au bord.
- **Un second clic** sur la même la verrouille. La touche LOCK (Tab) verrouille la sélection d'abord.
- **Un clic dans le vide** désélectionne et garde le verrou. **En vol, un clic ne choisit jamais un corps** (Terre,
  Lune).
- **Le crew** : « Désigner au pilote » (`wp.designate`, par id) sélectionne chez le pilote, sans verrou. La sélection
  du pilote est cerclée chez le crew.

## Vérification

- tests unitaires `radar-picture` (fusion, états, missiles, places exactes) et `radar-symbols` (P5) ;
- e2e sur kerr-mini, tous verts :
  - `radar-select` (vrais clics souris) ;
  - `crew-actions` A6 (désignation par le crew) ;
  - `radar-sync`, `f35-radar`, `f35-combat`, `f35-pcd`, `decoys`, `crew`, `aar`, `jetmodes` ;
  - `net-wing-fight` (salle à deux) ;
  - `bh-api`.

**Reste** : la mini-carte (RD15, posée ici mais inerte), puis RD7, RD10, RD11, RD13, RD4, RD5, RD6, RD12 et RD14.
