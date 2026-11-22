// AAA Avionics Display Renderer for the embedded Linux OBC (docs/PLAN-LINUX-OBC.md §3–4).
// Renders either live `/dev/fb0` XRGB8888 pixels OR the VT100/ANSI terminal mirror into any 2D canvas
// (Ranger/Lander/Endurance 3D cockpit screens, F-35 PCD portal, A320 Lower ECAM & tablet, HUD preview).
// Includes subtle craft-tuned phosphor glow, micro-scanlines, telemetry footer, and zero-allocation FB blits.

import type { TermBuffer } from "./term-buffer";
import type { ObcPhase, ObcTheme } from "./types";

const FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

export interface ObcPalette {
  bg: string;
  bgDeep: string;
  panel: string;
  border: string;
  glow: string;
  text: string;
  dim: string;
  accent: string;
  ok: string;
  warn: string;
  err: string;
  scanline: string;
}

export const OBC_PALETTES: Record<ObcTheme, ObcPalette> = {
  interstellar: {
    bg: "#04212c",
    bgDeep: "#02131a",
    panel: "#08394a",
    border: "#62e6ff",
    glow: "rgba(98, 230, 255, 0.22)",
    text: "#c6f7ff",
    dim: "#3c9fb6",
    accent: "#62e6ff",
    ok: "#7dff9a",
    warn: "#ffb347",
    err: "#ff5a46",
    scanline: "rgba(98, 230, 255, 0.045)",
  },
  f35: {
    bg: "#071014",
    bgDeep: "#03080b",
    panel: "#0d1f26",
    border: "#34d8ff",
    glow: "rgba(75, 227, 138, 0.16)",
    text: "#d8f8ff",
    dim: "#528999",
    accent: "#4be38a",
    ok: "#4be38a",
    warn: "#ffbf47",
    err: "#ff5544",
    scanline: "rgba(52, 216, 255, 0.03)",
  },
  a320: {
    bg: "#05070a",
    bgDeep: "#020305",
    panel: "#101720",
    border: "#3ec8ff",
    glow: "rgba(62, 200, 255, 0.14)",
    text: "#e6f5ff",
    dim: "#5b7991",
    accent: "#3ec8ff",
    ok: "#2ee66b",
    warn: "#ffaa22",
    err: "#ff4438",
    scanline: "rgba(255, 255, 255, 0.02)",
  },
  amber: {
    bg: "#160e04",
    bgDeep: "#0c0702",
    panel: "#261807",
    border: "#ffb347",
    glow: "rgba(255, 179, 71, 0.22)",
    text: "#ffe3b3",
    dim: "#9e6d2c",
    accent: "#ffb347",
    ok: "#ffd27d",
    warn: "#ff8c2b",
    err: "#ff4a36",
    scanline: "rgba(255, 179, 71, 0.05)",
  },
};

export interface ObcDrawSource {
  phase: ObcPhase;
  term: TermBuffer;
  fbFrame: { width: number; height: number; data: Uint8ClampedArray; rev: number } | null;
  fbFps?: number;
  dtauDt: number;
  activeScript: string | null;
  lastError: string | null;
  bootMs: number | null;
  crtFx?: boolean;
  themeOverride?: "auto" | ObcTheme;
  vessel?: string;
  body?: string;
  altMsl?: number;
  tasMps?: number;
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Scratch canvas used to scale `/dev/fb0` ImageData cleanly onto any target cockpit rectangle. */
let fbScratch: OffscreenCanvas | null = null;
let fbScratchCtx: OffscreenCanvasRenderingContext2D | null = null;
let fbScratchRev = -1;

function blitFramebuffer(
  g: Canvas2D,
  fb: { width: number; height: number; data: Uint8ClampedArray; rev: number },
  x: number,
  y: number,
  w: number,
  h: number,
  pal: ObcPalette,
) {
  if (!fbScratch || fbScratch.width !== fb.width || fbScratch.height !== fb.height) {
    fbScratch = new OffscreenCanvas(fb.width, fb.height);
    fbScratchCtx = fbScratch.getContext("2d");
    fbScratchRev = -1;
  }
  if (!fbScratchCtx) return;
  if (fbScratchRev !== fb.rev) {
    const img = new ImageData(new Uint8ClampedArray(fb.data), fb.width, fb.height);
    fbScratchCtx.putImageData(img, 0, 0);
    fbScratchRev = fb.rev;
  }
  const scale = Math.min(w / fb.width, h / fb.height);
  const dw = Math.round(fb.width * scale);
  const dh = Math.round(fb.height * scale);
  const dx = Math.round(x + (w - dw) / 2);
  const dy = Math.round(y + (h - dh) / 2);
  g.fillStyle = pal.bgDeep;
  g.fillRect(x, y, w, h);
  g.imageSmoothingEnabled = scale < 1;
  g.drawImage(fbScratch, dx, dy, dw, dh);
  g.imageSmoothingEnabled = true;

  // Crisp instrumentation frame around active framebuffer
  g.strokeStyle = pal.border;
  g.globalAlpha = 0.45;
  g.lineWidth = 1.5;
  g.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
  g.globalAlpha = 1;
}

function drawCrtOverlay(g: Canvas2D, pal: ObcPalette, x: number, y: number, w: number, h: number) {
  // Micro-scanlines (4px pitch — sharp, zero blur, < 0.08 ms)
  g.fillStyle = pal.scanline;
  for (let sy = y + 2; sy < y + h; sy += 4) {
    g.fillRect(x, sy, w, 1);
  }
  // Subtle corner glass registration ticks
  const tk = Math.max(8, Math.min(16, Math.round(Math.min(w, h) * 0.035)));
  g.strokeStyle = pal.border;
  g.globalAlpha = 0.35;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x + 3, y + 3 + tk);
  g.lineTo(x + 3, y + 3);
  g.lineTo(x + 3 + tk, y + 3);
  g.moveTo(x + w - 3 - tk, y + 3);
  g.lineTo(x + w - 3, y + 3);
  g.lineTo(x + w - 3, y + 3 + tk);
  g.moveTo(x + 3, y + h - 3 - tk);
  g.lineTo(x + 3, y + h - 3);
  g.lineTo(x + 3 + tk, y + h - 3);
  g.moveTo(x + w - 3 - tk, y + h - 3);
  g.lineTo(x + w - 3, y + h - 3);
  g.lineTo(x + w - 3, y + h - 3 - tk);
  g.stroke();
  g.globalAlpha = 1;
}

/**
 * Draw the live OBC display (either `/dev/fb0` graphical framebuffer or ANSI terminal mirror)
 * inside rectangle `(x, y, w, h)` using the craft's native palette (or user theme override).
 */
export function drawObcSurface(
  g: Canvas2D,
  src: ObcDrawSource,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ObcTheme,
  opts: { header?: boolean; footer?: boolean; hint?: string } = {},
) {
  const effectiveTheme: ObcTheme = src.themeOverride && src.themeOverride !== "auto" ? src.themeOverride : theme;
  const pal = OBC_PALETTES[effectiveTheme];
  const showHeader = opts.header !== false;
  const showFooter = opts.footer === true && h >= 280;
  const headerH = showHeader ? Math.max(24, Math.min(34, Math.round(h * 0.062))) : 0;
  const footerH = showFooter ? Math.max(22, Math.min(28, Math.round(h * 0.048))) : 0;

  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();

  // Deep avionics backdrop with subtle radial phosphor vignette
  g.fillStyle = pal.bg;
  g.fillRect(x, y, w, h);
  if (src.crtFx !== false) {
    const grad = g.createRadialGradient(x + w * 0.5, y + h * 0.45, w * 0.1, x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.72);
    grad.addColorStop(0, pal.glow);
    grad.addColorStop(1, "rgba(0,0,0,0.34)");
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
  }

  if (showHeader) {
    g.fillStyle = pal.panel;
    g.fillRect(x, y, w, headerH);
    g.strokeStyle = pal.border;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, y + headerH);
    g.lineTo(x + w, y + headerH);
    g.stroke();

    const badgeColor =
      src.phase === "ready"
        ? pal.ok
        : src.phase === "booting" || src.phase === "suspended"
          ? pal.warn
          : src.phase === "error"
            ? pal.err
            : pal.dim;
    const fs = Math.max(11, Math.min(16, Math.round(headerH * 0.48)));
    g.font = `700 ${fs}px ${FONT}`;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = badgeColor;
    const modeTag = src.fbFrame ? (src.fbFps ? `FB0 ${src.fbFps}Hz` : "FB0") : "TTY";
    const statusText =
      src.phase === "ready"
        ? `● LINUX OBC [${modeTag}]`
        : src.phase === "booting"
          ? "◐ OBC BOOTING…"
          : src.phase === "suspended"
            ? "⏸ OBC SUSPENDED"
            : src.phase === "error"
              ? "✕ OBC FAULT"
              : "○ OBC STANDBY";
    g.fillText(statusText, x + 8, y + headerH / 2);

    g.textAlign = "right";
    g.fillStyle = pal.dim;
    const rightInfo = src.activeScript ? `${src.activeScript} · τ ${src.dtauDt.toFixed(4)}` : `dτ/dt ${src.dtauDt.toFixed(4)}`;
    g.fillText(rightInfo, x + w - 8, y + headerH / 2);
  }

  const bx = x + 6;
  const by = y + headerH + 6;
  const bw = Math.max(16, w - 12);
  const bh = Math.max(16, h - headerH - footerH - 12);

  if (src.phase === "off" || src.phase === "suspended") {
    drawStandby(
      g,
      pal,
      bx,
      by,
      bw,
      bh,
      src.phase === "suspended" ? "VM SNAPSHOT HELD IN RAM · CLICK RESUME" : (opts.hint ?? "CTRL+\\ / F11 · CLICK BOOT"),
      src.phase === "suspended",
    );
  } else if (src.phase === "error") {
    drawMessage(g, pal, bx, by, bw, bh, "OBC KERNEL ERROR", src.lastError ?? "Unknown error", pal.err);
  } else if (src.fbFrame) {
    blitFramebuffer(g, src.fbFrame, bx, by, bw, bh, pal);
  } else {
    // Crisp ANSI terminal mirror
    const term = src.term;
    const cols = term.cols;
    const rows = term.rows;
    const charH = Math.max(9, Math.min(22, Math.floor(bh / rows)));
    const charW = bw / cols;
    const fontSize = Math.max(8, Math.min(charH - 2, Math.floor(charW * 1.62)));

    g.textBaseline = "top";
    g.textAlign = "left";

    for (let r = 0; r < rows; r++) {
      const line = term.grid[r]!;
      const py = by + r * charH;
      if (py + charH > by + bh + 2) break;

      for (let c = 0; c < cols; c++) {
        const cell = line[c]!;
        const px = bx + c * charW;
        if (cell.bg) {
          g.fillStyle = cell.bg;
          g.fillRect(px, py, Math.ceil(charW + 0.5), charH);
        }
        if (cell.ch !== " ") {
          g.font = `${cell.bold ? "700" : "500"} ${fontSize}px ${FONT}`;
          g.fillStyle = cell.fg ?? (cell.dim ? pal.dim : pal.text);
          g.fillText(cell.ch, px, py + 1);
        }
      }
    }

    // Blinking cursor block
    if (src.phase === "ready" && Math.floor(performance.now() / 550) % 2 === 0) {
      const cx = bx + Math.min(term.col, cols - 1) * charW;
      const cy = by + Math.min(term.row, rows - 1) * charH;
      g.fillStyle = pal.accent;
      g.globalAlpha = 0.65;
      g.fillRect(cx, cy + 1, Math.max(4, charW * 0.85), Math.max(6, charH - 2));
      g.globalAlpha = 1;
    }
  }

  if (showFooter) {
    const fy = y + h - footerH;
    g.fillStyle = pal.panel;
    g.fillRect(x, fy, w, footerH);
    g.strokeStyle = pal.border;
    g.globalAlpha = 0.45;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, fy);
    g.lineTo(x + w, fy);
    g.stroke();
    g.globalAlpha = 1;
    const ffs = Math.max(10, Math.min(13, Math.round(footerH * 0.48)));
    g.font = `600 ${ffs}px ${FONT}`;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = pal.text;
    const vLbl = `${(src.vessel ?? "CRAFT").toUpperCase()} · ${(src.body ?? "EARTH").toUpperCase()}`;
    g.fillText(vLbl, x + 8, fy + footerH / 2);
    g.textAlign = "right";
    g.fillStyle = pal.dim;
    const altStr = src.altMsl !== undefined ? `${(src.altMsl / 1000).toFixed(1)} km` : "—";
    const tasStr = src.tasMps !== undefined ? `${src.tasMps.toFixed(0)} m/s` : "—";
    g.fillText(`ALT ${altStr} · V ${tasStr}`, x + w - 8, fy + footerH / 2);
  }

  if (src.crtFx !== false) {
    drawCrtOverlay(g, pal, x, y + headerH, w, h - headerH - footerH);
  }

  g.restore();
}

function drawStandby(g: Canvas2D, pal: ObcPalette, x: number, y: number, w: number, h: number, hint: string, suspended: boolean) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Subtle avionics grid
  g.strokeStyle = pal.scanline;
  g.lineWidth = 1;
  for (let gx = x + 32; gx < x + w; gx += 32) {
    g.beginPath();
    g.moveTo(gx, y);
    g.lineTo(gx, y + h);
    g.stroke();
  }
  for (let gy = y + 32; gy < y + h; gy += 32) {
    g.beginPath();
    g.moveTo(x, gy);
    g.lineTo(x + w, gy);
    g.stroke();
  }
  g.strokeStyle = pal.dim;
  g.lineWidth = 1.5;
  g.strokeRect(x + w * 0.08, y + h * 0.16, w * 0.84, h * 0.68);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = pal.accent;
  g.font = `700 ${Math.max(14, Math.min(24, Math.round(w * 0.055)))}px ${FONT}`;
  g.fillText("LINUX OBC · UNKERNEL", cx, cy - 34);
  g.fillStyle = pal.text;
  g.font = `500 ${Math.max(11, Math.min(16, Math.round(w * 0.036)))}px ${FONT}`;
  g.fillText("Alpine 3.24 aarch64 · /dev/fb0 · AF_VSOCK", cx, cy - 4);
  g.fillStyle = pal.warn;
  g.font = `700 ${Math.max(11, Math.min(16, Math.round(w * 0.036)))}px ${FONT}`;
  g.fillText(suspended ? "SUSPENDED — SNAPSHOT READY" : "STANDBY — ON-DEMAND BOOT (0 MS IDLE)", cx, cy + 26);
  g.fillStyle = pal.dim;
  g.font = `500 ${Math.max(10, Math.min(14, Math.round(w * 0.032)))}px ${FONT}`;
  g.fillText(hint, cx, cy + 54);
}

function drawMessage(g: Canvas2D, pal: ObcPalette, x: number, y: number, w: number, h: number, title: string, body: string, color: string) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.font = `700 ${Math.max(13, Math.min(20, Math.round(w * 0.045)))}px ${FONT}`;
  g.fillText(title, cx, cy - 16);
  g.fillStyle = pal.text;
  g.font = `500 ${Math.max(10, Math.min(14, Math.round(w * 0.032)))}px ${FONT}`;
  g.fillText(body.slice(0, 64), cx, cy + 16);
}
