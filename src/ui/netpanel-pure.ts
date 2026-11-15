// The room panel's decisions that touch no page (audit 2026-11-10, QA-10: src/ui/netpanel.ts — 1 055 lines — never imported by a test):
// a room remembered among the known ones, a server's error said in the pilot's words, how long ago said short, the crew console's link.
// Moved out of netpanel.ts as they were; tested in tests/netpanel-pure.test.ts.

import { t, tf } from "../i18n";
import type { ErrorCode } from "../net/proto";

export interface Known {
  code: string;
  name: string;
  owner?: string;
  used: number;
}

/** The known rooms with `r` put first (what was known of it kept, its owner unless given anew), 20 at most. */
export function rememberRoom(list: readonly Known[], r: Known): Known[] {
  const rest = list.filter((k) => k.code !== r.code);
  const prev = list.find((k) => k.code === r.code);
  return [{ ...prev, ...r, owner: r.owner ?? prev?.owner }, ...rest].slice(0, 20);
}

// (every code the protocol has its words — src/net/proto.ts ErrorCode; « bad » had none: audit QA-10, 14 Nov 2026)
const ERRORS: Record<ErrorCode, () => string> = {
  "unknown-room": () => t("No room with that code"),
  full: () => t("The room is full (8 devices)"),
  "pilots-full": () => t("Four pilots already fly in this room: join as a spectator"),
  password: () => t("Wrong password"),
  owner: () => t("Only the room's owner can delete it"),
  update: () => t("This page is too old for the room server: reload it"),
  limit: () => t("Too many rooms: the server's, or those made from here this hour"),
  slow: () => t("Too many wrong passwords: wait half a minute"),
  replaced: () => t("The room was opened in another tab of this browser: this one left it"),
  rejoin: () => t("Back online, but the room did not take us back (gone, full or its password changed): back to the solo game"),
  bad: () => t("The page spoke to the room server out of turn: reload it"),
  "not-in-room": () => t("Not in a room"),
};

/** A code's words, or undefined when it is not one of the protocol's. */
export const errorText = (code: string | undefined) => (code && Object.hasOwn(ERRORS, code) ? ERRORS[code as ErrorCode]() : undefined);

/** Why a room's request failed, said: the protocol's words, the server unreachable, else the error's own message. */
export const why = (e: unknown) => {
  const code = (e as { code?: string }).code;
  const said = errorText(code);
  if (said) return said;
  return (e as Error).message === "offline" || (e as Error).message === "timeout"
    ? t("The room server cannot be reached")
    : String((e as Error).message ?? e);
};

/** How long ago [a time in ms, `now` too], said short: minutes, hours, days; "" for a time to come. */
export function ago(ms: number, now = Date.now()) {
  const s = (now - ms) / 1000;
  if (!(s > 0)) return "";
  if (s < 3600) return tf("{0} min ago", Math.max(1, Math.round(s / 60)));
  if (s < 86400) return tf("{0} h ago", Math.round(s / 3600));
  return tf("{0} d ago", Math.round(s / 86400));
}

/** The crew console's link for a room (the page's own place, its server named when not the default one). */
export function crewLinkOf(here: string, code: string, server: string | null): string {
  return `${new URL("crew/", here).href}#join=${code}${server ? `&server=${encodeURIComponent(server)}` : ""}`;
}
