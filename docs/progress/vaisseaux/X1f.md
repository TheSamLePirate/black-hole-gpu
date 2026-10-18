# X1f — Le pôle de la date partout ; l'ascension mesurée ; Jupiter

*2026-10-18, branche `vaisseaux-aaa` — `docs/PLAN-VAISSEAUX-AAA.md`, phase X1 (défauts de la campagne autopilotes).*

## Le pôle de la date, partout (corrigé)

Le HUD, le décollage, l'ordinateur de vol et le placement mesuraient l'inclinaison par rapport au pôle **J2000** (ou au
pôle du catalogue), alors que les sites et le sol tournent dans le repère **de la date**. Pour la Lune (pôle à ~2° du
J2000), le Lander visant 1° depuis Tranquility obtenait 2,66°.

- `system/solar.ts` `poleOfDate(b, t)` : le pôle de la date, gardé un jour de temps de scène (la précession-nutation
  de la Terre coûte cher) ;
- `controller/util.ts` `spinAxis(id, t)` et `game/place.ts` `equatorAxes(id, t)` : à une date, le pôle de la date ;
  passés aux neuf usages (azimut de lancement, est du sol, ordinateur de vol, cartes de site, rotation au sol, loi
  de vol « sf ») et au statut (l'inclinaison du HUD), au placement en orbite et à `orbitOver`.

**Mesuré** (`tests/takeoff-flight.test.ts`) : de Tranquility vers une orbite de 1° → **1,00°** autour du pôle de la date,
le HUD affiche 1,00°. Placements (`place-over`, `game-orbit`) : exacts dans le nouveau repère (le test de Mars lit
maintenant l'inclinaison à la date). Suite complète : 1 355 pass ; les 3 autres échecs (alunissage, deux figures de
voltige) passent relancés seuls (charge machine).

## L'ascension (mesurée, pas encore corrigée)

La référence « +27–30 % » de la campagne est une ascension **impulsive** (sans pertes). Mesures :
- **Lune, sans air** : Ranger 2 051 m/s, Lander 2 040 m/s pour 1 722 impulsifs → **+19 %** ; une ascension optimale y
  perd 3–5 % : ≈ 250 m/s gaspillés. Cause : sans air, la vitesse horizontale visée est liée à la hauteur (√f) — le
  vaisseau monte presque à la verticale et prend sa vitesse en haut, les pertes de gravité courent toute la montée.
- **Terre** : +27–30 % ; avec la poussée du Ranger (T/W ≈ 2,3), les pertes de gravité valent à elles seules ≈ 15 % — le
  « +10 % » visé par la campagne est hors d'atteinte physique sur Terre ; ≈ +18–20 % l'est.
- Essai : le guidage explicite dès 300 m sur un corps sans air → +50 à +64 %, l'orbite ratée (la fin de montée n'est pas
  faite pour une insertion basse). **Annulé.** La bonne solution : une ascension en deux temps comme celle du LM
  d'Apollo — insertion sur une orbite dont l'apoapside est l'altitude visée (périapside bas mais au-dessus du relief),
  puis circularisation — avec ses tests de Δv. Proposée en session à part.

## Jupiter (reporté)

La mission vers Jupiter échoue toujours (le planificateur se croit sur sa visée après la première correction) ; c'est
un chantier du planificateur n corps, proposé en session à part.
