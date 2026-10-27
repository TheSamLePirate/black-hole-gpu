import { expect, test } from "bun:test";
import { windowsIntegratedGpu } from "../src/tier";

const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

test("a Windows laptop drawing on its integrated GPU is told; a discrete GPU or another system is not", () => {
  expect(
    windowsIntegratedGpu({ userAgent: WIN, vendor: "intel", description: "Intel(R) Iris(R) Xe Graphics", architecture: "gen-12lp" }),
  ).toBe("intel");
  expect(windowsIntegratedGpu({ userAgent: WIN, vendor: "intel", description: "Intel(R) Arc(TM) A770 Graphics" })).toBeNull();
  expect(windowsIntegratedGpu({ userAgent: WIN, vendor: "amd", description: "AMD Radeon(TM) Graphics" })).toBe("amd");
  expect(windowsIntegratedGpu({ userAgent: WIN, vendor: "amd", description: "AMD Radeon 780M" })).toBe("amd");
  expect(windowsIntegratedGpu({ userAgent: WIN, vendor: "amd", description: "AMD Radeon RX 5700 XT" })).toBeNull();
  expect(windowsIntegratedGpu({ userAgent: WIN, vendor: "nvidia", description: "NVIDIA GeForce RTX 4050 Laptop GPU" })).toBeNull();
  expect(windowsIntegratedGpu({ userAgent: MAC, vendor: "intel", description: "Intel Iris Plus" })).toBeNull();
  // (an empty description — Chrome may give only the vendor —: Intel still told, AMD not guessed)
  expect(windowsIntegratedGpu({ userAgent: WIN, vendor: "intel", description: "" })).toBe("intel");
  expect(windowsIntegratedGpu({ userAgent: WIN, vendor: "amd", description: "" })).toBeNull();
});
