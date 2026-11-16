# Les e2e en avion contre la règle 13 d'E2E-VOLS — audit du 16 novembre 2026

Demande de Sam (16 nov., ~08:00 UTC, relayée par la session d'analyse) : « les tests e2e en avion doivent être parfaits — autopilot, gear,
autothrust ». Règle 13 de [E2E-VOLS](../E2E-VOLS.md) (fb0e0a92) : un avion d'e2e vole comme un pilote, et le test l'asserte — gelé pendant
les attentes de données, jamais de vol plané manette à 0 ; à chaque phase, ce qui est réellement appliqué (AP/ATHR, la poussée
`engineNow`, le train, la vitesse au-dessus du décrochage, une assiette plausible) ; un geste manuel rendu, l'état d'après vérifié.

Fait par la session PLAN-APPROCHES (1feb2f7f). Relevé : un agent de lecture sur les ~300 fichiers e2e (246 appellent `flyAt` : le F-35 porte
la caméra de presque tous les tests de rendu), les 46 du domaine aviation lus à la main, le reste par balayage statique et sondages.

## Ce que fait `flyAt`

`__bh.game.flyAt(lat, lon, hauteur sol, cap, vitesse)` place l'appareil **en gardant la manette et les maintiens tels qu'ils étaient** — au
démarrage, 0 et aucun — et rentre le train. Toute attente qui suit sans gel ni engagement le laisse planer au ralenti.

## Les outils (ce lot)

| Outil | Rôle |
|---|---|
| `tests/e2e/lib/flight-state.ts` | `flightState(app)` (AP, ATHR — l'ILS et la VNAV comptés —, `engineNow`, levier, train et son extension, vitesse air, incidence/décrochage, assiette, hauteur sol) ; `expectFlight(état, libellé, bornes)` et `CRUISE` (les parcours-* de la session du rendu) ; `placeJetFrozen` (gel, placement, attente, replacement, maintiens engagés) ; `flightProblems(état, phase)` / `expectFlightPhase(app, phase)` (croisière, approche, finale, arrondi, sol) |
| `tests/e2e/lib/held.ts` | `HELD` / `HELD_JS` : après un `flyAt`, une poussée de croisière et l'AP + l'ATHR engagés là où il est, sans le déplacer (3 pas pour le F-35, sa poussée posée ; 6 s pour l'A320 et son AP1) ; `MONITOR_INIT` / `MONITOR_STEP` / `monitorProblems` : un vol surveillé pas à pas (hors arrondi et roulage : poussée au ralenti **sans** autothrottle, incidence/décrochage, inclinaison, assiette, vitesse, maintiens ; le train au premier contact) |
| `tests/e2e-flight-state.test.ts` | le juge testé sans navigateur (4/4 : croisière, états absurdes, ralenti sous autothrottle permis, axe de piste, moniteur) |
| axe de piste (`flight-state.ts`) | `axis` dans l'état (écart de cap et latéral à la piste sous les roues), phases `lineup` (≤ 1°, ≤ 3 m) et `roll` (≤ 3°, ≤ 6 m), `AXIS_WATCH_START`/`READ` sur un roulage, `AXIS_PILOT_ON`/`OFF` (le palonnier d'un pilote) — demande de Sam (A320 mal aligné) |
| `tests/e2e-flight-guard.test.ts` | la garde statique : un `flyAt` suivi d'une attente avant tout gel, toute poussée ou tout autopilote est rouge ; les fichiers pas encore conformes listés avec leur propriétaire (`PENDING`, ne fait que rétrécir — le test dit quand en retirer un) |

Leçon retenue : un ralenti **sous autothrottle** (une descente gérée sur la pente) est d'un pilote ; le défaut, c'est le ralenti sans personne
aux gaz — le premier critère « poussée minimale < 0,05 » condamnait à tort les neuf vols de l'échantillon F-35.

## Le domaine de cette session — approches, A320, autopilotes : corrigé

| Fichier | Avant | Corrigé |
|---|---|---|
| approach-sample | attente du relief non gelée (15 s) ; aucun état asserté | gelé pendant l'attente ; moniteur pas à pas, train au toucher |
| approach-join, a320-approach-join | hauteur et toucher seulement | moniteur sur la jonction et la descente, train au toucher |
| fd-approach | AP coupé (voulu), ATHR non assertée | moniteur `{ ap: false }` : l'ATHR tenue, jamais de ralenti sans elle |
| radar-approach, jetmap-approach, approach-wheel, approach-auto, ils-runway, crew-approach, hud-runways-all, approach-audio, ils | `flyAt` puis attente (jusqu'à 45 s pour ils-runway) sans AP ni poussée ; rien d'asserté | `HELD` ; état asserté au placement (croisière, ou approche en finale) |
| jetmodes | idem ; une bascule ATHR qui aurait coupé celle engagée | `HELD`, bascule rendue conditionnelle, états assertés |
| a320-rain | A320 à 400 m sans manette ni AP pendant ≤ 60 s | `HELD` ; état asserté (`ap: false` : l'AP1 refusé 5 s après un placement) |
| a320-du-cost, a320-pad, a320-effects | manette seule, sans AP | `HELD` au placement |
| lebourget-night-ils, approach-detail | moteur à 0 jusqu'à l'ILS | manette et poussée au placement gelé ; état asserté sur la finale (train sorti) |
| takeoff-armed | maintiens assertés, poussée et train non | état asserté à la fin du décollage automatique (croisière : train rentré) |
| f35-nav | NAV assertée, poussée non | moniteur pendant le vol NAV (la VNAV comptée comme gestion de la poussée) |
| net-formation-ap | attentes non gelées ; `jetToggle` qui bascule | `HELD`, `apSet` (n'éteint rien) — retiré de `PENDING` |

## Les autres (listés dans la garde, `PENDING`)

- **Session du rendu (82)** : les tests de rendu, de scène, de sol, de mer et les parcours-* (déjà en cours : parcours-camera, -gpu, -ville,
  -meteo, -tars conformes ou en cours ; parcours-meteo 50→54 était le pire : ≤ 180 s non gelés, manche pris 30 s jamais repris).
  Pires : j7-approach-ground (≤ 60 + 180 s à 80 m/s), gopro, look-profile, raster-governor (≤ 90 s), canopy-scratches, motion-blur, geoid,
  f35-pcd (≤ 60 s). J0, J2 et motion-quality gardent le train sorti en croisière, à dessein — contraire à la règle : à décider avec Sam.
- **Vol, à attribuer (40)** : F-35 (body, gunsight, high-alpha, pcd, wingmen, hud…), porte-avions (carriers, deckland, trap), missions,
  école (course, instructor, quals), réseau (net-*, crew-*), TARS (tars-pcd, knowledge, cases), war-mode, radio, traffic-*.
- Aucun de ces fichiers n'asserte la poussée ni le train ; la plupart attendent ≤ 3 s non gelés (un bloc « les Alpes, 3 s » partagé).

## Limites de la garde

- Faux positifs : un `flyAt` dans une fonction d'aide gelée à l'appel (earth-horizons, earth-horizons-truth, sky-open, relief-shadows) —
  listés dans `PENDING`, à retirer après lecture.
- Manques : un `setTimeout` de moins d'une seconde avant un gel dans le même appel ; une attente à plus de 80 lignes du `flyAt`
  (perf-suite, raster-flight) ; les assertions d'état (la garde ne voit que l'attente au ralenti — le reste, c'est `flightProblems`).

## Rejoués (16 novembre 2026)

- **Ce Mac (fenêtre visible)** : radar-approach, jetmap-approach, approach-wheel, crew-approach, hud-runways-all, approach-auto, ils-runway,
  approach-audio, lebourget-night-ils — 22/25 puis, corrigés, 11/11 sur les trois rouges : approach-auto (depuis le nord la 13 construite,
  sa pente relevée à 4,25° au-dessus des collines, AP10b — l'attente du test datait d'avant), crew-approach (`HELD` déplaçait l'avion de
  600 m : plus établi), lebourget-night-ils (le train verrouillé attendu, pas 2 s fixes).
- **kerr-mini** : takeoff-armed, f35-nav (3), net-formation-ap (4), a320-pad, a320-du-cost, a320-rain, jetmodes (3), approach-sample A320
  (4 posés conformes au moniteur, KTNX refusée motivée), fd-approach 2/2 et ils 2/2 après correction : la main scriptée de fd-approach tirait
  le manche à fond (33° d'assiette, 122 % de l'incidence de décrochage sur le F-35) — retenue d'un pilote ajoutée ; Edwards renuméroté
  05R/23L (nav.dat) — l'attente « 22 » acceptée en « 23L ».
- **Retours de la session du rendu** (intégrés) : `placeJetFrozen` fait 10 pas avant `apSet` ; le ralenti sous autothrottle qui ralentit
  vers sa consigne n'est plus une faute (`idleAllowed`).
