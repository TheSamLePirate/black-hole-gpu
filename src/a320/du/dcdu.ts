// The A320's datalink displays, the DCDUs (docs/PLAN-A320.md, A7): FlightGear's (Models/Instruments/DCDU/DCDU.svg, its
// driver DCDU.nas ported in its idle state). Powered, each runs its self test first (FlightGear's du-test page: 25 to 30 s
// on the ground; here a few), then shows what the controllers sent — the game has no CPDLC link yet, so the screen
// stays as the real one does without one: dark, no active ATC, no message, no reply prompts. Its cell is 1024 × 683
// (FlightGear's 766 × 512 picture scaled to it); its text in a monospace face (FlightGear's Liberation Mono's).

import dcduSvg from "../../../assets/a320/du/dcdu.svg";
import testSvg from "../../../assets/a320/du/du-test.svg";
import type { DuData } from "./data";
import { type Ctx, Display } from "./display";
import { SvgDoc } from "./svg";

/** the self test's length here [s] */
const TEST_S = 5;
const W = 1024;
const H = 683;
const mono = (_family: string) => `"JetBrains Mono", "Liberation Mono", monospace`;

export class Dcdu extends Display {
  override hz = 2;
  private test: SvgDoc | null = null;
  private start = Number.NaN;

  constructor(side: 0 | 1 = 0) {
    super(side, dcduSvg);
  }

  protected override init(doc: SvgDoc) {
    // (no link: FlightGear's updateActiveATC and hideResponses — every line and prompt hidden)
    for (const k of ["Line1", "Line2", "Line3", "Line4", "MessageTimeStamp", "ADSConnection", "RecallMode", "LinkLost", "Recall"])
      doc.get(k).hide();
    for (const k of ["Close", "WILCO", "STBY", "UNABLE", "OTHER"]) doc.get(k).hide();
    fetch(testSvg)
      .then((r) => r.text())
      .then((t) => {
        // (its view shifted to the cell's middle: drawn H × H, (W − H) / 2 from the left)
        const T = new SvgDoc(t);
        const v = T.view;
        T.view = [v[0], v[1], v[2], v[3], v[4] + ((W - H) / 2) * (T.width / H), v[5]];
        this.test = T;
      })
      .catch((e) => console.error("A320 DCDU test page:", e));
  }

  draw(ctx: Ctx, _d: DuData, t: number) {
    if (!Number.isFinite(this.start)) this.start = t;
    // (the self test: FlightGear's common DU test page, square, fitted to the cell's height and centred)
    if (t - this.start < TEST_S) {
      this.test?.draw(ctx, H, H, mono);
      return;
    }
    this.doc!.draw(ctx, W, H, mono);
  }
}
