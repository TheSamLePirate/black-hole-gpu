# Plan : aurores et magnétosphères de tout le système solaire

Écrit le 3 novembre 2026, à la demande de Sam (« les aurores et magnétosphères, c'est une bonne idée à intégrer »).
L'idée vient du prochain chantier d'Alex (`vr-solar-system/docs/agent/puffs-bilan-qualite-aurores_2026-11-03-18-27-52.md`).
**Rien n'est commencé** : c'est un plan, avec les décisions à prendre par Sam en fin de document. Les sources
des chiffres sont listées à la fin. Les chiffres marqués « ~ » sont des ordres de grandeur tirés des revues, à
vérifier sur la source au moment de coder.

## 1. Ce qu'on a aujourd'hui

- **Une seule aurore, celle de la Terre**, `auroraLight` (`src/shaders/trace.wgsl`, S2 du plan aviation) :
  - un anneau autour du pôle du dipôle (80,8° N, 72,6° O, constante `AUR_MAG`) ;
  - centré à 69° de latitude magnétique moins 1,1° par point de Kp ;
  - plis et rayons procéduraux ;
  - le vert de l'oxygène (557,7 nm) culminant à 110 km, le rouge (630 nm) au-dessus de 200 km ;
  - intégré en 40 pas dans une coquille de 90 à 330 km.
- **Comment on l'active** :
  - par le réglage `aurora` (un Kp choisi à la main, de 0 à 9) ;
  - par les missions et la vue d'exception « Lofoten » (`views.ts`) ;
  - le code n'est compilé que si l'aurore est demandée (bit `HAS_AURORA`, 16384).
- **Aucun champ magnétique** : pas de modèle de champ, pas de lignes de champ, pas de magnétopause.
- **Limites connues de notre aurore terrestre** :
  - **l'anneau est symétrique en heure locale**, alors que le vrai ovale est décalé vers la nuit : environ 75–78°
    de latitude magnétique côté jour et 65–67° côté nuit par temps calme ;
  - pas de bordure basse bleu-violet de l'azote (N₂⁺ 427,8 nm) dans les orages ;
  - Kp jamais pris dans la météo spatiale réelle ;
  - pôle du dipôle figé (le WMM2025 le met à 80,85° N, 72,76° O pour 2025.0 : notre constante est bonne à 0,1° près).

## 2. Ce qu'on vise

1. **Des aurores réalistes partout où elles existent**, vues de l'espace et du sol (ou de dedans les nuages pour les
   géantes) : Terre, Jupiter, Saturne, Uranus, Neptune, Mars, Vénus, et les lunes Io, Europe et Ganymède.
2. **Les magnétosphères en schéma**, à afficher à la demande :
   - lignes de champ, magnétopause et onde de choc ;
   - tore de plasma d'Io, ceintures de radiation ;
   - mouvements des particules (giration, rebond, dérive).
3. **Une seule source de vérité pour les champs**, partagée par l'image, le schéma, les instruments, TARS et les tests.

## 3. Les données, corps par corps

| Corps | Champ (modèle) | Aurore : où, à quelle altitude, de quelle couleur | Visible à l'œil ? |
|---|---|---|---|
| **Terre** | IGRF-14 / WMM2025 ; dipôle incliné de ~9,2° | Ovale à 65–78° de latitude magnétique selon l'heure locale. O 557,7 nm vers 100–120 km, O 630 nm au-dessus de 200 km, N₂⁺ 427,8 nm en bordure basse | Oui |
| **Jupiter** | JRM33 (Juno, degrés utiles jusqu'à ~13–18) + feuillet de courant CON2020. Dipôle ~4,17 G à l'équateur, incliné de ~10° | Ovale principal (rupture de la corotation) ; empreintes d'Io (au moins 3 taches et une traîne), d'Europe et de Ganymède ; émissions polaires. L'ovale nord est très déformé par l'anomalie du champ. Les émissions vont de ~250 km (visible, Galileo) à ~400 km (UV au limbe) au-dessus de 1 bar. Surtout UV (H, H₂) et infrarouge (H₃⁺) | Faible : vue en visible côté nuit par Galileo |
| **Saturne** | Champ axisymétrique, dipôle incliné de moins de 0,01° (Cassini, Grand Finale), décalé vers le nord. Quadripôle et octupôle ~10 % du dipôle à 1 bar | Ovale principal vers 70–80° de latitude, qui oscille avec les « oscillations de période planétaire » (UVIS). UV de H₂ entre ~4 et 40 kR. Rideaux visibles à plus de 1 200 km au-dessus du limbe | Faible : vue en visible côté nuit (Cassini ISS, 2006). Sa couleur n'est pas connue |
| **Uranus** | Dipôle incliné de ~59°, décalé de ~0,3 rayon | Deux bandes près des pôles magnétiques (JWST, H₃⁺, janvier 2025) ; elles tournent avec la planète | Pas vue en visible |
| **Neptune** | Dipôle incliné de ~47°, décalé de ~0,55 rayon | Aurores H₃⁺ aux latitudes moyennes (JWST, publié en mars 2025) ; haute atmosphère froide (~358 K) | Pas vue en visible |
| **Mars** | Pas de champ global ; champs crustaux de l'hémisphère sud | Aurores discrètes au-dessus des champs crustaux (MAVEN IUVS, EMM EMUS) ; aurore diffuse sur tout le globe par les particules solaires. **Le vert à 557,7 nm a été vu du sol par Perseverance en mars 2024** (Science Advances, 2025) | Oui, faible, lors des tempêtes solaires |
| **Vénus** | Pas de champ ; magnétosphère induite | Raie verte de l'oxygène (557,7 nm) côté nuit (Keck, 2001), plus forte après les éjections de masse coronale, vers ~125 km ; le rouge est éteint sous 150 km | Faible |
| **Mercure** | Dipôle faible, décalé vers le nord de ~0,2 rayon | Aurore en **rayons X** : électrons qui frappent la surface (pas d'atmosphère) | Non : seulement en fausses couleurs |
| **Io** | Pas de champ propre ; Io baigne dans le tore | En éclipse (Galileo SSI, 1999) : lueurs bleues de SO₂ au-dessus des volcans (plus de 300 kR), rouge de l'oxygène aux limbes, vert faible côté nuit (sodium ?) | Oui, en éclipse |
| **Europe** | Champ induit (océan) | Oxygène à 630 et 636 nm, vu en éclipse (Keck et Hubble, 2018) ; UV à 130,4 et 135,6 nm | Faible, en éclipse |
| **Ganymède** | Dynamo propre, ~750 nT à l'équateur, dans le champ de Jupiter (~100 nT) | Deux ovales d'oxygène (UV 130,4 et 135,6 nm, 200 à 1 000 R) ; leur oscillation a servi à prouver l'océan | UV seulement (le visible est probablement trop faible) |
| **Callisto, Titan, Lune** | — | Rien à rendre (aucune aurore détectée qui vaille une image) | — |

Les grandeurs du schéma (ordres de grandeur, revues de Bagenal et al., à vérifier) :
- **magnétopause côté Soleil** : Terre ~10 R, Jupiter ~50–100 R, Saturne ~20–25 R, Uranus ~18 R, Neptune ~23–26 R,
  Mercure ~1,5 R ;
- **Ganymède** n'a pas d'onde de choc : le plasma de Jupiter y est sous-alfvénique, d'où des « ailes d'Alfvén » ;
- **tore d'Io** à 5,9 R_J, visible en rouge dans les raies du soufre ionisé [S II] (671,6 / 673,1 nm).

## 4. Principes (destination WebGPU AAA)

- **Une responsabilité commune** : un module `src/system/magnetic-fields.ts` possède les champs.
  - Il contient les coefficients de Gauss par corps, le dipôle équivalent, les traçages de lignes et la
    correspondance entre un pied de ligne et une distance.
  - Le shader, le schéma, TARS et les tests le lisent ; aucun ne refait sa propre géométrie de pôles.
  - `AUR_MAG` devient une donnée publiée par ce module, et non plus une constante du shader.
- **Préparer avant la frame** :
  - les lignes de champ, les ovales et les empreintes des lunes sont tracés au CPU, dans un worker, à la date de
    la scène ;
  - le shader ne lit que des tables : latitude de l'ovale par heure locale magnétique, positions des empreintes.
  - **Aucune évaluation d'harmoniques sphériques par pixel.**
- **L'émission aurorale est un terme d'émission de l'air**, rangé avec les modèles d'air partagés (le volet Q5 du plan
  commun). Elle est lue aujourd'hui par le traceur, et demain par la composition de l'air du raster, sans passer par
  un encodage propre à `trace.wgsl`.
- **Le schéma est une passe de lignes testée contre la profondeur finale**.
  - Elle reprend le code de segments d'`overlay.wgsl`, qui ne dessine aujourd'hui que sur le ciel.
  - Elle doit être cachée par une planète ou par un anneau.
  - Elle dépend donc du contrat « profondeur finale » (§7 de l'analyse stratégique).
- **Coût** :
  - le code n'est compilé que là où il sert : un bit par famille, comme `HAS_AURORA` ;
  - le budget est celui du corps (PLAN-PLANETES-AAA : le même que la Terre par vue) ;
  - chaque phase est mesurée en A/B sur ce Mac, sans casque, et les résultats sont montrés en images et en graphiques
    (CLAUDE.md).

## 5. Les phases

| | Quoi | Dépend de | Risque |
|---|---|---|---|
| **AM0** | `magnetic-fields.ts` : modèles (IGRF-14 réduit, JRM33 + CON2020, Saturne de Cassini, dipôles inclinés et décalés d'Uranus, Neptune, Mercure et Ganymède, carte crustale de Mars), traçage de lignes en worker, empreintes. Tests : pôle de la Terre contre WMM2025, empreinte d'Io contre les angles de Juno UVS (Hue et al. 2023), dipôle de Saturne sur l'axe | — | moyen (données) |
| **AM1** | **La Terre refaite** : ovale en heure locale magnétique (de type OVATION), bordure bleue de N₂⁺, arcs rouges dans les grands orages ; **Kp réel** de NOAA SWPC quand la date est « maintenant », avec un repli hors ligne ; `AUR_MAG` venu d'AM0 | AM0 | faible |
| **AM2** | **Une aurore générique par corps** : coquille d'émission, table des espèces et des altitudes, ovale et empreintes lus dans les tables d'AM0 ; la Terre passe par le même code | AM0, AM1 | moyen (coût) |
| **AM3** | **Jupiter** : ovale principal de JRM33 (statistique Juno UVS), empreintes d'Io, d'Europe et de Ganymède avec leurs traînes, émissions polaires, « dawn storms ». Raccord avec le volume des nuages (V1–V11) : l'aurore est au-dessus, vue depuis les ponts | AM2 | moyen |
| **AM4** | **Saturne** (ovale qui oscille, empreinte d'Encelade faible), **Uranus et Neptune** (ovales qui tournent avec un champ incliné) | AM2 | faible |
| **AM5** | **Les lunes** : Io (lueurs bleues des panaches, rouge aux limbes) et Europe (rouge de l'oxygène), en éclipse dans l'ombre de Jupiter ; les deux ovales UV de Ganymède | AM2 | moyen |
| **AM6** | **Mars et Vénus** : aurores discrètes au-dessus des champs crustaux, diffuses et vertes dans les tempêtes solaires (Perseverance, 2024) ; raie verte de Vénus après une éjection. Un réglage « tempête solaire » commun | AM2 | faible |
| **AM7** | **Le schéma des magnétosphères** : lignes de champ (L-shells), magnétopause et onde de choc (modèle de Shue pour la Terre, mis à l'échelle ailleurs), tore d'Io (aussi en lueur rouge réaliste), ceintures, particules animées (giration, rebond, dérive, au temps accéléré). Passe de lignes avec profondeur, réglage dans les Guides, actions TARS | AM0 | moyen (passe) |
| **AM8** | Fausses couleurs « instrument » (UV de Hubble ou Juno, infrarouge de JWST, rayons X de Mercure) si Sam le décide (décision 1) | AM2–AM6 | faible |

Pour chaque phase : tests unitaires des modèles, un e2e court par corps, en headless sur ce Mac. Les captures
avant/après et les coûts sont montrés dans T3, puis une entrée dans `progress-to-destination.md` si la phase
touche un contrat de la destination (l'air partagé, la passe de lignes avec profondeur).

## 6. Décisions pour Sam

1. **Le réalisme visible ou les fausses couleurs ?** Les aurores des géantes sont surtout en UV et en infrarouge ; en
   visible, elles sont très faibles et visibles seulement côté nuit. *Conseil* : le visible par défaut, physique, avec un
   mode « instrument » (AM8) qui montre ce que voient Hubble, Juno et JWST.
2. **La météo spatiale réelle pour la Terre** (Kp de NOAA SWPC quand la date est « maintenant ») ? *Conseil* : oui,
   avec repli sur le réglage manuel hors ligne.
3. **L'ordre** : *conseil* AM0 → AM1 → AM2 → AM3 (Jupiter, le plus spectaculaire) → AM7 (le schéma) → AM4 → AM5 →
   AM6 → AM8.
4. **Le schéma** : tout montrer (lignes, magnétopause, tore, ceintures, particules) avec un réglage par élément, ou
   seulement les lignes de champ d'abord ?
5. **Partager avec Alex** : il commence le même chantier en Unity. On lui envoie nos sources et nos tables d'AM0, et
   on reprend les siennes s'il en fait de meilleures.

## 7. Sources

- Terre : [NOAA, wandering geomagnetic poles (WMM2025)](https://www.ncei.noaa.gov/products/wandering-geomagnetic-poles) ;
  [Kyoto WDC, pôles IGRF-14](https://wdc.kugi.kyoto-u.ac.jp/poles/polesexp.html).
- Jupiter :
  - [Connerney et al. 2022, JRM33](https://ui.adsabs.harvard.edu/abs/2022JGRE..12707055C) ;
  - [Hue et al. 2023, empreintes d'Io, d'Europe et de Ganymède (Juno UVS)](https://arxiv.org/pdf/2304.14949) ;
  - [Bonfond et al. 2015, profil vertical de l'émission principale](https://www.ann-geophys.net/33/1211/2015/) ;
  - [Bonfond et al. 2017, Juno UVS](https://orbi.uliege.be/handle/2268/209568) ;
  - [Ingersoll et al. 1998, aurore visible et empreinte d'Io (Galileo)](https://resolver.caltech.edu/CaltechAUTHORS:20130419-133448345) ;
  - [Magnétosphère de Jupiter (synthèse)](https://en.wikipedia.org/wiki/Magnetosphere_of_Jupiter).
- Saturne :
  - [Cao et al., le champ du Grand Finale](https://arxiv.org/pdf/1911.06952) ;
  - [Dyudina et al., aurore visible de Saturne (Cassini)](https://www.arxiv.org/pdf/1506.00664) ;
  - [PIA11681, l'aurore nord en mouvement](https://photojournal.jpl.nasa.gov/catalog/PIA11681) ;
  - [Bader et al. 2019, l'ovale et les oscillations de période](https://eprints.lancs.ac.uk/id/eprint/130948) ;
  - [Melin et al., campagne H₃⁺ et UV](https://eprints.lancs.ac.uk/id/eprint/75818/1/melin_campagin_r3.pdf).
- Uranus et Neptune :
  - [Melin et al. 2025, H₃⁺ et aurores de Neptune (JWST)](https://researchportal.northumbria.ac.uk/en/publications/discovery-of-h3-and-infrared-aurorae-at-neptune-with-jwst/) ;
  - [Eos, l'aurore de Neptune](https://eos.org/articles/after-30-year-search-scientists-finally-find-an-aurora-on-neptune) ;
  - [Uranus en 3D par JWST (Tiranti et al., GRL 2026)](https://www.livescience.com/space/astronomy/james-webb-telescope-spots-giant-auroras-rolling-through-uranus-atmosphere).
- Mars :
  - [Knutsen et al. 2025, première aurore visible depuis le sol (Science Advances)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12077521/) ;
  - [EMM EMUS, aurores discrètes](https://vivo.colorado.edu/display/pubid_329570) ;
  - [reconnexion et aurores discrètes (MAVEN)](https://deepblue.lib.umich.edu/items/136145d2-9ba2-4f0d-8a33-c451f2c135bd).
- Vénus : [Slanger et al. 2001, la raie verte](https://www.sri.com/publication/ocean-space-pubs/discovery-of-the-atomic-oxygen-green-line-in-the-venus-night-airglow/).
- Mercure : [l'aurore X de Mercure (BepiColombo)](https://www.isas.jaxa.jp/en/topics/003540.html) ;
  [Science News](https://www.sciencenews.org/article/rain-electrons-mercury-xray-auroras).
- Lunes :
  - [Geissler et al. 1999, Io en éclipse (Galileo SSI)](https://experts.arizona.edu/en/publications/galileo-imaging-of-atmospheric-emissions-from-io-2/) ;
  - [de Kleer et Brown, l'aurore optique d'Europe](https://authors.library.caltech.edu/records/x4n1j-16c92) ;
  - [Roth et al., Hubble UV d'Io et d'Europe](https://kups.ub.uni-koeln.de/4894) ;
  - [Saur et al. 2015, les ovales de Ganymède et l'océan](https://deepblue.lib.umich.edu/bitstream/2027.42/111157/1/jgra51618.pdf) ;
  - [Greathouse et al. 2022, Juno UVS et Ganymède](https://orbi.uliege.be/bitstream/2268/297297/1/Greathouse%20et%20al.%20-%202022%20-%20UVS%20Observations%20of%20Ganymede%27s%20Aurora%20During%20Juno%20.pdf).
