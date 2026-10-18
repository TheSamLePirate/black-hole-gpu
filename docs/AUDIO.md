# Le son

Tout est synthétisé en direct par la Web Audio API : aucun échantillon, rien à télécharger — hors les voix Deepgram (TARS, la radio) et celles des joueurs, qui arrivent par le réseau. Plan : [`PLAN-AUDIO.md`](PLAN-AUDIO.md) (M6, S1–S8).

## Les fichiers

| Fichier | Rôle |
|---|---|
| `src/audio/engine.ts` | le moteur sonore : les bus, les voix continues (moteur, RCS, cabine, sol, station, vent, plasma), les signaux ponctuels (bips, vannes, crissements, bang, amarrage…), les mesures |
| `src/audio/director.ts` | le directeur : lit le vol à chaque image et le traduit en état pour le moteur (`EngineState`) et en signaux |
| `src/audio/space.ts` | pur : un point du vaisseau dans le repère de l'oreille, la vue à bord ou dehors, la vitesse du son, le Doppler, l'absorption de l'air |
| `src/audio/rocket.ts` | pur : le moteur-fusée granulaire (le cœur de l'AudioWorklet) |
| `src/audio/engine-worklet.ts` | l'AudioWorklet du moteur, servi en `audio-worklet.js` (comme les workers) |
| `src/jets.ts` | pur : quels propulseurs tirent et à quel niveau — partagé avec le rendu des panaches ; les grappes RCS |
| `src/audio/voice.ts` | pur : la file des voix (priorités, coupures, répétitions, lignes périmées), qui parle (`Speaker`), le débit et la hauteur de chacun ; la parole du système |
| `src/game/radio.ts` | pur : les rôles de la radio du vol (tour, ailiers, AWACS Darkstar, Mother, Paddles), le rôle d'une annonce reconnu à ses mots, la voix Deepgram de chacun |
| `src/ui/netvoice.ts` | la voix des joueurs d'une salle (WebRTC) : le micro envoyé, la voix des autres jouée par une radio |
| `src/audio/music.ts`, `score.ts`, `music/`, `formant.ts`, `g2p.ts`, `deepgram-voice.ts` | la musique, la voix robot de TARS, les voix Deepgram — voir [`TARS.md`](TARS.md) |

## Le graphe

```
bips ─────────────── panner (le tableau, en cabine) ─┬──────────────────────────────┐
moteur, turbofan, canon ── panner (tuyères) ─ air ─┐ │                              │
RCS (une voix par grappe, panner chacune) ─────────┼─┼→ écoute ─ passe-bas ─ coque ─┼→ master → compresseur → limiteur → sortie
sol (roulement, pneus, freins), station, vent,     │ │   (cabine : modes de coque)  │
plasma, buffeting ─────────────────────────────────┘ │                              │
ambiance (vie à bord, ventilation, roues, respiration, craquements) ───────────────┤
interface (clics) ─────────────────────────────────────────────────────────────────┤
voix (TARS, la radio et ses rôles, les joueurs) ───────────────────────────────────┤
musique ───────────────────────────────────────────────────────────────────────────┤
explosions (en retard du trajet du son) ───────────────────────────────────────────┘
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
| La pluie (PLAN-PLUIE P5) | dehors, son souffle et les gouttes au sol ; en cabine, la verrière tambourinée (plus dense et plus forte avec la vitesse), le souffle à travers la coque ; muette en pause | la pluie où est la vue (`rainView`), la vue (cabine ou dehors), la vitesse |
| Le turbofan du F-35 (son F135) | aux tuyères (placé, son Doppler) ; les voix de la fusée muettes | `EngineState.jet` : le régime (le sifflement du compresseur, un accord de ses étages de ~900 Hz au ralenti à ~3 kHz à plein), la poussée (le rugissement large bande de l'échappement, sa couleur, son grondement grave), la post-combustion (un bruit brun déchiré : son crépitement), la soufflante de sustentation en STOVL (son souffle et le ton de ses pales) ; depuis le siège, rugissement, grondement et PC assourdis, le sifflement par la structure |
| Le pilote du F-35 dans son masque | depuis le cockpit : sa respiration au repos aussi (calme, ~14 par minute), forcée sous la charge, muette en G-LOC, un hoquet quand il revient à lui | la charge à ses yeux (`game/gstrain.ts`) ; réglages F-35 › *Respiration du pilote* et *Effets du facteur de charge* |
| Le buffeting | un grondement grave secoué à travers la cellule, plus fort à bord | le buffeting de l'aile aux grandes incidences, pondéré par la pression dynamique |
| Le combat (F-35) | le canon (le GAU-22/A : un bourdonnement à 55 coups par seconde et leur crépitement) et nos départs de missile aux tuyères ; l'alarme d'un départ ennemi (quatre bips) et celle du RWR tant qu'un missile nous poursuit (deux tons rapides) ; les explosions en retard de leur distance / 340 m/s, plus faibles et plus sourdes au loin (muettes au-delà) ; un coup reçu | le monde du combat (`camera.combat` : les tirs, les missiles, leurs événements) |

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

Le F-35 (F6, 2026-10-13, `f35-sound`), au sol freins serrés, le canal le plus fort :

| Situation | Cockpit | Poursuite |
|---|---|---|
| Ralenti | −31 | −27 |
| Plein sec | −16 | −19 |
| Post-combustion | −14 | −13,5 |

Crêtes sous −4,8 dB ; depuis le siège, la PC plus douce que derrière l'avion.

## Les voix

Le bus « voix » ne passe pas par la coque : il va droit au master, comme un casque les entend. Qui parle, dans
quel ordre et de quelle voix : [`TARS.md`](TARS.md) (les annonces, le contrôle de mission, TARS).

- **La radio** (`engine.ts radio`) : à son début la tonalité Quindar d'ouverture (2 525 Hz, 250 ms, comme le
  capcom d'Apollo) et le clic du squelch, un souffle dans la bande de la voix tant qu'elle parle, à sa fin la
  tonalité de fermeture (2 475 Hz) et la queue du squelch ; plus de souffle pendant le blackout de la rentrée
  (`radioNoise`). Une voix système (Web Speech) ne passe pas par l'AudioContext : la radio est jouée autour d'elle ;
  une voix Deepgram y passe, filtrée en bande radio (320 Hz–3,4 kHz, une présence vers 1,8 kHz).
- **Les rôles de la radio du vol** (I4, [`progress/aviation/I4.md`](progress/aviation/I4.md)) : la tour, les
  ailiers, l'AWACS **Darkstar** (la situation : les bandits par leur BRAA, les groupes, les sites SAM, les
  victoires, la *bogey dope*), le porte-avions **Mother** et son officier d'appontage **Paddles** (ses appels
  coupent les autres) — chacun sa voix Deepgram (`ROLE_VOICE` : les quatre anglaises différentes, deux en
  français, partagées), sinon une autre voix système de la langue avec son débit et sa hauteur ; leur nom dans les
  sous-titres, la radio autour. Les missiles sur nous restent à TARS. En salle, les rôles qui concernent notre
  avion (ailiers, Mother, Paddles) sont entendus des autres pilotes, son nom devant (« Ana — Roger ball. ») ;
  Darkstar est à chacun. Le réglage *Rôles radio* (F-35) éteint : la seule voix de la tour.
- **La voix des joueurs** (R2, [`NETWORK.md`](NETWORK.md)) : le micro sur chaque lien direct (WebRTC, Opus, écho
  annulé, bruit réduit), ouvert par la voix (par défaut, seuil −48 dBFS), une touche tenue ou toujours ; la voix
  de chacun jouée sur le bus « voix » par une radio (passe-haut 320 Hz, passe-bas 3,2 kHz, une légère
  saturation, un souffle tant qu'il parle) avec les tonalités Quindar à chaque début et fin — option *radio*
  du panneau —, son volume à lui ; deux appareils d'un même réseau ne s'entendent pas (une même pièce : l'écho).
- **Sous une voix de joueur**, les moteurs, l'ambiance et la musique baissent de 8 dB (`duck`).

## Mesurer

- `__sound.levels()` : le RMS des deux canaux ; `__sound.busLevels()` : chaque bus et la crête ; `__sound.spaceState()` : les panners (moteur, grappes), le modèle, le Doppler, la cabine (modes, ventilation, respiration, compteurs de craquements, crissements, joints, amarrages, bangs), le sol, la station, le plasma.
- Les e2e tournent avec `--mute-audio` : la sortie est muette, le graphe tourne. L'audio démarre sur une touche (`KeyT` deux fois).
- e2e : `tests/e2e/audio-space.e2e.test.ts`, `f35-sound` (le turbofan), `voice`, `radio` (les rôles, deux pages en salle), `net-voice` (la voix des joueurs : le faux micro de Chrome, les Quindar, les moteurs baissés) ; unitaires : `audio-space`, `audio-rocket`, `jets`, `voice`, `radio`.
