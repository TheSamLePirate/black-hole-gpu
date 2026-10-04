# Les tests à distance — le Mac mini

Les suites e2e, les vols scriptés et les mesures prennent des minutes et occupent le GPU. Le **Mac mini**
du réseau (un M1, alias ssh `kerr-mini`) les fait pendant que ce Mac continue le travail.
`scripts/remote.ts` y envoie **l'arbre tel qu'il est ici** — les changements non commités et les fichiers
non suivis compris —, y lance la commande dans une copie à elle, en affiche le journal ici en direct, et
en rapporte ce qu'elle a écrit. Chrome s'y ouvre **en plein écran** : qui passe devant le mini voit qu'il
travaille, et on peut regarder le test en partage d'écran.

Le mini n'a pas besoin de droits d'écriture sur le dépôt : on ne lui demande pas de récupérer le code,
on le lui envoie.

---

## Démarrage rapide

```bash
# un fichier e2e
bun scripts/remote.ts run -- E2E=1 bun test tests/e2e/landing.e2e.test.ts --timeout 600000
# où en sont les jobs
bun scripts/remote.ts status
# regarder l'écran du mini
open vnc://Mac-mini-de-olivier.local
```

`bun run remote …` revient au même que `bun scripts/remote.ts …` (script de `package.json`).

**Piège** : `bun run e2e tests/e2e/x.e2e.test.ts` lance **toutes** les e2e (le filtre `tests/e2e` du
script s'ajoute au vôtre, ici comme sur le mini). Pour un seul fichier : `E2E=1 bun test <fichier>
--timeout 600000`.

---

## Les commandes

```
bun scripts/remote.ts run [--headless] [--cpu] [--hold <s>] [--name <n>] [--detach] -- <commande…>
bun scripts/remote.ts status
bun scripts/remote.ts logs <id> [-f]
bun scripts/remote.ts fetch <id>
bun scripts/remote.ts cancel <id>
bun scripts/remote.ts clean [--keep 10]
bun scripts/remote.ts sync
```

| | |
|---|---|
| `run -- <commande>` | envoie l'arbre, lance la commande sur le mini, affiche son journal, rapporte les résultats ; **finit avec le code de sortie de la commande** (`run … && …` s'enchaîne) |
| *(par défaut)* | Chrome en plein écran sur l'écran du mini ; **un job navigateur à la fois** (les autres attendent leur tour) |
| `--headless` | sans fenêtre |
| `--cpu` | job sans navigateur (`bun test`, `typecheck`) : tourne à côté des jobs navigateur, sans attendre |
| `--hold <s>` | chaque Chrome des e2e reste ouvert `<s>` secondes à sa fermeture — pour voir où le test a laissé l'app |
| `--name <n>` | le nom du job (sinon : celui du fichier de test, ou le premier mot de la commande) |
| `--detach` | rend la main tout de suite avec l'id du job ; `logs <id> -f` pour le suivre ensuite |
| `status` | tous les jobs : id, état (`queued` / `running` / `done`), code de sortie, durée, mode, commande |
| `logs <id>` | le journal ; `-f` le suit jusqu'à la fin, rapporte les résultats et rend le code du job |
| `fetch <id>` | rapporte les résultats d'un job (fait automatiquement à la fin d'un `run` ou d'un `logs -f`) |
| `cancel <id>` | arrête un job et ce qu'il a lancé (serveur, Chrome) |
| `clean --keep 10` | efface les anciens jobs sur le mini (jamais ceux en cours) |
| `sync` | envoie l'arbre sans rien lancer |

La commande est lancée par zsh dans la copie : `UPDATE=1 bun test …`, `a && b` s'écrivent comme dans un
terminal.

---

## Recettes

**Un fichier e2e** (~30 s à 1 min) :
```bash
bun scripts/remote.ts run -- E2E=1 bun test tests/e2e/title.e2e.test.ts --timeout 600000
```

**Toute la suite e2e** (~2 min 50 sur le mini, 59 tests) :
```bash
bun scripts/remote.ts run --name full-e2e -- E2E=1 bun test tests/e2e --timeout 600000
```

**Les tests unitaires et le typecheck, à côté** (sans attendre le GPU) :
```bash
bun scripts/remote.ts run --cpu -- bun test && bun run typecheck
```

**Plusieurs jobs d'un coup** — ils font la queue là-bas, un navigateur à la fois :
```bash
bun scripts/remote.ts run --detach -- E2E=1 bun test tests/e2e/landing.e2e.test.ts --timeout 600000
bun scripts/remote.ts run --detach -- E2E=1 bun test tests/e2e/golden.e2e.test.ts --timeout 600000
bun scripts/remote.ts status
bun scripts/remote.ts logs <id> -f
```

**Voir l'état final d'un test** (la fenêtre reste 20 s) :
```bash
bun scripts/remote.ts run --hold 20 -- E2E=1 bun test tests/e2e/landing.e2e.test.ts --timeout 600000
```

**Réenregistrer un golden** — il revient dans `remote-results/<id>/artifacts/`, **jamais appliqué tout
seul** :
```bash
bun scripts/remote.ts run -- UPDATE=1 E2E=1 bun test tests/e2e/golden.e2e.test.ts --timeout 600000
diff tests/e2e/golden/flights.json remote-results/<id>/artifacts/tests/e2e/golden/flights.json
```
(À comparer, puis à copier à la main si c'est voulu — et à dire : un golden d'une autre machine n'est pas
forcément celui d'ici.)

**Un vol réel, de l'orbite à la piste** (`scripts/live-entry.ts` : la boucle du jeu, l'autopilote de
rentrée, le journal toutes les 10 s, les erreurs de la page au moment où elles arrivent ; ~14 min) :
```bash
bun scripts/remote.ts run --name live-paris -- bun scripts/live-entry.ts --site Bourget --inc 52
bun scripts/remote.ts run --name live-edwards -- bun scripts/live-entry.ts --site Edwards --inc 40
```
`--inc` : l'inclinaison de l'orbite, au moins la latitude du site (Le Bourget 49° N, Edwards 35° N).
Il finit 0 arrêté sur la piste, 1 sinon (écrasé, hors piste, pas de désorbitation trouvée, plus de
`--max-min` minutes — 75 par défaut).

**Un script de diagnostic hors du dépôt** — pour instrumenter la page sans toucher au code : l'écrire dans
un dossier temporaire, le copier sur le mini, le lancer depuis la copie du job (ses imports par
`process.cwd()`) :
```bash
scp diag.ts kerr-mini:/tmp/kerr-diag.ts
bun scripts/remote.ts run --name diag -- bun /tmp/kerr-diag.ts
```
```ts
// diag.ts
const { App, stopServer } = await import(`${process.cwd()}/tests/e2e/lib/app.ts`);
const app = await App.boot({ hash: "scene=game:artemis" });
// … app.js(`…`) : envelopper une méthode, relever un état …
app.close();
stopServer();
```
(C'est ainsi qu'a été trouvée l'erreur E1 de `docs/ERRORS-TO-FIX.md`.)

**Les mesures** (`bench.ts`, `trace-ab.ts`, `gallery.ts`, `quality.ts`, `check-wgsl.ts`) restent en
headless quoi qu'on demande : la fenêtre ferait suivre ses images au rafraîchissement de l'écran. Un
chiffre mesuré sur le mini est celui d'un M1 (8 cœurs GPU) : il ne se compare qu'à un autre chiffre du
mini (un A/B fait là-bas des deux côtés), jamais à un chiffre d'ici.

---

## Lire ce qui s'affiche

```
remote: synced 993 files to kerr-mini (9,367 bytes sent, 0.4 s)        ← l'arbre envoyé
remote: kerr-mini:~/Documents/DEV/black-hole-gpu pulled — at 104d670 …  ← le clone du mini à jour
remote: 20261004-204850-landing started on kerr-mini, full screen       ← l'id du job, son mode
bun test v1.3.14 …                                                      ← le journal du job, en direct
remote: remote-results/20261004-204850-landing/ (log, meta.json)        ← les résultats rapportés
remote: 20261004-204850-landing ended, exit 0                           ← le code de sortie
```

Les résultats, dans `remote-results/<id>/` (ignoré par git, à vider soi-même) :
- `log` — tout ce que la commande a écrit ;
- `meta.json` — la commande, le mode, les heures de création, de départ et de fin, le code de sortie ;
- `artifacts/` — **chaque fichier que le job a écrit** dans sa copie, à son chemin (un golden, un
  `docs/perf/bench-*`, des captures). Rien n'est recopié dans l'arbre d'ici.

---

## Quelle version du code tourne ?

**Celle de cet arbre au moment du lancement**, octet pour octet : les fichiers suivis par git, modifiés ou
non, et les fichiers non suivis que `.gitignore` n'exclut pas. Vérifié le 2026-10-04 (993 fichiers, aucune
différence d'empreinte). Restent ici : ce que `.gitignore` exclut — les données brutes NASA
(`assets/nasaSolar`, `assets/dem`, `assets/etopo`, `assets/kernels`), les modèles bruts, `dist/`,
`node_modules/` (réinstallé là-bas depuis le `bun.lock` envoyé dès qu'il change).

- **Un instantané** : une modification faite ici *après* le lancement n'est pas dans le job en cours —
  le relancer.
- Le serveur du job est le sien, lancé sur sa copie, qui reconstruit les workers depuis `src/` : pas de
  bundle périmé possible.
- **Le clone du mini** (`~/Documents/DEV/black-hole-gpu`) est mis à jour depuis GitHub à chaque envoi
  (`fetch` puis avance rapide seulement) — mais les jobs ne tournent pas dessus.

Pour le vérifier soi-même :
```bash
bun scripts/remote.ts sync
git ls-files -co --exclude-standard -z | xargs -0 shasum | sort -k2 > /tmp/ici.sha
git ls-files -co --exclude-standard -z > /tmp/liste.bin && scp -q /tmp/liste.bin kerr-mini:/tmp/
ssh kerr-mini 'cd kerr-runner/base && xargs -0 shasum < /tmp/liste.bin | sort -k2' > /tmp/mini.sha
diff /tmp/ici.sha /tmp/mini.sha && echo identiques
```

---

## Regarder

Finder › Réseau › le mini › *Partager l'écran*, ou `open vnc://Mac-mini-de-olivier.local`.

- Chrome s'y ouvre en **plein écran** (mode kiosque : ni onglets ni barre d'adresse), un Chrome par groupe
  de tests — les fenêtres s'ouvrent et se ferment au fil des tests.
- La page garde la taille que le test lui donne (1440 × 900 par défaut) : **dans le coin haut gauche** de
  l'écran de 1920 × 1080, le reste vide — le test voit exactement ce qu'il verrait en headless.
- Un test qui calcule tout un vol en un seul appel à pas fixes (`landing`, `golden`, `rates`) **fige
  l'image** pendant le calcul, puis montre l'état final : `--hold` pour avoir le temps de le voir. Le vol
  réel (`live-entry.ts`), lui, se regarde de bout en bout.
- Les captures d'écran ne passent pas par ssh (`screencapture` : macOS donne l'écran aux applications, pas
  à sshd).

---

## Quand ça ne marche pas

| Ce qu'on voit | La cause | Que faire |
|---|---|---|
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | le mini a changé (réinstallé) — ou ce n'est pas lui | **Ne jamais contourner.** Sur le mini : `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` ; si l'empreinte est bien la sienne, ici : `ssh-keygen -R 192.168.1.106` |
| `Chrome did not start` / un test bloqué à son démarrage | le mini **n'a plus internet** : Chrome, même headless, se bloque alors au démarrage (le runner affiche un `WARNING`) | rétablir sa connexion (le mini est en Ethernet depuis le 2026-10-04) |
| `rsync failed 3 times` / erreurs ssh | le mini est hors réseau ou en veille | `ssh kerr-mini true` ; son adresse peut changer, l'alias passe par son nom (`Mac-mini-de-olivier.local`) |
| `no graphical session` | personne n'est connecté à l'écran du mini | ouvrir la session sur le mini, ou `--headless` |
| `WARNING — … not pulled` | le clone du mini a des modifications locales, ou pas de réseau | sans effet sur le test ; régler le clone du mini à l'occasion |
| `waits for the GPU (held by …)` | un autre job navigateur tourne (une autre session, peut-être) | attendre, ou `status` / `cancel <id>` |
| un test passe ici et échoue là-bas | le M1 est plus lent : un délai d'attente (`waitFor`) trop juste | le dire plutôt que d'allonger le délai sans le décider |
| `live-entry.ts` : la vitesse au sol semble énorme | la vitesse du statut du jeu se mesure par rapport au centre de la Terre (sa rotation : ~305 m/s à Paris) | le script juge l'arrêt par la position le long de la piste |

Un verrou GPU laissé par un job mort est repris tout seul. Un job ne meurt pas si la connexion ssh tombe :
`logs <id> -f` le retrouve.

---

## Comment c'est fait

- **L'envoi** : `git ls-files -co --exclude-standard` (~990 fichiers, ~420 Mo la première fois, puis ce qui
  a changé : moins d'une seconde) par rsync vers `~/kerr-runner/base/` sur le mini ; les fichiers disparus
  d'ici y sont effacés. 3 tentatives si le transfert est coupé.
- **La copie du job** : `~/kerr-runner/runs/<id>/`, un clone APFS de la base (instantané, gratuit) — un job
  qui écrit un fichier n'écrit que dans sa copie ; `node_modules` partagé (lien), `bun install
  --frozen-lockfile` quand `bun.lock` change.
- **Le job** : détaché sur le mini (il survit à la coupure ssh), sous `caffeinate` (le mini et son écran
  restent éveillés), dans son propre groupe de processus (`cancel` arrête aussi son serveur et ses Chrome).
- **Le verrou GPU** : `~/kerr-runner/gpu.lock`, un job navigateur à la fois — deux rendus sur un GPU se
  partagent ses images, et les mesures avec.
- **Le plein écran** : `E2E_HEADED=1` → `tests/e2e/lib/cdp.ts` lance Chrome en `--kiosk` (pas `--app=` :
  Chrome y ouvrait une seconde fenêtre ordinaire, celle que les tests pilotaient) et `--use-mock-keychain`
  (sinon une demande d'accès au trousseau bloque Chrome). `E2E_HOLD=<s>` : la pause à la fermeture.
  Ces deux variables marchent aussi ici, sans le mini.
- **Les fichiers** : `scripts/remote.ts` (ici), `scripts/remote-runner.ts` (là-bas, envoyé avec l'arbre),
  `.claude/skills/remote-e2e/SKILL.md` (pour Claude).

| Variable (ici) | Par défaut | |
|---|---|---|
| `KERR_REMOTE` | `kerr-mini` | l'alias ssh du Mac distant |
| `KERR_REMOTE_DIR` | `kerr-runner` | son dossier de travail, dans son dossier personnel |
| `KERR_REMOTE_CLONE` | `Documents/DEV/black-hole-gpu` | son clone, mis à jour à chaque envoi (vide : aucun) |

---

## Installer un Mac distant (une fois)

1. **Session à distance** activée (Réglages › Général › Partage), et la clé ssh de ce Mac dans son
   `~/.ssh/authorized_keys` (`ssh-copy-id utilisateur@machine`).
2. **bun, de la même version qu'ici** (`bun --version`) :
   `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"`.
3. **Google Chrome** dans `/Applications`.
4. **Une session ouverte sur son écran, jamais verrouillée** (le plein écran en a besoin) : ouverture de
   session automatique, économiseur et verrouillage coupés.
5. **Un câble réseau** de préférence : en Wi-Fi faible, les transferts se coupent et, sans internet,
   Chrome ne démarre plus.
6. **Ici, l'alias ssh** dans `~/.ssh/config` — le dépôt (public) ne nomme pas la machine :

   ```
   Host kerr-mini
     HostName <son-nom>.local
     User <utilisateur>
     HostKeyAlias <son-ip-de-l'époque>   # (si sa clé est connue sous une IP)
     ControlMaster auto
     ControlPath ~/.ssh/cm-%r@%h-%p
     ControlPersist 10m
     ServerAliveInterval 30
   ```

Puis, pour vérifier : `bun scripts/remote.ts run -- E2E=1 bun test tests/e2e/title.e2e.test.ts --timeout
600000` (~30 s ; la première fois, l'envoi de l'arbre et l'installation des dépendances en plus).

---

## Ménage

`bun scripts/remote.ts clean --keep 10` sur le mini ; `remote-results/` ici, à vider à la main.
