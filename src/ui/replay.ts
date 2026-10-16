// The flight's replay and its trailer (docs/PLAN-AVIATION-AAA.md, S3 — game/replay.ts): the last minutes flown played
// again — the flight held meanwhile, put back as it was after — under the replay's cameras: the director cutting
// between them, or one held (the chase, the orbit, the fly-by, the cockpit); played, paused, slowed, sought; a photo
// of the frame (the photo mode over it); the trailer — the best moments found, cut by the director, in the cinema's
// bars, each its caption, a title before and an end after —, played here or rendered as a video.

import "./replay.css";
import {
  bestMoments,
  boomsOnScreen,
  cutLength,
  directorShot,
  type FlightTape,
  type Moment,
  type MomentKind,
  REPLAY_SHOTS,
  type ReplayShot,
  type ShotPose,
  type ShotState,
  shotPose,
  startShot,
  type TapeBoom,
  type TapeFrame,
} from "../game/replay";
import { paintBoom } from "./hud/symbology";
import { t } from "../i18n";
import { onEscape } from "./keys";
import { button, el, h, kbd } from "./kit";

export interface ReplayHost<R> {
  tape: FlightTape<R>;
  /** why the replay cannot start now (none: it can) */
  blocked(): string | null;
  /** the flight held, the scene kept — returns how to put it back */
  enter(): () => void;
  /** a frame drawn again under a camera's pose — the craft between it and the next (u: 0 … 1) */
  apply(f: TapeFrame<R>, pose: ShotPose, next: TapeFrame<R>, u: number): void;
  /** the craft's own seat (the cockpit's pose) */
  cockpit(): ShotPose;
  /** a frame's explosions (none: none drawn), the view's field now [°] */
  booms?(f: TapeFrame<R>): TapeBoom[];
  fov(): number;
  /** the photo mode over the frame held; its close called back */
  photo(onClose: () => void): void;
  /** the trailer rendered as a video: its frames given (each: the frame, the pose, the seconds) — why not, or null */
  video(frames: { f: TapeFrame<R>; next: TapeFrame<R>; u: number; pose: ShotPose }[], fps: number, draft: boolean): string | null;
  /** the place and the date, for the title card */
  title(): { place: string; date: string; craft: string };
  /** a moment's caption (its figures in the player's units) */
  caption(m: Moment): string;
  toast(s: string): void;
}

const SHOT_NAME: Record<ReplayShot | "auto", string> = {
  auto: t("Director"),
  chase: t("Chase"),
  orbit: t("Orbit around"),
  flyby: t("Fly-by pass"),
  cockpit: t("Cockpit"),
  target: t("On the target"),
};

/** The kinds of moment, their name on screen. */
export const MOMENT_NAME: Record<MomentKind, string> = {
  low: t("Low pass"),
  pull: t("Hard pull"),
  sonic: t("Through Mach 1"),
  gun: t("Guns, guns"),
  missile: t("Missile away"),
  kill: t("Splash"),
  touch: t("Wheels down"),
  form: t("In formation"),
  flight: t("In flight"),
};

/** The trailer's cards: the title's and the end's [s]. */
const CARD_S = 2.6;

export class ReplayPlayer<R> {
  /** playing: the replay's time on the tape [s], its rate */
  t = 0;
  playing = true;
  rate = 1;
  /** the camera asked: the director's, or one held */
  mode: ReplayShot | "auto" = "auto";
  shot: ShotState | null = null;
  /** the director's cuts so far */
  private cuts = 0;
  /** the trailer: its moments, the one playing, the cards' time (title: < 0) */
  trailer: { moments: Moment[]; i: number; card: "title" | "end" | null; cardT: number } | null = null;
  private restore: (() => void) | null = null;
  private bar: HTMLElement | null = null;
  private seek: HTMLInputElement | null = null;
  private clock: HTMLElement | null = null;
  private letter: HTMLElement | null = null;
  /** the explosions drawn over the replay (the HUD's are hidden) */
  private fx: HTMLCanvasElement | null = null;
  /** the explosions drawn in the last frame */
  boomsDrawn = 0;
  private caption: HTMLElement | null = null;
  private unEscape: (() => void) | null = null;
  private photoOpen = false;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(private host: ReplayHost<R>) {}

  get active() {
    return !!this.restore;
  }

  /** The replay opened (the tape's last 20 s, or its start): why not, or null. */
  open(o: { trailer?: boolean } = {}): string | null {
    const why = this.host.blocked() ?? (this.host.tape.length < 3 ? t("Nothing to replay yet: fly a little first") : null);
    if (why) return why;
    if (!this.restore) {
      this.restore = this.host.enter();
      this.build();
      document.body.classList.add("replay");
      this.unEscape = onEscape(() => this.close());
      addEventListener("keydown", this.onKey, true);
    }
    if (o.trailer) return this.startTrailer();
    this.trailer = null;
    this.letterbox(false);
    this.at(Math.max(this.host.tape.start, this.host.tape.end - 20));
    this.playing = true;
    this.sync();
    return null;
  }

  /** Back to the flight, as it was. */
  close() {
    if (!this.restore) return;
    removeEventListener("keydown", this.onKey, true);
    this.unEscape?.();
    this.unEscape = null;
    this.bar?.remove();
    this.letter?.remove();
    this.fx?.remove();
    this.fx = null;
    this.bar = this.letter = this.caption = this.seek = this.clock = null;
    document.body.classList.remove("replay", "replay-cinema");
    this.trailer = null;
    const r = this.restore;
    this.restore = null;
    r();
  }

  /** The trailer: the best moments, the title first. */
  startTrailer(): string | null {
    const moments = bestMoments(this.host.tape);
    if (!moments.length) return t("Nothing to replay yet: fly a little first");
    this.trailer = { moments, i: 0, card: "title", cardT: 0 };
    this.mode = "auto";
    this.rate = 1;
    this.playing = true;
    this.at(moments[0]!.t0);
    this.letterbox(true);
    this.sync();
    return null;
  }

  /** Sought to time t: the shot begun afresh there. */
  at(t: number) {
    const T = this.host.tape;
    this.t = Math.min(Math.max(t, T.start), T.end);
    // (a cut to elsewhere in time: the director chooses afresh, not after the shot that was)
    this.shot = null;
    this.newShot();
  }

  setMode(m: ReplayShot | "auto") {
    this.mode = m;
    this.newShot();
    this.sync();
  }

  private newShot() {
    const T = this.host.tape;
    const want = this.mode === "auto" ? directorShot(T, this.t, this.shot?.shot ?? null, this.cuts) : this.mode;
    this.shot = startShot(T, want, this.t, this.cuts++);
  }

  /** One frame of the replay: the time on, the director's cuts, the trailer's moments and cards; the frame drawn. */
  frame(dt: number) {
    if (!this.restore) return;
    const T = this.host.tape;
    const tr = this.trailer;
    if (tr?.card) {
      tr.cardT += dt;
      if (tr.cardT >= CARD_S) {
        if (tr.card === "end") {
          // (the end: the replay paused at the trailer's last frame — rendered as a video, left, played again)
          this.trailer = null;
          this.letterbox(false);
          this.playing = false;
          this.sync();
        } else {
          tr.card = null;
          this.showCaption(tr.moments[0]!);
        }
      }
    } else if (this.playing) {
      this.t += dt * this.rate;
      if (tr) {
        const m = tr.moments[tr.i]!;
        if (this.t >= m.t1) {
          if (++tr.i < tr.moments.length) {
            this.at(tr.moments[tr.i]!.t0);
            this.showCaption(tr.moments[tr.i]!);
          } else {
            this.t = m.t1;
            tr.card = "end";
            tr.cardT = 0;
            this.showCard("end");
          }
        }
      } else if (this.t >= T.end) {
        this.t = T.end;
        this.playing = false;
        this.sync();
      }
    }
    // (the director: a cut when the shot has run its length, or the fly-by's craft gone far past)
    if (this.shot && this.mode === "auto") {
      const len = this.t - this.shot.t0;
      const pose = shotPose(T, this.shot, this.t);
      const gone = this.shot.shot === "flyby" && pose && pose.eye[2] < -400;
      if (len > cutLength(this.cuts) || len < -0.01 || gone) this.newShot();
    } else if (this.shot?.shot === "flyby" && this.t - this.shot.t0 > 6) this.newShot();
    const S = T.span(this.t);
    if (!S || !this.shot) return;
    const f = S.a;
    const pose = shotPose(T, this.shot, this.t, this.host.cockpit());
    if (pose) {
      this.host.apply(f, pose, S.b, S.u);
      this.drawBooms(f, pose);
    }
    if (this.seek && document.activeElement !== this.seek) this.seek.value = String(this.t - T.start);
    if (this.clock) this.clock.textContent = `${(this.t - T.end).toFixed(1)} s`;
  }

  /** The trailer's frames for a video: each frame of its moments under the director's cameras, at `fps`. */
  trailerFrames(fps = 30): { f: TapeFrame<R>; next: TapeFrame<R>; u: number; pose: ShotPose }[] {
    const T = this.host.tape;
    const out: { f: TapeFrame<R>; next: TapeFrame<R>; u: number; pose: ShotPose }[] = [];
    const moments = bestMoments(T);
    let prev: ReplayShot | null = null;
    let k = 0;
    for (const m of moments) {
      let st: ShotState | null = null;
      for (let u = m.t0; u < m.t1; u += 1 / fps) {
        const p = st && shotPose(T, st, u);
        if (!st || u - st.t0 > cutLength(k) || (st.shot === "flyby" && p && p.eye[2] < -400)) {
          const want = directorShot(T, u, prev, k);
          st = startShot(T, want, u, k++);
          prev = want;
        }
        const pose = shotPose(T, st, u, this.host.cockpit());
        const S = T.span(u);
        if (pose && S) out.push({ f: S.a, next: S.b, u: S.u, pose });
      }
    }
    return out;
  }

  /** The frame's explosions over the image, as the HUD draws them. */
  private drawBooms(f: TapeFrame<R>, pose: ShotPose) {
    const c = this.fx;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const W = Math.round(innerWidth * dpr),
      H = Math.round(innerHeight * dpr);
    if (c.width !== W || c.height !== H) Object.assign(c, { width: W, height: H });
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const B = boomsOnScreen(f.s, pose, this.host.booms?.(f) ?? [], this.host.fov(), W, H);
    this.boomsDrawn = B.length;
    for (const b of B) paintBoom(ctx, [b.x, b.y], b.depth, b.fpx, b.size, b.age, W, H, dpr);
  }

  // ---------------------------------------------------------------- the interface

  private build() {
    const T = this.host.tape;
    this.seek = h("input", {
      type: "range",
      min: "0",
      max: String(T.length),
      step: "0.05",
      class: "rp-seek",
      "aria-label": t("Time in the replay"),
      "data-testid": "replay-seek",
    }) as HTMLInputElement;
    this.seek.addEventListener("input", () => this.at(T.start + Number(this.seek!.value)));
    this.clock = el("span", "rp-clock", "");
    // (the marks of the best moments on the time line)
    const marks = el("span", "rp-marks");
    for (const m of bestMoments(T)) {
      const k = el("span", "rp-mark");
      k.style.left = `${((m.t0 - T.start) / Math.max(T.length, 1)) * 100}%`;
      k.style.width = `${((m.t1 - m.t0) / Math.max(T.length, 1)) * 100}%`;
      k.title = MOMENT_NAME[m.kind];
      marks.append(k);
    }
    const shots = (["auto", ...REPLAY_SHOTS] as const).map((m) =>
      button({ label: SHOT_NAME[m], testid: `replay-shot-${m}`, on: this.mode === m, onClick: () => this.setMode(m) }),
    );
    shots.forEach((b, i) => (b.dataset.shot = ["auto", ...REPLAY_SHOTS][i]));
    const rate = h("select", { class: "rp-rate", "aria-label": t("Speed"), "data-testid": "replay-rate" }) as HTMLSelectElement;
    for (const r of [1, 0.5, 0.25]) rate.append(h("option", { value: String(r) }, r === 1 ? "1×" : r === 0.5 ? "½×" : "¼×"));
    rate.addEventListener("change", () => (this.rate = Number(rate.value)));
    const play = button({ label: "⏸", title: t("Play or pause (Space)"), testid: "replay-play", onClick: () => this.toggle() });
    play.classList.add("rp-play");
    this.bar = h(
      "div",
      { class: "rp-bar k-frame", role: "toolbar", "aria-label": t("Replay"), "data-testid": "replay" },
      h("span", { class: "k-title rp-title" }, t("Replay")),
      play,
      h("span", { class: "rp-track" }, this.seek, marks),
      this.clock,
      rate,
      h("span", { class: "rp-shots" }, ...shots),
      button({ label: t("Photo"), testid: "replay-photo", onClick: () => this.photo() }),
      button({
        label: t("Trailer"),
        kind: "primary",
        testid: "replay-trailer",
        onClick: () => {
          const why = this.startTrailer();
          if (why) this.host.toast(why);
        },
      }),
      button({ label: t("Video…"), testid: "replay-video", onClick: () => this.video(false) }),
      h("span", { class: "rp-keys" }, kbd(t("Space")), " ", kbd("←→"), " ", kbd("1–6"), " ", kbd(t("Esc"))),
      button({ label: t("Back to the flight"), icon: "close", testid: "replay-close", onClick: () => this.close() }),
    );
    this.letter = h("div", { class: "rp-letter", "data-testid": "replay-letterbox" }, el("div", "rp-cap"));
    this.caption = this.letter.querySelector(".rp-cap");
    this.fx = h("canvas", { class: "rp-fx", "data-testid": "replay-fx" }) as HTMLCanvasElement;
    document.body.append(this.fx, this.letter, this.bar);
  }

  /** The bar's state shown: the play button, the camera held, the time line's length. */
  private sync() {
    if (!this.bar) return;
    const play = this.bar.querySelector(".rp-play span");
    if (play) play.textContent = this.playing ? "⏸" : "⏵";
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>("[data-shot]")) b.classList.toggle("on", b.dataset.shot === this.mode);
    if (this.seek) this.seek.max = String(this.host.tape.length);
  }

  private toggle() {
    if (!this.playing && this.t >= this.host.tape.end - 0.05 && !this.trailer) this.at(this.host.tape.start);
    this.playing = !this.playing;
    this.sync();
  }

  private letterbox(on: boolean) {
    document.body.classList.toggle("replay-cinema", on);
    if (on) this.showCard("title");
    else if (this.caption) this.caption.replaceChildren();
  }

  private showCard(which: "title" | "end") {
    if (!this.caption) return;
    const x = this.host.title();
    this.caption.className = `rp-cap rp-card rp-${which}`;
    this.caption.replaceChildren(
      ...(which === "title"
        ? [el("b", "", x.craft), el("span", "", x.place), el("small", "", x.date)]
        : [el("b", "", t("Kerr")), el("small", "", t("Replay of the flight"))]),
    );
  }

  private showCaption(m: Moment) {
    if (!this.caption) return;
    this.caption.className = "rp-cap rp-lower";
    this.caption.replaceChildren(el("b", "", MOMENT_NAME[m.kind]), el("span", "", this.host.caption(m)));
  }

  private photo() {
    if (this.photoOpen) return;
    this.playing = false;
    this.sync();
    this.photoOpen = true;
    document.body.classList.add("replay-photo");
    this.host.photo(() => {
      this.photoOpen = false;
      document.body.classList.remove("replay-photo");
    });
  }

  /** The trailer rendered as a video (a draft: in seconds). */
  video(draft: boolean): string | null {
    const frames = this.trailerFrames(30);
    if (frames.length < 2) {
      const why = t("Nothing to replay yet: fly a little first");
      this.host.toast(why);
      return why;
    }
    const why = this.host.video(frames, 30, draft);
    if (why) this.host.toast(why);
    return why;
  }

  private key(e: KeyboardEvent) {
    if (this.photoOpen || e.metaKey || e.ctrlKey || (e.target as HTMLElement)?.tagName === "INPUT") return;
    const T = this.host.tape;
    let used = true;
    if (e.code === "Space") this.toggle();
    else if (e.code === "ArrowLeft") this.at(this.t - 5);
    else if (e.code === "ArrowRight") this.at(this.t + 5);
    else if (/^Digit[1-6]$/.test(e.code)) this.setMode((["auto", ...REPLAY_SHOTS] as const)[Number(e.code.slice(5)) - 1]!);
    else if (e.code === "Home") this.at(T.start);
    else used = false;
    if (used) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.sync();
    }
  }

  /** For the automation: where it is. */
  state() {
    const T = this.host.tape;
    return {
      active: this.active,
      t: this.t - T.end,
      length: T.length,
      playing: this.playing,
      mode: this.mode,
      shot: this.shot?.shot ?? null,
      booms: this.boomsDrawn,
      trailer: this.trailer && { moment: this.trailer.i, of: this.trailer.moments.length, card: this.trailer.card },
      moments: bestMoments(T).map((m) => ({ kind: m.kind, t0: m.t0 - T.end, t1: m.t1 - T.end, score: Math.round(m.score) })),
    };
  }
}
