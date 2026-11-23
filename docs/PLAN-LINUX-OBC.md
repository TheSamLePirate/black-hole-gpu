# PLAN-LINUX-OBC : Ordinateur de bord Linux embarqué (OBC) AAA

*Spécification et plan d'architecture validés et mis à jour le 22 novembre 2026 (confrontés à Unkernel `v0.2.0-261121-e69adda` et à l'architecture réelle du dépôt).*

---

## État et objet du document

| Champ | Valeur |
|---|---|
| **Statut** | **Implémenté et vérifié en E2E WebGPU (Lots OBC-0 à OBC-6 livrés le 22 novembre 2026)** |
| **Architecture cible** | Noyau Linux 7.x natif WebAssembly (`unkernel` `v0.2.0`) + émulateur CPU `aarch64` (`kwemu` + JIT Wasm) + Alpine Linux 3.24 (`alpine.erofs`, 4,05 Mo) |
| **Périmètre** | Vaisseaux (*Ranger*, *Lander*, *Endurance*), Avions (*F-35B/C*, *A320* — MCDU, Lower ECAM & Tablette), Console HUD In-Game (`xterm.js` + `/dev/fb0`), Console équipage déportée `crew/`, `__bh.obc`, TARS |
| **Documents liés** | [BH-API.md](BH-API.md), [COCKPIT.md](COCKPIT.md), [CREW.md](CREW.md), [HOTAS.md](HOTAS.md), [TARS.md](TARS.md), [src/input/keymap.ts](../src/input/keymap.ts), [VOL-AVIONS.md](VOL-AVIONS.md), [VOL-VAISSEAUX.md](VOL-VAISSEAUX.md) |
| **Objectif** | Fournir un véritable ordinateur de bord Linux embarqué (`aarch64`, Alpine 3.24, Python/Node/C/Shell), démarré à la demande dans un Web Worker dédié (0 ms et 0 Mo au boot du simulateur), connecté en temps réel à la physique WGS84/Kerr via 9p (`/obc`) et `AF_VSOCK` (port 4747), affichable simultanément dans les cockpits 3D, en console HUD et sur la console équipage `crew/`. |

---

## 1. Vision et principes directeurs AAA

1. **Performance garantie 60 FPS et coût nul hors utilisation :**
   - **Boot paresseux (on-demand) :** Tant que le joueur n'ouvre pas la console OBC, ne sélectionne pas un onglet `OBC` ou n'appelle pas `__bh.obc.boot()` / TARS, aucun octet de `unkernel.wasm` ni d'`alpine.erofs` n'est téléchargé et aucun Worker n'est créé.
   - **Isolation Web Worker :** `createKernel({ worker: true })` exécute le noyau Linux, le JIT `kwemu`, le réseau Wisp et le disque IndexedDB dans un Web Worker dédié, **sans** exiger `COOP/COEP` (compatible avec les tuiles cross-origin IGN/OSM/Esri ; `SharedArrayBuffer` est utilisé automatiquement si disponible).
   - **Rendu cockpit dirty-checked (< 0,3 ms CPU/frame) :** Le canvas OBC n'est redessiné que lorsqu'une nouvelle frame `/dev/fb0` ou de nouveaux caractères terminal arrivent (cadence bornée à 15–30 Hz).
2. **Un vrai Linux `aarch64` complet :**
   - `unkernel` (`v0.2.0`) compile un noyau Linux 7.x avec vraie MMU (`fork`, `mmap`, `overlayfs`, `ext4`, `9p`, `AF_VSOCK`, `TCP/IP`, `/dev/fb0`) directement en WebAssembly, exécutant des binaires ARM64 (`aarch64`) non modifiés d'Alpine 3.24.
   - Démarrage en ~0,3–0,8 s dans le navigateur, ~48–256 Mo de RAM invité, disque `/data` persistant en IndexedDB pour `/home/pilot/` et les paquets `apk` (`python3`, `nodejs`, `sqlite`, `gcc`, etc.).
3. **Interconnexion totale et typée avec la physique (`__bh` & WGS84/Kerr) :**
   - **Montage 9p hôte (`/obc`) :** fichiers virtuels temps réel (`/obc/telemetry.json`, `/obc/tau` + lien symbolique `/dev/tau`, `/obc/cmd`, `/obc/status.json`, `/obc/scripts/`, `/obc/lib/`).
   - **Bus `AF_VSOCK` (port `4747`) :** flux bidirectionnel JSONL/RPC basse latence (20–50 Hz) pour les bibliothèques `obc` (Python / Node.js) et les scripts de pilotage automatique.
   - **Validation stricte :** toute commande issue du Linux passe par un validateur borné (`src/obc/protocol.ts`) avant d'atteindre les contrôleurs du simulateur.
4. **Multi-Head Display synchrone & Parité TARS :**
   - Mêmes données et même instance Linux sur : cockpits 3D (*Ranger/Lander/Endurance*, *F-35 PCD*, *A320 MCDU + LECAM + Tablette*), console HUD in-game, console équipage `crew/`, API `__bh.obc` et outils TARS.

---

## 2. Architecture système et flux de données

```
+-----------------------------------------------------------------------------------------+
|                                     NAVIGATEUR                                          |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  |                            MAIN THREAD (Simulateur WebGPU)                        |  |
|  |  * WebGPU Renderer + Physique WGS84/Kerr (__bh, Fleet, Camera, Sim, Lagrange)     |  |
|  |  * ObcRuntime + ObcBridge (src/obc/):                                             |  |
|  |      - 9p Host Mount (/obc/telemetry.json, /obc/tau, /obc/cmd, /obc/scripts, lib) |  |
|  |      - AF_VSOCK Server (port 4747, JSONL RPC 20-50 Hz)                            |  |
|  |      - TermBuffer ANSI/VT100 + FbRenderer (/dev/fb0 RGBA ou miroir terminal)      |  |
|  |  * Surfaces : CockpitScreens (OBC), F-35 PCD (OBC), A320 (MCDU/LECAM/Tablette),   |  |
|  |               Console HUD (xterm.js + Sixel/IIP + FB0), Crew (crew-cmd/BC), TARS  |  |
|  +-----------------------------------------^-----------------------------------------+  |
|                                            | postMessage / Transferables (ou SAB)       |
|  +-----------------------------------------v-----------------------------------------+  |
|  |                        WEB WORKER (Unkernel WorkerKernel)                         |  |
|  |  * unkernel.wasm (Linux 7.x + kwemu aarch64 JIT) + alpine.erofs + IndexedDB /data |  |
|  |  * /dev/fb0 (512x512 XRGB8888) | /obc (9p) | AF_VSOCK:4747 | /dev/tau -> /obc/tau |  |
|  +-----------------------------------------^-----------------------------------------+  |
+--------------------------------------------|--------------------------------------------+
                                             | WebSocket Wisp v1
                                             v
                    +-------------------------------------------------+
                    | Dev local : /__wisp (server/wisp-relay.ts)      |
                    | Prod : Serveur Portainer Wisp (wss://...)       |
                    +------------------------+------------------------+
                                             v
                                 Internet réel / LAN
```

---

## 3. Les surfaces d'affichage (Multi-Head)

### 3.1 Écrans physiques des cockpits 3D & Tablette
Chaque surface bascule automatiquement entre **le framebuffer `/dev/fb0` (pixels purs 32 bpp)** lorsqu'une application graphique l'ouvre et **un miroir haute netteté du terminal** stylisé à la palette native de l'appareil dans le cas contraire :

* **Vaisseaux (*Ranger*, *Lander*, *Endurance* — `src/ui/cockpitscreens.ts`) :**
  Onglet tactile **`OBC`** ajouté dans la barre d'onglets (`7×2`) de chaque écran 3D (palette cyan *Interstellar* `#62e6ff`). Cliquer sur `OBC` démarre automatiquement le noyau si éteint.
* **Chasseur *F-35B / F-35C* (`src/f35/pcd.ts`) :**
  Nouveau portail **`OBC`** sélectionnable sur n'importe lequel des 4 portails du PCD (mode split ou pleine moitié gauche/droite), avec touches tactiles rapides (`BOOT`, `ORB`, `ILS`, `DIAG`, `FB0`, `TERM`).
* **Airbus *A320* (`src/a320/mcdu/`, `src/a320/du/sd.ts`, `src/ui/a320page.ts`) :**
  * **MCDU (`MCDU MENU` → `<OBC LINK`) :** page interactive pilotable au clavier physique du MCDU (état OBC, $d\tau/dt$, dernières lignes terminal, lancement de scripts via LSK, envoi du scratchpad comme commande Linux).
  * **Lower ECAM (`LECAM` / SD) :** page graphique **`OBC`** sélectionnable affichant `/dev/fb0` ou le terminal stylisé Airbus directement sur l'écran 3D central inférieur.
  * **Tablette A320 (`src/ui/a320page.ts`) :** section dédiée **`OBC`** (démarrage/arrêt, ouverture console, bascule écran `LECAM`, lancement des outils avioniques, état télémétrique).

### 3.2 Console HUD In-Game (Overlay rétractable)
* **Raccourcis clavier Mac sans conflit** (vérifiés dans `src/input/keymap.ts`, où `§`/`IntlBackslash`, `\` seul et `²` seul sont déjà assignés au vol) :
  * **`Ctrl + \`** (`Control + Backslash`) — raccourci universel QWERTY / terminal.
  * **`Ctrl + ²` / ``Ctrl + ` ``** (`Control + Backquote`) — variante ergonomique sur Mac ISO AZERTY.
  * **`F11`** — touche fonction dédiée libre dans le jeu.
  * **Bouton `OBC`** dans la barre supérieure du jeu.
* **Fonctionnalités :** terminal `@xterm/xterm` 6.0 (24-bit TrueColor, `@xterm/addon-fit`, `@xterm/addon-image` pour Sixel/IIP), vue commutable **`Terminal | /dev/fb0 | Split`**, lanceur rapide de scripts (`Diag`, `Orbite`, `Rentrée`, `ILS`, `Solaire`, `FDR`, `Démo FB0`), boutons 1-clic **`Installer Python`** / **`Installer Node`**, réglage URL Wisp en direct, isolation totale du clavier pendant la saisie.

### 3.3 Console Équipage déportée (`crew/`)
* Nouvel onglet **`OBC`** dans `src/crew/` (`src/crew/draw/obc.ts`), **sans embarquer `xterm.js`** afin de respecter strictement le plafond de bundle de `tests/crew.test.ts` (`< 375 Ko`).
* Affiche l'état OBC, $d\tau/dt$, les lignes du terminal en direct et permet d'envoyer des commandes (`obc.boot`, `obc.exec`, `obc.script`, `obc.input`) via `crew-cmd` (salle réseau) ou `BroadcastChannel("kerr-obc")` (second onglet local).

---

## 4. Capacités graphiques, suite avionique & bibliothèque `obc`

### 4.1 Fonctionnement 100 % hors-ligne dès le 1er boot + Python/Node
L'image `alpine.erofs` (4,05 Mo) est servie localement (`/obc/alpine.erofs`) et reste sous la limite binaire de 8 Mo/fichier (`scripts/check-repo-size.ts`).
* **Suite immédiatement exécutable hors-ligne dès le premier boot** (montée en lecture sur `/obc/scripts/`, ajoutée au `PATH`) :
  * `obc-diag` — tableau de bord avionique, WGS84, orbite, dilatation Kerr $d\tau/dt$ et état système (ANSI TrueColor).
  * `obc-orbit` — calcul des éléments orbitaux ($a, e, P_e, A_p, T$), transfert de Hohmann et vue polaire (TUI immédiat hors-ligne + tracé `/dev/fb0` haute résolution).
  * `obc-reentry` — couloir de rentrée atmosphérique, pression dynamique $q$, Mach, gradient thermique.
  * `obc-ils` — alignement Localizer / plan de descente 3° Glide Slope sur les pistes du simulateur.
  * `obc-solar` — synoptique du système solaire / Gargantua / points de Lagrange et JWST.
  * `obc-fdr` — boîte noire 20 Hz enregistrant dans `/home/pilot/fdr.jsonl` (et SQLite si `python3` présent) + résumé statistique post-vol.
  * `obc-fb-demo` — démonstrateur graphique natif `/dev/fb0` (XRGB8888 512×512 : radar orbital, horizon artificiel, télémétrie) fonctionnant même sans Python grâce à un générateur POSIX/awk, et enrichi dès que Python est installé.
  * `obc-install` — installation 1-clic de `python3`, `nodejs`, `py3-pillow`, `sqlite` via `apk` (persistés sur le disque IndexedDB `/data`).
* **Bibliothèques standard `obc` pré-montées (`/obc/lib/obc.py` et `/obc/lib/obc.mjs`) :**
  * `AvionicsBus` (lecture `/obc/telemetry.json` ou streaming `AF_VSOCK:4747`, méthodes `read()`, `tau()`, `wait_tick()`, `set_throttle()`, `set_stick()`, `set_autopilot()`, `set_hold()`, `set_gear()`, `set_flaps()`, `say()`).
  * `Framebuffer` (dessin 32 bpp XRGB8888 directement dans `/dev/fb0` sans dépendance externe : pixels, lignes, cercles, ellipses orbitales, grille, texte bitmap 5×7).

---

## 5. Dilatation temporelle relativiste & horloge de simulation

* `/obc/tau` (et lien symbolique `/dev/tau` créé au boot) expose en temps réel : `dtau_dt` ($d\tau/dt$), `proper_time_s`, `sim_time_s`, `warp`, `frozen`, `body`.
* Lorsque le simulateur est en pause ou gelé (`Space` / `__bh.freeze(true)`), le shell Linux reste interactif pour éditer ou inspecter des scripts, tandis que `state.frozen = true`, `sim_dt = 0` et `bus.wait_tick()` attendent le prochain pas de simulation (avec suspension complète optionnelle via `__bh.obc.suspend()`).

---

## 6. Réseau Wisp & persistance hybride

* **Développement local (`server/wisp-relay.ts`) :** relais Wisp v1 intégré à `server.ts` sur `/__wisp` (actif en dev uniquement, protection `foreignOrigin(req)`, quotas de connexions/flux). `apk add python3` et `curl` fonctionnent immédiatement sans configuration.
* **Production / Portainer :** URL Wisp personnalisable dans les réglages et dans la barre de la console OBC (sauvegardée via `src/util/storage.ts`), ex. `wss://wisp.domaine.fr/`.
* **Persistance hybride :**
  * `/home/pilot/` persisté localement dans IndexedDB via le disque `/data` d'Unkernel.
  * `scripts/obc/` du dépôt Git monté en direct sur `/obc/scripts/` (éditable depuis l'IDE sur Mac et exécutable immédiatement dans le cockpit).

---

## 7. API `__bh.obc`, TARS et découpage des lots

* **`__bh.obc` (`src/automation.ts`, documenté dans `docs/BH-API.md`) :** `status()`, `boot()`, `stop()`, `reboot()`, `suspend()`, `resume()`, `resetDataDisk()`, `getConfig()`, `setConfig(patch)`, `exec(cmd, timeoutMs?)`, `write(text)`, `readScreen()`, `telemetry()`, `openConsole()`, `closeConsole()`, `toggleConsole()`, `runScript(name)`, `setWispUrl(url)`, `testWisp(url?)`, `listFiles(dir?)`, `readGuestFile(path)`, `writeGuestFile(path, content)`, `captureFbDataUrl()`, `scripts()`.
* **TARS (`src/ai/game-tools.ts`) :** outil unifié `obc` (`status`, `boot`, `stop`, `reboot`, `suspend`, `resume`, `open`, `close`, `script`, `exec`, `screen`, `test_wisp`, `config`) + écrans `cockpit_obc` / `obc_console` via `show_screen`.
* **Lots de réalisation (tous livrés & vérifiés en E2E WebGPU) :**
  * **Lot OBC-0** ✅ : Socle Unkernel `v0.2.0` (Web Worker, `alpine.erofs`, routes `server.ts`, `build-pages.ts`, relais Wisp dev `server/wisp-relay.ts`).
  * **Lot OBC-1** ✅ : Pont I/O 9p atomique (`/obc`) + `AF_VSOCK:4747` + validateur `protocol.ts` + `TermBuffer` + `FbRenderer`.
  * **Lot OBC-2** ✅ : Intégration Cockpits 3D (*Ranger/Lander/Endurance* `OBC`, *F-35* PCD `OBC`, *A320* MCDU `OBC LINK`, Lower ECAM `obcPage` et Tablette A320).
  * **Lot OBC-3** ✅ : Console HUD In-Game (`xterm.js` + `/dev/fb0` + raccourcis Mac `Ctrl+\`, `Ctrl+²`, `F11` + barre supérieure).
  * **Lot OBC-4** ✅ : Intégration Console équipage `crew/` (`< 375 Ko`, FR/EN, `BroadcastChannel` + relais distant `InstrumentSnapshot.obc` & `cfg.obc`).
  * **Lot OBC-5** ✅ : Suite logicielle avionique `scripts/obc/` (outils hors-ligne + SDK Python/Node `obc`).
  * **Lot OBC-6** ✅ : `__bh.obc`, outil TARS `obc`, documentation (`BH-API.md`, `E2E-CATALOGUE.md`, `progress-to-destination.md`), tests unitaires et E2E headed WebGPU.
  * **Lot OBC-7** ✅ : Graphismes avioniques AAA (`fb-renderer.ts` 4 thèmes `interstellar`/`f35`/`a320`/`amber`, vignettage phosphore radial, scanlines 4 px, pied télémétrie, badge `FB0 <Hz>`, rendu planétaire/orbital `obc-fb-demo`, primitives `obc.py` et mode `--fb` sur `obc-ils` / `obc-reentry`).
  * **Lot OBC-8** ✅ : Relais multi-machine `crew/` (`InstrumentSnapshot.obc` borné + `cfg.obc` + `crew/views.ts` / `crew/main.ts`, budget `< 375 Ko` préservé).
  * **Lot OBC-9** ✅ : Console HUD complète (tiroir `Options` RAM/FB0/JIT/Persist/Reset/Theme/CRT/Audio/Clock/Wisp + testeur live `Test Wisp`, tiroir `Editor` `/home/pilot/*`, `Suspend`/`Resume`, export `PNG`, pointeur/molette `evdev`).
  * **Lot OBC-10** ✅ : Interactivité 3D multi-cockpits (boutons tactiles 3D Ranger, 5 touches + portail large F-35B PCD, Lower ECAM + MCDU `OBC LINK` A320).
  * **Lot OBC-11** ✅ : Vérification complète (`tsc`, `biome`, WGSL, `BH-API`, `build:pages`, `check-repo-size`, unitaires + E2E headed 4/4, 41 assertions, 61,3 → 60,6 fps, 5 captures archivées dans `docs/progress/linux-obc/`).
  * **Lot OBC-12** ✅ : Suite Python 3.14 & Node.js v24 (`obc-fuel`, `obc-nav`, `obc-kerr`, `obc-auto`, `obc-top`, `obc-mission-tui`, `obc-fmc-tui`, `obc-pfd-fb`, `obc-radar-fb`, `obc-kerr-fb`), optimisations `/dev/fb0` zéro-alloc + relais Wisp production Portainer (`wss://code.samlepirate.org/`).
  * **Lot OBC-13** ✅ : Pont RPC universel `__bh` & 73 outils TARS 100 % CSP-safe (`src/obc/bh-rpc.ts`, 9p atomique synchrone + VSOCK), CLI/TUI universel `bh` (piping `stdin`/`stdout`) & `bh-tui`, `obc-airports`, `obc-ils-fb` (27 Hz), suite complète **F-35** (`obc-f35`, `obc-f35-tui`, `obc-f35-fb` 29 Hz + PCD 3D) et **A320** (`obc-a320`, miroir MCDU/ECAM, `obc-a320-tui`, `obc-a320-fb` 24 Hz + Lower ECAM 3D) — validé en E2E WebGPU **7/7 tests, 99 assertions, 62,1 fps actifs**, 15 captures dans `docs/progress/linux-obc/`.
  * **Lot OBC-14** ✅ : Routage clavier capture-phase vers TUIs & `/dev/fb0` (vrai TTY sans heredoc + `RawKeys`/`startRawKeys`), conversion exacte `radAttitudeToDeg` (radians→degrés) + refonte AAA `obc-pfd-fb` calquée sur `src/a320/du/pfd.ts` (horizon incliné 1:1 vérifié sur `fb0-pfd-banked.png`), et `pip 26.1.2` + `npm 11.12.1` installés d'office (`512 MiB` RAM, dépôt `v3.24/community`) — E2E WebGPU **7/7, 106 assertions, 58,8 → 58,8 fps**.
  * **Lot OBC-15** ✅ : Double distribution **Alpine 3.24 + Debian 13 (Trixie)** (sélecteur rapide topbar + Options + `__bh.obc.switchDistro` + TARS `obc`, `debian.erofs` résolu à la demande via `fetchDistro("debian")` en dev & Pages CI hors Git), paliers RAM **512 MiB · 1 GiB · 2 GiB (défaut) · 4 GiB** (`ram4gAllocatedMiB = 4096` vérifié en Chrome WebGPU, repli dégradé automatique), installateur universel multi-distro `obc-install` streamé en direct (`vm.spawn`) couvrant les **7 outils sur Alpine ET Debian** (`python3`, `pip`, `node`, `npm`, `bun`, `pi` `@earendil-works/pi-coding-agent`, `claude` Claude Code), durcissement Wisp (`end()` + `drain()` + découpage 32 KiB) et compatibilité `bash` Debian (`runScript` + détection portable des binaires) — E2E WebGPU **8/8, 134 assertions, 60,2 → 60,6 fps**.
  * **Lot OBC-16** ✅ : Suite native **Rust + Ratatui + `/dev/fb0`** (`rust/obc-suite/`, workspace Cargo 4 crates `obc-core` / `obc-fb` / `obc-tui` / `obc-rs`, Edition 2024, MSRV 1.85, Clippy pedantic `-D warnings` zéro warning, 8/8 tests unitaires + snapshots `TestBackend`), binaire multi-appel statique `aarch64-unknown-linux-musl` (`assets/obc/obc-rs`, 1,0 Mo LTO fat + stripped) monté à `/obc/bin/obc-rs` dès le 1ᵉʳ boot (0 dépendance Python/Node, servi par `server.ts` et `_site/obc/obc-rs`). Les 6 TUIs (`bh-tui`, `obc-top`, `obc-mission-tui`, `obc-fmc-tui`, `obc-f35-tui`, `obc-a320-tui`) tournent sur **Ratatui 0.29 + Crossterm 0.28** avec repli `Viewport::Fixed(100×26)` quand `TIOCGWINSZ=(0,0)` sur le port série Unkernel, et les 6 programmes graphiques `/dev/fb0` (`obc-pfd-fb`, `obc-f35-fb`, `obc-a320-fb`, `obc-ils-fb`, `obc-radar-fb`, `obc-kerr-fb`) utilisent un framebuffer XRGB8888 zéro-allocation `FBIOGET_VSCREENINFO` + `libc::mmap` (`20–30 Hz`, horizon artificiel PFD 1:1 vérifié à `-29,7°` / `-7,5°` face au HUD 3D F-35, rendu live sur PCD F-35 & LECAM A320). Chaîne **Rust (`rustc` + `cargo`)** ajoutée à `obc-install rust`, bouton HUD `+Rust`, `obc-diag` (`obc-rs=native` + `rust=...`) et outil TARS `obc` (vérifié `rustc 1.96.1` / `cargo 1.96.1` sur Alpine 3.24 + `obc-rs` sur Debian 13). Correctif CI `tests/e2e-waits.test.ts` (`waitOptional` en fenêtres actives de 60 s).
  * **Lot OBC-17** ✅ : Base de connaissances & **5 Agent Skills AAA** auto-provisionnés dans `/home/pilot/` dès le 1ᵉʳ boot (`scripts/obc/pilot-kit/` → `/obc/pilot-kit/` → `/home/pilot/` sur Alpine & Debian, servis par `server.ts` et `_site/obc/pilot-kit/`) pour **Claude Code (`claude`)** et **Pi (`pi`)** : `CLAUDE.md`, `AGENTS.md`, `README.md`, 4 guides techniques complets (`docs/OBC-ARCHITECTURE.md`, `docs/BH-API-GUIDE.md`, `docs/TTY-AND-FB0.md`, `docs/UNKERNEL-LINUX.md`) et 5 skills synchronisés dans `.claude/skills/`, `.pi/skills/` et `.agents/skills/` (`obc-build-fb-app`, `obc-build-tui-app`, `obc-control-sim`, `obc-manage-linux`, `obc-rust-dev`). Vérifié en tests unitaires et E2E WebGPU headed (`kit=docs+5skills`).
  * **Lot OBC-18** ✅ : **Gestionnaire complet de la machine Linux AAA** (`src/ui/obc-manager.ts`, 6 onglets : `Monitor`, `System & Unkernel`, `Disk & Snapshots`, `Network & Wisp`, `Toolchains`, `Game & Logs`) + **panneau `linux-obc` déplaçable (drag barre titre, double-clic maximiser) et redimensionnable sur 8 bords/coins** avec persistance géométrique (`kerr.obc.win`), boutons Dock Reset (`⌖`) / Maximiser (`⛶`) et `SIGWINCH` live (`vm.resize(cols, rows)`). Expose toutes les options Unkernel (`cpus` 1/2/4 SMP + `webCpuBlocker`, `shm` `/dev/kwshm`, `profile` + `formatProfile`, `jit`, `fbWidth/fbHeight` jusqu'à 1024×768, `vm.stats()` temps réel à 1 Hz, `cmdline`, `memory64`, `crossOriginIsolated`), la gestion complète du disque persistant IndexedDB (`vm.sync()` Flush, quota navigateur + blocs `IdbStore`, export/import `/home/pilot` `.tar.gz`, sauvegarde/restauration snapshot binaire `.kwsnap`, Reset `/data`), les modes Wisp (`auto`/`prod`/`local`/`custom`/`off` + probe live + test HTTPS invité + `NetStats`), le moniteur de processus (`SIGTERM`/`SIGKILL`), le routage 1-clic vers les 3 cockpits 3D (Ranger/F-35/A320), la taille de police/opacité et la visionneuse de logs noyau. Exposé sur `__bh.obc`, TARS `obc`, et vérifié en tests unitaires + E2E WebGPU headed.
  * **Lot OBC-19** ✅ : **Isolation souris terminal + synchronisation live des dimensions TTY (`/obc/tty_size`) & reflow dynamique Ratatui** : garde souris 4 couches (`src/obc/term-mouse.ts`, `PROMPT_COMMAND` + `runScript` + `Reset TTY` Manager, commit `14663054`), fichier 9p taille fixe 16 o `/obc/tty_size`, `TermBuffer.resize(cols, rows)` synchronisé avec `xterm.js` (`FitAddon`) et `vm.resize(cols, rows)` (`SIGWINCH`), et reflow temps réel dans `obc-tui` (recalcul `Viewport::Fixed` sur changement `/obc/tty_size` et `Event::Resize` + pied de page 1 ligne sur les 6 TUIs Ratatui, `assets/obc/obc-rs` recompilé). Vérifié en E2E WebGPU headed en mode `TTY` et `Split` (`hud-bh-tui-split.png`, `hud-bh-tui.png`, `hud-tui-top.png`).
  * **Lot OBC-20** ✅ : **Centre de commande universel AAA `bh-tui`** (`rust/obc-suite/crates/obc-tui/src/bh_tui.rs`, `fuzzy.rs`, `obc-core/src/bus.rs`, `src/obc/bh-rpc.ts`) : indexation complète en 1 appel RPC (`op: "catalog"`, **601 fonctionnalités** : 79+ membres `__bh` imbriqués avec extraction automatique des noms de paramètres `fnParams` + 73 outils TARS avec schémas typés `paramSpecs` `enum`/`min`/`max`/`required` + 28 Actions rapides 1-clic), moteur **Fuzzy Search multi-jetons** (`/` inline ou `f`/`Ctrl+P` palette globale `FUZZY ALL`) avec score camelCase/frontières et surlignage ambre, **modales interactives d'exécution pour TOUT** (formulaire typé TARS avec sélecteur `←/→/Space` pour `enum`/`bool` + mode JSON brut `Ctrl+E`, appel direct de toute fonction `__bh`, éditeur de propriétés `op: "set"` avec auto-`refresh()`, barre Vim `:` `eval`/`tool`/`set` et historique ré-exécutable `5:LOG`). Vérifié en tests Rust (`11/11`, Clippy pedantic `-D warnings` = 0), unitaires TS (`20/20`) et E2E WebGPU headed (`hud-bh-tui-fuzzy.png`, `hud-bh-tui-modal.png`, `hud-bh-tui-result.png`, `hud-bh-tui-split.png`).
