# Mac Thermal Toolkit 2 — CLI Bun pour humains et LLM

L'outil combine macmon, powermetrics, l'état thermique natif de macOS, pmset et les compteurs GPU du pilote. **Aucun serveur MCP, HTTP ou socket n'est lancé.**

## Démarrage

Sur ce Mac, Bun et macmon sont déjà installés. Le point d'entrée habituel est conservé :

```bash
bun "/Users/olivierveinand/Documents/Codex/2026-10-29/co/outputs/mac-thermal.ts"
```

Sans sous-commande, il ouvre le tableau de bord historique. Avec une sous-commande, il produit du JSON versionné pour un agent.

La version autonome `mac-thermal-toolkit/dist/mac-thermal.js` regroupe le code et ses dépendances JavaScript. Elle peut être copiée seule et utilisée avec Bun, sans `bun install`. macmon et les commandes macOS restent nécessaires pour les mesures.

## Un diagnostic ponctuel pour un LLM

```bash
bun mac-thermal.ts doctor
bun mac-thermal.ts snapshot --power auto --pretty
bun mac-thermal.ts snapshot --power off --metrics 'gpu.*'
bun mac-thermal.ts catalog
bun mac-thermal.ts schema
```

`doctor` détecte l'OS, la version de macmon, les samplers powermetrics disponibles et l'autorisation sudo non interactive du contexte courant. `catalog` décrit les 30 métriques, leurs unités et leurs limites d'interprétation. `schema` publie les JSON Schema des principaux résultats ; une copie est livrée dans `mac-thermal-toolkit/schema.json`.

Pour les nouvelles commandes, stdout contient le JSON. Les messages d'authentification et d'arrêt passent sur stderr. Les erreurs portent un code stable et un code de sortie documenté. Les messages destinés aux agents et les identifiants sont en anglais ; le tableau de bord reste en français.

## Mesures complètes accessibles au LLM sans mot de passe dans le chat

Lance dans ton terminal :

```bash
bun "/Users/olivierveinand/Documents/Codex/2026-10-29/co/outputs/mac-thermal.ts" monitor \
  --power required \
  --latest "/Users/olivierveinand/Documents/Codex/2026-10-29/co/work/thermal-latest.json" \
  --log "/Users/olivierveinand/Documents/Codex/2026-10-29/co/work/thermal-history.jsonl" \
  --quiet
```

`sudo` demande le mot de passe de ton compte administrateur, directement dans le terminal. Le script ne lit et ne conserve aucun mot de passe. Bun s'exécute avec ton compte habituel ; seuls les appels fixes à powermetrics sont élevés. Le collecteur renouvelle la validité de sa session sudo tant qu'il tourne, sans modifier sudoers ni les réglages du Mac.

Le LLM lit ensuite :

```bash
bun "/Users/olivierveinand/Documents/Codex/2026-10-29/co/outputs/mac-thermal.ts" latest \
  "/Users/olivierveinand/Documents/Codex/2026-10-29/co/work/thermal-latest.json" \
  --max-age 15 --metrics 'gpu.*'
```

Une mesure de plus de 15 secondes est refusée par défaut. Le fichier courant est remplacé atomiquement ; les nouveaux fichiers sont créés avec les permissions 0600. Le journal JSONL tourne à 8 Mio et conserve deux archives `.1` et `.2`. Des verrous empêchent deux collecteurs d'écrire les mêmes chemins. Ctrl+C arrête le collecteur et libère ses verrous.

Le collecteur est borné à une heure par défaut ; `--duration` permet de choisir de 1 à 86400 secondes. Aucun service ni lancement automatique au démarrage n'est installé. Si une session est tuée brutalement et laisse un verrou, vérifier le PID du fichier `.lock` avant toute suppression ; les PID morts identifiés peuvent être récupérés automatiquement au prochain lancement.

## Enregistrer, analyser, comparer

```bash
# Enregistrement borné ; stdout contient le résumé, le fichier contient les mesures
bun mac-thermal.ts record --power auto --samples 5 --interval 1000 \
  --duration 60 --label 'rendu identique' --out session.json

# Statistiques et tendances, sans nouvelle collecte
bun mac-thermal.ts analyze session.json --metrics 'gpu.*'
bun mac-thermal.ts analyze /chemin/thermal-history.jsonl

# Écarts entre deux enregistrements
bun mac-thermal.ts compare reference.json essai.json --same-workload
```

`record` calcule minimum, maximum, moyenne des échantillons, médiane, p95, variation et pente par minute. Les valeurs manquantes sont exclues. Les pentes utilisent les dates réelles, pas l'intervalle demandé. Les comptes de pression thermique sont des nombres d'échantillons, pas des durées. `--include-samples` ajoute les mesures au JSON stdout ; `--raw` ajoute les sorties originales. Ces options augmentent le volume fourni au LLM.

Limites des enregistrements : 120 échantillons au maximum, durée de collecte de 600 secondes au maximum, 10 échantillons au maximum avec les données brutes. L'initialisation des outils allonge la cadence réelle. Les sous-processus ont un délai maximal, peuvent être annulés et leurs sorties sont bornées.

L'analyse accepte les snapshots v2, sessions v2 complètes, tableaux de snapshots v2 et journaux JSONL v2, jusqu'à 16 Mio et 5000 lignes. Elle vérifie les unités, sources, valeurs et versions. Une dernière ligne tronquée est signalée ; les doublons exacts sont dédupliqués et les ID contradictoires sont refusés. Les anciens journaux du tableau de bord ne sont pas migrés silencieusement.

La comparaison affiche des écarts observés. `--same-workload` est une déclaration de l'appelant, pas une preuve expérimentale. Des différences de charge, de matériel/OS, de refroidissement ou d'alimentation limitent l'interprétation. L'outil ne conclut pas à une cause thermique sur cette seule base.

## Contrat des mesures

Chaque métrique contient :

```json
{
  "value": 87.8,
  "unit": "degC",
  "source": "macmon",
  "quality": "reported",
  "unavailableReason": null
}
```

- `reported` : valeur rapportée par une source, sans garantie de mesure physique indépendante.
- `estimated` : puissance estimée.
- `derived` : calcul décrit dans le catalogue.
- `unavailable` : valeur `null` et raison explicite, par exemple `NOT_EXPOSED`, `DISABLED` ou `AUTHORIZATION_REQUIRED`.

Le résultat contient aussi la fenêtre de lecture, l'état de chaque source, la couverture des métriques et des observations accompagnées de chemins vers leurs preuves. `--metrics` filtre les métriques retournées ; `selection` donne les ID choisis et `coverage` conserve la couverture de la collecte complète.

`--power auto` renvoie les données disponibles sans demande de mot de passe. `--power required` exige powermetrics. `--power off` le désactive. `--authenticate` permet une saisie sudo explicite pour un snapshot ou enregistrement lancé dans un terminal interactif. Ne pas mettre `sudo` devant Bun.

Une couverture partielle est courante : pmset ne publie pas nécessairement de limite CPU et macmon 0.7.0 n'expose pas les ventilateurs. `--require-complete` est un contrôle strict de toutes les métriques du catalogue ; il peut échouer même quand toutes les sources disponibles fonctionnent normalement.

## GPU et précautions d'interprétation

Les résultats distinguent : températures, activité GPU réelle, activité pondérée par la fréquence, fréquences actives, répartition des états, états logiciels demandés, puissances, compteurs Device/Renderer/Tiler, mémoire utilisée/allouée et compteur de récupération.

Un GPU actif à 100 % n'est pas nécessairement saturé en calcul : il peut attendre la mémoire ou d'autres ressources. Les compteurs Device/Renderer/Tiler ne s'additionnent pas ; leurs définitions et fenêtres de mise à jour sont celles du pilote. La mémoire allouée n'est pas une quantité de VRAM dédiée ni nécessairement résidente.

`thermal.hardwareThrottling` reste **unknown** : ces outils n'exposent pas un indicateur matériel universel permettant de confirmer la cause d'une baisse de fréquence. Les findings distinguent observation, inférence et limite. Les heuristiques « actif au moins 95 % » et « fréquence sous 90 % du maximum déclaré » ne sont pas des seuils thermiques Apple. Les bornes numériques du catalogue servent à rejeter des valeurs impossibles, pas à définir une température de fonctionnement sûre.

Les sources sont lancées en parallèle avec des fenêtres différentes. `sourceReadEndSkewMs` mesure l'écart entre les fins de lecture et ne date pas la mise à jour interne du pilote. Les valeurs `null` ou tableaux de ventilateurs vides n'impliquent ni arrêt du GPU, ni absence de ventilateurs, ni absence de limitation.

Pour les compteurs détaillés ALU, bande passante, occupation et temps par kernel, il faut profiler la charge avec les outils Metal de Xcode/Instruments disponibles pour l'application et le matériel.

## Codes de sortie

| Code | Signification |
|---|---|
| 0 | Résultat exploitable, éventuellement partiel |
| 1 | Erreur interne |
| 2 | Arguments, fichier ou schéma invalides |
| 3 | Autorisation ou source privilégiée requise indisponible |
| 4 | Plateforme incompatible |
| 5 | Source/couverture requise indisponible, verrou ou limite de collecte |
| 6 | Mesure périmée ou incohérence d'horloge |
| 130 | Annulation |

Les erreurs JSON contiennent `code`, `message`, `retryable`, `remedy` et parfois `details`. Une erreur de source requise peut inclure le snapshot partiel exploitable.

## Développement et validation

```bash
cd mac-thermal-toolkit
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

Les tests couvrent le parsing de la capture réelle fournie, les formats macmon, la provenance et les valeurs manquantes, les limites numériques, les tendances, les comparaisons, les fichiers atomiques, la fraîcheur, la rotation, les verrous, la CLI, les délais et l'annulation. La collecte sans sudo, l'enregistrement, le collecteur avec fichiers et l'analyse sont vérifiés sur ce M1 Max. Les métriques powermetrics sont vérifiées sur la capture réelle fournie ; la nouvelle collecte privilégiée automatique nécessite un lancement dans ton terminal authentifié.

Le guide destiné à l'agent est `mac-thermal-toolkit/LLM-GUIDE.md`. Le code source, le lockfile et les schémas restent fournis ; la version autonome évite une installation JavaScript chez l'utilisateur.

Documentation consultée : [Bun — sous-processus](https://bun.sh/docs/runtime/child-process), [Zod — JSON Schema](https://zod.dev/json-schema), [macmon 0.7.0](https://github.com/vladkens/macmon/blob/v0.7.0/readme.md), [Apple — Metal Compute on MacBook Pro](https://developer.apple.com/videos/play/tech-talks/10580/), aide locale `powermetrics --help`, `man pmset`, libellés du binaire powermetrics et compteurs observés sur ce Mac.
