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

  process(_inputs: Float32Array[][], outputs: Float32Array[][], p: Record<string, Float32Array>) {
    const out = outputs[0];
    if (!out?.length) return true;
    const ch = out[0]!;
    this.synth.process(ch, { throttle: p.throttle![0]!, air: p.air![0]!, pitch: p.pitch![0]! });
    for (let k = 1; k < out.length; k++) out[k]!.set(ch);
    return true;
  }
}

registerProcessor("kerr-rocket", RocketProcessor);
