// Lightweight OBC terminal & status view for the remote Crew console (crew/ — docs/PLAN-LINUX-OBC.md §3.3).
// Zero xterm.js dependency: pure 2D canvas rendering so crew/ stays well under its 375 KB bundle budget.

import type { ObcCrewSnapshot } from "../../obc/types";
import { L } from "../lang";
import { C, type Pen, type Rect } from "./kit";

export interface CrewObcAction {
  label: string;
  rect: Rect;
  kind: "boot" | "script";
  script?: string;
}

/** Render the Linux OBC screen inside the Crew console canvas, returning clickable quick-action buttons. */
export function drawObcView(p: Pen, r: Rect, snap: ObcCrewSnapshot | null): CrewObcAction[] {
  const actions: CrewObcAction[] = [];
  const pad = 10;
  const headH = 34;
  const footH = 38;
  const c = p.c;

  // Frame
  c.fillStyle = "#041922";
  c.fillRect(r.x, r.y, r.w, r.h);
  c.fillStyle = "#083344";
  c.fillRect(r.x, r.y, r.w, headH);
  p.seg(r.x, r.y + headH, r.x + r.w, r.y + headH, C.cyan, 1);

  const phase = snap?.phase ?? "off";
  const led = phase === "ready" ? C.green : phase === "booting" ? C.amber : phase === "error" ? C.red : C.dim;
  p.text(
    `${phase === "ready" ? "●" : "○"} ${L("LINUX OBC · ORDINATEUR DE BORD", "LINUX OBC · ON-BOARD COMPUTER")}`,
    r.x + pad,
    r.y + headH / 2,
    { size: 13, col: led, align: "left", base: "middle", weight: 700 },
  );
  const rightMeta = snap
    ? `${snap.distro} · ${snap.fbActive ? "FB0" : "TTY"} · dτ/dt ${snap.dtauDt.toFixed(4)}`
    : L("En attente du simulateur", "Waiting for simulator");
  p.text(rightMeta, r.x + r.w - pad, r.y + headH / 2, { size: 11, col: C.dim, align: "right", base: "middle" });

  // Terminal lines body
  const bx = r.x + pad;
  const by = r.y + headH + 8;
  const bw = Math.max(40, r.w - 2 * pad);
  const bh = Math.max(40, r.h - headH - footH - 16);

  if (!snap || snap.phase === "off") {
    p.text(L("OBC en veille — appuyez sur Démarrer", "OBC on standby — tap Boot"), bx + bw / 2, by + bh / 2 - 12, {
      size: 14,
      col: C.cyan,
      align: "center",
      base: "middle",
      weight: 700,
    });
    p.text(
      L("Alpine 3.24 aarch64 · /obc/telemetry.json · /dev/fb0", "Alpine 3.24 aarch64 · /obc/telemetry.json · /dev/fb0"),
      bx + bw / 2,
      by + bh / 2 + 12,
      { size: 11, col: C.dim, align: "center", base: "middle" },
    );
  } else {
    const lines = snap.lines.length ? snap.lines : [L("Démarrage du noyau Linux...", "Booting Linux kernel...")];
    const lineH = Math.max(12, Math.min(20, Math.floor(bh / Math.max(lines.length, 16))));
    const fs = Math.max(10, Math.min(14, lineH - 3));
    for (let i = 0; i < lines.length; i++) {
      const y = by + i * lineH + lineH * 0.5;
      if (y > by + bh) break;
      const text = lines[i]!;
      const col =
        text.includes("ERROR") || text.includes("CRITICAL")
          ? C.red
          : text.startsWith("╔") || text.startsWith("║") || text.startsWith("╚")
            ? C.cyan
            : C.text;
      p.text(text.slice(0, 84), bx + 4, y, { size: fs, col, align: "left", base: "middle" });
    }
  }

  // Quick action strip at foot
  const fy = r.y + r.h - footH;
  c.fillStyle = "#072836";
  c.fillRect(r.x, fy, r.w, footH);
  p.seg(r.x, fy, r.x + r.w, fy, "#1b5568", 1);
  const defs: { label: string; kind: "boot" | "script"; script?: string }[] = [
    { label: phase === "off" ? L("Démarrer", "Boot") : "Diag", kind: phase === "off" ? "boot" : "script", script: "diag" },
    { label: L("Orbite", "Orbit"), kind: "script", script: "orbit" },
    { label: L("Rentrée", "Reentry"), kind: "script", script: "reentry" },
    { label: "ILS", kind: "script", script: "ils" },
    { label: L("Solaire", "Solar"), kind: "script", script: "solar" },
    { label: "FB0", kind: "script", script: "fb-demo" },
  ];
  const gap = 6;
  const bwBtn = Math.floor((r.w - pad * 2 - gap * (defs.length - 1)) / defs.length);
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!;
    const rect: Rect = { x: r.x + pad + i * (bwBtn + gap), y: fy + 6, w: bwBtn, h: footH - 12 };
    p.round(rect.x, rect.y, rect.w, rect.h, 4);
    p.fill("#0b4154");
    p.stroke(C.cyan, 1);
    p.text(d.label, rect.x + rect.w / 2, rect.y + rect.h / 2, {
      size: 11,
      col: C.text,
      align: "center",
      base: "middle",
      weight: 700,
    });
    actions.push({ label: d.label, rect, kind: d.kind, script: d.script });
  }

  return actions;
}
