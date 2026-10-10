// Speaking to TARS (PLAN-TARS-AGENT A5): push-to-talk by the browser's speech recognition — Chrome's goes
// through Google's servers, Safari's stays on the device (the owner's choice, said in the settings' help).
// A key held listens (its words shown as they come), released sends what was heard; a tap is the field.
// Without recognition (Firefox), the field alone.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const Ctor = (): (new () => Recognition) | null => {
  const w = globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export interface ListenHost {
  lang(): "fr" | "en";
  /** the words heard so far (interim) */
  hearing(text: string): void;
  /** what was said, once the key is released (empty: nothing heard) */
  heard(text: string): void;
  /** it went wrong: the microphone refused, no network, no speech — the recognition's own error code too */
  failed(why: "denied" | "network" | "none" | "other", code?: string): void;
  /** listening on / off */
  state(on: boolean): void;
}

/** a hold shorter than this is a tap [ms] */
export const HOLD_MS = 280;

export class PushToTalk {
  private rec: Recognition | null = null;
  private finals = "";
  private interim = "";
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private held = false;
  /** listening asked for — the key held, the microphone switched on — until released or switched off */
  private wanted = false;
  /** the recognition's last error, and how many times running it ended right after it began */
  private error = "";
  private quickEnds = 0;
  private startedAt = 0;
  listening = false;

  constructor(
    private host: ListenHost,
    private ctor: () => (new () => Recognition) | null = Ctor,
    private now: () => number = () => performance.now(),
  ) {}

  static get supported() {
    return !!Ctor();
  }

  /** The key down: a hold starts listening after HOLD_MS. */
  down() {
    if (this.held) return;
    this.held = true;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.held) this.start();
    }, HOLD_MS);
  }

  /** The key up: a tap (true: open the field) or the end of the words. */
  up(): boolean {
    if (!this.held) return false;
    this.held = false;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
      return true;
    }
    this.stop();
    return false;
  }

  /** Listening on, until stop(): the words so far kept across the recognition's own ends. */
  start() {
    if (!this.ctor() || this.listening) return;
    this.finals = "";
    this.interim = "";
    this.error = "";
    this.quickEnds = 0;
    this.wanted = true;
    this.listening = true;
    this.host.state(true);
    this.run();
  }

  /**
   * One recognition: the browser's end its own whenever it likes — Chrome's after a pause or a hiccup
   * ("aborted", "no-speech"), Safari's after its first phrase —, half a second in at times: while listening
   * is still wanted it is begun again at once (what was heard kept), until stop(); a refusal, or ends right
   * at the start three times running, give up — the reason said.
   */
  private run() {
    const C = this.ctor();
    if (!C) return this.finish();
    const r = new C();
    r.lang = this.host.lang() === "fr" ? "fr-FR" : "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) this.finals += `${res[0]!.transcript} `;
        else interim += res[0]!.transcript;
      }
      this.interim = interim;
      this.quickEnds = 0;
      this.host.hearing(this.text());
    };
    r.onerror = (e) => {
      this.error = e.error;
    };
    r.onend = () => {
      if (this.rec !== r) return;
      this.rec = null;
      // (a phrase in progress kept: the next recognition starts afresh)
      if (this.interim) {
        this.finals += `${this.interim} `;
        this.interim = "";
      }
      const fatal = this.error === "not-allowed" || this.error === "service-not-allowed" || this.error === "audio-capture";
      this.quickEnds = this.now() - this.startedAt < 400 ? this.quickEnds + 1 : 0;
      if (this.wanted && !fatal && this.quickEnds < 3) {
        this.error = "";
        this.run();
        return;
      }
      if (this.wanted && (fatal || this.quickEnds >= 3)) this.fail();
      this.finish();
    };
    this.rec = r;
    this.startedAt = this.now();
    try {
      r.start();
    } catch {
      this.rec = null;
      this.error = this.error || "start";
      this.fail();
      this.finish();
    }
  }

  private text() {
    return `${this.finals}${this.interim}`.replace(/\s+/g, " ").trim();
  }

  private fail() {
    const e = this.error;
    this.host.failed(
      e === "not-allowed" || e === "service-not-allowed" ? "denied" : e === "network" ? "network" : e === "no-speech" ? "none" : "other",
      e,
    );
  }

  /** Listening over: off, and what was heard sent. */
  private finish() {
    const was = this.listening;
    this.wanted = false;
    this.listening = false;
    if (!was) return;
    this.host.state(false);
    this.host.heard(this.text());
  }

  /** The words ended: the last results come, then `heard`. */
  stop() {
    this.wanted = false;
    if (this.rec) this.rec.stop();
    else this.finish();
  }
}
