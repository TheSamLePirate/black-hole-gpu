# Audit des affichages de consigne — 11 octobre 2026

Reprise des modifications présentes dans l'arbre de travail de Claude, puis vérification du rapport complet dans le code. Les corrections portent sur les affichages et la télémétrie ; les lois de pilotage restent celles utilisées avant l'audit.

| Point | Vérification et résultat |
|---|---|
| 1 | Confirmé dans notre univers. Conversion de `lastWant.beta` vers le repère home, puis soustraction de la vitesse de référence : astre, sol, air avec le vent local, ou cible selon la bande. La référence de `mission.ts` citée par le rapport concerne Gargantua, où la comparaison reste dans le repère ZAMO. |
| 2–3 | Confirmés. Écart au profil, PAPI, MLS et graphe utilisent `hp` en finale automatique. Les aides reprennent aussi la hauteur et le point visé de `R.prof`. La finale manuelle garde son profil fondé sur AGL. |
| 4 | Confirmé. `PROFILE` désigne l'écart de position au profil ; `PATH` désigne l'écart d'angle de trajectoire. |
| 5–6 | Confirmés ; correction de Claude conservée. Texte du directeur et NAV utilisent `bankFlown ?? bank` en rentrée. `entryInfo` conserve aussi `guidanceBank` pour la valeur brute. |
| 7 | Confirmé. La consigne d'amarrage est exposée après les corrections d'attente, d'alignement et le guidage hors du couloir, dans le même repère que `g.closing`. Le graphe conserve le profil nominal identifié comme tel et montre la consigne actuelle comme niveau `ASKED`. Son point et ses axes conservent les valeurs négatives. |
| 8–9 | Confirmés. La montée affiche l'angle et la route sol du vecteur effectivement commandé (`lastWant`), incluant le roulement, le mélange avec le guidage hors atmosphère et la correction d'inclinaison. La route actuelle et la consigne utilisent toutes deux la vitesse relative au sol. |
| 10 | Confirmé. L'erreur CIRC et l'altitude cible utilisent `circularVelocity` et son rayon moyen J2, comme le contrôleur. Aucun remplacement d'un résultat non fini par une fausse erreur nulle. |
| 11 | Confirmé. `hubNote.asked` est la projection signée du vecteur final, après la correction empêchant de plonger dans un astre. |
| 12 | Confirmé. Le texte de descente distingue la poussée DOI et n'y affiche pas une vitesse demandée fictive. |
| 13 | Confirmé. Le directeur SF utilise la direction relative à l'air après les translations, la glissade et la limite de descente près du sol. Sa consigne et le FPV sont dans le même repère. |
| 14 | Confirmé. `CMD GS`, `TRK`, `groundSpeedMs`, `pathDeg`, `trackDeg` ; le HUD et TARS lisent la consigne effective SF. |
| 15 | Confirmé comme ambiguïté de libellé. `commandedPathDeg` et « Path angle — commanded vs flown » remplacent les mentions de glide slope. |
| 16 | Confirmé. Les cartes et TARS affichent la norme complète de la vitesse sol et la vitesse air séparément. La vitesse horizontale nécessaire au profil manuel reste distincte. |
| 17 | Confirmé ; correction de Claude conservée. Norme du vecteur `vh`, vitesse verticale positive vers le haut, taux de descente positif vers le bas, indicateur DOI. |
| 18 | Confirmé. Le directeur assisté compare le levier de gaz, indépendant de la poussée résiduelle et des RCS. |
| 19 | Confirmé. Le diamant APPROACH lit `aimAlong` issu du profil ; TARS peut aussi lire `aimAlongM`. |
| 20 | Confirmé. Le hub et l'écran DOCK utilisent les mêmes seuils de dépassement de la consigne signée : 25 % + 0,01 m/s, puis 50 % + 0,02 m/s. Hors du couloir automatique, le dépassement axial n'est pas jugé. |
| 21 | Le diagnostic « sans rotation de la cible » est infirmé : `dockGeometry` soustrait déjà `ω × (ring − targetCentre)`. Le point tournant à l'anneau diffère cependant du point sur l'axe utilisé par le contrôleur. La nouvelle consigne affichée est convertie vers le repère de la mesure existante. Une cible tournante est couverte par un test. |

Les anciennes clés de traduction inutilisées sont conservées ; les nouveaux textes ont leur traduction française. `docs/TARS.md` décrit les nouveaux noms et signes de télémétrie.

## Validation

- Tests de régression dans `tests/guidance-display.test.ts` : références de vitesse, cercle moyen J2, attente/recul/finale d'amarrage, cible tournante, consigne SF dans le vent et sous la limite de descente, consigne effective de montée.
- `tests/tars-tools.test.ts` : télémétrie de descente, hauteur au seuil, consigne d'amarrage signée.
- `tests/e2e/landing.e2e.test.ts` : différence de terrain de 40 m sans changement du PAPI ni du MLS ; point visé du profil.
- `tests/e2e/tars-agent.e2e.test.ts` : un modèle simulé lit la norme et les signes de descente par le véritable outil `get_telemetry`.
- Campagne ciblée : `bun run e2e hub-card hub-graph landing assist-dock tars-agent`. Exécutée ici en headless, `kerr-mini` étant inaccessible par SSH.

Résultats finaux :

- `bun run check` : réussi (types, Biome et 9/9 shaders WGSL compilés ; avertissements non bloquants existants).
- `bun test` : **731 réussis, 348 ignorés, aucun échec**.
- Campagne navigateur ciblée : **21 réussis, aucun échec**, cinq fichiers, environ 132 secondes.
- Dernière vérification des tests de régression et de symbologie : **27 réussis, aucun échec**.
- `git diff --check` : réussi.

Aucun push ou déploiement effectué lors de la validation. Les autres changements déjà présents (configuration Claude, règles de déploiement, golden flights, plan Electron et rapports test-kimi) sont conservés sans modification par cette reprise.
