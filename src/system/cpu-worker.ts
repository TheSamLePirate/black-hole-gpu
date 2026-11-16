// Pure CPU work off the page's thread (PLAN-J7 J7-7: at a craft change and a placement, these held images on the main thread): the hulls'
// collision trees (collide.ts TriBVH — the F-35's ~100 ms) and the sea's spectrum (sea/spectrum.ts seaCascades — ~45 ms a new sea state:
// a placement, the real weather's arrival). A request names its job; the answer hands its arrays back without a copy. cpu-client.ts is the
// page's side.
import { TriBVH } from "./collide";
import { type SeaPhysics, type SeaSystem, seaCascades } from "../sea/spectrum";
import { impulseArrays, type NoteJob, renderNotes } from "../audio/music/instruments";

export type CpuRequest =
  | { id: number; job: "bvh"; pos: Float32Array; tri: Uint32Array }
  | { id: number; job: "sea"; systems: SeaSystem[]; seed: number; phys: SeaPhysics }
  | { id: number; job: "mips"; blob: Blob; size: number }
  | { id: number; job: "notes"; sampleRate: number; jobs: NoteJob[]; fresh?: boolean }
  | { id: number; job: "ir"; sampleRate: number; secs: number; bright: number };

const g = globalThis as unknown as { onmessage: unknown; postMessage(v: unknown, t?: Transferable[]): void };
g.onmessage = async (e: MessageEvent<CpuRequest>) => {
  const q = e.data;
  try {
    if (q.job === "mips") {
      // (an image's mip chain, each level resized from the full image — the traffic's maps: 115 ms of the page's thread at the flight's
      // start, PLAN-J7 J7-8)
      const img = await createImageBitmap(q.blob);
      const levels: ImageBitmap[] = [];
      for (let w = q.size; w >= 1; w >>= 1)
        levels.push(await createImageBitmap(img, { resizeWidth: w, resizeHeight: w, resizeQuality: "high" }));
      img.close();
      g.postMessage({ id: q.id, levels }, levels);
      return;
    }
    if (q.job === "notes") {
      // (the music's rendered notes — PLAN-J7 J7-8b: 25–60 ms a brass note on the page's thread at the flight's start)
      const notes = renderNotes(q.sampleRate, q.jobs, q.fresh);
      g.postMessage(
        { id: q.id, notes },
        notes.map((n) => n.data.buffer),
      );
      return;
    }
    if (q.job === "ir") {
      const ir = impulseArrays(q.sampleRate, q.secs, q.bright);
      g.postMessage(
        { id: q.id, ir },
        ir.map((c) => c.buffer),
      );
      return;
    }
    if (q.job === "bvh") {
      const p = new TriBVH(q.pos, q.tri).parts();
      g.postMessage({ id: q.id, ...p }, [p.box.buffer, p.link.buffer, p.order.buffer]);
    } else {
      const s = seaCascades(q.systems, q.seed, q.phys);
      g.postMessage(
        { id: q.id, ...s },
        s.h0.map((a) => a.buffer),
      );
    }
  } catch (err) {
    g.postMessage({ id: q.id, error: String(err) });
  }
};
