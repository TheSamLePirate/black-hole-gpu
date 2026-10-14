// The players' voices (docs/PLAN-RESEAU.md, R2): our microphone sent on each direct link (WebRTC, Opus — echo
// cancelled, noise suppressed, its gain kept even), opened by our voice (the default), by a key held, or
// always; each other's voice played on the sound's voice bus — through a radio from craft to craft (the band of
// a headset's, a little drive, a hiss while he speaks, the Quindar tones at the start and the end of what he
// says, as Apollo's) —, the engines and the ambience lowered under him, who speaks shown. Two devices on one
// network do not hear each other (they are in one room: an echo); each other's volume, muted or not.

import { sound } from "../audio/engine";
import { t } from "../i18n";
import { store } from "../util/storage";
import type { NetPanel } from "./netpanel";

type Mode = "vad" | "ptt" | "open";

interface VoicePrefs {
  mode: Mode;
  /** voice activation's threshold [dBFS] */
  threshold: number;
  /** the push-to-talk key (a key's code), null: none chosen */
  pttKey: string | null;
  radio: boolean;
  /** devices on one network not heard (they are in one room) */
  sameRoomMute: boolean;
  volumes: Record<string, number>;
}

const KEY = "kerr.net.voice";
const DEFAULTS: VoicePrefs = { mode: "vad", threshold: -48, pttKey: null, radio: true, sameRoomMute: true, volumes: {} };

interface Peer {
  stream: MediaStream;
  el: HTMLAudioElement;
  src: MediaStreamAudioSourceNode;
  an: AnalyserNode;
  out: GainNode;
  hiss: GainNode;
  chain: AudioNode[];
  speaking: boolean;
  loudAt: number;
}

const rms = (a: AnalyserNode, buf: Float32Array<ArrayBuffer>) => {
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!;
  return 10 * Math.log10(s / buf.length + 1e-12);
};

export class NetVoice {
  prefs: VoicePrefs = { ...DEFAULTS, ...store.getJSON<Partial<VoicePrefs>>(KEY, {}) };
  /** our microphone on */
  on = false;
  /** we speak now (sent) */
  talking = false;
  /** the Quindar tones played (the tests') */
  quindars = 0;
  private mic: MediaStream | null = null;
  /** the track sent (the microphone's clone) */
  private send: MediaStreamTrack | null = null;
  private micAn: AnalyserNode | null = null;
  private micLoudAt = -1;
  private pttHeld = false;
  private peers = new Map<number, Peer>();
  private bound: NetPanel["net"] = null;
  private unbind: (() => void) | null = null;
  private buf = new Float32Array(1024);

  constructor(
    private panel: NetPanel,
    private toast: (s: string) => void,
  ) {
    addEventListener(
      "keydown",
      (e: KeyboardEvent) => {
        if (this.prefs.mode === "ptt" && this.prefs.pttKey && e.code === this.prefs.pttKey && this.on) {
          this.pttHeld = true;
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    addEventListener(
      "keyup",
      (e: KeyboardEvent) => {
        if (this.prefs.pttKey && e.code === this.prefs.pttKey) this.pttHeld = false;
      },
      true,
    );
  }

  save() {
    store.setJSON(KEY, this.prefs);
  }

  /** Our microphone asked for (the browser's permission) and sent; or false (refused, none). */
  async enable(): Promise<boolean> {
    if (this.on) return true;
    const io = sound.voiceInput();
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      this.toast(t("No microphone (refused or none)"));
      return false;
    }
    if (io) {
      this.micAn = io.ctx.createAnalyser();
      this.micAn.fftSize = 1024;
      // (a graph that reaches the output, silent: Chrome pulls a microphone's source only then)
      const mute = io.ctx.createGain();
      mute.gain.value = 0;
      io.ctx.createMediaStreamSource(this.mic).connect(this.micAn).connect(mute).connect(io.ctx.destination);
    }
    // (a clone sent, opened and closed by the voice — the microphone itself kept on: a disabled track is
    // silence, and the voice activation listens to it)
    this.send = this.mic.getAudioTracks()[0]?.clone() ?? null;
    if (this.send) this.send.enabled = this.prefs.mode === "open";
    this.panel.net?.setMic(this.send);
    this.on = true;
    return true;
  }

  disable() {
    this.panel.net?.setMic(null);
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.send?.stop();
    this.send = null;
    this.mic = null;
    this.micAn = null;
    this.on = false;
    this.talking = false;
  }

  /** the others' voices received (the tests') */
  get heard() {
    return this.peers.size;
  }

  /** the levels now [dBFS]: our microphone's, each other's (the tests', a meter) */
  levels() {
    const out: Record<string, number> = {};
    if (this.micAn) out.mic = rms(this.micAn, this.buf);
    for (const [s, P] of this.peers) out[s] = rms(P.an, this.buf);
    return out;
  }

  /** whether another speaks now */
  speaking(slot: number) {
    return !!this.peers.get(slot)?.speaking;
  }

  volume(slot: number) {
    return this.prefs.volumes[this.panel.net?.room?.members.find((m) => m.slot === slot)?.device ?? String(slot)] ?? 1;
  }

  setVolume(slot: number, v: number) {
    const dev = this.panel.net?.room?.members.find((m) => m.slot === slot)?.device ?? String(slot);
    this.prefs.volumes[dev] = v;
    this.save();
  }

  private bind() {
    const net = this.panel.net;
    if (net === this.bound) return;
    this.unbind?.();
    this.unbind = null;
    for (const s of [...this.peers.keys()]) this.drop(s);
    this.bound = net;
    if (!net) {
      if (this.on) this.disable();
      return;
    }
    this.unbind = net.on("voice", ({ slot, stream }) => (stream ? this.add(slot, stream) : this.drop(slot)));
    // (the microphone kept across a new client: sent again)
    if (this.on && this.send) net.setMic(this.send);
  }

  private add(slot: number, stream: MediaStream) {
    this.drop(slot);
    const io = sound.voiceInput();
    if (!io) return;
    const { ctx, bus } = io;
    // (Chrome plays a remote stream through Web Audio only while a media element holds it too: muted)
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const out = ctx.createGain();
    out.gain.value = 0;
    // the radio: a headset's band, a little drive; its hiss while he speaks
    const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 320, Q: 0.7 });
    const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 3200, Q: 0.7 });
    const drive = new WaveShaperNode(ctx, { curve: softClip(2.2) });
    const chain: AudioNode[] = [hp, lp, drive];
    if (this.prefs.radio) src.connect(hp).connect(lp).connect(drive).connect(out);
    else src.connect(out);
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    const noise = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    noise.buffer = nb;
    noise.loop = true;
    noise
      .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1800, Q: 0.6 }))
      .connect(hiss)
      .connect(out);
    noise.start();
    out.connect(bus);
    this.peers.set(slot, { stream, el, src, an, out, hiss, chain, speaking: false, loudAt: -1 });
  }

  private drop(slot: number) {
    const P = this.peers.get(slot);
    if (!P) return;
    this.peers.delete(slot);
    try {
      P.src.disconnect();
      P.out.disconnect();
      P.el.srcObject = null;
    } catch {
      /* gone */
    }
  }

  /** The Quindar tone (NASA's: 2 525 Hz at the start of a transmission, 2 475 Hz at its end), a quarter second. */
  private quindar(start: boolean) {
    const io = sound.voiceInput();
    if (!io) return;
    const { ctx, bus } = io;
    const o = new OscillatorNode(ctx, { type: "sine", frequency: start ? 2525 : 2475 });
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
    g.gain.setValueAtTime(0.12, t0 + 0.24);
    g.gain.linearRampToValueAtTime(0, t0 + 0.25);
    o.connect(g).connect(bus);
    o.start(t0);
    o.stop(t0 + 0.26);
    this.quindars++;
  }

  /** The frame: our voice opened or closed, each other's level read — his start and end said by the tones —,
   *  the engines lowered while someone speaks. */
  frame() {
    this.bind();
    const now = performance.now();
    const net = this.panel.net;
    // ours
    const track = this.send;
    if (track && this.micAn) {
      const loud = rms(this.micAn, this.buf) > this.prefs.threshold;
      if (loud) this.micLoudAt = now;
      const vad = now - this.micLoudAt < 350;
      const want = this.prefs.mode === "open" || (this.prefs.mode === "ptt" ? this.pttHeld : vad);
      if (track.enabled !== want) track.enabled = want;
      this.talking = want;
    }
    // each other's
    let anyone = false;
    const ctx = sound.voiceInput()?.ctx;
    for (const [slot, P] of this.peers) {
      const L = net?.mesh?.peers.get(slot);
      // (on one network: in one room — not heard, unless asked)
      const silenced = this.prefs.sameRoomMute && L?.route === "host";
      const level = rms(P.an, this.buf);
      if (level > -55) P.loudAt = now;
      const speaking = !silenced && now - P.loudAt < 400;
      if (speaking !== P.speaking) {
        P.speaking = speaking;
        if (this.prefs.radio) this.quindar(speaking);
      }
      anyone ||= speaking;
      if (ctx) {
        const vol = silenced ? 0 : this.volume(slot);
        P.out.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
        P.hiss.gain.setTargetAtTime(speaking && this.prefs.radio ? 0.02 : 0, ctx.currentTime, 0.03);
      }
    }
    sound.duck(anyone);
  }
}

/** A gentle saturation: tanh's, normalised. */
function softClip(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}
