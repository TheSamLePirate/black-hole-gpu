// The page's side of scripts/render-music.ts: a theme rendered offline (an OfflineAudioContext), its intensity
// following a curve, returned as 16-bit PCM WAV bytes (base64) and its levels.
import { MusicEngine } from "../../src/audio/music/engine";

declare global {
  interface Window {
    renderTheme: (
      id: string,
      secs: number,
      curve: [number, number][],
      seed: number,
    ) => Promise<{ wav: string; peak: number; rms: number; sub: number }>;
  }
}

window.renderTheme = async (id, secs, curve, seed) => {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(sr * secs), sr);
  const eng = new MusicEngine(ctx, ctx.destination);
  eng.seed = seed;
  const at = (t: number) => {
    let v = curve[0]![1];
    for (let i = 1; i < curve.length; i++) {
      const [t0, v0] = curve[i - 1]!,
        [t1, v1] = curve[i]!;
      if (t >= t0 && t <= t1) v = v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      if (t > t1) v = v1;
    }
    return v;
  };
  eng.play(id, 0, 0.05);
  for (let t = 0; t < secs; t += 0.1) {
    eng.intensityWant = at(t);
    eng.pump(t, 0.1, 0.5);
  }
  eng.stop(secs - 3, 2.5);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0),
    R = buf.getChannelData(1);
  let peak = 0,
    s = 0,
    lp = 0,
    sub = 0;
  const k = 1 - Math.exp((-2 * Math.PI * 90) / sr);
  for (let i = 0; i < L.length; i++) {
    const m = (L[i]! + R[i]!) / 2;
    peak = Math.max(peak, Math.abs(L[i]!), Math.abs(R[i]!));
    s += m * m;
    lp += (m - lp) * k;
    sub += lp * lp;
  }
  // (16-bit PCM WAV)
  const n = L.length;
  const bytes = new ArrayBuffer(44 + n * 4);
  const v = new DataView(bytes);
  const w = (o: number, str: string) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 4, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i]!)) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i]!)) * 32767, true);
  }
  let bin = "";
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { wav: btoa(bin), peak, rms: Math.sqrt(s / n), sub: Math.sqrt(sub / n) };
};
