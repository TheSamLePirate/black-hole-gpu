// The scene's date and time (the transport bar's clock, the pause menu): now (the real date), the start
// of the scene, a date chosen (UTC), steps of an hour and a day — over the game's tools' jumpTo, which
// carries the ship with the world (its orbit, its place on a ground) and drops a plan made on the old
// clock. A scene without the game's calendar (a bare Kerr view): its time in M, back to its start.

import "./placepanel.css";
import type { GameTools } from "../game/tools";
import type { Settings } from "../settings";
import { EPOCH_DATE, M_SECONDS } from "../system/solar";
import { fmtClock, hasCalendar } from "../clock";
import { t } from "../i18n";
import { dateNow } from "../util/now";
import { button, el as h, modal } from "./kit";

export interface TimeHost {
  tools: GameTools;
  settings: Settings;
  /** the scene's clock when it was applied [M] */
  sceneStart(): number;
  toast(text: string): void;
}

const DAY = 86400;
/** a scene time [M] → its date (ms since 1970) and back */
const toMs = (tm: number) => EPOCH_DATE + tm * M_SECONDS * 1e3;
const fromMs = (ms: number) => (ms - EPOCH_DATE) / 1e3 / M_SECONDS;

export class TimePanel {
  private close: (() => void) | null = null;
  private timer = 0;

  constructor(private host: TimeHost) {}

  get isOpen() {
    return !!this.close;
  }

  open() {
    if (this.close) return;
    const root = h("div", "pp");
    const m = modal({
      title: t("Date and time"),
      body: [root],
      cls: "pp-frame",
      testid: "time-panel",
      onClose: () => {
        this.close = null;
        clearInterval(this.timer);
      },
    });
    this.close = m.close;
    this.build(root);
  }

  private build(root: HTMLElement) {
    const H = this.host;
    const cal = hasCalendar(H.settings);
    const clock = h("div", "tm-clock");
    const clockMain = h("b");
    const clockSub = h("small");
    clock.append(clockMain, clockSub);
    const show = () => {
      const c = fmtClock(H.settings, H.tools.now());
      clockMain.textContent = c.main;
      clockSub.textContent = c.sub;
    };
    const note = h(
      "p",
      "pp-note",
      t("The ship keeps its orbit, or its place on the ground, around its body; a manoeuvre plan made on the old clock is dropped."),
    );
    const err = h("p", "pp-err");
    const jump = (tm: number) => {
      err.textContent = "";
      try {
        const r = H.tools.jumpTo(tm);
        H.toast(r.planDropped ? t("The clock moved: the plan made on the old clock was dropped") : t("The clock moved"));
        show();
        if (cal) input.value = isoLocal(toMs(H.tools.now()));
      } catch (e) {
        err.textContent = (e as Error).message ?? String(e);
      }
    };
    const resets = h("div", "pp-seg");
    if (cal) resets.append(button({ label: t("Now (the real date)"), testid: "time-now", onClick: () => jump(fromMs(dateNow())) }));
    resets.append(button({ label: t("Start of the scene"), testid: "time-start", onClick: () => jump(H.sceneStart()) }));
    // a date chosen, in UTC
    const input = h("input", "pp-in tm-date") as HTMLInputElement;
    input.type = "datetime-local";
    input.step = "1";
    input.value = isoLocal(toMs(H.tools.now()));
    const pick = h("div", "tm-pick");
    pick.append(
      input,
      h("span", "pp-unit", "UTC"),
      button({
        label: t("Set"),
        kind: "primary",
        testid: "time-set",
        onClick: () => {
          const ms = Date.parse(`${input.value}Z`);
          if (Number.isFinite(ms)) jump(fromMs(ms));
          else err.textContent = t("Not a date");
        },
      }),
    );
    const steps = h("div", "pp-quick");
    for (const [label, sec] of [
      ["−1 d", -DAY],
      ["−1 h", -3600],
      ["+1 h", 3600],
      ["+1 d", DAY],
      ["+30 d", 30 * DAY],
    ] as const)
      steps.append(button({ label: t(label), onClick: () => jump(H.tools.now() + sec / M_SECONDS) }));
    root.append(clock, h("div", "k-label pp-h", t("Back to")), resets);
    if (cal) root.append(h("div", "k-label pp-h", t("A date")), pick, h("div", "k-label pp-h", t("Steps")), steps);
    root.append(note, err);
    show();
    this.timer = window.setInterval(show, 250);
  }
}

/** a date as the datetime-local input takes it (UTC, to the second) */
const isoLocal = (ms: number) => new Date(ms).toISOString().slice(0, 19);
