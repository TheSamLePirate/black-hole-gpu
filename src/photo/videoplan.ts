// A video's plan (PLAN-MODES-AAA M8): its shots, the draft's size and sampling (a shot tested in seconds, low
// resolution and few samples, before the final render), its frames, its file's name. Pure (tests/videoplan.test.ts).

/** What a video films: the scene going on from now, a take recorded live, a camera move, the director's cameras. */
export const SHOTS = ["live", "take", "orbit", "dive", "journey", "director"] as const;
export type Shot = (typeof SHOTS)[number];

/** The draft's box, its long and short sides: the final size fitted in it (its aspect kept, a portrait turned), even
 *  sides (the encoders' need). */
export const DRAFT_BOX: [number, number] = [640, 360];
/** The draft's samples per pixel: the motion and the timing read, the noise left. */
export const DRAFT_SPP = 4;

/** The draft's size for a final size: fitted in DRAFT_BOX (never larger than the final), even sides, 16 px at least. */
export function draftSize(w: number, h: number): [number, number] {
  const k = Math.min(1, DRAFT_BOX[0] / Math.max(w, h), DRAFT_BOX[1] / Math.min(w, h));
  const even = (x: number) => Math.max(16, Math.round((x * k) / 2) * 2);
  return [even(w), even(h)];
}

/** The frames of a video of `seconds` at `fps` (one at least). */
export function videoFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

/** The video's file name: the scene's stem, the shot, its length, its rate, a draft marked. */
export function videoName(stem: string, shot: Shot, seconds: number, fps: number, draft: boolean, ext: string): string {
  return `${stem}-${shot}-${Math.round(seconds)}s-${fps}fps${draft ? "-draft" : ""}.${ext}`;
}
