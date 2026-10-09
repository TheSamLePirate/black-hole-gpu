// The voices (PLAN-TARS T1): who speaks, in what order — a line of the landing's callouts cuts a comment,
// mission control waits its turn, nothing said twice running, a line gone stale dropped — and the system's
// speech (Web Speech: the browser's and the OS's voices, French or English) saying it. The queue is pure
// (tested); `Speech` wraps speechSynthesis, which may be missing (said in subtitles alone then).
//
// A Web Speech voice does not pass through the game's AudioContext: no filter on it. A "radio" line is heard
// as one by what the engine plays around it (the squelch, the Quindar tones, the hiss — engine.ts radio).

/** Who speaks: the landing's callouts (the aircraft's own voice), mission control (by radio), TARS, the
 *  flight computer's messages. */
export type Speaker = "callout" | "mission" | "tars" | "computer";

/** A line to say. */
export interface VoiceLine {
  /** the same id twice in a row: said once (a callout repeated by the next frame) */
  id?: string;
  text: string;
  speaker: Speaker;
  /** 0 the most urgent (a warning: "pull up") … 3 chatter; a lower number cuts a higher one being said */
  priority: number;
  /** by radio (mission control): the squelch and the hiss round it */
  radio?: boolean;
  /** not said once older than this [ms] (a callout of a height already passed) */
  ttl?: number;
}

interface Queued extends VoiceLine {
  at: number;
}

/** The queue: the line to say next, the one being said cut by a more urgent one. */
export class VoiceQueue {
  private q: Queued[] = [];
  /** the line being said */
  current: Queued | null = null;
  /** the last id said or queued, and when (a repeat within `repeatMs` dropped) */
  private lastId = new Map<string, number>();

  constructor(private repeatMs = 4000) {}

  /** A line asked: queued by priority (the same priority: in order); a more urgent one than the line being
   *  said returns `"interrupt"` — its caller stops the speech, then asks `next`. */
  push(line: VoiceLine, now: number): "queued" | "interrupt" | "dropped" {
    if (line.id) {
      const last = this.lastId.get(line.id);
      if (last !== undefined && now - last < this.repeatMs) return "dropped";
      this.lastId.set(line.id, now);
    }
    // (a line already waiting with the same id: replaced, not said twice)
    if (line.id) this.q = this.q.filter((x) => x.id !== line.id);
    const item: Queued = { ...line, at: now };
    let i = this.q.findIndex((x) => x.priority > line.priority);
    if (i < 0) i = this.q.length;
    this.q.splice(i, 0, item);
    return this.current && line.priority < this.current.priority ? "interrupt" : "queued";
  }

  /** The line to say now (none being said): the most urgent not gone stale. */
  next(now: number): VoiceLine | null {
    if (this.current) return null;
    while (this.q.length) {
      const l = this.q.shift()!;
      if (l.ttl !== undefined && now - l.at > l.ttl) continue;
      this.current = l;
      return l;
    }
    return null;
  }

  /** The line being said is over (said, or cut). */
  done() {
    this.current = null;
  }

  /** Everything let go (the voice switched off, a new flight). */
  clear() {
    this.q = [];
    this.current = null;
    this.lastId.clear();
  }

  get waiting() {
    return this.q.length;
  }
}

/** How long a subtitle stays when nothing speaks it [ms]: reading time, 2.5 s at least. */
export const readingMs = (text: string) => Math.max(2500, 900 + 60 * text.length);

/** A system voice's score for a language: the language first, then the better voices (the networked
 *  and "enhanced" ones), a local one before an online one at equal rank. */
export function voiceScore(v: { lang: string; name: string; localService: boolean }, want: "fr" | "en"): number {
  const lang = v.lang.toLowerCase().replace("_", "-");
  if (!lang.startsWith(want)) return -1;
  let s = 10;
  if (want === "fr" ? lang === "fr-fr" : lang === "en-us" || lang === "en-gb") s += 5;
  if (/premium|enhanced|natural|neural|google/i.test(v.name)) s += 4;
  // (the novelty voices of macOS: not for a cockpit)
  if (/bells|bubbles|cellos|jester|organ|trinoids|whisper|zarvox|bahh|boing|wobble|bad news|good news|superstar|albert|fred/i.test(v.name))
    s -= 20;
  if (v.localService) s += 1;
  return s;
}

/** The voice each speaker speaks with: its rate and pitch (mission control a touch quicker, the callouts
 *  flat and even). */
export const SPEAKER_STYLE: Record<Speaker, { rate: number; pitch: number }> = {
  callout: { rate: 1.05, pitch: 0.9 },
  mission: { rate: 1.08, pitch: 1.0 },
  tars: { rate: 1.0, pitch: 0.8 },
  computer: { rate: 1.0, pitch: 1.0 },
};

export interface SpeechHost {
  /** the language to speak (the interface's) */
  lang(): "fr" | "en";
  /** the voice's volume 0…1, and whether it speaks at all */
  volume(): number;
  enabled(): boolean;
  /** a line begins and ends (the subtitles, the radio's squelch) */
  onStart(l: VoiceLine): void;
  onEnd(l: VoiceLine): void;
}

/** The voices said by Web Speech: the queue drained one line at a time. Without speechSynthesis (or the
 *  voice off), each line is "said" for its reading time — the subtitles keep their rhythm. */
export class Speech {
  readonly queue = new VoiceQueue();
  /** every line said (the tests, the lab) */
  readonly said: { text: string; speaker: Speaker; at: number }[] = [];
  /** every line asked, said or not (the tests, the lab: a flight stepped faster than speech) */
  readonly asked: { id?: string; text: string; speaker: Speaker }[] = [];
  private synth: SpeechSynthesis | null = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private utter: SpeechSynthesisUtterance | null = null;

  constructor(private host: SpeechHost) {}

  /** A line to say (the order and the cuts: VoiceQueue). */
  say(line: VoiceLine) {
    this.asked.push({ id: line.id, text: line.text, speaker: line.speaker });
    if (this.asked.length > 400) this.asked.shift();
    const now = performance.now();
    const r = this.queue.push(line, now);
    if (r === "interrupt") this.cut();
    this.pump();
  }

  /** The line being said stopped (a more urgent one, the voice off). */
  cut() {
    const cur = this.queue.current;
    if (!cur) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const u = this.utter;
    this.utter = null;
    // (its own end event is let go: the next line starts here)
    if (u) u.onend = u.onerror = null;
    this.synth?.cancel();
    this.queue.done();
    this.host.onEnd(cur);
  }

  /** Everything stopped and forgotten. */
  stop() {
    this.cut();
    this.queue.clear();
  }

  private pump() {
    const l = this.queue.next(performance.now());
    if (!l) return;
    this.said.push({ text: l.text, speaker: l.speaker, at: performance.now() });
    if (this.said.length > 200) this.said.shift();
    this.host.onStart(l);
    const finish = () => {
      if (this.queue.current !== l) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.utter = null;
      this.queue.done();
      this.host.onEnd(l);
      this.pump();
    };
    // (no voice — none in the browser, or switched off —: its reading time, the subtitles alone)
    const synth = this.synth;
    if (!synth || !this.host.enabled()) {
      this.timer = setTimeout(finish, readingMs(l.text));
      return;
    }
    const u = new SpeechSynthesisUtterance(l.text);
    const want = this.host.lang();
    const voices = synth.getVoices();
    let best: SpeechSynthesisVoice | null = null,
      bs = -1;
    for (const v of voices) {
      const s = voiceScore(v, want);
      if (s > bs) (bs = s), (best = v);
    }
    if (best) u.voice = best;
    u.lang = best?.lang ?? (want === "fr" ? "fr-FR" : "en-US");
    const st = SPEAKER_STYLE[l.speaker];
    u.rate = st.rate;
    u.pitch = st.pitch;
    u.volume = Math.min(Math.max(this.host.volume(), 0), 1);
    u.onend = u.onerror = finish;
    this.utter = u;
    // (a voice that never ends — some engines lose the event —: let go after twice its reading time)
    this.timer = setTimeout(finish, 2 * readingMs(l.text) + 4000);
    synth.speak(u);
  }
}
