// TARS's ear by Deepgram (its live recognition, nova-3): the microphone streamed as it is spoken — mono, 16 kHz,
// 16-bit PCM — over a WebSocket, the words coming back as they are heard. The same in every browser (Arc, Brave,
// Firefox have no recognition of their own, or none that works). Its way in: a key pasted in TARS's console
// (/deepgram — kept in this browser only, sent to Deepgram only), else the dev server's relay (`/__deepgram`,
// the key of its .env, which never leaves it); neither: the browser's own recognition (listen.ts).

import { store } from "../util/storage";

const KEY = "kerr.deepgram.key";

/** The pasted key: this browser's (none: the relay, or the browser's recognition). */
export const deepgramKey = {
  get(): string | null {
    const k = store.get(KEY);
    return k && /^[\w-]{20,}$/.test(k) ? k : null;
  },
  set(k: string): boolean {
    const v = k.trim();
    if (!/^[\w-]{20,}$/.test(v)) return false;
    return store.set(KEY, v);
  },
  clear() {
    store.remove(KEY);
  },
  hint(): string | null {
    const k = this.get();
    return k ? `…${k.slice(-4)}` : null;
  },
};

/** Where to stream: Deepgram itself (the pasted key, as the WebSocket's subprotocol) or the dev server's relay. */
export interface EarTarget {
  url: string;
  protocols?: string[];
}

let relay: boolean | null = null;

/** The way in, if any: the key pasted, else the relay when the server has one (asked once). */
export async function earTarget(lang: "fr" | "en"): Promise<EarTarget | null> {
  const q = new URLSearchParams({
    model: "nova-3",
    language: lang,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    endpointing: "300",
    // (his name, which it heard as "Tar")
    keyterm: "TARS",
  }).toString();
  const key = deepgramKey.get();
  if (key) return { url: `wss://api.deepgram.com/v1/listen?${q}`, protocols: ["token", key] };
  if (relay === null) {
    try {
      relay = (await fetch("/__deepgram", { signal: AbortSignal.timeout(3000) })).ok;
    } catch {
      relay = false;
    }
  }
  return relay ? { url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__deepgram?${q}` } : null;
}

/** A turn's ear: the words as they come (interim, final), its failure, its end. */
export interface EarHooks {
  interim(text: string): void;
  final(text: string): void;
  error(code: string): void;
  /** a line for the diagnosis (the console's trail) */
  note?(what: string): void;
}

/** The samples brought down to a lower rate (a box average over each output sample's span). */
export function downsample(x: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return x;
  const k = from / to;
  const n = Math.floor(x.length / k);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * k),
      b = Math.min(Math.floor((i + 1) * k), x.length);
    let s = 0;
    for (let j = a; j < b; j++) s += x[j]!;
    out[i] = s / Math.max(b - a, 1);
  }
  return out;
}

/** Samples [-1, 1] as 16-bit little-endian PCM. */
export function pcm16(x: Float32Array): Uint8Array {
  const out = new Uint8Array(x.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < x.length; i++) v.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), true);
  return out;
}

/** A Deepgram message's words: final or interim (null: not a transcript). */
export function readResult(data: string): { text: string; final: boolean } | null {
  try {
    const j = JSON.parse(data) as { type?: string; is_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
    if (j.type !== "Results") return null;
    return { text: (j.channel?.alternatives?.[0]?.transcript ?? "").trim(), final: !!j.is_final };
  } catch {
    return null;
  }
}

/** One turn of listening: the microphone streamed until end(); the last words come before it resolves. */
export class DeepgramEar {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private queue: Uint8Array[] = [];
  private ended = false;
  private closed: Promise<void> = Promise.resolve();

  constructor(private target: EarTarget) {}

  async start(hooks: EarHooks) {
    // (the microphone first: its refusal said as such)
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      hooks.error((e as { name?: string }).name === "NotAllowedError" ? "not-allowed" : "audio-capture");
      return;
    }
    // (released while the microphone was being granted: nothing to send)
    if (this.ended) return this.stopMic();
    const ws = new WebSocket(this.target.url, this.target.protocols);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.closed = new Promise((ok) => {
      ws.onclose = (e) => {
        hooks.note?.(`ws close ${e.code}${e.reason ? ` ${e.reason}` : ""}`);
        // (closed before we asked: the key refused, the network, the relay — said)
        if (!this.ended) hooks.error(e.code === 1008 || e.code === 4001 ? "deepgram-key" : `deepgram-${e.code}`);
        this.release();
        ok();
      };
    });
    ws.onopen = () => {
      hooks.note?.(`ws open, ${this.queue.length} queued`);
      for (const b of this.queue) ws.send(b);
      this.queue = [];
    };
    ws.onmessage = (m) => {
      if (typeof m.data !== "string") return;
      const r = readResult(m.data);
      if (!r) return;
      if (r.final) {
        if (r.text) hooks.final(r.text);
      } else hooks.interim(r.text);
    };
    this.ctx = new AudioContext();
    // (made after the microphone's grant — an await: the key's gesture may be spent, the context left
    // suspended, and nothing would be sent)
    if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
    hooks.note?.(`audio ${this.ctx.state} ${this.ctx.sampleRate} Hz`);
    let sent = 0;
    const src = this.ctx.createMediaStreamSource(this.stream);
    // (a script processor: its output left silent, its input sent on — connected to the output, or it would not run)
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    const rate = this.ctx.sampleRate;
    this.node.onaudioprocess = (e) => {
      if (this.ended) return;
      const b = pcm16(downsample(e.inputBuffer.getChannelData(0), rate, 16000));
      if (sent++ === 0) hooks.note?.("first audio");
      if (ws.readyState === WebSocket.OPEN) ws.send(b);
      else if (ws.readyState === WebSocket.CONNECTING) this.queue.push(b);
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  /** The words ended: the microphone off, Deepgram's last results waited for (3 s at most). */
  async end() {
    this.ended = true;
    this.stopMic();
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
    else if (ws?.readyState === WebSocket.CONNECTING) ws.close();
    await Promise.race([this.closed, new Promise((r) => setTimeout(r, 3000))]);
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
  }

  private stopMic() {
    this.node?.disconnect();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    void this.ctx?.close();
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }

  private release() {
    this.stopMic();
    this.ws = null;
  }
}
