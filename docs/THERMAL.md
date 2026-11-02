# La chaleur des Mac du labo — le service thermique

Une mesure GPU prise sur un Mac qui chauffe ne vaut rien : le 30 octobre, le GPU de ce Mac tournait à 555 MHz sur 1 296
sous une pression thermique « Heavy », et les benchs bougeaient de ±40 %. Le service thermique écrit en continu, sur
chaque Mac du labo, l'état thermique et l'horloge du GPU. Un agent le lit avant une mesure, les e2e l'enregistrent pour
chaque test, et le moniteur du labo l'affiche.

L'outil vient de Sam (le « Mac Thermal Toolkit », écrit le 29–30 octobre) ; il est repris dans `tools/mac-thermal/`
avec trois ajouts : une commande `service`, la pression thermique lue sans root, et powermetrics lu depuis un flux root.

## En bref

```sh
bun scripts/thermal.ts                    # ce Mac : pression, horloge GPU / max, températures, puissances
bun scripts/thermal.ts --all              # ce Mac et kerr-mini
bun scripts/thermal.ts window --minutes 10
bun scripts/thermal.ts doctor --all       # l'agent, le démon root, macmon, l'âge des fichiers
bun scripts/lab-monitor.ts                # une ligne « Heat » par machine
```

```
this Mac   Heavy · GPU 980/1296 MHz (76 %) scaled 75.6 % · GPU 76.1 °C CPU 77.2 °C · GPU 5.5 W · sys 29.9 W · state fair
           ⚠ thermal pressure Heavy — figures measured now may be throttled (±40 % seen under Heavy)
```

**Avant un bench ou un A/B**, lire cette ligne : une pression autre que `Nominal` ou un état `serious`/`critical` rendent
la mesure douteuse. Il faut attendre, ou le noter à côté des chiffres. `bench.ts` et `trace-ab.ts` l'affichent eux-mêmes
au début et à la fin, et l'écrivent dans leur rapport (`machineThermal: { before, after, window }`).

## Les deux moitiés

| | La moitié utilisateur (sans root) | La moitié root (facultative) |
|---|---|---|
| Ce qui tourne | LaunchAgent `org.samlepirate.kerr-thermal` : `bun mac-thermal.js service` | LaunchDaemon `org.samlepirate.kerr-thermal-feed` : `/bin/sh` + powermetrics, rien d'autre |
| Installation | `bun scripts/thermal.ts install [--host kerr-mini]`, par un agent ou par Sam | **une fois, par Sam** : `sudo sh ~/.local/share/kerr-thermal/install-root.sh` |
| Ce qu'elle donne | pression thermique de l'OS (notifyd), `thermalState`, horloge GPU, activité GPU (fréquence × occupation), températures CPU/GPU, puissances, mémoire, compteurs du pilote GPU, limites CPU | en plus : temps d'activité réel du GPU, histogramme de ses fréquences, puissance GPU selon powermetrics, état demandé par le logiciel |
| Fichiers | `~/.local/state/kerr-thermal/latest.json`, `history.jsonl` (8 Mio × 3, ~2 h à 5 s) | `/var/run/kerr-thermal/powermetrics.txt` (0644, un échantillon toutes les 5 s) |

**Sans root, l'essentiel est là.** La pression thermique (`Nominal/Moderate/Heavy/Trapping/Sleeping`) est celle que publie
le système : `notifyutil -g com.apple.system.thermalpressurelevel`, la même valeur `OSThermalPressureLevel` que
powermetrics affiche, lisible par tout utilisateur. macmon donne l'horloge et la puissance du GPU sans root. Seul
powermetrics exige root, et il n'apporte que des détails (le temps d'activité réel, l'histogramme des fréquences).

**Pourquoi un démon root plutôt que sudo** : l'outil d'origine relance `sudo -n powermetrics` à chaque mesure, depuis un
terminal où Sam s'est authentifié. Le ticket sudo expire, et un LaunchAgent ou un e2e n'a pas de terminal. Le démon tourne
en root et ne fait qu'une chose : `powermetrics -n 1` en boucle, écrit de façon atomique dans un fichier lisible par tous.
Il n'y a ni règle sudoers ni mot de passe conservé, et ni bun ni le code du dépôt ne tournent en root. Le script exécuté
est une copie que `install-root.sh` place sous `root:wheel` dans `/Library/PrivilegedHelperTools/` : l'utilisateur ne
peut pas la modifier. L'agent lit ce fichier s'il a moins de 15 s ; sinon, il remplit les champs powermetrics à `null`,
avec la raison.

## Installer

Ce Mac (fait le 2026-11-02, moitié utilisateur) :

```sh
bun scripts/thermal.ts install            # construit tools/mac-thermal en un seul fichier → ~/.local/share/kerr-thermal/, charge l'agent
sudo sh ~/.local/share/kerr-thermal/install-root.sh     # Sam, une fois : le démon powermetrics
```

kerr-mini (fait le 2026-11-02, moitié utilisateur ; macmon 0.8.2 installé par Homebrew) :

```sh
bun scripts/thermal.ts install --host kerr-mini         # installe macmon par Homebrew s'il manque, copie, charge l'agent
ssh -t kerr-mini sudo sh ~/.local/share/kerr-thermal/install-root.sh    # Sam, une fois
```

Après un changement dans `tools/mac-thermal/`, relancer `install` (sur chaque Mac) ; la moitié root ne change que si
`powermetrics-feed.sh` change. Pour retirer : `bun scripts/thermal.ts uninstall [--host h]` et
`sudo sh ~/.local/share/kerr-thermal/install-root.sh --uninstall`. Le PC Windows n'a pas ce service : l'outil lit
les capteurs d'Apple Silicon.

## Ce que ça coûte

La commande `monitor` d'origine lance un macmon par mesure, soit ~2,2 s de CPU à chaque fois (mise en place d'IOReport),
plus osascript (0,14 s). Le service garde un seul macmon en flux continu (~20 ms par échantillon une fois lancé) et lit
`thermalState` dans son propre processus (FFI vers `NSProcessInfo`, 0,7 ms). Mesuré sur ce Mac : **~0,36 s de CPU en 30 s**
pour bun et macmon ensemble, soit ~1 % d'un cœur, en `ProcessType Background` (cœurs E, priorité basse). Cette charge ne
gêne pas une mesure GPU.

Le démon root suit la même règle. Sa première version relançait `powermetrics -n 1` toutes les 5 s, et chaque lancement
coûtait 2 à 4,5 s de CPU (mesuré le 2 novembre sur les deux Mac), soit un tiers d'un cœur en continu. Il garde maintenant
un seul powermetrics en flux continu (`-n -1 -b 1`). awk découpe ce flux et publie chaque échantillon dès sa dernière
ligne (`GPU Power:` de la section GPU). Un échantillon coupé par la fin du flux est jeté, et le précédent reste en place.

## Pour les e2e et les scripts

`scripts/lib/thermal.ts` lit les fichiers de l'agent, sans lancer de processus. Il ne lève jamais d'erreur et rend `null`
quand le service est absent :

```ts
import { thermalLine, thermalNow, thermalWarning, thermalWindow } from "../scripts/lib/thermal";
const b = thermalNow();                 // le dernier échantillon (null : pas de service, ou plus vieux que 30 s)
thermalWarning(b);                      // « thermal pressure Heavy — … » ou null
thermalWindow(t0, t1);                  // entre deux instants : nombre d'échantillons par pression, horloge GPU min/médiane/max, températures max
```

- **Chaque e2e** : `summary.json` de chaque test (`tests/e2e/lib/telemetry.ts`) porte `thermal`, la fenêtre du test.
  Sur kerr-mini, il s'agit de la chaleur de kerr-mini, puisque le test y tourne.
- **`bench.ts`, `trace-ab.ts`** : une ligne au début et une à la fin ; `machineThermal` dans `report.json`, dans
  `docs/perf/bench-<label>.json` et dans le `--out` de trace-ab.
- **`lab-monitor.ts`** : une ligne `Heat:` par Mac.
- Pour un agent qui veut tout le détail : `bun ~/.local/share/kerr-thermal/mac-thermal.js latest
  ~/.local/state/kerr-thermal/latest.json --max-age 15 [--metrics 'gpu.*']` (le JSON complet de l'outil,
  `tools/mac-thermal/LLM-GUIDE.md`).

## Lire les chiffres

- `pressure` : `Nominal` est sain. `Moderate` et au-delà signalent que macOS réduit déjà ou va réduire les fréquences.
  `pressureSource` vaut `powermetrics` ou `os` (notifyd), qui donnent la même valeur.
- `gpuMHz / gpuMaxMHz` : une horloge basse sur un GPU **peu chargé** est normale (le DVFS suit la charge). Sous
  pleine charge, elle est suspecte. Sans le démon root, `gpuBusyPct` est l'activité de macmon, pondérée par la fréquence
  (« scaled ») ; avec le démon, c'est le temps d'activité réel (« active »).
- `gpuTempC` vaut `null` (« ? ») sur kerr-mini : c'est un M1, où macmon ne trouve pas de capteur de température GPU (il
  écrit 0, que l'outil rend indisponible). La température CPU, l'horloge et la puissance du GPU y sont bien mesurées.
- Les règles de l'outil restent valables : `null` veut dire indisponible, jamais zéro ; aucune conclusion de bridage
  matériel n'est tirée (`hardwareThrottling: "unknown"`).

## Tests

`tools/mac-thermal/tests/` : les 29 tests de l'outil d'origine et 6 nouveaux (`service.test.ts` : la pression de l'OS, les 0 °C de macmon,
le flux root, `thermalState` par FFI, le service sur un faux macmon). Depuis la racine du dépôt, sous `bun test`, un
sous-processus perd sa sortie standard (`tests/chrome-lock.test.ts` échoue de la même façon). Ces tests se lancent donc
depuis un autre dossier : `cd / && bun test ~/Documents/DEV/black-hole-gpu/tools/mac-thermal`.
