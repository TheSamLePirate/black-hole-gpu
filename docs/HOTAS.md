# Les manettes et les HOTAS

Le jeu lit tous les périphériques branchés en même temps : une manette Xbox ou PlayStation, un manche, une manette des gaz, un palonnier, souvent sur trois prises USB. Chaque axe et chaque bouton peut être affecté à une commande. Les réglages sont gardés dans le navigateur, par modèle de périphérique. Plan : [`PLAN-HOTAS.md`](PLAN-HOTAS.md) (M7, H1–H6).

## Les fichiers

| Fichier | Rôle |
|---|---|
| `src/input/axes.ts` | pur : le modèle d'un périphérique d'après son identifiant ; la mise en forme d'un axe (calibration, inversion, zone morte, courbe) ; le levier absolu et son cran ; un chapeau lu comme un axe ; les affectations lues sur tous les périphériques ; les fronts des boutons ; la détection |
| `src/input/devices.ts` | les instantanés des périphériques, les profils du joueur (`kerr.pads`), `PadControls` : la lecture de chaque image, les périphériques réclamés |
| `src/input/profiles.ts` | les profils connus (douze modèles), le profil générique d'un appareil de vol inconnu, le modèle de la manette standard |
| `src/input/haptics.ts` | les vibrations : le fond continu (`hapticMix`), les impulsions, l'envoi à chaque périphérique qui sait vibrer |
| `src/ui/pads-screen.ts` | l'écran « Manettes et HOTAS » : les périphériques en direct, l'affectation par détection, les réglages des axes, la calibration |
| `src/gamepad.ts` | la manette standard (son mapping intégré : le vol, la caméra, les menus) ; elle laisse aux profils les périphériques réclamés |
| `src/controller/piloting.ts` | `pilotInput` : le clavier, le tactile, la manette et les profils additionnés ; la reprise du levier |

## Le chemin d'une entrée

```
navigator.getGamepads() ─ snapshotDevices ─┬─ profil du joueur (par modèle) ─┐
                                           ├─ profil connu (identifiants)   ─┼→ readCommands → axes, actions, touches tenues
                                           └─ profil générique (par le nom) ─┘
axes ────────────→ pilotInput : tangage, roulis, lacet, translations RCS, regard ; le levier → les gaz (reprise)
actions (fronts) → onPadKeyAction → la même action que la touche du clavier (keymap.ts)
touches tenues ──→ ajoutées à celles du clavier
freins aux pieds → motion.ts (ajoutés au freinage de l'arrêt)
```

- **Le modèle** : Chrome donne « Nom (Vendor: 044f Product: b10a) », Firefox « 044f-b10a-Nom », Safari le nom seul. Le modèle est `fournisseur:produit` (ou le nom). Le profil du joueur est gardé sous ce modèle.
- **Réclamé** : un périphérique sans mapping standard qui a un profil n'est plus lu comme une manette par `gamepad.ts`. Auparavant, un HOTAS était lu comme une manette, avec ses axes affectés au hasard. La manette standard n'est jamais réclamée (elle garde sa caméra et ses menus). Si le joueur lui crée un profil, ce profil pilote le vol à la place du mapping intégré.
- **Plusieurs sources sur une commande** (la torsion du manche et le palonnier, par exemple) : leurs valeurs s'additionnent, puis sont bornées.

## Un axe

- **La calibration** : l'étendue apprise (bouger chaque axe jusqu'à ses butées), ramenée à −1…+1.
- **L'inversion**, puis **la zone morte** (8 % par défaut, 12 % pour une torsion).
- **La courbe** : x·(1 − c) + x³·c. La pleine course est conservée ; c = 0,35 par défaut.
- **Un demi-axe** : un seul côté d'un axe (un manche poussé d'un côté seulement).
- **Un chapeau** : ses huit positions, lues comme deux axes (le regard).

## La manette des gaz

- **Absolue** : la position du levier donne les gaz, de 0 à 100 %. Un cran de 4 % au ralenti garantit 0 % en butée basse. Les touches et les gâchettes de la manette Xbox restent incrémentales.
- **La reprise, comme un fader de table de mixage** : si les touches (ou le branchement) ont laissé les gaz ailleurs que sur le levier, celui-ci ne les reprend qu'en passant par leur valeur. Sans cela, au premier mouvement, les gaz sautaient de 30 % à plein.
- **En pilote automatique** (rentrée, approche), les gaz sont ceux de l'ordinateur. En mode assisté, le directeur indique sa poussée et le pilote la règle au levier.

## Les profils connus

| Modèle | Ce qui est affecté |
|---|---|
| Thrustmaster T.16000M, T.Flight HOTAS, Warthog (manche) ; Saitek/Logitech X52, X56 (manche) ; Logitech Extreme 3D Pro ; VKB Gladiator | le roulis, le tangage (manche tiré : nez haut), la torsion en lacet ; le SAS au bouton du pouce ; le levier intégré s'il y en a un |
| Thrustmaster TWCS, Warthog (manette) ; X56 (manette) | le levier (absolu), le culbuteur en lacet, le mini-manche en translations RCS |
| Thrustmaster TFRP, T-Rudder ; Saitek/Logitech Pro Flight | les freins aux pieds, le lacet |
| un appareil de vol inconnu (nommé manche, manette des gaz, palonnier…) | un profil générique, d'après ses axes |

L'ordre des axes varie selon le navigateur et le système. Ces profils sont donc un point de départ : la détection les corrige.

## L'écran « Manettes et HOTAS »

Il s'ouvre depuis l'écran des commandes. On y trouve :

- **Les périphériques en direct** : chacun avec son nom, son modèle, son profil (connu, générique, le mien, ou le mapping intégré d'une manette standard), ses axes en barres et ses boutons allumés.
- **Les affectations** : un clic sur la source d'une commande, puis on bouge l'axe ou on presse le bouton. Le plus grand mouvement l'emporte. Un manche bougé d'un seul côté donne un demi-axe, un levier l'axe entier.
- **Les réglages de chaque axe** : l'inversion, la zone morte et la courbe, avec la réponse tracée.
- **Les actions** : ajouter une commande (un axe, une action du clavier, une touche tenue), calibrer, revenir au profil d'origine. Une manette standard peut être « personnalisée » à partir de son mapping intégré.

Toute modification fait du profil celui du joueur, gardé pour ce modèle. **Rien n'est piloté tant que l'écran est ouvert** : un bouton pressé pour l'affecter ne déclenche pas son action.

## Les vibrations

- **Le fond continu**, renouvelé toutes les 100 ms : la poussée (léger, aigu), le plasma de la rentrée (lourd), le roulage (il grandit avec la vitesse).
- **Les impulsions**, par-dessus : chaque roue qui touche, les joints de la piste, un bang, les secousses transsoniques, l'amarrage et la séparation, un crash.
- **L'envoi** : `dual-rumble` (Chrome, Safari), `pulse` (Firefox), à tous les périphériques qui savent vibrer.
- **Le réglage** « Vibrations des manettes » va de 0 (aucune) à 1 (0,6 par défaut). Les vibrations sont calculées par le directeur du son, mais restent sensibles même le son coupé.

## Les tests

- **Unitaires** : `tests/hotas-axes.test.ts`, `tests/hotas-profiles.test.ts`, `tests/hotas-haptics.test.ts`.
- **e2e** `tests/e2e/hotas.e2e.test.ts`, avec un HOTAS en trois pièces simulé dans la page :
  - la réclamation ;
  - le manche et la reprise du levier ;
  - un bouton sur le SAS ;
  - les freins aux pieds ;
  - les profils connus ;
  - l'écran par de vrais clics ;
  - les vibrations.
- **e2e** `tests/e2e/hotas-flight.e2e.test.ts`, un vol entier au HOTAS simulé, à 25 km d'Edwards :
  - le levier pris au ralenti, puis réglé pour tenir 200 m/s ;
  - une montée de 15 s et un tour complet incliné à 35°, au manche ;
  - l'approche en mode assisté : le directeur suivi au manche, le levier là où il le demande ;
  - attendu : posé sur la piste, sans remise des gaz.

Pour simuler des périphériques dans une page, remplacez `navigator.getGamepads` (voir le `FAKE` des e2e) : chaque objet a `id`, `mapping: ""`, `axes`, `buttons` et, pour les vibrations, `vibrationActuator`.
