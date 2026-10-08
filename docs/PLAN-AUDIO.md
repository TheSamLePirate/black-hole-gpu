# Plan AUDIO — M6 du plan Monde (8 octobre 2026)

Suite de [`PLAN-MONDE.md`](PLAN-MONDE.md), phase **M6 : l'audio spatial**. Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

## Décisions du propriétaire (08/10/2026)

- **Le HRTF en option « Casque »** : un réglage ; au casque, le HRTF (les sources devant, derrière, au-dessus) et le Doppler ; sans lui (enceintes), un panoramique à puissance constante et le Doppler.
- **Le moteur en synthèse granulaire** : tout reste synthétisé (rien à télécharger), mais le moteur passe dans un `AudioWorklet` granulaire — le grondement et le crépitement d'une vraie fusée, la tonalité qui suit la poussée et l'air.
- **Les sources placées dans le monde, toutes** : le vaisseau et ses propulseurs (le moteur à l'arrière, chaque grappe RCS à sa place sur la coque), la piste et le sol (les pneus au toucher, le roulement, le vent au sol, le passage de l'appareil devant la caméra), la station et l'amarrage (l'ISS et l'Endurance qui bourdonnent de près, le choc des loquets transmis par la structure), la rentrée et le bang (le plasma autour de la coque, le bang entendu du sol avec le retard du son).
- **La cabine complète** : le son étouffé par la coque, la structure qui craque sous la charge et la chaleur, la pressurisation et la ventilation, les bips du tableau placés aux écrans, la respiration au-delà de 4 g.

## État de départ (inventaire du 08/10/2026)

- `audio/engine.ts` (740 lignes) : tout synthétisé — bips (oscillateurs, cloches FM), moteur (bruit brun filtré, bruit blanc en bande passante, sub-basse), RCS (bruit et `StereoPanner`), ambiance (ronronnement, air, roues de réaction, vent, grondement de rentrée), une petite pièce par convolution ; un écouteur « intérieur / extérieur » par un passe-bas. Bus : master → compresseur → limiteur.
- `audio/director.ts` : lit le vol à chaque image (les gaz, le RCS, les roues, l'air, le plasma) et joue les signaux.
- **Pas de** `PannerNode`, de HRTF, de Doppler, de source placée ; un panoramique stéréo pour le RCS seulement.
- **Défaut** (audit § 12) : le cockpit et la cabine ne sont pas « à bord » pour le son (`ON_HULL` : dorsale, ventre, arrière) — entendus comme une vue extérieure.
- **Aucun test** (couverture audio 0 %) ; `?e2e=1` coupe l'audio.

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| S1 | **L'espace sonore** | `audio/space.ts` (pur, testé) : la position et la vitesse de chaque source dans le repère de l'oreille (la caméra), l'atténuation, le Doppler (selon la vitesse du son de l'air, aucun dans le vide), la vue à bord ou dehors (le cockpit et la cabine à bord : le défaut de l'audit) ; dans `engine.ts` des voix spatialisées (`PannerNode` égal-puissance, HRTF au réglage « Casque ») ; le réglage et son panneau, FR + EN ; e2e mesurant le niveau (RMS) et le côté de chaque source | **fait** : `audio/space.ts` (pur, 5 unitaires) — un point du vaisseau dans le repère de l'oreille (la pose de la caméra sur le vaisseau, ou la vue du spectateur), la vitesse du son de l'air, le Doppler (tenu à une octave, aucun dans le vide), l'absorption de l'air (20 kHz près, ~4 kHz à 1 km), la vue à bord ou dehors — **le cockpit et la cabine désormais à bord** (le défaut de l'audit) ; dans `engine.ts` le moteur placé à ses tuyères (un `PannerNode` égal-puissance, HRTF au réglage « Casque ») et l'air après lui, son Doppler en `detune` ; la vitesse radiale celle du vol, pas celle de l'écran (au ×4 du vol en altitude, chaque passage décalé d'une octave) ; un mesureur stéréo à la sortie. e2e `audio-space` : derrière le pilote, à gauche de l'aile droite (11 dB d'écart), devant le nez tourné vers l'arrière ; HRTF au casque ; le Doppler et l'absorption d'un survol en vol. Planche `s1-espace.jpg` |
| S2 | **Le moteur granulaire** | un `AudioWorklet` (servi et construit comme les workers) : des grains de bruit filtré, leur densité et leur hauteur selon la poussée et la pression de l'air, le crépitement, la sub-basse ; dans le vide, entendu par la structure seulement ; mesuré (CPU de l'audio, niveaux), le repli sur l'ancien moteur sans worklet | à faire |
| S3 | **Le vaisseau placé** | le moteur à la tuyère, chaque grappe RCS à sa place (les `thrusters` de `vessels.ts`), ses claquements de vanne ; entendus selon la vue — de la cabine, de la dorsale, de la poursuite, du dehors (libre, survol : le Doppler du passage) | à faire |
| S4 | **La cabine** | le son par la coque (passe-bas, résonances), la structure qui craque sous la charge (g) et la chaleur, la pressurisation et la ventilation, les bips du tableau placés aux écrans, la respiration au-delà de 4 g | à faire |
| S5 | **La piste et le sol** | le crissement des pneus au toucher (selon la descente et le glissement), le roulement selon la vitesse, le freinage, le vent au sol ; le passage bas devant la caméra (survol) | à faire |
| S6 | **La station et l'amarrage** | l'ISS et l'Endurance qui bourdonnent de près (ventilation, pompes), le choc des loquets à l'amarrage transmis par la structure, la séparation | à faire |
| S7 | **La rentrée et le bang** | le plasma qui gronde autour de la coque (sa force selon le flux thermique), le bang supersonique entendu du sol avec le retard de la distance, le double bang | à faire |
| S8 | **Mesures et finitions** | les niveaux de chaque situation au labo (RMS par bus), les spectrogrammes pour les planches, `AUDIO.md`, i18n, planche finale | à faire |

Chaque étape : un commit, une planche dans `docs/progress/audio/` (spectrogrammes et niveaux mesurés), FR + EN.
