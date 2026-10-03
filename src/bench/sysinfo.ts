// What the benchmark ran on: the GPU as WebGPU names it, its features and key limits, the browser, the
// screen, the CPU threads and memory the browser tells — nothing that identifies a person.
import type { Renderer } from "../renderer";
import type { BenchReport } from "./report";

interface UAData {
  brands?: { brand: string; version: string }[];
  platform?: string;
  mobile?: boolean;
}

export function systemInfo(r: Renderer): BenchReport["system"] {
  const a = r.adapter;
  const nav = navigator as Navigator & { userAgentData?: UAData; deviceMemory?: number };
  const ua = nav.userAgentData;
  const mq = (q: string) => typeof matchMedia !== "undefined" && matchMedia(q).matches;
  return {
    gpu: {
      vendor: a?.vendor ?? "",
      architecture: a?.architecture ?? "",
      device: a?.device ?? "",
      description: a?.description ?? "",
      fallback: !!a?.fallback,
    },
    features: a?.features ?? [],
    limits: a?.limits ?? {},
    browser: {
      ua: navigator.userAgent,
      brands: (ua?.brands ?? []).filter((b) => !/not.a.brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`),
      platform: ua?.platform ?? navigator.platform ?? "",
      mobile: ua?.mobile ?? mq("(pointer: coarse)"),
    },
    screen: {
      css: [screen.width, screen.height],
      dpr: devicePixelRatio,
      gamut: mq("(color-gamut: rec2020)") ? "rec2020" : mq("(color-gamut: p3)") ? "p3" : "srgb",
      hdr: mq("(dynamic-range: high)"),
    },
    cpuThreads: navigator.hardwareConcurrency ?? 0,
    deviceMemoryGB: nav.deviceMemory ?? null,
    tier: { guessed: r.tier.level, label: r.tier.label, measured: null },
  };
}
