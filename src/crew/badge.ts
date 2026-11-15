// The crew console's badge (audit 2026-11-10, QA-10: src/crew/main.ts — never imported by a test): where the station is — aboard,
// waiting for the pilot's agreement, on the ground with the light's time or the link cut — and the profile's line. Moved out of
// main.ts's syncBadge() as it was; tested in tests/crew-badge.test.ts.

import { dur } from "./draw/kit";
import { L } from "./lang";
import type { CrewProfile } from "./profile";

/** Where the station is: aboard (agreed), aboard waiting for the pilot, else on the ground — its link cut, or its light's time. */
export function stationWhere(
  place: "aboard" | "ground",
  accepted: boolean,
  asked: "asked" | "yes" | "no" | undefined,
  link: { delay: number; cut: boolean },
): string {
  return place === "aboard" && accepted
    ? L("à bord", "aboard")
    : place === "aboard" && asked !== "no"
      ? L("à bord · en attente du pilote", "aboard · waiting for the pilot")
      : link.cut
        ? L("sol · liaison coupée", "ground · link cut")
        : link.delay >= 0.5
          ? `${L("sol", "ground")} +${dur(link.delay)}`
          : L("sol", "ground");
}

/** The badge's line: a jet's tactical console, a spacecraft's station and where it is, none else. */
export function profileBadge(profile: CrewProfile | null, craftName: string | undefined, call: string, where: string): string {
  return profile === "jet"
    ? `${craftName ?? "F-35"} · ${L("TACTIQUE", "TACTICAL")}`.toUpperCase()
    : profile === "space"
      ? `${L("VAISSEAU", "SPACECRAFT")} · ${craftName ?? ""} — ${call} · ${where}`.toUpperCase()
      : "";
}
