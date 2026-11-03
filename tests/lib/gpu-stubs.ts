// A test's fake GPU device given what the imagery's mips pass asks of it (src/system/earth-tiles.ts orthoMips — T9a, T9b): a
// shader module, a render pipeline, buffers, bind groups, an encoder whose passes draw nothing, textures' views. The fake's
// own textures and queue writes kept as they are.
const g = globalThis as { GPUBufferUsage?: unknown };
g.GPUBufferUsage ??= { UNIFORM: 64, COPY_DST: 8, COPY_SRC: 4, MAP_READ: 1, STORAGE: 128 };

export function withGpuStubs(dev: GPUDevice): GPUDevice {
  const d = dev as unknown as {
    createTexture: (x: { size: number[] }) => Record<string, unknown>;
    queue: Record<string, unknown>;
  };
  const pass = { setPipeline() {}, setBindGroup() {}, setViewport() {}, setScissorRect() {}, draw() {}, end() {} };
  const stubs = {
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: () => ({ destroy() {} }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
  };
  return Object.assign({}, stubs, dev, {
    createTexture: (x: { size: number[] }) => ({ createView: () => ({}), width: x.size[0], ...d.createTexture(x) }),
    queue: { writeBuffer() {}, submit() {}, ...d.queue },
  }) as unknown as GPUDevice;
}
