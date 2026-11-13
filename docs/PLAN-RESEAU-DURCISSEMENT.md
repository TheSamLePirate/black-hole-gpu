# Plan — durcir le réseau : validation, droits, reprise, serveur

**État (13 novembre 2026) : RD0, RD1 et RD2 faits** (session de l'audit hors rendu ; [NETWORK.md](NETWORK.md) « The
input boundary », « The server defends itself » ; `src/net/inbound.ts`, `server/rooms.ts`) ; RD3 attend la décision 1 du
§4 ; RD4, RD5 à suivre. *(État d'origine,
10 novembre : plan proposé, rien d'implémenté.)* Il vient de l'audit du 10 novembre
([04-reseau-equipage.md](audit-2026-11-10/04-reseau-equipage.md), constats NET-01 à NET-33). Il prolonge
[PLAN-RESEAU.md](PLAN-RESEAU.md) (R0–R8, terminé) et ne recouvre pas
[PLAN-SERVICES-SERVEUR-AAA.md](PLAN-SERVICES-SERVEUR-AAA.md) (comptes, services : jamais commencé). Le code fait foi.
Les constats viennent de la lecture du code ; aucun n'a été rejoué en jeu.

**Demande de Sam.** « Le réseau, le networking, tout doit être parfait. »

## 1. Le constat en trois phrases

Le jeu à deux entre amis fonctionne et il est mesuré : relais WebSocket, liens directs WebRTC, horloge de salle,
prédiction des appareils distants, ordres d'équipage validés par schéma. Mais les membres d'une salle se font une
confiance totale : presque aucun événement reçu n'est validé, tout membre peut agir sur l'appareil d'un autre, et le
serveur n'a ni quota ni limite de débit. Enfin l'état « dur » (amarrages, passagers, scores, rôles) ne vit que dans des
événements passés : un joueur qui arrive ou se reconnecte ne le connaît pas.

## 2. Principes

1. **Un message reçu est une donnée non sûre.** Il est validé par un schéma avant d'atteindre le jeu, et une erreur
   de traitement ne remonte jamais dans la boucle d'image.
2. **Chacun fait autorité sur son appareil.** Un autre membre propose ; le propriétaire ou le serveur décide.
3. **L'état se reprend.** Ce qui doit survivre à une reconnexion est un état tenu par le serveur, pas un événement.
4. **Le serveur se défend seul** : quotas, débit, expiration, identité non publiée.
5. **Mêmes actions métier** que le clavier, TARS et la console d'équipage (CLAUDE.md).

## 3. Les lots

| Lot | Contenu | Constats | Taille | Critère de passage |
|---|---|---|---|---|
| **RD0 — reproduire** | Un e2e à deux pages : un pair envoie des événements mal formés (`match`, `cs`, `dock`, `tel`), des échantillons NaN, infinis, d'un autre slot. Il fixe l'état actuel (image figée ou non) avant toute correction. | NET-01, NET-06, NET-07 | S | L'e2e échoue aujourd'hui là où l'audit le prévoit, ou le constat est retiré |
| **RD1 — la frontière d'entrée** | Tous les événements passent par un schéma versionné (celui de `crew-cmd` sert de modèle) ; le traitement d'un événement est isolé (une exception est comptée, journalisée, jamais relancée dans la frame) ; échantillons filtrés (fini, borné, slot de l'émetteur vérifié en lien direct, temps plausible) ; le serveur ne rejoue pas un événement invalide aux arrivants | NET-01, NET-06, NET-07, NET-21 | M | RD0 vert ; test unitaire par type d'événement ; version de protocole refusée proprement |
| **RD2 — le serveur se défend** | Quota de salles par adresse et expiration des salles vides ; limite de débit par connexion sur le JSON ; essais de mot de passe freinés, hachage salé ; identité de reprise par jeton secret, plus par `device` publié ; TURN lié à une salle ; relais Deepgram avec contrôle d'origine et limite | NET-02, NET-03, NET-04, NET-15, NET-16, NET-17, TA-14 | M | Test du serveur : 1 000 créations depuis une adresse refusées après le quota ; inondation coupée ; usurpation refusée |
| **RD3 — les droits** | Rôles tenus par le serveur (créateur, pilote, équipage, spectateur) ; lancer ou arrêter un match, détruire, forcer une formation, remplacer un plan, se déclarer copilote : réservés ou soumis à l'accord du propriétaire ; « instruments » sans pleins droits sur simple déclaration | NET-08, NET-09, NET-24 | M | Test : un spectateur ne peut déclencher aucune de ces actions ; e2e d'une demande acceptée puis refusée |
| **RD4 — l'état repris** | Amarrages, passagers, scores, rôles co-op, match en cours : un état de salle servi à l'arrivée et à la reconnexion ; slot stable après reconnexion, état par slot purgé au départ ; reconnexion refusée dite au joueur | NET-10, NET-12, NET-13, NET-05 | M–L | e2e : rejoindre en cours de match et après un amarrage, tout est là ; deux onglets ne s'expulsent plus en boucle |
| **RD5 — la liaison** | Pendant une coupure du WebSocket, les liens directs continuent d'envoyer ; garde de lien mort et contre-pression (`bufferedAmount`) ; retour rapide au lien direct ; gros messages hors du canal fiable ; onglet masqué : état annoncé aux autres au lieu d'un appareil figé | NET-11, NET-14, NET-18, NET-19, NET-22, NET-23 | M | e2e : coupure du relais de 10 s sans perte de l'autre appareil à l'écran ; test de charge existant (`src/net/load.ts`) sans croissance mémoire |
| **RD6 — le monde commun** | Décider ce qui est commun à la salle : date et horloge (déjà), météo, trafic réel, pannes. Aujourd'hui météo, trafic et date du suivi sont locaux. | NET-26, NET-27 | M, après décision | Deux joueurs voient la même météo au même endroit, ou la doc dit que non |
| **RD7 — restes** | Altitude du panache par l'ellipsoïde ; vitesse float32 près de Gargantua ; tampon de gigue par lien ; port 3001, en-tête Origin ; erreurs serveur traduites ; redémarrage du serveur seulement quand `server/` change | NET-20, NET-28 à NET-33 | S | — |

Ordre conseillé : RD0, RD1, RD2 (le serveur est public), puis RD3, RD4, RD5. RD6 attend une décision de Sam.

**RD0 et RD1, faits le 13 novembre 2026.** RD0 : l'e2e `net-inbound` (une page dans une salle du serveur de test, un
client Bun pour pair) a vu sur le code d'avant **tout ce que l'audit prévoyait** — `{kind:"match", m:{id:"x"}}` : 163 →
0 images GPU en 2 s, 278 exceptions (`A.pilots is not iterable`, `reading 'limit'`) ; un `tel` de chaînes et un `dock`
sans place, l'appareil du pair visible à 200 m : image figée aussi (64 → 0) ; un échantillon NaN gardé dans la piste
du pair ; le `match` invalide rejoué par le serveur à l'arrivant. Un `bump` NaN, lui, était déjà refusé
(`netBumped`). RD1 : `src/net/inbound.ts` (`readEvent` : l'enveloppe, et douze types lus champ par champ — ceux que le
jeu garde et relit à chaque image ; les autres types gardent leurs propres lecteurs), le client (événements lus,
écouteurs isolés et comptés, échantillons bornés et datés, slot du lien direct écrit à la réception — NET-06), le
décodage des échantillons (`decodeCraft` : fini et borné), le serveur (ni relayé ni gardé pour les arrivants ; `/health`
`rejected`), les étapes réseau de l'image gardées (`main.ts`, AR-03 pour le réseau), et la page d'une autre version du
protocole refusée aussitôt (avant : elle attendait sans fin). Version des événements : un type connu d'une autre forme
est jeté (décision 3 du §4 : recommandation appliquée en attendant Sam — refuser plutôt que lire à moitié).

**RD2, fait le 13 novembre 2026.** Six défauts vus d'abord par `tests/net-server-defence.test.ts` sur le serveur d'avant :
60 salles créées d'une adresse sans refus ; 3 000 événements relayés d'un coup ; l'identifiant d'appareil d'un membre
publié dans la liste, et le copier prenait sa place ; un spectateur revenu comme pilote faisait un cinquième pilote ;
aucun frein aux mots de passe, gardés en sha256 non salé ; aucune salle jamais oubliée. Corrigés dans `server/rooms.ts` :
10 salles par heure et par adresse (`X-Real-IP`), salles vides oubliées après 30 jours, un seau de 120 messages JSON
rempli de 60/s par connexion, 5 mots de passe faux puis 30 s d'attente (code `slow`), argon2id (l'ancien sha256 lu puis
salé), un identifiant public (`publicId`) à la place de l'identifiant d'appareil dans la liste, le monde et le nom TURN,
le rôle gardé à la reprise d'une place, TURN réservé aux membres d'une salle. **Pas fait dans RD2** : le relais Deepgram
(TA-14 : son contrôle d'origine existe dans `server.ts`, aucune limite de débit), deux onglets du même appareil qui
s'expulsent (NET-05, prévu en RD4).

## 4. Décisions à prendre par Sam

1. **Niveau de défense visé.** « Entre amis » (RD1, RD2, RD4, RD5 suffisent) ou « salles publiques avec des inconnus »
   (RD3 devient obligatoire, et la détection des coups ne peut plus rester chez le tireur).
2. **Ce qui est commun à la salle** (RD6) : météo, trafic, pannes.
3. **Compatibilité entre versions** : un client ancien est-il refusé à l'entrée (simple) ou toléré (schémas tolérants) ?

## 5. Documents à tenir

[NETWORK.md](NETWORK.md) et [NETWORK.fr.md](NETWORK.fr.md) (ce que voit le joueur), [CREW.md](CREW.md) (droits),
[DEPLOY.md](DEPLOY.md) (serveur), [E2E-CATALOGUE.md](E2E-CATALOGUE.md), le journal si un lot sert la destination
(§19.8 reprise, §19.10 même monde).
