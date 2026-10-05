# Les tests sur iPad — l'app sur un vrai iPad, pilotée depuis le Mac où il est branché

`scripts/ipad.ts` pilote Safari sur un iPad par le WebDriver de Safari lui-même (`safaridriver`, norme
W3C), depuis le Mac auquel l'iPad est branché en USB — ici le Mac mini de [REMOTE-TESTS.md](REMOTE-TESTS.md).
Il passe donc par `scripts/remote.ts` comme les autres jobs à distance, et ses captures reviennent avec
eux. Un **vrai iPad** : son GPU, son Safari, sa mémoire, sa mise en page tactile — ce que le Chrome des
e2e ne montre pas.

---

## Démarrage rapide

```bash
# la session, WebGPU, le démarrage, Artemis en vol : images/s, erreurs, 2 captures (~1 min)
bun scripts/remote.ts run --cpu --name ipad-check -- bun scripts/ipad.ts check
# un retour complet en temps réel : orbite → autopilote de rentrée → Paris – Le Bourget, jusqu'à l'arrêt (~15 min)
# (--no-shots : sans captures — avec elles, Safari a lâché la page au début du vol plané 3 fois sur 5)
bun scripts/remote.ts run --cpu --name ipad-flight -- bun scripts/ipad.ts flight --site Bourget --no-shots
# les réglages de l'app, son niveau de rendu et l'écran, en JSON (à comparer avec Chrome)
bun scripts/remote.ts run --cpu --name ipad-settings -- bun scripts/ipad.ts settings
```

**`--cpu`** : c'est l'iPad qui dessine, pas le mini — le job n'attend pas le verrou GPU du mini (une e2e
Chrome peut y tourner en même temps). L'iPad n'accepte **qu'une session à la fois** : un second job iPad
attend le premier (le script redemande pendant 2 min, le temps que l'iPad lâche une session).

Les résultats : le journal défile ici ; les captures arrivent dans
`remote-results/<id du job>/artifacts/remote-results/ipad-<heure>-<commande>/`, numérotées et nommées par
phase (`01-orbit.png`, `05-glide.png`, `07-touchdown.png`, `09-stopped.png`…). Le code de sortie du job est
celui du script : 0 si `check` n'a vu aucune erreur de page, si `flight` s'est arrêté sur la piste.

---

## Les commandes

| | ce qu'elle fait | finit à 0 si |
|---|---|---|
| `check [--scene game:artemis]` | ouvre le site, vérifie `navigator.gpu` et le contexte sécurisé, attend l'app, charge la scène, attend que l'écran de chargement se lève, compte les images sur 5 s, lit le `perf()` de l'app | aucune erreur de page |
| `flight [--site Bourget] [--inc 52] [--max-min 60]` | la scène, le relief de la Terre chargé, une orbite de 400 km inclinée pour passer au-dessus du site (par défaut : sa latitude + 3°), l'autopilote de rentrée vers sa piste ; un relevé toutes les 10 s, chaque seconde sous 400 m, toutes les 2 s sur la piste ; une capture à chaque phase | arrêté sur la piste |
| `settings` | la scène, puis `__bh.settings` (ses valeurs simples), le niveau de rendu, l'écran — une ligne JSON | toujours |

Options communes : `--url <site>` (par défaut le site publié, `https://thesamlepirate.github.io/black-hole-gpu/`),
`--out <dossier>`, `--no-shots`. Les pistes : celles de `src/game/sites.ts` (Kennedy, Edwards, Kourou,
Baïkonour, Paris – Le Bourget, Tanegashima, Woomera, la plaine d'Edmunds).

Sur le Mac de l'iPad, à la main (sans copie ni rapatriement) : `bun scripts/ipad.ts check`.

---

## Quel code est testé ? Le site publié

WebGPU exige un **contexte sécurisé** : sur l'iPad, `http://192.168.x.x:3000` n'a pas de `navigator.gpu`.
D'où le site publié par défaut (HTTPS) — le code de `main` sur GitHub une fois son build Pages fini
(comparer `version.json` sur le site à `git rev-parse --short HEAD`). **Il bouge** : un push pendant une
série de vols change le code sous les vols suivants.

Pour tester l'arbre tel qu'il est ici, il faudrait que le serveur du mini parle HTTPS avec un certificat
auquel l'iPad fait confiance (`mkcert`, sa racine installée sur l'iPad en profil, `Bun.serve({ tls })`) —
pas encore en place.

---

## Installer (une fois)

1. **L'iPad branché en USB** au Mac, déverrouillé, « Faire confiance à cet ordinateur » accepté.
2. **Appairé pour le développement** — sur le Mac, `xcrun devicectl list devices` le montre ; si
   `safaridriver` répond *device is not paired* : `xcrun devicectl manage pair --device <son identifiant>`
   (accepter sur l'iPad).
3. **Automatisation à distance** — sur l'iPad : Réglages › Apps › Safari › Avancé › *Automatisation à distance*.
4. **Éveillé** — Réglages › Luminosité et affichage › Verrouillage automatique : *Jamais* pendant les tests
   (un iPad verrouillé coupe la session).
5. Sur le Mac, `safaridriver` vient avec Safari (`safaridriver --version`). Piloter le Safari du Mac
   demanderait aussi `safaridriver --enable` (mot de passe admin) — pas les sessions iOS.

Vérifier : `bun scripts/remote.ts run --cpu -- bun scripts/ipad.ts check` → `session on iPad de …`,
`frames: ~60 /s`.

---

## Les limites du WebDriver de Safari sur iOS

- **Une session à la fois**, et l'iPad garde une session finie une à deux minutes.
- **Pas de toucher sur l'iPad pendant le test** : un voile couvre la page ; la barre d'adresse est orange.
- **Un seul doigt** au plus : ni pincement ni geste à deux doigts. `ipad.ts` pilote l'app par son API de
  console (`__bh`), comme le font surtout les e2e Chrome.
- **Ni contrôle du réseau, ni flux de la console** : les requêtes CelesTrak et des tuiles de terrain
  partent (les e2e Chrome les bloquent) ; les erreurs de la page sont relevées par un crochet que
  `ipad.ts` pose une fois la scène levée (une erreur d'avant n'est pas vue).
- **Pas d'émulation de la taille d'écran** : l'écran de l'iPad lui-même — 1590 × 1106 px CSS en 2× en
  paysage (le mode bureau de Safari ; l'app voit quand même 5 points tactiles et prend sa mise en page tactile).

---

## Quand ça ne marche pas

| message | ce qui se passe | ce qu'on fait |
|---|---|---|
| *Some devices were found, but could not be used* (sans raison) | `safaridriver` vient de démarrer et n'a pas encore examiné l'iPad | rien : `ipad.ts` redemande quelques secondes |
| *device is not paired* | l'iPad n'est pas appairé pour le développement | `xcrun devicectl manage pair --device <id>` |
| *Remote Automation is turned off* | le réglage de Safari | Réglages › Apps › Safari › Avancé |
| *The Safari instance is already paired with a different session* | la session précédente est encore tenue (un script tué ne l'a pas fermée) | rien : `ipad.ts` attend jusqu'à 2 min |
| *invalid session id* en plein vol | Safari a lâché la page | voir ci-dessous : mémoire ; `--no-shots` |
| `the scene never came up` | l'app ne démarre pas (première visite : les shaders compilent plusieurs minutes) | relancer — Safari garde les shaders compilés |

À savoir aussi :

- *invalid session id* : 3 vols sur 5 avec captures ont perdu la page **au début du vol plané**, juste
  après une capture qui échouait — tous les trois après une rentrée à 15–30 images/s (les vols qui ont tenu
  rentraient à 40–60). Le vol sans captures a tenu jusqu'à l'arrêt. Probablement la **mémoire** de l'iPad
  (8 Go, l'onglet bien moins), à laquelle une capture pleine résolution (3180 × 2384) s'ajoute :
  `--no-shots` pour les vols longs.
- `WebGPU device lost` en pleine rentrée (vu 2 fois, avec ou sans captures) : l'app s'en remet et le vol
  continue — mais c'est un bug de l'app sur iPad, pas du test.
- **Changer le `#` de l'adresse ne charge pas une scène** — `ipad.ts` recharge la page avec la scène dans le lien.
- L'écran de chargement est levé quand `#loading` a la classe `done` ; le relief de la Terre arrive ~30 s
  après (`__bh.relief("earth", …) > 100`), ce qu'attend `flight`.
- La **vitesse du statut n'est pas une vitesse sol** : elle est mesurée par rapport au centre de la Terre,
  les ~305 m/s du sol qui tourne (à Paris) dedans ; `flight` juge l'arrêt par la position le long de la piste.
- Les messages de l'autopilote suivent la langue de la page : *Touchdown* en anglais, *Toucher* en français.

---

## Ce que ça a montré (2026-10-04, le site publié)

Artemis à ~60 images/s, le démarrage en cache en ~6 s. Cinq vols orbite → Le Bourget contre cinq dans
Chrome sur le mini : ceux du mini tous doux (0,2 à 0,7 m/s vers le bas) ; les trois touchers de l'iPad
tous durs — 5 m/s (train cédé), 1,6 m/s, 2,9 m/s avec une ressource de 3 à 8 m à l'arrondi et un rebond
(puis 10 m/s, train cédé) —, à 57–60 images/s ; deux vols ont perdu la page au début du vol plané, un a
perdu le GPU et s'en est remis. Les réglages sont les mêmes des deux côtés (seul le niveau de rendu
diffère) ; la cadence (60 Hz sur l'iPad, 50 sur le mini) reste la piste à vérifier.

Le 2026-10-05, `ipad.ts flight --no-shots` : toucher à 1,4 m/s vers le bas, arrêté à 2 063 m du seuil,
à 0,1 m de l'axe (14 min 37) — malgré un `WebGPU device lost` en route.
