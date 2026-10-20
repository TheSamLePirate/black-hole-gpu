// A question to the pilot from the room (PLAN-VAISSEAUX N: another's order, his request to take the controls): a card
// at the top of the screen — what is asked, Accept and Refuse, the time left —, answered once; let lapse, refused.
// One at a time: a new one takes the place of the one before (refused).

import { t } from "../i18n";
import "./netask.css";

let open: { root: HTMLElement; done: (yes: boolean) => void } | null = null;

export function netAsk(text: string, answer: (yes: boolean) => void, testid = "net-ask", seconds = 30) {
  open?.done(false);
  const root = document.createElement("div");
  root.className = "netask";
  root.dataset.testid = testid;
  root.setAttribute("role", "alertdialog");
  const p = document.createElement("p");
  p.textContent = text;
  const left = document.createElement("i");
  left.className = "netask-left";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "k-btn primary";
  yes.textContent = t("Accept");
  yes.dataset.testid = `${testid}-yes`;
  const no = document.createElement("button");
  no.type = "button";
  no.className = "k-btn";
  no.textContent = t("Refuse");
  no.dataset.testid = `${testid}-no`;
  const row = document.createElement("div");
  row.className = "netask-row";
  row.append(left, no, yes);
  root.append(p, row);
  let answered = false;
  const t0 = performance.now();
  const tick = setInterval(() => {
    const s = Math.max(0, seconds - (performance.now() - t0) / 1000);
    left.textContent = `${Math.ceil(s)} s`;
    if (s <= 0) done(false);
  }, 250);
  const done = (y: boolean) => {
    if (answered) return;
    answered = true;
    clearInterval(tick);
    root.remove();
    if (open?.root === root) open = null;
    answer(y);
  };
  yes.addEventListener("click", () => done(true));
  no.addEventListener("click", () => done(false));
  left.textContent = `${seconds} s`;
  document.body.append(root);
  open = { root, done };
}
