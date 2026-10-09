// TARS's emblem (PLAN-TARS-AGENT A7): his four slabs, as the robot stands — each a monolith with its lit
// strip —, moving with what he does: still and dim at rest; listening, the strips rising with the voice
// heard; thinking, a slow wave along the slabs; acting, a slab lit in turn for each action; speaking, the
// strips the level of his voice. Drawn in SVG; animated only while not at rest, and not at all with reduced
// motion (the state then shown by the colour alone).

export type EmblemState = "idle" | "listening" | "thinking" | "acting" | "speaking" | "error";

const NS = "http://www.w3.org/2000/svg";
const SLABS = 4;

export class TarsEmblem {
  readonly el: SVGSVGElement;
  private slabs: SVGRectElement[] = [];
  private strips: SVGRectElement[] = [];
  private state: EmblemState = "idle";
  private raf = 0;
  private t0 = performance.now();
  private pulse = -1;
  /** the voice's level now (0…1): heard (listening) or said (speaking); null: unknown (a system voice) */
  level: () => number | null = () => null;
  still: () => boolean = () => false;

  constructor(size = 34) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 40 44");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(Math.round((size * 44) / 40)));
    svg.setAttribute("class", "tars-emblem");
    svg.setAttribute("aria-hidden", "true");
    for (let i = 0; i < SLABS; i++) {
      const x = 2 + i * 9.5;
      const slab = document.createElementNS(NS, "rect");
      slab.setAttribute("x", String(x));
      slab.setAttribute("y", "2");
      slab.setAttribute("width", "8");
      slab.setAttribute("height", "40");
      slab.setAttribute("rx", "0.8");
      slab.setAttribute("class", "te-slab");
      const strip = document.createElementNS(NS, "rect");
      strip.setAttribute("x", String(x + 1.6));
      strip.setAttribute("width", "4.8");
      strip.setAttribute("rx", "0.5");
      strip.setAttribute("class", "te-strip");
      svg.append(slab, strip);
      this.slabs.push(slab);
      this.strips.push(strip);
    }
    this.el = svg;
    this.paint(0);
  }

  set(s: EmblemState) {
    if (s === this.state) return;
    this.state = s;
    this.el.dataset.state = s;
    if (s === "idle" || this.still()) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.paint(0);
    } else if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  /** an action done: its slab flashes */
  flash() {
    this.pulse = performance.now();
    if (!this.raf && !this.still()) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.paint((now - this.t0) / 1000);
    this.raf = this.state === "idle" && now - this.pulse > 600 ? 0 : requestAnimationFrame(this.frame);
  };

  /** the strips' heights (0…1) and the slabs' offsets for a time */
  private paint(t: number) {
    const lv = this.level();
    for (let i = 0; i < SLABS; i++) {
      let h = 0.22;
      let dy = 0;
      switch (this.state) {
        case "listening":
          h = 0.25 + 0.7 * Math.max(lv ?? 0.3 + 0.25 * Math.sin(t * 9 + i * 1.7), 0) * (0.6 + 0.4 * Math.sin(t * 13 + i * 2.3) ** 2);
          break;
        case "thinking":
          h = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(t * 3.2 - i * 0.9));
          dy = 1.4 * Math.sin(t * 3.2 - i * 0.9);
          break;
        case "acting":
          h = 0.35 + 0.55 * Math.max(0, Math.cos(t * 5 - i * 1.4)) ** 3;
          break;
        case "speaking": {
          const v = lv ?? 0.45 + 0.35 * Math.abs(Math.sin(t * 11 + i * 1.3) * Math.sin(t * 4.3 + i));
          h = 0.2 + 0.75 * Math.min(1, v) * (0.75 + 0.25 * Math.sin(t * 17 + i * 2.1));
          break;
        }
        case "error":
          h = 0.9;
          break;
      }
      // (an action's flash: the slabs lit one after the other)
      const since = (performance.now() - this.pulse) / 1000;
      if (since < 0.6) h = Math.max(h, 1 - Math.abs(since * 6 - i) / 1.5);
      h = Math.min(1, Math.max(0.08, h));
      const H = 34 * h;
      this.strips[i]!.setAttribute("y", String(39 - H + dy));
      this.strips[i]!.setAttribute("height", String(H));
      this.slabs[i]!.setAttribute("y", String(2 + dy * 0.4));
    }
  }
}
