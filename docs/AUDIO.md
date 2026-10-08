# Le son

Tout est synthétisé en direct par la Web Audio API : aucun échantillon, rien à télécharger. Plan : [`PLAN-AUDIO.md`](PLAN-AUDIO.md) (M6, S1–S8).

## Les fichiers

| Fichier | Rôle |
|---|---|
| `src/audio/engine.ts` | le moteur sonore : les bus, les voix continues (moteur, RCS, cabine, sol, station, vent, plasma), les signaux ponctuels (bips, vannes, crissements, bang, amarrage…), les mesures |
| `src/audio/director.ts` | le directeur : lit le vol à chaque image et le traduit en état pour le moteur (`EngineState`) et en signaux |
| `src/audio/space.ts` | pur : un point du vaisseau dans le repère de l'oreille, la vue à bord ou dehors, la vitesse du son, le Doppler, l'absorption de l'air |
| `src/audio/rocket.ts` | pur : le moteur-fusée granulaire (le cœur de l'AudioWorklet) |
| `src/audio/engine-worklet.ts` | l'AudioWorklet du moteur, servi en `audio-worklet.js` (comme les workers) |
| `src/jets.ts` | pur : quels propulseurs tirent et à quel niveau — partagé avec le rendu des panaches ; les grappes RCS |

## Le graphe

```
bips ─────────────── panner (le tableau, en cabine) ─┬──────────────────────────────┐
moteur (granulaire, sub) ─ panner (tuyères) ─ air ─┐ │                              │
RCS (une voix par grappe, panner chacune) ─────────┼─┼→ écoute ─ passe-bas ─ coque ─┼→ master → compresseur → limiteur → sortie
sol (roulement, pneus, freins), station, vent,     │ │   (cabine : modes de coque)  │
plasma ────────────────────────────────────────────┘ │                              │
ambiance (vie à bord, ventilation, roues, respiration, craquements) ───────────────┤
interface (clics) ──────────────────────────────────────────────────────────────────┘
```

## L'espace sonore

- **Le repère** : un point `p` du vaisseau (x à gauche, y en haut, z vers le nez) est en `S·p + t` dans le repère de la caméra (`mounts.ts shipToCamera`, ou `renderer.shipPlace` pour un spectateur) ; Web Audio regarde vers −z : on retourne z.
- **Les panners** : à puissance constante par défaut (enceintes) ; **HRTF** avec le réglage « Casque (son 3D) ».
- **Les vues** : le **cockpit** et la **cabine** entendent le vaisseau de l'intérieur ; les fixations de coque (dorsale, ventre, nez, amarrage) par la structure ; les autres de dehors. Dans le vide, dehors : une licence de jeu (assourdi, plus loin).
- **Le Doppler** : selon la vitesse radiale *du vol* (divisée par l'accélération du temps), la vitesse du son de l'air (aucun dans le vide), tenu à une octave.
- **L'air** : un passe-bas selon la distance (20 kHz près, ~4 kHz à 1 km).

## Les sources

| Source | Où | Ce qui la commande |
|---|---|---|
| Le moteur (granulaire : la turbulence en grains, le crépitement des ondes de Mach dans l'air) | aux tuyères | la poussée appliquée, l'air, le Doppler |
| Le RCS | chaque grappe à sa place (6 sur le Ranger) ; vannes au départ et à l'arrêt | `jets.ts` — les mêmes jets que les panaches |
| La cabine | modes de coque (85 et 170 Hz), ventilation, soupir du régulateur, bips au tableau | la vue, la charge, l'échauffement de la coque |
| La structure | craquements quand la charge change ou pèse ; tics de la coque qui chauffe | la charge ressentie, l'échauffement |
| L'équipage | respiration au-delà de 4 g (grognement de l'anti-g) | la charge ressentie (l'air, sinon la poussée) |
| Le sol | crissement de chaque pneu à son contact, roulement, joints de dalles tous les 15 m, freins, vent au sol | `gearLast` (la charge de chaque jambe), la vitesse, la météo |
| La station | bourdonnement (réseau 60 Hz, pompe 385 Hz, ventilation) au port, par la structure une fois amarré ; amarrage (contact, crochets, six loquets, serrage) et séparation | `dockInfo`, la cible, l'assemblage |
| Le bang | là où le cône de Mach balaie un auditeur immobile (spectateur, survol) : une onde en N | la place et la vitesse de l'appareil vues de l'auditeur, Mach |
| À bord, Mach 1 | les secousses transsoniques (jamais son propre bang) | Mach |
| La rentrée | le plasma qui gronde, secoué, et le flux ionisé qui siffle | le flux thermique |

## Le mix mesuré (S8)

RMS moyen à la sortie (dBFS) et crête, Chrome du labo, volumes par défaut :

| Situation | Master (RMS) | Crête |
|---|---|---|
| Orbite, au repos (cockpit) | −36 | −27 |
| Plein gaz (cockpit) | −14 | −2,3 |
| Plein gaz (poursuite) | −22 | −9 |
| Lacet au RCS (cockpit) | −19 | −2,4 |
| 5 g, respiration (cockpit) | −14 | −2,0 |
| Rentrée, plasma (cockpit) | −21 | −8 |
| Roulage après le toucher (poursuite) | −29 | −16 |
| Bang au survol (Mach 2) | −19 | −0,9 (impulsion) |
| Amarré à l'ISS (cockpit) | −23 | −11 |

Avant ce réglage, le plein gaz depuis le siège tournait à −5 dB RMS, crêtes à −0,5 dB : le limiteur écrasait tout le reste.

## Mesurer

- `__sound.levels()` : le RMS des deux canaux ; `__sound.busLevels()` : chaque bus et la crête ; `__sound.spaceState()` : les panners (moteur, grappes), le modèle, le Doppler, la cabine (modes, ventilation, respiration, compteurs de craquements, crissements, joints, amarrages, bangs), le sol, la station, le plasma.
- Les e2e tournent avec `--mute-audio` : la sortie est muette, le graphe tourne. L'audio démarre sur une touche (`KeyT` deux fois).
- e2e : `tests/e2e/audio-space.e2e.test.ts` ; unitaires : `audio-space`, `audio-rocket`, `jets`.
