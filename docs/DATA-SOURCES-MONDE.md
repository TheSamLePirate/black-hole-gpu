# Sources de données de qualité — monde

Date : **23 octobre 2026**. Statut : **recherche, aucune implémentation** — rien n'a été changé dans le code.

But : trouver, hors de France (IGN) et de Suisse (swisstopo), les données **libres et de qualité** qui peuvent entrer dans
la Terre de Kerr par le même chemin que les sources nationales (`src/system/national.ts`, `NationalSource` : une emprise,
une URL d'orthophoto Web Mercator, des hauteurs par tuile, un crédit), ou remplacer les couches mondiales actuelles
(Terrarium/SRTM, EOX Sentinel‑2 2021, WorldCover, OpenFreeMap).

## 0. Lecture

- **[V]** : vérifié le 23/10/2026 par `curl -H "Origin: https://example.org"` sur une vraie tuile ou requête —
  statut HTTP et `Access-Control-Allow-Origin` (ACAO) vus. « ACAO écho » : le serveur renvoie l'origine reçue, accepté
  par le navigateur comme `*`. **« sans ACAO »** : illisible depuis le navigateur, il faut un proxy ou un pré-calcul.
- **[D]** : documentation, non revérifié en direct. Les licences et résolutions [D] sont **à confirmer avant diffusion**.
- **[NV]** : non vérifié (serveur injoignable depuis ce Mac, ou incertain).
- Critères de Kerr : récupérable **dans le navigateur** (CORS), **grille Web Mercator** ou WMS/WCS/ImageServer qui accepte
  une boîte EPSG:3857 (une requête = une tuile, comme le WMS-R de l'IGN), **hauteurs brutes** (float BIL/GeoTIFF/LERC,
  Terrarium, Terrain‑RGB, PNG GSI, quantized-mesh), licence permettant au moins l'usage du jeu.
- **Règle WGS84** (CLAUDE.md) : presque toutes ces données sont des **altitudes au-dessus de la mer** (NAVD88, CGVD2013,
  NAP, DHHN2016, AHD, NZVD2016, JGD2011, EGM2008…) → sol sur l'ellipsoïde = `max(H, 0) + N` (EGM2008), comme Terrarium
  et l'IGN. L'écart entre ces référentiels nationaux et EGM2008 est de quelques décimètres (< 1 m). **Exceptions déjà
  ellipsoïdales : ArcticDEM, REMA, HMA 8 m** — ne pas ajouter N.

## 1. Verdict

1. **Mapterhorn remplace Terrarium partout, d'un coup.** Tuiles Terrarium (WebP 512 px) jusqu'à **z 17**, CORS `*`,
   qui agrègent **151 relevés nationaux** (LiDAR 0,25–2 m sur l'essentiel de l'Europe, USA 3DEP, Canada HRDEM, Japon,
   Australie, Nouvelle-Zélande…) sur une base Copernicus GLO‑30. Toutes les licences sont commerciales avec attribution.
   C'est le plus gros gain mondial pour le moins de code : le décodeur Terrarium existe déjà.
2. **Il n'existe pas d'imagerie mondiale libre plus fine que 10 m.** Le gain d'imagerie vient **pays par pays** —
   le modèle IGN/swisstopo de `national.ts`. Les meilleurs candidats immédiats (Web Mercator, CORS `*`, sans clé) :
   **Espagne (PNOA 15–25 cm), Pays-Bas (PDOK 8–25 cm), Autriche (basemap.at 29 cm), Japon (GSI), USA (NAIP 0,6 m),
   Nouvelle-Zélande (LINZ, clé libre), Bavière/NRW, Tchéquie, Pologne, Flandre, Luxembourg, Slovénie, NSW, Taïwan,
   Hong Kong**.
3. **Bâtiments hors France : Overture Maps** (PMTiles, CORS `*`, ODbL) complète OSM par les emprises ML de
   Microsoft/Google et des hauteurs fusionnées — surtout utile en Afrique, Asie, Amérique latine.
4. **Pôles et océans** : ArcticDEM / REMA 2 m (CC BY, ImageServer LERC en 3857) et GEBCO 2025/2026 (domaine public).

## 2. Couches mondiales

### 2.1 Relief

| Source | Rés. | Type | Accès navigateur | Licence | Note |
|---|---|---|---|---|---|
| **Mapterhorn** | 0,25 m → 30 m selon le pays, tuiles z 0–17 | **DTM** LiDAR là où il existe, **DSM** GLO‑30 ailleurs | `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` — **[V] 200, ACAO `*`**, TileJSON `encoding: terrarium`, `tileSize: 512`, cache 7 j | sources CC BY / CC0 / OGL / LO / DL-DE / domaine public ; crédit `https://mapterhorn.com/attribution` | **404 hors couverture fine** (z 13–14 hors LiDAR) → sur-échantillonner le parent, comme Terrarium au-delà de z 15 |
| AWS Terrain Tiles (actuel) | ~30 m (SRTM), 3–10 m par endroits | DSM | `elevation-tiles-prod/terrarium` — [V] ACAO `*` en GET (pas en HEAD), **z 15 max** | libre | figé vers 2017 |
| Copernicus DEM GLO‑30 / 90 | 30 / 90 m | **DSM** | COG S3 `copernicus-dem-30m` — [V] 206 **sans ACAO**, préflight 403 | gratuit, commercial OK, crédit DLR/Airbus/Copernicus [D] | déjà la base de Mapterhorn ; EGM2008 |
| FABDEM | 30 m | DTM (GLO‑30 sans arbres ni bâtiments) | téléchargement | **CC BY‑NC‑SA** | seulement si le jeu reste non commercial |
| NASADEM, AW3D30, TanDEM‑X EDEM, MERIT | 30–90 m | DSM | téléchargement, compte | variable, souvent restrictive [D] | aucun ne bat Mapterhorn |
| MapTiler / Mapbox / Cesium World Terrain | — | — | clé | payant / conditions | pour mémoire |

**Mapterhorn en détail** [D sauf mention] : maintenu par Oliver Wipfli (ex-swisstopo), avec Brandon Liu (Protomaps) ;
financé par NLnet NGI0 (UE), stockage et bande passante offerts par Cloudflare ; code BSD‑3
([mapterhorn.com](https://mapterhorn.com/), [GitHub](https://github.com/mapterhorn/mapterhorn)). Archives PMTiles :
planète z 0–12 (`download.mapterhorn.com/planet.pmtiles`, 355 Go, [V] ACAO `*` en GET avec `Range`), z 13–17 en archives
par tuile z 6 (`download_urls.json`). Quantification Terrarium dépendant du niveau (1/256 m à z 19, jamais pire que 1 m).
**Aucune conversion verticale** dans la chaîne : chaque source garde son altitude nationale au-dessus de la mer → même
contrat que Terrarium (`max(H,0) + N`), avec des marches de quelques décimètres aux frontières des sources.
Aucune politique d'usage publiée pour le serveur public : mettre en cache, rester poli, prévoir un miroir/auto-hébergement
(PMTiles) avant une diffusion large.

Couverture fine (liste `download.mapterhorn.com/attribution.json`, [V] lue par l'agent) :
- **France** LiDAR HD MNT 0,5 m (partiel), RGE ALTI 1/5 m métropole + outre-mer ; **Suisse** swissALTI3D 0,5 m, Zurich 0,25 m.
- **Allemagne** les 16 Länder en DGM1 (BW 0,25 m) ; **Autriche** 1 m ; **Espagne** 0,5–5 m ; **Portugal** 0,5 m ;
  **Roumanie** 0,5 m ; **Luxembourg** 0,5 m ; **Wallonie** 0,5 m ; **Flandre** 1 m ; **Pays-Bas** AHN5 5 m (+ Caraïbes 0,5 m) ;
  **Danemark** 0,4 m ; **Norvège** 1 m ; **Suède** 1 m ; **Finlande** 2 m ; **Estonie** 1 m ; **Pologne** 1/5 m ;
  **Tchéquie** 5 m ; **Slovaquie** 1 m ; **Slovénie** 1 m ; **Chypre** 1 m ; **Lettonie** 20 m.
- **Italie** TINITALY 10 m + Aoste, Bolzano, Lombardie, Piémont, Trentin, Sicile, Sardaigne.
- **Royaume-Uni** Angleterre, Écosse, Galles 1 m ; **Islande** 10 m, **Groenland** 2 m, Féroé 10 m, Svalbard 20 m.
- **USA** 3DEP 1 m (≈ 30 blocs) + 1/3″ ; **Canada** HRDEM 2 m ; **Australie** 5 m, Tasmanie 2 m ; **Nouvelle-Zélande** 1 m ;
  **Japon** GSI 1/5/10 m ; **Taïwan** 20 m ; **Israël** 10 m ; **Rwanda** 10 m.

Conséquence pour Kerr : Mapterhorn **contient déjà le LiDAR HD et swissALTI3D**. L'IGN et swisstopo restent préférables
là où Kerr les prend plus finement ou plus frais (surfaces MNS/MNH, I4/I6), mais partout ailleurs une seule source
mondiale donne le relief LiDAR. Piège : **hors pays LiDAR, la base GLO‑30 est un DSM** (forêts et villes dans le « sol »).

### 2.2 Imagerie

| Source | Rés. | Accès | Licence | Verdict |
|---|---|---|---|---|
| EOX Sentinel‑2 cloudless | 10 m (z 15 sur-échantillonné) | WMTS `…/{layer}_3857/default/g/{z}/{y}/{x}.jpg` (**y avant x**) — [V] couches 2018, 2020, 2021, **2023, 2024, 2025** en 200, ACAO écho | **CC BY‑NC‑SA** (commercial payant) ; la version **2016 était CC BY** [D] | passer à **2025** à licence égale |
| Copernicus Sentinel‑2 Global Mosaic (CDSE) | 10 m, trimestriel/annuel | STAC `sentinel-2-global-mosaics`, réflectances brutes | Copernicus, **commercial OK** | seule option 10 m commerciale propre, mais tuiles à fabriquer soi-même |
| Digital Earth Africa geomedian | 10 m, Afrique | WMTS `ows.digitalearth.africa` couche `gm_s2_annual`, matrice `WholeWorld_WebMercator` — [V] ACAO `*` | CC BY 4.0 | bon sans nuages sur l'Afrique |
| NASA GIBS / Landsat | 15–250 m | déjà utilisé | domaine public | — |
| Esri World Imagery | sub-métrique | [V] ACAO `*` | **pas libre** (compte, pas de cache) | à éviter |
| Bing, Google, Mapbox, MapTiler | — | clé / interdit | — | à éviter |
| Planet NICFI | 4,7 m tropiques | **arrêté le 24/01/2025** [D] | — | — |
| OpenAerialMap, Maxar Open Data | variable | patchs épars | CC BY / **CC BY‑NC** | non |

### 2.3 Bâtiments, végétation, eau

| Couche | Source | Accès | Licence |
|---|---|---|---|
| Bâtiments | **Overture Maps** `buildings` (OSM + Microsoft ML + Google Open Buildings + Esri + IGN Espagne…), champs `height`, `num_floors` | PMTiles `overturemaps-extras-us-west-2…/tiles/2026-10-21.0/buildings.pmtiles` (181 Go) — [V] ACAO `*` ; GeoParquet S3 | ODbL |
| Bâtiments 2.5D | Google Open Buildings Temporal (hauteurs, Afrique/Asie/LatAm, ~4 m) | Earth Engine → pré-calcul | CC BY / ODbL |
| Canopée | Meta/WRI 1 m (≈ 2018–2020) | COG S3 `dataforgood-fb-data` — [V] **sans ACAO** → pré-calcul | CC BY 4.0 |
| Canopée | ETH Global Canopy Height 10 m (2020) | GeoTIFF / Earth Engine | CC BY 4.0 |
| Densité d'arbres | Copernicus HRL Tree Cover Density 10 m (Europe) | ImageServer EEA [V] écho | libre |
| Eaux | JRC Global Surface Water 30 m | `storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png` — [V] ACAO `*` | Copernicus/JRC, attribution |
| Côtes | OSM water polygons | zip 907 Mo (pré-calcul) | ODbL |

## 3. Europe (hors France et Suisse)

Le règlement d'exécution **UE 2023/138 « High-Value Datasets »**, en vigueur depuis le **9 juin 2024**, impose
orthophotos, altimétrie, bâtiments et cadastre gratuits, sous CC BY 4.0 ou plus ouvert, par API et en téléchargement
([EUR-Lex](https://eur-lex.europa.eu/eli/reg_impl/2023/138/oj)). C'est lui qui a ouvert les Länder allemands, la Suède,
le Danemark, la Belgique, la Pologne… L'Europe est donc la zone la plus riche après la France.

### 3.1 Les meilleurs candidats « source nationale » (ortho + relief, sans clé, CORS)

| Pays | Orthophoto (Web Mercator) | Relief brut | Licence |
|---|---|---|---|
| **Espagne** | PNOA máxima actualidad 15–25 cm : WMTS `https://www.ign.es/wmts/pnoa-ma?…layer=OI.OrthoimageCoverage&tilematrixset=GoogleMapsCompatible…` — [V] ACAO `*` ; TMS `tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg` (y inversé) [V] `*` | WCS `servicios.idee.es/wcs-inspire/mdt`, couverture `Elevacion25830_5` (**MDT05, 5 m LiDAR**, Canaries incluses) — [V] **GeoTIFF float, ACAO `*`** ; MDT02 et nuages LiDAR en téléchargement | CC BY 4.0, « PNOA cedido por © IGN » [D] |
| **Pays-Bas** | PDOK `service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg` 25 cm (8 cm `Actueel_orthoHR`) — [V] ACAO `*` | AHN WCS `service.pdok.nl/rws/ahn/wcs/v1_0`, `dtm_05m` / `dsm_05m` — [V] **GeoTIFF float, ACAO `*`** (0,5 m, NAP) | CC0 / CC BY [D] |
| **Autriche** | basemap.at `mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg` 29 cm — [V] ACAO `*` | ALS DGM 1 m national (BEV, téléchargement) ; Tyrol 0,5 m WMS [V] écho ; Vorarlberg [V] `*` | CC BY 4.0 « basemap.at » [D] |
| **Tchéquie** | ČÚZK `ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}` — [V] écho | ImageServer DMR5G (2 m DTM) / DMP1G (DSM), `exportImage` **LERC F32** — [V] écho | CC BY 4.0 depuis 2023 [D] |
| **Norvège** | Norge i bilder : licence restreinte [D] | WCS `wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833` (1 m) — [V] GeoTIFF `*` ; ImageServer `hoydedata.no` LERC F32 [V] écho | CC BY 4.0 (relief) [D] |
| **Estonie** | Fotokaart WMS `kaart.maaamet.ee/wms/fotokaart` [V] `*` | WCS `teenus.maaamet.ee/ows/wcs-dtm`, `dtm-1` — [V] GeoTIFF `*` | CC BY 4.0 [D] |
| **Luxembourg** | `wmts1.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg` — [V] `*` | LiDAR 0,5–1 m (téléchargement) | CC0 [D] |
| **Allemagne — NRW** | WMTS `wmts.nrw.de/geobasis/wmts_nw_dop/tiles/nw_dop/EPSG_3857_16/{z}/{x}/{y}` (DOP 10–20 cm) — [V] écho | DGM1 **COG** `opengeodata.nrw.de/…/dgm1_tiff/` — [V] Range 206, ACAO `*` ; WCS `wcs.nrw.de/geobasis/wcs_nw_dgm` [V] écho | dl-de/zero-2.0 [D] |
| **Allemagne — Bavière** | WMTS `wmtsod1.bayernwolke.de/wmts/by_dop/smerc/{z}/{x}/{y}` DOP20 — [V] `*` | DGM1 GeoTIFF par km — [V] **sans ACAO** (proxy) | CC BY 4.0 [D] |

### 3.2 Les autres

| Pays | Ortho | Relief | Accès |
|---|---|---|---|
| Allemagne, autres Länder | DOP20 en WMS : BW `owsproxy.lgl-bw.de/…DOP_20_C` [V] `*`, Saxe [V] `*`, Thuringe [V] `*`, Hesse [V] `*`, Brandebourg [V] `*` ; Basse-Saxe [NV] | DGM1 ouverts (téléchargement) — déjà dans Mapterhorn | dl-de/by ou zero ; bâtiments LoD2 CityGML ouverts dans la plupart [D] |
| Belgique — Flandre | WMTS `geo.api.vlaanderen.be/omw/wmts` 25 cm [V] `*` | DHMV II 1 m WCS `geo.api.vlaanderen.be/el-dtm/wcs` (capacités [V] `*`, GetCoverage non réussi) | licence gratuite ≈ CC BY |
| Belgique — Wallonie | MapServer `geoservices.wallonie.be/…/ORTHO_LAST` [V] écho | MNT/MNS 2021–22 rendus seulement ; brut en téléchargement | — |
| Royaume-Uni | **pas d'ortho nationale libre** (APGB sous licence) | Angleterre : EA LiDAR Composite DTM 1 m, WMS `environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wms` en EPSG:3857 [V] `*` (format geotiff annoncé, non testé) ; Écosse, Galles 1 m | OGL v3 |
| Portugal | DGT `ortos.dgterritorio.gov.pt/wms/ortosat2023` (30 cm) et `cartografia.dgterritorio.gov.pt/ortos2021/service` (25 cm) [V] `*` | LiDAR MDT 0,5 m (2024, téléchargement avec compte) | CC BY 4.0 [D] |
| Pologne | WMTS `mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution` (matrice 3857) 25 cm [V] `*` | NMT 1 m WCS — [V] **sans ACAO** | libre depuis 2020 |
| Slovénie | WMS `ipi.eprostor.gov.si/wms-si-gurs-dts/wms`, `SI.GURS.ZPDZ:DOF025_3857` [V] `*` | LiDAR 1 m (téléchargement) | libre |
| Slovaquie | WMS `zbgisws.skgeodesy.sk/zbgis_ortofoto_wms/…` [V] écho | DMR 5.0 LiDAR 1 m (téléchargement) | libre |
| Italie | national : WMS 2012 ~50 cm **en http** [V] `*` ; **Haut-Adige** `geoservices.buergernetz.bz.it/mapproxy/service/ows` ortho 2024 [V] écho | LiDAR régionaux (Bolzano, Trentin, Aoste…) en téléchargement ; Trentin [V] sans ACAO | régional, CC0 / CC BY [D] |
| Danemark | Dataforsyningen ortho 12,5 cm | DHM 0,4 m WCS | **jeton gratuit** requis [V] ; CC BY 4.0 |
| Suède | STAC `stac-bild` | STAC `api.lantmateriet.se/stac-hojd/v1/`, `dtm-cog` 1 m CC BY 4.0 | COG en **auth Basic** [V] 401 → proxy + compte Geotorget |
| Finlande | MML WMTS 50 cm | KM2 2 m / 1 m | **clé gratuite** ; [NV] (injoignable) |
| Croatie | WMS `geoportal.dgu.hr/…/orthophoto_2021_2022/wms` | WMS rendu | [V] **sans ACAO, sans 3857** |
| Irlande, Islande, Lettonie/Lituanie | pas d'ortho nationale libre / [NV] | Irlande LiDAR partiel ; Islande IslandsDEM 2 m [D] | — |

Paneuropéen : **EMODnet Bathymetry** (~115 m, CC BY 4.0) WMS/WCS `ows.emodnet-bathymetry.eu` [V] `*`, tuiles
`tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png` (rendues) ; bâtiments nationaux 3D BAG (NL),
LoD2 (DE), EUBUCCO (UE) [D].

## 4. Amériques

| Zone | Ortho | Relief | Accès / licence |
|---|---|---|---|
| **USA** | USGS `basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` (NAIP 0,6–1 m) — [V] ACAO `*` ; NAIP ImageServer `imagery.nationalmap.gov/…/USGSNAIPImagery/ImageServer` `exportImage` 0,3–0,6 m [V] `*` | **3DEP** ImageServer `elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?…&imageSR=3857&format=lerc&pixelType=F32` — [V] `*` mais **20–30 s à froid, 504 parfois** (cache/proxy obligatoire) ; COG `prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/{1m,13,S1M…}` [V] Range 206, `*` (`Content-Range` non exposé) | **domaine public** ; NAVD88 |
| USA côtes | — | NOAA CUDEM 3 m et `DEM_all` ImageServer LERC F32 (`gis.ngdc.noaa.gov`) [V] `*` ; **BlueTopo** bathymétrie COG [V] `*` | domaine public |
| Alaska | — | IfSAR 5 m (dans le 3DEP) ; ArcticDEM 2 m | — |
| **Canada** | pas d'ortho nationale ; Québec « Imagerie orthorectifiée » CC BY 4.0 (service [NV]) ; C.-B., Ontario [NV] | **HRDEM 1–2 m LiDAR** : WMS/WCS `datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic`, `GetMap&layers=dtm&crs=EPSG:3857&format=image/geotiff` → **float32 en ~2 s** [V] écho — **le plus proche du WMS-R de l'IGN** ; COG `canelevation-dem.s3.ca-central-1.amazonaws.com` [V] `*` ; CDEM 20 m, MRDEM 30 m | **OGL-Canada 2.0** (commercial OK) ; CGVD2013 |
| Mexique | — | INEGI LiDAR 5 m (téléchargement, UTM), CEM 15 m | « libre uso » [NV] ; pas de CORS |
| Argentine | WMS `wms.ign.gob.ar/geoserver/ows` [V] `*` | MDE-Ar ~30 m ; MDE drone 50 cm sur ~20 villes [V] écho | CC BY [NV] |
| Brésil, Chili, Pérou, Colombie | rien d'ouvert et fin trouvé | GLO‑30 / Mapterhorn | IBGE [V] sans ACAO |

## 5. Asie‑Pacifique, Moyen-Orient, Afrique

| Pays | Ortho | Relief | Accès / licence |
|---|---|---|---|
| **Japon — GSI** (le meilleur équivalent de l'IGN) | `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg` jusqu'à z 18 — [V] `*` ; `ort` (z 14–18) | `dem_png` (DEM10B, z ≤ 14), **`dem5a_png` (5 m LiDAR, z 15)**, **`dem1a_png` (1 m LiDAR partiel, z 17)** — [V] **200, ACAO `*`**. Codage : x = 2¹⁶R + 2⁸G + B ; h = 0,01·x (x < 2²³) sinon 0,01·(x − 2²⁴) ; (128,0,0) = vide | **sans clé**, conditions GSI compatibles CC BY 4.0, crédit « 出典：国土地理院 » ; altitudes JGD2011 (mer) |
| **Nouvelle-Zélande — LINZ** | `basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api={clé}` 7,5–30 cm — [V] `*` | `elevation` et `elevation-dsm` en **`.png?pipeline=terrain-rgb`** (LiDAR 1 m, h = −10000 + 0,1·(R·65536 + G·256 + B)) — [V] `*` | **CC BY 4.0** ; clé auto-émise (ULID, 90 j, 1000 req/min) ou clé statique sur demande ; NZVD2016 |
| **Australie — NSW** | `maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}` (10–50 cm) — [V] `*` | `NSW_5M_Elevation/ImageServer/exportImage?…bboxSR=3857&format=lerc&pixelType=F32` — [V] `*` | CC BY 4.0 ; AHD |
| Australie — autres | Victoria `base.maps.vic.gov.au/wmts/AERIAL_WM_256/EPSG:3857:256/{z}/{x}/{y}.png` [V] `*` ; Tasmanie theLIST [V] écho ; Queensland [NV] (jeton) | GA LiDAR 5 m (WCS [V] écho) ; ELVIS 1–5 m (téléchargement) | CC BY 4.0 |
| Taïwan | NLSC `wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}` jusqu'à z 19 — [V] `*` | DTM 20 m en **CSV** (pré-calcul) | Open Government Licence ; TWVD2001 |
| Hong Kong | `mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/imagery/WGS84/{z}/{x}/{y}.png` — [V] `*`, sans clé | DTM 5 m ASC ; LiDAR CEDD sur commande [NV] | © Lands Department |
| Singapour | OneMap `onemap.gov.sg/maps/tiles/Satellite/{z}/{x}/{y}.png` — [V] `*` | pas de MNT ouvert trouvé | Singapore Open Data Licence [NV] |
| Corée du Sud | VWorld : clé + injoignable depuis la France | — | inutilisable |
| Inde | Bhuvan / CartoDEM : redistribution et commerce restreints, frontières sensibles | — | **à éviter** |
| Indonésie | — | DEMNAS 8 m (EGM2008), téléchargement avec compte | licence BIG [NV] |
| Philippines | — | LiPAD LiDAR 1 m (plaines), compte | plutôt non commercial [NV] |
| Himalaya | — | NASA **HMA DEM 8 m** (NSIDC, Earthdata) — **ellipsoïdal** | ouvert, pré-calcul |
| Israël | govmap : jeton [V] 401 | 10 m dans Mapterhorn | — |
| Golfe, Arabie | rien d'ouvert trouvé | GLO‑30 | — |
| **Afrique** | Digital Earth Africa 10 m (§2.2) ; Afrique du Sud NGI ~0,5 m via `aerial.openstreetmap.org.za/ngi-aerial/{z}/{x}/{y}.jpg` [V] `*` (hôte bénévole, licence pour un jeu [NV] — demander) | Rwanda 10 m (Mapterhorn) ; sinon GLO‑30 | — |

## 6. Pôles et océans

| Source | Rés. | Accès | Licence / datum |
|---|---|---|---|
| **ArcticDEM v4.1** (Arctique, Groenland, Alaska) | 2 / 10 / 32 m | ImageServer `di-pgc.img.arcgis.com/arcgis/rest/services/arcticdem_latest/ImageServer/exportImage?…bboxSR=3857&imageSR=3857&format=lerc&pixelType=F32` — [V] écho, 1–3 s ; COG/STAC `pgc-opendata-dems.s3.us-west-2.amazonaws.com` [V] `*` | **CC BY 4.0** ; **ellipsoïdal WGS84** ; DSM optique (artefacts sur l'eau) |
| **REMA v2.0** (Antarctique) | 2 / 10 / 32 m | `…/rema_latest/ImageServer` [V] écho ; COG/STAC [V] `*` | CC BY 4.0 ; ellipsoïdal |
| **GEBCO 2025** (2026 sorti le 23/04/2026) | 15″ (~450 m) | ImageServer `gis.ccom.unh.edu/server/rest/services/GEBCO2025/GEBCO_2025_IS/ImageServer` LERC S16 [V] écho ; COG 2024 sur source.coop [V] `*` ; WMS rendu [V] `*` | **domaine public**, pas pour la navigation ; MSL |
| NOAA `DEM_global_mosaic` | variable (GEBCO + plus fin) | ImageServer LERC F32 [V] `*` | domaine public |
| IBCAO 5.2 (Arctique), IBCSO v2 (Antarctique) | 100–500 m | téléchargement | conditions GEBCO / CC BY |
| EMODnet (mers d'Europe) | ~115 m | §3 | CC BY 4.0 |

## 7. Ce que cela demande à Kerr (sans rien changer aujourd'hui)

Décodeurs de hauteurs, par ordre de rendement :

| Format | Sources | Effort |
|---|---|---|
| **Terrarium WebP 512** | Mapterhorn | le décodeur existe ; changer extension, taille 512 (une tuile = 4 tuiles 256 de Kerr) et repli parent sur 404 |
| PNG GSI (cm, signé) | Japon | ~3 lignes |
| Terrain‑RGB (Mapbox) | Nouvelle-Zélande | ~3 lignes |
| GeoTIFF float (WCS / WMS) | Espagne, Pays-Bas, Norvège, Estonie, Canada, (Angleterre) | un lecteur TIFF float non compressé/deflate — même famille que le BIL de l'IGN |
| **LERC** (ArcGIS `exportImage`) | USA 3DEP, NOAA, Tchéquie, Norvège, NSW, ArcticDEM, REMA, GEBCO | décodeur WASM `lerc` (Esri) dans le worker |
| COG (lectures `Range`) | NRW, USGS, CanElevation, PGC | geotiff.js ; attention : `Content-Range` souvent non exposé |

Orthophotos : presque toutes sont en Web Mercator XYZ/WMTS, donc une `orthoUrl` par pays dans `NationalSource`, plus un
`OrthoFit` mesuré sur une douzaine de lieux comme `SWISS_FIT` (millésimes, saturation, ombres photographiées). Plusieurs
serveurs inversent l'ordre (`{z}/{y}/{x}` : EOX, ArcGIS, basemap.at, NLSC).

Ordre proposé si l'on y va :

1. **Mapterhorn à la place de Terrarium** (le relief LiDAR sur ~40 pays d'un coup ; garder l'IGN et swisstopo là où
   ils servent plus que le MNT).
2. **Ortho Espagne, Pays-Bas, Autriche** (Web Mercator, CORS `*`, sans clé ; Alpes autrichiennes et Pyrénées
   espagnoles prolongent les zones déjà belles) — relief : déjà dans Mapterhorn.
3. **Japon (GSI)** et **USA (NAIP + Mapterhorn 3DEP)** : les deux grandes zones de vol hors Europe sans clé.
4. **Nouvelle-Zélande** (clé libre) et **NSW**, puis Tchéquie, Pologne, Bavière/NRW, Flandre, Luxembourg, Slovénie,
   Taïwan, Hong Kong (ortho seule).
5. **EOX 2025**, Overture bâtiments hors France, JRC eaux, GEBCO pour les fonds marins, ArcticDEM/REMA aux pôles.
6. Pré-calculs hors ligne (pas de CORS) : canopée Meta 1 m / ETH 10 m hors France.

## 8. Risques

- **Serveurs publics sans SLA** (Mapterhorn, GSI, PDOK…) : cache agressif, User-Agent/Referer, pas de rafales ;
  prévoir un miroir PMTiles pour Mapterhorn avant un trafic fort. 3DEP ImageServer est trop lent sans cache.
- **Licences [D]** à relire une par une avant diffusion ; garder **EOX en NC** tant que le jeu n'est pas commercial.
- **Crédits** : chaque source exige son attribution (le mécanisme I7 « crédit de la source sous la caméra » s'étend).
- **Coutures** : millésimes et colorimétries différentes aux frontières ; marches verticales de quelques décimètres
  entre référentiels nationaux.
- **DSM vs DTM** : GLO‑30, ArcticDEM, REMA, `elevation-dsm` LINZ portent arbres et bâtiments ; ne pas y poser des arbres
  ou bâtiments par-dessus sans les retirer.

## 9. Sources

- Mapterhorn : https://mapterhorn.com/ · https://mapterhorn.com/data-access/ · https://github.com/mapterhorn/mapterhorn ·
  https://download.mapterhorn.com/attribution.json
- AWS Terrain Tiles : https://github.com/tilezen/joerd/blob/master/docs/data-sources.md
- Copernicus DEM : https://registry.opendata.aws/copernicus-dem/
- EOX cloudless : https://cloudless.eox.at/documentation/license
- Sentinel‑2 global mosaics : https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-global-mosaics
- Overture : https://docs.overturemaps.org/guides/buildings/ · https://docs.overturemaps.org/attribution/
- Google Open Buildings Temporal : https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1
- Meta/WRI canopée : https://registry.opendata.aws/dataforgood-fb-forests/ · ETH : https://langnico.github.io/globalcanopyheight
- UE HVD 2023/138 : https://eur-lex.europa.eu/eli/reg_impl/2023/138/oj
- Espagne : https://www.ign.es/web/ign/portal/qsm-cnig · Pays-Bas : https://www.pdok.nl · Autriche : https://basemap.at
- GSI : https://maps.gsi.go.jp/development/ichiran.html · https://maps.gsi.go.jp/development/demtile.html
- LINZ : https://www.linz.govt.nz/data/linz-data/linz-basemaps/how-use-linz-basemaps-apis
- GA LiDAR 5 m : https://services.ga.gov.au/gis/rest/services/DEM_LiDAR_5m_2025/MapServer
- USGS 3DEP : https://www.usgs.gov/3d-elevation-program
- NRCan HRDEM : https://datacube.services.geo.ca/stac/api/collections/hrdem-mosaic-1m
- PGC ArcticDEM / REMA : https://www.pgc.umn.edu/data/ · https://stac.pgc.umn.edu/api/v1/collections
- GEBCO : https://www.gebco.net/gebco2025-grid
- Digital Earth Africa : https://www.digitalearthafrica.org
- Taïwan DTM : https://data.gov.tw/dataset/176927 · Hong Kong DTM : https://data.gov.hk/en-data/dataset/hk-landsd-openmap-5m-grid-dtm
- Planet NICFI (fin) : https://community.planet.com/tropical-basemaps-85/nicfi-satellite-data-program-prolongs-public-access-to-high-resolution-rainforest-satellite-images-6020
