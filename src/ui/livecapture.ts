// Living a capture (PLAN-MODES-AAA M7): a sky event's exposures taken one after the other in the game itself — the
// scene put at each exposure's time, the view as it is, the image taken and stacked (the brightest of each pixel:
// a multiple exposure's lighten) — the stack growing on screen as the event unfolds, its progress and the time left.
// Stopped at any time; at the end, the stack saved as it is, its growth as a time-lapse video (PLAN-MODES-AAA M8:
// the multiple exposure's animation), or the series rendered at full quality (the multiple exposure's dialog). The
// game's time held during it, given back after.

import "./livecapture.css";
import { t, tf } from "../i18n";
import { VIDEO_EXT, VideoWriter } from "../video";
import { button, el, h } from "./kit";

export interface LiveHost {
  /** the scene at a time [ms UTC], settled (`first`: the first exposure — the place's ground loaded) */
  at(ms: number, first: boolean): Promise<void>;
  /** the image on screen now */
  grab(): Promise<{ data: Uint8Array; width: number; height: number }>;
  download(b: Blob, name: string): void;
  /** the game held (its state returned) and given back */
  hold(): unknown;
  release(was: unknown): void;
}

export interface LiveRun {
  title: string;
  /** the exposures' times [ms UTC] */
  times: number[];
  /** the series at full quality (the multiple exposure's dialog), offered at the end */
  render?: () => void;
  /** the file's name, without its extension */
  stem: string;
  /** drawn on each exposure before it is stacked (its index): what the scene does not draw — the ISS's streak */
  overlay?: (frame: Uint8Array, width: number, height: number, i: number) => void;
}

/** The stack: each pixel the brightest of the exposures so far (RGBA, in place). Pure (tests/livecapture.test.ts). */
export function lighten(stack: Uint8ClampedArray, frame: Uint8Array | Uint8ClampedArray) {
  const n = Math.min(stack.length, frame.length);
  for (let i = 0; i < n; i += 4) {
    if (frame[i]! > stack[i]!) stack[i] = frame[i]!;
    if (frame[i + 1]! > stack[i + 1]!) stack[i + 1] = frame[i + 1]!;
    if (frame[i + 2]! > stack[i + 2]!) stack[i + 2] = frame[i + 2]!;
    stack[i + 3] = 255;
  }
}

/** The time-lapse's rate for `n` exposures: about four seconds of growth, 4 to 24 frames a second. */
export function lapseFps(n: number): number {
  return Math.min(24, Math.max(4, Math.round(n / 4)));
}

/** An image cropped to even sides (the encoders' need): itself when they already are. */
export function evenCrop(data: Uint8Array | Uint8ClampedArray, w: number, h: number): { data: Uint8Array; w: number; h: number } {
  const ew = w & ~1,
    eh = h & ~1;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.length);
  if (ew === w && eh === h) return { data: bytes, w, h };
  const out = new Uint8Array(ew * eh * 4);
  for (let y = 0; y < eh; y++) out.set(bytes.subarray(y * w * 4, y * w * 4 + ew * 4), y * ew * 4);
  return { data: out, w: ew, h: eh };
}

/** The time left [s], from the exposures done and the time they took so far. */
export function timeLeft(done: number, total: number, elapsedS: number): number {
  if (done <= 0) return Number.NaN;
  return (elapsedS / done) * (total - done);
}

export class LiveCapture {
  private root: HTMLElement | null = null;
  private stop = false;
  running = false;

  constructor(private d: LiveHost) {}

  /** Lives a capture: its exposures taken and stacked on screen. */
  async run(o: LiveRun) {
    if (this.running) return;
    this.running = true;
    this.stop = false;
    const canvas = el("canvas", "lc-canvas");
    const bar = el("i", "");
    const line = el("div", "lc-line");
    const left = el("div", "lc-left");
    const acts = el("div", "lc-acts");
    const stopBtn = button({ label: t("Stop"), testid: "live-stop", onClick: () => (this.stop = true) });
    acts.append(stopBtn);
    const root = h(
      "section",
      { class: "lc k-frame", "data-testid": "live-capture", role: "status", "aria-live": "polite" },
      h("header", { class: "lc-head" }, el("b", "k-title", o.title), el("span", "lc-rec", t("LIVE"))),
      canvas,
      h("div", { class: "lc-bar" }, bar),
      line,
      left,
      acts,
    );
    this.root?.remove();
    this.root = root;
    document.body.append(root);
    const was = this.d.hold();
    const started = performance.now();
    let stack: ImageData | null = null;
    const ctx = canvas.getContext("2d")!;
    let done = 0;
    // (the time-lapse: the stack after each exposure, a frame — when this browser encodes video)
    let lapse: VideoWriter | null = null;
    const fps = lapseFps(o.times.length);
    const addLapse = async (img: ImageData, times = 1) => {
      if (!lapse) return;
      const c = evenCrop(img.data, img.width, img.height);
      try {
        for (let k = 0; k < times; k++) await lapse.addFrame(c.data, c.w, c.h);
      } catch {
        lapse.close();
        lapse = null;
      }
    };
    try {
      for (const [i, ms] of o.times.entries()) {
        if (this.stop) break;
        await this.d.at(ms, i === 0);
        if (this.stop) break;
        const px = await this.d.grab();
        o.overlay?.(px.data, px.width, px.height, i);
        if (!stack || stack.width !== px.width || stack.height !== px.height) {
          stack = new ImageData(px.width, px.height);
          canvas.width = px.width;
          canvas.height = px.height;
        }
        lighten(stack.data, px.data);
        ctx.putImageData(stack, 0, 0);
        if (i === 0) {
          const cfg = await VideoWriter.supported(stack.width & ~1, stack.height & ~1, fps).catch(() => null);
          lapse = cfg ? new VideoWriter(cfg, fps) : null;
        }
        await addLapse(stack);
        done = i + 1;
        bar.style.width = `${((done / o.times.length) * 100).toFixed(1)}%`;
        line.textContent = tf(
          "Exposure {0} / {1} · {2} UTC",
          done,
          o.times.length,
          new Date(ms).toISOString().slice(0, 16).replace("T", " "),
        );
        const s = timeLeft(done, o.times.length, (performance.now() - started) / 1000);
        left.textContent = Number.isFinite(s) && done < o.times.length ? tf("about {0} s left", Math.ceil(s)) : "";
      }
    } finally {
      this.d.release(was);
      this.running = false;
    }
    // the end: the stack kept, saved or rendered at full quality
    root.classList.add("done");
    root.querySelector(".lc-rec")!.textContent = this.stop ? t("STOPPED") : t("DONE");
    left.textContent = tf("{0} exposures stacked", done);
    acts.replaceChildren();
    // (the time-lapse closed on the whole stack held a second and a half)
    let film: Blob | null = null;
    if (lapse && stack && done > 1) {
      await addLapse(stack, Math.round(1.5 * fps));
      film = lapse ? await lapse.finish().catch(() => null) : null;
    } else lapse?.close();
    const ext = lapse ? VIDEO_EXT[lapse.format] : "mp4";
    if (stack && done)
      acts.append(
        button({
          label: t("Save the stack (PNG)"),
          kind: "primary",
          testid: "live-save",
          onClick: () => canvas.toBlob((b) => b && this.d.download(b, `${o.stem}-live.png`), "image/png"),
        }),
      );
    if (film)
      acts.append(
        button({
          label: tf("Time-lapse ({0})", ext.toUpperCase()),
          testid: "live-lapse",
          onClick: () => this.d.download(film, `${o.stem}-timelapse.${ext}`),
        }),
      );
    if (o.render)
      acts.append(
        button({
          label: t("Full-quality render"),
          testid: "live-render",
          onClick: () => {
            this.close();
            o.render!();
          },
        }),
      );
    acts.append(button({ label: t("Close"), testid: "live-close", onClick: () => this.close() }));
    return done;
  }

  close() {
    this.stop = true;
    this.root?.remove();
    this.root = null;
  }
}
