# tools/mac-thermal — le Mac Thermal Toolkit de Sam, repris

La chaleur et l'horloge GPU d'un Mac Apple Silicon (macmon, powermetrics, notifyd, pmset, compteurs du pilote GPU), en
JSON versionné pour un agent. **Le mode d'emploi côté labo est [docs/THERMAL.md](../../docs/THERMAL.md)** (le service,
son installation, sa lecture dans les e2e et les benchs).

- `mac-thermal.ts` : le point d'entrée (tableau de bord sans argument, CLI JSON avec une sous-commande).
- `src/` : l'outil. `README-toolkit.md` et `LLM-GUIDE.md` sont ses documentations d'origine (2026-10-30).
- `service/` : le service. `install-agent.sh` installe la moitié utilisateur (LaunchAgent, sans root) ;
  `install-root.sh` et `powermetrics-feed.sh` installent la moitié root (LaunchDaemon : powermetrics seul).
  `bun scripts/thermal.ts install [--host kerr-mini]` les copie avec l'outil empaqueté en un seul fichier.

Ce qui a changé par rapport à l'original (`~/Documents/Codex/2026-10-29/co/outputs/mac-thermal-toolkit`) :

1. **La commande `service`** (`src/service.ts`) : un seul macmon en flux continu au lieu d'un macmon lancé à chaque
   mesure (~2,2 s de CPU par lancement), `thermalState` lu par FFI au lieu d'osascript. Les instantanés, `latest.json`
   et le journal gardent le même format que `monitor`.
2. **La pression thermique sans root** : `notifyutil -g com.apple.system.thermalpressurelevel`, la valeur
   `OSThermalPressureLevel` de macOS (0 Nominal … 4 Sleeping, `<libkern/OSThermalNotification.h>`). Elle sert quand
   powermetrics n'a pas tourné ; `thermal.pressureSource` vaut `"powermetrics"` ou `"os"`. Ce champ est ajouté au schéma
   en optionnel, et les anciens journaux restent lisibles.
3. **powermetrics lu depuis le flux root** (`/var/run/kerr-thermal/powermetrics.txt`, `MAC_THERMAL_POWER_FEED`) au
   lieu de `sudo -n`, quand ce flux a moins de 15 s ; `doctor` affiche `powermetrics.feed`.
4. `collect()` est découpé en deux (`assemble()`), pour que le service réutilise l'assemblage des sources.

Tests (34) : `cd / && bun test ~/Documents/DEV/black-hole-gpu/tools/mac-thermal`, à lancer depuis un autre dossier que
la racine du dépôt (voir docs/THERMAL.md, § Tests). `zod` est une dépendance de développement du dépôt.
