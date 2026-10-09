# Plan TARS agent — l'IA du jeu (9 octobre 2026)

Suite de [`PLAN-TARS.md`](PLAN-TARS.md) (M10, fait). TARS ne lisait qu'un relevé du vol et ne pouvait que parler. Il devient **un agent** : il agit sur tout le jeu par des outils, se souvient de vos conversations, et s'écoute à la voix. Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

## Décisions du propriétaire

- (09/10/2026) **TARS peut tout faire, sans jamais demander** : le pilotage, les autopilotes, la navigation, le temps, les vues, les réglages, mais aussi charger ou effacer une sauvegarde, déplacer le vaisseau, changer la date.
- (09/10/2026) **Le modèle se choisit dans les réglages** : une courte liste de modèles qui appellent des outils, GLM-5.3-flash par défaut, toujours par la clé OpenRouter du joueur.
- (09/10/2026) **Une mémoire, effaçable** : la conversation est gardée d'une visite à l'autre, les vieux échanges résumés, des notes que TARS prend ; un bouton « Effacer » et « oublie tout ».
- (09/10/2026) **Le push-to-talk** : la reconnaissance vocale du navigateur (Chrome l'envoie aux serveurs de Google ; Safari la garde sur l'appareil), le champ texte gardé.

## Principes

- **Un seul catalogue d'outils**, décrit par un schéma (nom, rôle, arguments typés et bornés). Les arguments sont vérifiés avant d'agir : une erreur revient au modèle, jamais au jeu.
- **Tout le jeu** :
  - des outils de haut niveau pour ce qui compte (autopilotes, cible, calculateur de vol, lieu, temps, sauvegardes, missions) ;
  - les réglages par le schéma (les quelque 600 du jeu, chacun validé : bornes, choix permis) ;
  - et toute action d'une touche (`press`) : ce qu'un joueur peut faire au clavier, TARS le peut.
- **Lire avant d'agir** : des outils de lecture (l'état du vol, l'orbite, la cible, les sites, la météo, les alertes, le planificateur).
- **Attendre** : un outil qui tient le tour pendant que le jeu tourne (un autopilote jusqu'au bout, une poussée, une phase), borné et interruptible.
- **Pas de confirmation** (décision), mais **un filet** : une sauvegarde automatique « avant TARS » précède chaque geste qui ne se défait pas (charger, effacer, déplacer, changer la date), et « annule » y revient.
- **Hors ligne**, sans clé : TARS comprend les ordres courants (FR / EN) et les mêmes outils les exécutent.
- **La voix** : ses mots dits par sa voix (T5a), ses actions montrées dans le champ F6 au fil de l'eau.

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| A1 | **Le cœur de l'agent** | `ai/tool-schema.ts` (le schéma des outils, la vérification des arguments), `ai/agent.ts` (la boucle d'un tour : appels dans l'ordre, résultats rendus au modèle, erreurs dites, bornes de pas et de temps, arrêt), `ai/memory.ts` (la mémoire : les tours, le résumé, les notes, l'effacement) ; `OpenRouter.complete` (les outils, le modèle choisi) | **fait** : les arguments parsés et vérifiés (bornes, choix permis, rien d'inconnu, rien d'obligatoire manquant, objets et tableaux imbriqués), l'erreur dite au modèle ; un tour : les appels d'une réponse dans leur ordre, chaque résultat rendu par l'id de son appel (coupé à 4000 caractères), 12 pas et 15 min au plus, l'arrêt même pendant une attente ; la mémoire : 24 tours mot pour mot, puis la moitié la plus vieille résumée par le modèle (hors ligne : abandonnée), 40 notes, effacée ; six modèles au choix (tous appellent des outils, prix du catalogue). 4 unitaires. Planche `a1-coeur.jpg` |
| A2 | **Le catalogue d'outils** | `ai/game-tools.ts` : lecture (état, orbite, cible, sites, météo, alertes, réglages, sauvegardes, missions, rapport), vol (autopilotes, maintiens, poussée, train, volets, aérofrein, modes), navigation (cible, calculateur de vol : planifier et exécuter), temps, vues et caméra, lieux (orbite, sol, près d'un corps, trou de ver, plané vers une piste), sauvegardes, missions, réglages (chercher, lire, écrire validé), toute touche ; `wait` ; `remember` / `forget` | |
| A3 | **TARS agent en jeu** | le branchement dans `main.ts` : le tour lancé depuis F6, ses mots dits, ses actions listées dans le champ, l'arrêt (Échap, « stop »), le filet « avant TARS » et « annule » ; le réglage « Modèle de TARS » ; la mémoire et son bouton « Effacer » ; le résumé des vieux tours | |
| A4 | **Hors ligne : les ordres** | les ordres courants compris sans modèle (FR / EN) et exécutés par les mêmes outils | |
| A5 | **Le push-to-talk** | la reconnaissance vocale (FR / EN), F6 tenu pour parler (tapé : le champ), un bouton micro, une action liable à la manette ; le texte entendu affiché en direct | |
| A6 | **Des vols dirigés par TARS** | des e2e avec un modèle simulé qui pilote : « pose-nous à Edwards », « orbite basse puis cap sur la Lune », la mémoire après un rechargement, l'effacement ; un banc réel (`scripts/tars-eval.ts`) à lancer avec la clé du joueur | |
| A7 | **Doc, finitions** | `docs/TARS.md` complété, FR + EN, planche finale | |

Chaque étape : un commit, une planche dans `docs/progress/tars-agent/`, FR + EN.
