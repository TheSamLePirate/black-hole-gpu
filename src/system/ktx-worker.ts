// The KTX2 transcoder's worker (Basis Universal, vendor/basis): a UASTC file to the GPU's own
// compressed format — BC7 (desktop), ASTC 4×4 (Apple, mobile) — or RGBA8 when it has neither, level by
// level, off the frame loop. Built on its own (server.ts, scripts/build-pages.ts) as ktx-worker.js.
// @ts-expect-error (an Emscripten module, CommonJS, untyped)
import BASIS from "../../vendor/basis/basis_transcoder.js";

export type KtxTarget = "bc7" | "astc" | "rgba";
export interface KtxRequest { id: number; url: string; target: KtxTarget; wasm: string }
export interface KtxReply { id: number; width?: number; height?: number; levels?: Uint8Array[]; error?: string }

// (the transcoder's formats: basisu_transcoder.h, transcoder_texture_format)
const FORMAT: Record<KtxTarget, [string, number]> = { bc7: ["cTFBC7_RGBA", 6], astc: ["cTFASTC_4x4_RGBA", 10], rgba: ["cTFRGBA32", 13] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: Promise<any> | null = null;
const g = globalThis as unknown as { onmessage: unknown; postMessage: (m: unknown, t?: Transferable[]) => void };
// (one file at a time: the transcoder's instance is shared — files interleaved across their fetches
// failed to transcode)
let chain: Promise<void> = Promise.resolve();
g.onmessage = (e: MessageEvent<KtxRequest>) => {
  chain = chain.then(() => handle(e.data));
};
async function handle(q: KtxRequest) {
  try {
    mod ??= BASIS({ locateFile: () => q.wasm }).then((m: { initializeBasis(): void }) => (m.initializeBasis(), m));
    const m = await mod;
    const [name, num] = FORMAT[q.target];
    const format = m.transcoder_texture_format?.[name]?.value ?? num;
    const data = new Uint8Array(await (await fetch(q.url)).arrayBuffer());
    const f = new m.KTX2File(data);
    try {
      if (!f.isValid() || !f.startTranscoding()) throw new Error(`not a valid KTX2 file: ${q.url}`);
      const levels: Uint8Array[] = [];
      for (let l = 0; l < f.getLevels(); l++) {
        const out = new Uint8Array(f.getImageTranscodedSizeInBytes(l, 0, 0, format));
        if (!f.transcodeImage(out, l, 0, 0, format, 0, -1, -1)) throw new Error(`transcoding level ${l} of ${q.url} failed`);
        levels.push(out);
      }
      const r: KtxReply = { id: q.id, width: f.getWidth(), height: f.getHeight(), levels };
      g.postMessage(r, levels.map((x) => x.buffer as ArrayBuffer));
    } finally {
      f.close();
      f.delete();
    }
  } catch (err) {
    g.postMessage({ id: q.id, error: String(err) } satisfies KtxReply);
  }
}
