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
  /** it went wrong: the microphone refused, no network, no speech */
  failed(why: "denied" | "network" | "none" | "other"): void;
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
  listening = false;

  constructor(private host: ListenHost) {}

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

  start() {
    const C = Ctor();
    if (!C || this.listening) return;
    const r = new C();
    r.lang = this.host.lang() === "fr" ? "fr-FR" : "en-US";
    r.continuous = true;
    r.interimResults = true;
    this.finals = "";
    this.interim = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) this.finals += `${res[0]!.transcript} `;
        else interim += res[0]!.transcript;
      }
      this.interim = interim;
      this.host.hearing(`${this.finals}${interim}`.replace(/\s+/g, " ").trim());
    };
    r.onerror = (e) =>
      this.host.failed(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "denied"
          : e.error === "network"
            ? "network"
            : e.error === "no-speech"
              ? "none"
              : "other",
      );
    r.onend = () => {
      if (this.rec !== r) return;
      this.rec = null;
      this.listening = false;
      this.host.state(false);
      this.host.heard(`${this.finals}${this.interim}`.replace(/\s+/g, " ").trim());
    };
    this.rec = r;
    this.listening = true;
    this.host.state(true);
    try {
      r.start();
    } catch {
      this.rec = null;
      this.listening = false;
      this.host.state(false);
      this.host.failed("other");
    }
  }

  /** The words ended: the last results come, then `heard`. */
  stop() {
    this.rec?.stop();
  }
}
