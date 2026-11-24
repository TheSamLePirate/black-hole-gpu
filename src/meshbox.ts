// What the meshes drawn into a box of the image share — the ISS (station.ts) and JWST (jwst.ts): one vertex format
// (24 bytes: position float32×3, normal snorm8×4, colour/kind unorm8×4, part uint8×4), the three pipelines of their
// shaders (the 4× MSAA shading into the box — colour and its distance —, the Sun's shadow map, the composite into the
// linear HDR image before bloom), the box itself (the bounding sphere's projection, its MSAA and resolved targets
// kept while they fit) and the composite pass. Each renderer keeps its own uniforms, meshes and draws.

import type { Vec3 } from "./physics";

/** One vertex: position float32×3, normal snorm8×4, colour (alpha: the surface kind) unorm8×4, part uint8×4. */
export const MESH_STRIDE = 24;

const VERTEX_LAYOUT: GPUVertexBufferLayout[] = [
  {
    arrayStride: MESH_STRIDE,
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x3" },
      { shaderLocation: 1, offset: 12, format: "snorm8x4" },
      { shaderLocation: 2, offset: 16, format: "unorm8x4" },
      { shaderLocation: 3, offset: 20, format: "uint8x4" },
    ],
  },
];

/** The three pipelines' descriptors over one module (entry points vs/fs, shadowVs, compVs/compFs) — created at once
 *  (createRenderPipeline: the ISS's, at start-up) or in the background (createRenderPipelineAsync: JWST's, on approach). */
export function meshBoxPipelines(module: GPUShaderModule, label: string) {
  const main: GPURenderPipelineDescriptor = {
    label,
    layout: "auto",
    vertex: { module, entryPoint: "vs", buffers: VERTEX_LAYOUT },
    fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }, { format: "rg16float" }] },
    // (no culling: panels, foils and arrays are single sheets)
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    multisample: { count: 4 },
  };
  const shadow: GPURenderPipelineDescriptor = {
    label: `${label}: shadow map`,
    layout: "auto",
    vertex: { module, entryPoint: "shadowVs", buffers: VERTEX_LAYOUT },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less", depthBias: 2, depthBiasSlopeScale: 2 },
  };
  const comp: GPURenderPipelineDescriptor = {
    label: `${label} composite`,
    layout: "auto",
    vertex: { module, entryPoint: "compVs" },
    fragment: {
      module,
      entryPoint: "compFs",
      targets: [
        {
          format: "rgba16float",
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  };
  return { main, shadow, comp };
}

/**
 * The image's box [x, y, w, h] a bounding sphere (centre `p` in the camera frame — x right, y up, z forward —, radius
 * R) projects into, 4 px of margin; all of the image when the camera is in or at the sphere; null when behind or out.
 */
export function sphereBox(p: Vec3, R: number, W: number, H: number, tanH: number, aspect: number): [number, number, number, number] | null {
  if (p[2] < -R) return null;
  const dist = Math.hypot(...p);
  let bx = 0,
    by = 0,
    bw = W,
    bh = H;
  if (p[2] > R + 0.5 && dist > R * 1.05) {
    const sx = (x: number, z: number) => ((x / (z * tanH * aspect) + 1) / 2) * W;
    const sy = (y: number, z: number) => ((1 - y / (z * tanH)) / 2) * H;
    const zr = p[2] - R;
    const x0 = Math.floor(Math.min(sx(p[0] - R, zr), sx(p[0] - R, p[2] + R))) - 4;
    const x1 = Math.ceil(Math.max(sx(p[0] + R, zr), sx(p[0] + R, p[2] + R))) + 4;
    const y0 = Math.floor(Math.min(sy(p[1] + R, zr), sy(p[1] + R, p[2] + R))) - 4;
    const y1 = Math.ceil(Math.max(sy(p[1] - R, zr), sy(p[1] - R, p[2] + R))) + 4;
    bx = Math.max(0, x0);
    by = Math.max(0, y0);
    bw = Math.min(W, x1) - bx;
    bh = Math.min(H, y1) - by;
  }
  return bw > 0 && bh > 0 ? [bx, by, bw, bh] : null;
}

/** A sphere's apparent radius on the image [px] (radius R at distance `dist`, image height H, tan of half the fov). */
export function sphereRadiusPx(R: number, dist: number, H: number, tanH: number): number {
  return dist > R ? (Math.asin(R / dist) / Math.atan(tanH)) * (H / 2) : Number.POSITIVE_INFINITY;
}

/** The box's targets: 4× MSAA colour, distance and depth, their resolved colour and distance. */
export interface MeshBoxTargets {
  w: number;
  h: number;
  color: GPUTexture;
  depthColor: GPUTexture;
  depth: GPUTexture;
  resColor: GPUTexture;
  resDepth: GPUTexture;
  comp?: GPUBindGroup;
}

/** The box's targets, kept while the box fits them (within 1.5× + 64 px), else made anew — the old ones destroyed once the
 *  work already submitted is done (a pass encoded earlier this frame — the ship's, hidden behind the box — may read them). */
export class MeshBox {
  current: MeshBoxTargets | null = null;
  constructor(private device: GPUDevice) {}

  ensure(w: number, h: number): MeshBoxTargets {
    const b = this.current;
    if (b && b.w >= w && b.h >= h && b.w <= 1.5 * w + 64 && b.h <= 1.5 * h + 64) return b;
    this.release();
    const d = this.device;
    const ms = (format: GPUTextureFormat) =>
      d.createTexture({ size: [w, h], format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const res = (format: GPUTextureFormat) =>
      d.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.current = {
      w,
      h,
      color: ms("rgba16float"),
      depthColor: ms("rg16float"),
      depth: ms("depth24plus"),
      resColor: res("rgba16float"),
      resDepth: res("rg16float"),
    };
    return this.current;
  }

  /** Lets its targets go (destroyed after the work submitted). */
  release() {
    const b = this.current;
    if (!b) return;
    this.current = null;
    const old = [b.color, b.depthColor, b.depth, b.resColor, b.resDepth];
    void this.device.queue.onSubmittedWorkDone().then(() => {
      for (const t of old) t.destroy();
    });
  }
}

/** The colour attachments and depth of the box's shading pass (cleared; MSAA resolved into the box's own). */
export function meshBoxPass(box: MeshBoxTargets): GPURenderPassDescriptor {
  return {
    colorAttachments: [
      {
        view: box.color.createView(),
        resolveTarget: box.resColor.createView(),
        loadOp: "clear",
        storeOp: "discard",
        clearValue: [0, 0, 0, 0],
      },
      {
        view: box.depthColor.createView(),
        resolveTarget: box.resDepth.createView(),
        loadOp: "clear",
        storeOp: "discard",
        clearValue: [0, 0, 0, 0],
      },
    ],
    depthStencilAttachment: { view: box.depth.createView(), depthLoadOp: "clear", depthClearValue: 1, depthStoreOp: "discard" },
  };
}

/** The box composited into `hdr` (premultiplied, over), within its rectangle. */
export function compositeMeshBox(
  device: GPUDevice,
  enc: GPUCommandEncoder,
  label: string,
  hdr: GPUTexture,
  comp: GPURenderPipeline,
  uniform: GPUBuffer,
  box: MeshBoxTargets,
  bx: number,
  by: number,
) {
  const cp = enc.beginRenderPass({
    label,
    colorAttachments: [{ view: hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: "load", storeOp: "store" }],
  });
  cp.setPipeline(comp);
  box.comp ??= device.createBindGroup({
    layout: comp.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 4, resource: box.resColor.createView() },
    ],
  });
  cp.setBindGroup(0, box.comp);
  cp.setScissorRect(bx, by, Math.min(box.w, hdr.width - bx), Math.min(box.h, hdr.height - by));
  cp.draw(3);
  cp.end();
}
