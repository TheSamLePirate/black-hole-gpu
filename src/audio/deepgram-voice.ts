// The voices by Deepgram (Aura-2: TARS's, mission control's, the tower's — the settings' choice): a line sent
// over Deepgram's speak WebSocket, its sound coming back as 16-bit PCM at 24 kHz, gathered, then played by the
// game's own audio (engine.ts playVoice: TARS's grit, a radio's band, his place in the cockpit). Its way in as
// the ear's (ai/deepgram.ts): the key pasted, or the dev server's relay; neither: the robot or the system's.

import { deepgramKey, probeRelay } from "../ai/deepgram";

/** the sound's rate [Hz] */
export const VOICE_RATE = 24000;

/** Where to send a line: Deepgram itself (the key as the WebSocket's subprotocol), or the dev server's relay. */
export async function speakTarget(model: string): Promise<{ url: string; protocols?: string[] } | null> {
  const q = new URLSearchParams({ model, encoding: "linear16", sample_rate: String(VOICE_RATE) }).toString();
  const key = deepgramKey.get();
  if (key) return { url: `wss://api.deepgram.com/v1/speak?${q}`, protocols: ["token", key] };
  if (await probeRelay()) return { url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__deepgram/speak?${q}` };
  return null;
}

/** Whether a Deepgram voice is within reach (a key, or the relay). */
export async function voiceReachable(): Promise<boolean> {
  return !!deepgramKey.get() || (await probeRelay());
}

/** 16-bit little-endian PCM as samples [-1, 1]. */
export function fromPcm16(b: Uint8Array): Float32Array {
  const n = b.length >> 1;
  const v = new DataView(b.buffer, b.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 32768;
  return out;
}

/** The lines said: their sound kept (the same line, the same voice: not asked twice — a callout repeated, a test). */
export class DeepgramVoice {
  private cache = new Map<string, Float32Array>();

  constructor(private target: (model: string) => Promise<{ url: string; protocols?: string[] } | null> = speakTarget) {}

  /** A line's sound in a voice (null: out of reach, refused, the time out — 12 s). */
  async synth(text: string, model: string): Promise<Float32Array | null> {
    const id = `${model}\n${text}`;
    const kept = this.cache.get(id);
    if (kept) {
      // (kept as the newest)
      this.cache.delete(id);
      this.cache.set(id, kept);
      return kept;
    }
    const t = await this.target(model);
    if (!t) return null;
    const pcm = await new Promise<Uint8Array | null>((done) => {
      const chunks: Uint8Array[] = [];
      let settled = false;
      const end = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok || !chunks.length) return done(null);
        const n = chunks.reduce((s, c) => s + c.length, 0);
        const all = new Uint8Array(n);
        let o = 0;
        for (const c of chunks) {
          all.set(c, o);
          o += c.length;
        }
        done(all);
      };
      const ws = new WebSocket(t.url, t.protocols);
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => {
        ws.close();
        end(false);
      }, 12_000);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "Speak", text }));
        ws.send(JSON.stringify({ type: "Flush" }));
      };
      ws.onmessage = (m) => {
        if (typeof m.data !== "string") return void chunks.push(new Uint8Array(m.data as ArrayBuffer));
        // (all of it come: closed)
        if (m.data.includes('"Flushed"')) {
          end(true);
          ws.send(JSON.stringify({ type: "Close" }));
          ws.close();
        }
      };
      ws.onclose = () => end(chunks.length > 0);
    });
    if (!pcm) return null;
    const samples = fromPcm16(pcm);
    this.cache.set(id, samples);
    if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value!);
    return samples;
  }
}
