// The spacecraft's missions chosen (PLAN-VAISSEAUX X11 — game/spacemissions.ts): the Interstellar campaign's chapters
// (each opened by the one before, those flown ticked) and the library's missions, a card each — its name, its brief,
// its objectives, its budget —, flown at once (its start set up, its objectives watched). And a mission made here:
// its start the flight as it is now, its objectives the school's conditions in their order, its budget, its messages
// at their times — flown at once, or shared as a link (#smission=…).

import { campaignDone } from "../controller/spacemission";
import type { SpaceDone, SpaceStart } from "../game/spacecourse";
import {
  CAMPAIGN,
  chapterOpen,
  doneText,
  EDITOR_DONE,
  objText,
  SPACE_MISSIONS,
  type SpaceMission,
  type SpaceMissionId,
} from "../game/spacemissions";
import { t, tf } from "../i18n";
import { button, el as h, modal } from "./kit";

export interface SpaceMissionHost {
  /** one of ours set up and begun */
  go(id: SpaceMissionId): void;
  /** one made set up and begun */
  fly(M: SpaceMission): void;
  /** the flight as it is now, as a start (null: not in a spacecraft) */
  here(): SpaceStart | null;
  /** its link copied (said) */
  share(M: SpaceMission): void;
}

export function spaceMissionPanel(host: SpaceMissionHost) {
  const root = h("div", "chp");
  const m = modal({ title: t("Spacecraft missions"), body: [root], cls: "chp-frame", testid: "space-missions" });
  const done = campaignDone();
  const card = (M: SpaceMission) => {
    const open = chapterOpen(M, done);
    const c = h("div", `chp-card${open ? "" : " locked"}`);
    const goals = h("ol", "chp-goals");
    for (const O of M.objectives) goals.append(h("li", "", objText(O)));
    const b = button({
      label: open ? t("Fly") : t("Locked"),
      kind: open ? "primary" : "plain",
      testid: `space-mission-${M.id}`,
      onClick: () => {
        if (!open) return;
        m.close();
        host.go(M.id as SpaceMissionId);
      },
    });
    b.disabled = !open;
    c.append(
      h("b", "chp-name", t(M.title)),
      h("p", "chp-brief", t(M.brief)),
      goals,
      h("span", "chp-par", budgetText(M) || t("no budget")),
      h("span", "chp-best", M.chapter ? (M.chapter <= done ? "✓" : open ? t("open") : "🔒") : ""),
      b,
    );
    return c;
  };
  root.append(h("h3", "chp-h", tf("The Interstellar campaign · {0}/{1}", done, CAMPAIGN.length)));
  for (const M of CAMPAIGN) root.append(card(M));
  root.append(h("h3", "chp-h", t("Library")));
  for (const M of SPACE_MISSIONS.filter((x) => !x.chapter)) root.append(card(M));
  root.append(
    button({
      label: t("Make a mission from here…"),
      icon: "plus",
      testid: "smed-open",
      onClick: () => {
        const start = host.here();
        if (!start) return;
        m.close();
        spaceMissionEditor(host, start);
      },
    }),
  );
}

const budgetText = (M: SpaceMission) =>
  [M.budget?.dv ? tf("Δv {0} m/s", M.budget.dv) : "", M.budget?.timeS ? tf("{0} min at most", Math.round(M.budget.timeS / 60)) : ""]
    .filter(Boolean)
    .join(" · ");

/** The editor: a mission made from the flight as it is now. */
export function spaceMissionEditor(host: SpaceMissionHost, start: SpaceStart) {
  const root = h("div", "smed");
  const m = modal({ title: t("A mission made here"), body: [root], cls: "chp-frame", testid: "smed-editor" });
  const field = (label: string, input: HTMLElement) => {
    const l = h("label", "smed-field");
    l.append(h("span", "", label), input);
    return l;
  };
  const input = (type: string, value: string, testid: string) => {
    const i = h("input", "smed-in");
    i.type = type;
    i.value = value;
    i.dataset.testid = testid;
    return i;
  };
  const title = input("text", "", "smed-title");
  title.placeholder = t("Its name");
  const brief = input("text", "", "smed-brief");
  brief.placeholder = t("What it asks (optional)");
  const dv = input("number", "", "smed-dv");
  dv.placeholder = "—";
  const time = input("number", "", "smed-time");
  time.placeholder = "—";
  const says = h("textarea", "smed-in smed-says");
  says.dataset.testid = "smed-says";
  says.placeholder = t("Messages, one a line: 60: the text");
  // the objectives: a row each — the condition, its value
  const rows = h("ol", "smed-rows");
  const addRow = (key = "altAbove", value = "") => {
    const li = h("li", "smed-row");
    const sel = h("select", "smed-in");
    sel.dataset.testid = "smed-kind";
    for (const k of EDITOR_DONE) {
      const o = h("option", "", doneText({ [k.key]: k.pick ? (k.pick[0] ?? "") : k.unit ? "…" : true } as unknown as SpaceDone));
      o.value = k.key;
      sel.append(o);
    }
    sel.value = key;
    const val = h("span", "smed-val");
    const fill = () => {
      val.replaceChildren();
      const K = EDITOR_DONE.find((x) => x.key === sel.value)!;
      if (K.pick) {
        const s = h("select", "smed-in");
        s.dataset.testid = "smed-value";
        for (const p of K.pick) {
          const o = h("option", "", doneText({ [K.key]: p } as unknown as SpaceDone));
          o.value = p;
          s.append(o);
        }
        if (value && K.pick.includes(value)) s.value = value;
        val.append(s);
      } else if (K.unit) {
        const n = input("number", value || "1", "smed-value");
        n.min = "0";
        val.append(n, h("span", "smed-unit", K.unit === "n" ? "" : K.unit));
      }
      value = "";
    };
    sel.addEventListener("change", fill);
    fill();
    li.append(
      sel,
      val,
      button({ icon: "close", title: t("Remove"), testid: "smed-remove", onClick: () => rows.children.length > 1 && li.remove() }),
    );
    rows.append(li);
  };
  addRow("altAbove", "100");
  const errs = h("p", "smed-errs");
  const mission = (): SpaceMission | null => {
    const objectives = [...rows.children].map((li) => {
      const [sel, val] = [li.querySelector("select")!, li.querySelector<HTMLInputElement | HTMLSelectElement>(".smed-val > *")];
      const K = EDITOR_DONE.find((x) => x.key === sel.value)!;
      const v = K.pick ? val!.value : K.unit ? Math.max(0, Number(val!.value) || 0) : true;
      return { done: { [K.key]: v } as unknown as SpaceDone };
    });
    const said = says.value
      .split("\n")
      .map((l) => /^\s*(\d+(?:\.\d+)?)\s*[:s]\s*(.+)$/.exec(l))
      .filter((x): x is RegExpExecArray => !!x)
      .map((x) => ({ at: Number(x[1]), text: x[2]!.trim() }));
    const name = title.value.trim() || objText(objectives[0]!);
    const dvN = Number(dv.value);
    const tN = Number(time.value);
    const budget = dvN > 0 || tN > 0 ? { dv: dvN > 0 ? dvN : undefined, timeS: tN > 0 ? Math.round(tN * 60) : undefined } : undefined;
    return {
      id: `m-${Date.now().toString(36)}`,
      title: name,
      brief: brief.value.trim() || objectives.map(objText).join(" · "),
      start,
      objectives,
      budget,
      says: said.length ? said : undefined,
    };
  };
  const grid = h("div", "smed-grid");
  grid.append(field(t("Name"), title), field(t("Brief"), brief), field(t("Δv at most [m/s]"), dv), field(t("Time at most [min]"), time));
  const acts = h("div", "smed-acts");
  acts.append(
    button({ label: t("Add an objective"), icon: "plus", testid: "smed-add", onClick: () => addRow() }),
    button({
      label: t("Copy its link"),
      icon: "copy",
      testid: "smed-share",
      onClick: () => {
        const M = mission();
        if (M) host.share(M);
      },
    }),
    button({
      label: t("Fly"),
      kind: "primary",
      testid: "smed-fly",
      onClick: () => {
        const M = mission();
        if (!M) return;
        m.close();
        host.fly(M);
      },
    }),
  );
  root.append(
    grid,
    h(
      "p",
      "smed-start",
      tf(
        "Start: the flight as it is now — the {0}",
        start.vessel === "ranger" ? "Ranger" : start.vessel === "lander" ? "Lander" : "Endurance",
      ),
    ),
    h("h3", "chp-h", t("Objectives, in their order")),
    rows,
    field(t("Messages"), says),
    errs,
    acts,
  );
}
