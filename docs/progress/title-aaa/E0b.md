# E0b — DE440 demandé en premier (2026-10-18)

[Plan](../../PLAN-TITRE-AAA.md) · [E0](E0.md) · `tests/e2e/boot-time.e2e.test.ts` à `NET=20`

- 20 Mbit/s, 40 ms de latence, cache coupé ; chaque visite dans son propre Chrome.
- 3 visites par cas, l'ancien et le nouveau code alternés (avant 92a69d1b).
- Deux cas :
  - **« sauvegarde »** : le joueur qui revient, sa sauvegarde automatique derrière le titre ;
  - **« première »** : aucune sauvegarde, effacée avant les scripts de la page (`FIRST=1`).
- Fichiers bruts : `E0b-{avant,apres}-{sauvegarde,premiere}.json`.

## Ce qui a changé

1. **DE440 d'abord.** Le ciel (Gaia, 3,6 Mo) et les étoiles (3,5 Mo) attendent les éphémérides.
   - `prefetchSkyAssets(get, after)` : les promesses existent tout de suite, et `loadSky` les attend au lieu de
     retélécharger.
   - Les octets ne commencent qu'une fois DE440 arrivé.
2. **JUP365 (7,5 Mo) n'est plus avant la première image pour toute sauvegarde.** Il ne l'est plus que pour une
   sauvegarde qui nomme Jupiter ou ses lunes (cible, corps de référence, sol), avec la même expression régulière
   que pour les scènes.
   - Jusqu'ici, tout joueur qui revenait téléchargeait 7,5 Mo avant DE440, où que soit sa sauvegarde.
3. **Ce qui se télécharge en avance** attend que le ciel soit là : JUP365 (2 s après l'image) et les cartes
   moyennes de la Terre (22,7 Mo, 3 s après). Sinon, ils partagent le lien avec le ciel.

## Mesures

Le JS du jeu met lui-même de 2,1 à 8,9 s à arriver selon la visite : c'est le bruit de l'émulation, deux visites
sur douze en souffrent. Les durées sont donc comptées **depuis `main`**, le début du JS ; les 3 visites de chaque
cas y concordent à ±0,1 s.

| depuis le début du JS | sauvegarde : avant | sauvegarde : après | première : avant | première : après |
|---|---|---|---|---|
| éphémérides et **titre** | 7,6 s | **1,7 s** | 4,4 s | **1,7 s** |
| **première image** | 7,8 s | **1,8 s** | 4,6 s | **1,8 s** |
| vrai ciel chargé | 6,3 s | 6,7 s | 4,8 s | 6,9 s |
| splash levé | 8,8 s | **7,7 s** | 5,8 s | 7,9 s |

En temps absolu (médianes) :

- **sauvegarde** : première image 10,5 → 5,0 s, splash 11,5 → 10,7 s ;
- **première visite** : première image 7,7 → 4,3 s, splash 8,9 → 10,3 s.

## Lecture

- **Le titre et la première image gagnent 3 à 6 s.** C'est ce dont E2 a besoin : un menu prêt tôt, une intention
  appliquée avant la première image.
- **Pour un premier visiteur, le vrai ciel arrive 2,1 s plus tard.** Le premier rendu se fait donc avec le ciel
  procédural, puis la Voie lactée arrive ; le splash, qui attend les assets, se lève d'autant plus tard.
  - Les octets sont les mêmes, mais une fois la première image passée, le ciel ne descend qu'à 11–13 Mbit/s,
    contre 19 quand le lien est libre.
  - Ce n'est ni un autre téléchargement (CDP ne voit que ces 3 requêtes), ni le compteur de progression
    (`loading.fetch`), ni un thread principal saturé (aucun trou au-delà de 100 ms). Trois flux parallèles en
    page installée atteignent 19 Mbit/s.
  - La cause reste à trouver ; elle peut être propre à l'émulation réseau de Chrome.
- **Variantes essayées et écartées.**
  - Tout en parallèle avec des indices de priorité (`priority: "high"` pour DE440, `"low"` pour le ciel) : DE440
    reste à ~6,9 s, l'émulation partage le lien quoi qu'il arrive.
  - Le ciel sans compteur : même lenteur.
- **Pour E1/E2** : le fondu vers la scène vivante doit attendre le vrai ciel, pas seulement la première image.
  Sinon la Voie lactée « saute » sous les yeux du joueur.
