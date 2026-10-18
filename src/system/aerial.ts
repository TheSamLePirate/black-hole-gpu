// The aerial perspective's table (trace.wgsl aerial, apRead; renderer.ts dispatchTrace): what the kernel needs of the
// device, and the tracer without it where the device lacks that.

/** the sampled textures the main kernel needs with the aerial perspective's table (its two more) */
export const AERIAL_TEXTURE_LIMIT = 21;
/** The tracer without the aerial perspective's table where the device cannot bind its two textures more: its
 *  bindings, its reading (never with its flag on then) and its pass's kernel left out. */
export function aerialShader(code: string, supported: boolean): string {
  if (supported) return code;
  return code
    .replace(/^@group\(1\) @binding\((4|5|6|7|8)\).*\n/gm, "")
    .replace(
      /fn apRead\([\s\S]*?(?=@compute @workgroup_size\(8, 8\)\nfn aerial\()/,
      "fn apRead(t: f32, tFar: f32) -> EarthAir { var o: EarthAir; o.T = vec3f(1.0); return o; }\nfn apCovers(t: f32, tFar: f32) -> bool { return false; }\n\n",
    )
    .replace(/@compute @workgroup_size\(8, 8\)\nfn aerial\([\s\S]*?(?=fn earthLook\()/, "");
}
