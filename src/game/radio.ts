// The roles' voices (docs/PLAN-AVIATION-AAA.md, I4): who speaks on the flight's radio — the tower, the wingmen
// ("Two", "Three"…), the radar controller (the AWACS "Darkstar": the picture, the bandits by their BRAA, a bogey
// dope), the carrier ("Mother": the recoveries, the launches, the qualifications) and its landing signal officer
// ("Paddles": the ball, the power, the wave-off, the grades). A line written before the roles had voices
// ("Paddles: power!", "F-35C, Mother: Charlie…") found its role by its words — the role's own name then left out
// (the subtitles name who speaks). Pure.

export type RadioRole = "tower" | "wingman" | "awacs" | "mother" | "lso";

/** The roles shared on the flight's radio with the room (the others hear them): those about our own craft. */
export const SHARED_ROLES: readonly RadioRole[] = ["wingman", "mother", "lso"];

/** The roles' Deepgram voices: a voice of its own for each (the French has two: the radar and the ship's apart). */
export const ROLE_VOICE: Record<Exclude<RadioRole, "tower">, { fr: string; en: string }> = {
  wingman: { fr: "aura-2-hector-fr", en: "aura-2-apollo-en" },
  awacs: { fr: "aura-2-agathe-fr", en: "aura-2-athena-en" },
  mother: { fr: "aura-2-agathe-fr", en: "aura-2-zeus-en" },
  lso: { fr: "aura-2-hector-fr", en: "aura-2-mars-en" },
};

const PREFIX = /^(?:([^,:]{1,24}),\s*(?:ici\s+)?)?(Mother|Paddles|Shooter|Darkstar|Tour|Tower)\s*:\s*/i;

/** A radio line's role by its words, and the line without the role's name (an addressee kept: "F-35C, …"). */
export function roleOfLine(text: string): { role: RadioRole; text: string } {
  const m = PREFIX.exec(text);
  if (!m) return { role: "tower", text };
  const who = m[2]!.toLowerCase();
  const role: RadioRole = who === "paddles" ? "lso" : who === "darkstar" ? "awacs" : who === "tour" || who === "tower" ? "tower" : "mother";
  const rest = text.slice(m[0].length);
  return { role, text: m[1] ? `${m[1]}, ${rest}` : rest.charAt(0).toUpperCase() + rest.slice(1) };
}
