// The views of exception's page (docs/PLAN-AVIATION-AAA.md, S2 — game/views.ts): a card for each scene — its
// place, its hour, its weather, its challenge —; one picked flown at once (a mission made for its hour, or the
// challenge it is).

import "./views.css";
import { VIEWS } from "../game/views";
import { t } from "../i18n";
import { el as h, modal } from "./kit";

export interface ViewsHost {
  /** a view flown: what to say */
  fly(id: string): string;
  toast(s: string): void;
}

/** The views of exception, their cards. */
export function openViews(host: ViewsHost) {
  const grid = h("div", "vw-grid");
  const m = modal({ title: t("Views of exception"), body: [grid], cls: "vw-frame", testid: "views" });
  for (const v of VIEWS) {
    const c = h("button", "vw-card");
    c.type = "button";
    c.dataset.testid = `view-${v.id}`;
    c.append(
      h("b", "", v.title),
      h("span", "vw-place", v.place),
      h("span", "vw-facts", `${v.when} · ${v.weather}`),
      h("span", "vw-chal", v.challenge),
    );
    c.onclick = () => {
      m.close();
      host.toast(host.fly(v.id));
    };
    grid.append(c);
  }
}
