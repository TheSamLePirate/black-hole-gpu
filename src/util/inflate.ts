// A file served gzip-compressed (its own bytes: 1f 8b), inflated here — the meshes compressed at build
// time (PLAN-MONDE M3: the Endurance's, the Ranger's, the Lander's, −44 to −50 %); a file as it was
// stored (not compressed) passes through, so an older build's still loads.

/** The bytes of a response, inflated if they are gzip's. */
export async function inflated(res: Response): Promise<ArrayBuffer> {
  const raw = await res.arrayBuffer();
  const h = new Uint8Array(raw, 0, Math.min(2, raw.byteLength));
  if (h[0] !== 0x1f || h[1] !== 0x8b) return raw;
  return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
