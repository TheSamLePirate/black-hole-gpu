// Flying the Ranger with the fingers (a touch screen, no keyboard): a stick at the bottom left — pitch
// (pull back: nose up) and yaw —, at the bottom right the throttle, a lever that stays where it is
// left, and two roll buttons held down. Their commands go where the keys' and the game controller's
// do (controls.ts: pilotInput); the throttle is the pilot's, as the Z and X keys set it. Shown while
// piloting on a screen whose pointer is coarse; the rest of the HUD — SAS, holds, autopilots, the
// planner — is its buttons.

export interface TouchFlightDeps {
  /** the fingers' commands, read each frame by the flight computer (−1…1) */
  input: { pitch: number; yaw: number; roll: number };
  throttle(): number;
  setThrottle(t: number): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** A finger's command past a small dead zone, finer near the centre (|v|^1.6). */
const shape = (v: number) => {
  const a = Math.max(0, Math.min(1, (Math.abs(v) - 0.08) / 0.92));
  return Math.sign(v) * a ** 1.6;
};

export class TouchFlight {
  readonly el = h("div", "tf");
  private stick = h("div", "tf-stick");
  private knob = h("div", "tf-knob");
  private thr = h("div", "tf-thr");
  private fill = h("div", "tf-fill");
  private thrLabel = h("b", "tf-thrv");
  private shown = false;
  private lastThr = NaN;

  constructor(private d: TouchFlightDeps) {
    this.stick.append(h("i", "tf-ring"), this.knob);
    this.stick.append(...["▲", "▼", "◀", "▶"].map((t, i) => h("span", `tf-arrow a${i}`, t)));
    this.stickInput();

    const right = h("div", "tf-right");
    const rolls = h("div", "tf-rolls");
    for (const [label, v] of [["⟲", -1], ["⟳", 1]] as const) {
      const b = h("button", "tf-roll", label);
      b.setAttribute("aria-label", v < 0 ? "Roll left" : "Roll right");
      const off = () => {
        if (this.d.input.roll === v) this.d.input.roll = 0;
        b.classList.remove("on");
      };
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.d.input.roll = v;
        b.classList.add("on");
      });
      b.addEventListener("pointerup", off);
      b.addEventListener("pointercancel", off);
      b.addEventListener("lostpointercapture", off);
      rolls.append(b);
    }
    this.thr.append(this.fill, h("span", "tf-thrk", "THR"), this.thrLabel);
    this.thrInput();
    right.append(rolls, this.thr);
    this.el.append(this.stick, right);
    this.el.hidden = true;
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private stickInput() {
    const s = this.stick;
    let id = -1;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const r = s.getBoundingClientRect();
      const R = 0.5 * r.width - 0.5 * this.knob.offsetWidth;
      let x = e.clientX - (r.left + 0.5 * r.width);
      let y = e.clientY - (r.top + 0.5 * r.height);
      const l = Math.hypot(x, y);
      if (l > R) (x *= R / l), (y *= R / l);
      this.knob.style.transform = `translate(${x}px, ${y}px)`;
      // (pulled back, the nose up; to the right, yaw right)
      this.d.input.pitch = shape(y / R);
      this.d.input.yaw = shape(x / R);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      this.knob.style.transform = "";
      this.d.input.pitch = this.d.input.yaw = 0;
      s.classList.remove("on");
    };
    s.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      id = e.pointerId;
      s.setPointerCapture(id);
      s.classList.add("on");
      move(e);
    });
    s.addEventListener("pointermove", move);
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
    s.addEventListener("lostpointercapture", end);
  }

  private thrInput() {
    const t = this.thr;
    let id = -1;
    const set = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const r = t.getBoundingClientRect();
      const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top - 8) / (r.height - 16)));
      // (the ends snap: full, cut)
      this.d.setThrottle(v > 0.97 ? 1 : v < 0.03 ? 0 : v);
      this.update(true, true);
    };
    t.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      id = e.pointerId;
      t.setPointerCapture(id);
      t.classList.add("on");
      set(e);
    });
    t.addEventListener("pointermove", set);
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      t.classList.remove("on");
    };
    t.addEventListener("pointerup", end);
    t.addEventListener("pointercancel", end);
  }

  /** Shown or not (piloting on a touch screen), the throttle's lever where the pilot's is. */
  update(show: boolean, force = false) {
    if (show !== this.shown) {
      this.shown = show;
      this.el.hidden = !show;
      if (!show) {
        const i = this.d.input;
        i.pitch = i.yaw = i.roll = 0;
        this.knob.style.transform = "";
      }
    }
    if (!show) return;
    const v = this.d.throttle();
    if (!force && v === this.lastThr) return;
    this.lastThr = v;
    this.fill.style.height = `${(v * 100).toFixed(1)}%`;
    this.thrLabel.textContent = `${Math.round(v * 100)}%`;
  }
}
