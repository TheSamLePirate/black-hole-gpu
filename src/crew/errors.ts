// The room server's errors in the crew console's language, by their code (audit 2026-11-10, NET-32; QA-10: out of crew/main.ts,
// tested). Every code the protocol has (src/net/proto.ts ErrorCode) its words — a code added there without them does not compile.

import type { ErrorCode } from "../net/proto";
import { L } from "./lang";

export const SERVER_ERRORS: Record<ErrorCode, () => string> = {
  password: () => L("Mot de passe incorrect.", "Wrong password."),
  "unknown-room": () => L("Cette salle n’existe plus.", "This room no longer exists."),
  full: () => L("La salle accueille déjà huit appareils.", "The room already has eight devices."),
  update: () => L("Rechargez cette page pour mettre le réseau à jour.", "Reload this page to update the network."),
  "pilots-full": () => L("Quatre pilotes volent déjà dans cette salle.", "Four pilots already fly in this room."),
  owner: () => L("Seul le propriétaire de la salle peut le faire.", "Only the room's owner can do that."),
  limit: () =>
    L(
      "Trop de salles : celles du serveur, ou celles créées d’ici cette heure.",
      "Too many rooms: the server's, or those made from here this hour.",
    ),
  slow: () => L("Trop de mots de passe faux : attendez une demi-minute.", "Too many wrong passwords: wait half a minute."),
  replaced: () =>
    L(
      "La salle a été ouverte dans un autre onglet de ce navigateur : celui-ci l’a quittée.",
      "The room was opened in another tab of this browser: this one left it.",
    ),
  rejoin: () => L("De retour en ligne, mais la salle ne nous a pas repris.", "Back online, but the room did not take us back."),
  "not-in-room": () => L("Pas dans une salle.", "Not in a room."),
  bad: () => L("La page a parlé au serveur hors de son ordre : rechargez-la.", "The page spoke to the server out of turn: reload it."),
};

/** A code's words, or null when the code is not one of the protocol's (the server's own text said then). */
export const serverError = (code: string): string | null =>
  Object.hasOwn(SERVER_ERRORS, code) ? SERVER_ERRORS[code as ErrorCode]() : null;
