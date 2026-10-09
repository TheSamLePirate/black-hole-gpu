# Plan TARS — M10 du plan Monde (9 octobre 2026)

Suite de [`PLAN-MONDE.md`](PLAN-MONDE.md), phase **M10 : la musique, la voix et TARS**. C'est la dernière phase du plan Monde. Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

## Décisions du propriétaire

- (05/10/2026, plan Monde) **TARS par OpenRouter** : le texte par `z-ai/glm-5.3-flash` ; les **décisions typées par Jev** (`typesafe/jev`, `POST /api/alpha/decisions`) — parler ou se taire, quel sujet, quel ton, l'alerte à dire d'abord.
- (05/10/2026) **La clé OpenRouter du joueur**, saisie dans les réglages et gardée en local, jamais dans le code ; sans clé, des phrases écrites.
- (05/10/2026) L'audio et TARS ferment la phase 3.
- (09/10/2026) **La musique aux moments forts seulement** : silence par défaut ; la partition ne vient qu'aux grands instants — le décollage, la rentrée, la finale, le trou de ver, Gargantua (et le tic-tac de Miller sur Miller).
- (09/10/2026) **Web Speech, plus une voix robot pour TARS** : les annonces et le contrôle de mission par les voix du système (FR / EN) ; TARS par une **voix synthétisée maison**, passée dans l'audio du jeu (son timbre robotique, sa place dans la cabine).
- (09/10/2026) **TARS parle de lui-même aux moments clés** : rarement — un événement marquant, une erreur, un conseil quand le pilote hésite —, Jev décidant s'il vaut la peine de parler ; il répond toujours quand on lui parle.
- (09/10/2026) **La clé : la connexion OpenRouter et la saisie** — un bouton « Se connecter avec OpenRouter » (OAuth PKCE, sans serveur) et un champ pour coller une clé ; gardée en local seulement.

## État de départ (inventaire du 09/10/2026)

- **L'audio** (`audio/engine.ts`, M6) : tout est synthétisé. Les bus sont master → compresseur → limiteur, plus beeps, moteur, RCS, ambiance, interface, salle et écoute (coque).
  - Les signaux passent par `play(cue)` ; les alarmes répétées sont `master`, `collision` et `terrain`.
  - **Il n'y a ni bus de voix ni bus de musique.** L'aide du réglage Son dit d'ailleurs « pas de musique ».
- **La voix** : rien. Aucun `speechSynthesis` dans le code. Une voix Web Speech ne passe pas par l'`AudioContext` : aucun filtre « radio » n'est possible sur elle, seulement autour (le souffle, le squelch).
- **Les signaux disponibles** :
  - les phases (`game/phase.ts` `PhaseWatcher`, événement `phase`) ;
  - la rentrée (`entryRun.phase`, le profil d'approche et ses phases, la remise de gaz) ;
  - les alertes (`ui/hud/alerts.ts`, la master caution) ;
  - les messages du pilote (`pilotMessage`, `GameLog`) ;
  - la hauteur sol, la vitesse verticale, le plasma (`air.heat`) ;
  - près du trou noir, `dtau` (dτ/dt) et `region` ;
  - la hauteur de décision (`RUNWAY_DH`, `game/procedures.ts`). Il n'existe pas de logique de « sink rate ».
- **Les réglages** : le groupe Son et ses volumes (`soundMaster`…), de type `"pref"` (dans `kerr.prefs`, hors des sauvegardes). Le schéma n'a **aucun champ texte** : la clé ira dans un `store` à part (`util/storage.ts`), jamais dans les réglages exportés ni dans une sauvegarde.
- **Le réseau** :
  - Le METAR et l'ISS ont déjà un modèle d'appel : délai, cache, et repli silencieux hors ligne.
  - Il n'y a pas de CSP, et le service worker laisse passer les POST.
  - OpenRouter accepte CORS pour les complétions. La connexion « Sign in with OpenRouter » (OAuth PKCE, sans serveur) donne au joueur une clé sans copier-coller.
  - Le CORS de Jev n'est pas documenté : à vérifier par un vrai appel.
- **Les coûts** :
  - GLM-5.3-flash coûte 0,075 $ par million de jetons en entrée et 0,25 $ en sortie (moitié prix jusqu'au 9/09/2026, donc déjà échu).
  - Jev ne facture que l'entrée.

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| T1 | **La voix** | `audio/voice.ts` : une file de paroles par priorité (une alerte coupe un commentaire), la voix du système choisie par langue (FR / EN), son volume ; les **sous-titres** (une ligne sous le HUD, l'orateur nommé) ; le souffle radio et le squelch autour d'une voix « radio » ; réglages (voix, sous-titres, volume), FR + EN ; e2e (la file, les sous-titres) | **fait** : `audio/voice.ts` — `VoiceQueue` (pure, 3 unitaires : la plus urgente d'abord, une plus urgente coupe celle qui est dite, la même ligne pas deux fois en 4 s, une ligne périmée abandonnée) et `Speech` (les voix Web Speech du système, choisies par langue, les voix fantaisie de macOS écartées ; un débit et une hauteur par orateur ; sans voix, chaque ligne dure son temps de lecture) ; **la radio autour** des lignes du contrôle : le bip Quindar d'Apollo (2525 / 2475 Hz), le squelch et un souffle, sur un nouveau bus « voix » du moteur ; `ui/subtitles.ts` (l'orateur nommé, au-dessus du tiers bas) ; réglages Voix, Volume des voix, Sous-titres (FR + EN, `i18n/fr-tars.ts`) ; `__bh.voice`. e2e `voice` 2/2 ; vérifié dans Chrome : 199 voix, la phrase dite et finie, le souffle sur le bus voix. Planche `t1-voix.jpg` |
| T2 | **Les annonces** | `game/callouts.ts`, pur et testé : les annonces de finale à la hauteur radio (2500, 1000, 500, 100, 50, 40, 30, 20, 10), « minimums » à la hauteur de décision, « sink rate », « pull up », « gear », les alertes du HUD dites une fois (la plus grave d'abord) ; une hystérésis, rien deux fois ; un vol de labo écouté (la liste des annonces) | à faire |
| T3 | **Le contrôle de mission** | des répliques écrites sur les événements du vol (décollage, mise en orbite, injection, rentrée, posé ; amarrage ; « Go for TLI », les autorisations), dites à la radio ; **le blackout radio** dans le plasma : la voix coupée, le souffle, puis « Ranger, Houston, comment recevez-vous ? » à la sortie | à faire |
| T4 | **La partition adaptative** | `audio/score.ts` (pur : les accords, les couches, l'intensité selon la phase et la gravité) et un bus musique : nappes et **orgue additif** ; **le silence par défaut**, la musique aux moments forts seulement (décollage, rentrée, finale, trou de ver, Gargantua), entrée et sortie en fondu ; **le tic-tac de Miller** : un battement par jour terrestre écoulé, sa cadence tirée du vrai dτ/dt (1,4 s sur Miller) ; mesuré (CPU, niveaux), réglages | à faire |
| T5 | **TARS, hors ligne** | **sa voix robot** : une synthèse maison (des phonèmes du texte FR / EN, des formants, un timbre robotique), rendue dans l'`AudioContext` du jeu — placée à son poste dans la cabine, passée par la coque ; le personnage : une touche et un champ pour lui parler, ses réponses écrites tirées de l'état du vol (où, combien de carburant, combien de temps, quoi faire), ses remarques aux moments clés ; **l'honnêteté et l'humour réglables** (90 %, 75 %…) qui changent ses phrases ; sa voix | à faire |
| T6 | **TARS par OpenRouter** | la clé (connexion OpenRouter et/ou saisie), gardée en local ; le texte par GLM-5.3-flash (le contexte : l'état du vol résumé, ses réglages de personnalité), les décisions par Jev (parler ou se taire, sujet, ton, alerte d'abord) posées en parallèle ; le budget (appels par minute, coût affiché), le repli sur T5 hors ligne ou sans clé ; e2e avec un OpenRouter simulé | à faire |
| T7 | **Labo, finitions** | un vol complet écouté (annonces, musique, TARS) ; les coûts mesurés ; `docs/TARS.md`, FR + EN ; planche finale | à faire |

Chaque étape : un commit, une planche dans `docs/progress/tars/`, FR + EN.
