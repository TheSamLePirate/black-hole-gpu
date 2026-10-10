// The kernel's variant bits (src/shaders/trace.wgsl's `override` constants: HAS_SHADE, HAS_WX, …) for a
// shader-slice test — a few of the kernel's functions compiled alone in a compute shader to check their
// numbers: each override the slice does not define itself, declared as a constant at its default. A new
// variant bit used by a sliced function no longer breaks the slice with "unresolved value".

/** `const NAME: T = default;` for every override of `kernel` that `slice` does not already declare. */
export function overrideConsts(kernel: string, slice: string): string {
  return [...kernel.matchAll(/^override\s+(\w+)\s*:\s*(\w+)\s*=\s*([^;]+);/gm)]
    .filter(([, name]) => !new RegExp(`\\b(const|override|let|var(<[^>]*>)?)\\s+${name}\\b`).test(slice))
    .map(([, name, type, value]) => `const ${name}: ${type} = ${value!.trim()};`)
    .join(" ");
}
