// The rocket engine's AudioWorklet (PLAN-AUDIO S2): the granular synth (rocket.ts) on the audio thread, its
// controls as k-rate parameters — the throttle applied, the air's density, the Doppler's pitch. Bundled on
// its own and loaded by URL next to the page (server.ts in development, the pages build): audio-worklet.js.

import { RocketSynth } from "./rocket";

// (the AudioWorkletGlobalScope's own names: not in the DOM's types)
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class RocketProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "throttle", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "air", defaultValue: 0, minValue: 0, maxValue: 2, automationRate: "k-rate" },
      { name: "pitch", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" },
    ];
  }

  private synth = new RocketSynth(sampleRate, (Math.random() * 4294967296) >>> 0);
  /** the block's controls, one object kept: none made per 128 samples on the audio thread (audit TA-24) */
  private ctl = { throttle: 0, air: 0, pitch: 1 };

  process(_inputs: Float32Array[][], outputs: Float32Array[][], p: Record<string, Float32Array>) {
    const out = outputs[0];
    if (!out?.length) return true;
    const ch = out[0]!;
    const c = this.ctl;
    c.throttle = p.throttle![0]!;
    c.air = p.air![0]!;
    c.pitch = p.pitch![0]!;
    this.synth.process(ch, c);
    for (let k = 1; k < out.length; k++) out[k]!.set(ch);
    return true;
  }
}

registerProcessor("kerr-rocket", RocketProcessor);

/** TARS's ear (ai/deepgram.ts): the microphone's samples handed to the page in parts of 1 024 (≈ 21 ms at 48 kHz) — the
 *  ScriptProcessorNode it replaces (deprecated) waited for 4 096 (≈ 85 ms) before the first (audit TA-22). */
export const MIC_PART = 1024;
class MicProcessor extends AudioWorkletProcessor {
  private part = new Float32Array(MIC_PART);
  private n = 0;

  process(inputs: Float32Array[][]) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const k = Math.min(ch.length - i, MIC_PART - this.n);
      this.part.set(ch.subarray(i, i + k), this.n);
      this.n += k;
      i += k;
      if (this.n === MIC_PART) {
        // (handed over, not copied: a new part for the next samples)
        this.port.postMessage(this.part, [this.part.buffer]);
        this.part = new Float32Array(MIC_PART);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("kerr-mic", MicProcessor);
