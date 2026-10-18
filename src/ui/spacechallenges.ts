// The spacecraft's challenges chosen (PLAN-VAISSEAUX X10 — game/spacechallenges.ts): a card each — its name, what it
// asks, its gold mark, the best kept and its medal —, taken at once (its start set up, the judge running).

import { spaceBests } from "../controller/spacechallenge";
import { scoreText, SPACE_CHALLENGES, type SpaceChallengeId } from "../game/spacechallenges";
import { t, tf } from "../i18n";
import { button, el as h, modal } from "./kit";

const MEDAL: Record<string, string> = { gold: "🥇", silver: "🥈", bronze: "🥉" };

export function spaceChallengePanel(go: (id: SpaceChallengeId) => void) {
  const root = h("div", "chp");
  const m = modal({ title: t("Spacecraft challenges"), body: [root], cls: "chp-frame", testid: "space-challenges" });
  const B = spaceBests();
  for (const C of SPACE_CHALLENGES) {
    const best = B[C.id];
    const card = h("div", "chp-card");
    card.append(
      h("b", "chp-name", t(C.title)),
      h("p", "chp-brief", t(C.brief)),
      h("span", "chp-par", tf("gold under {0}", scoreText(C, C.medals[0]))),
      h("span", "chp-best", best ? `${MEDAL[best.medal ?? ""] ?? "·"} ${scoreText(C, best.score)}` : t("not flown")),
      button({
        label: t("Fly"),
        kind: "primary",
        testid: `space-chal-${C.id}`,
        onClick: () => {
          m.close();
          go(C.id);
        },
      }),
    );
    root.append(card);
  }
}
