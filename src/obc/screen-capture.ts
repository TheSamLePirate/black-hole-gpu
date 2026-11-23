// AAA 3D Cockpit Screen Input Capture (Keyboard + Mouse) & Double-Click Camera Guard.
// When the pilot clicks on an interactive 3D cockpit screen (F-35 PCD OBC, A320 Lower ECAM OBC / MCDU,
// Ranger/Lander/Endurance MFD OBC), keyboard and mouse inputs are captured directly into that screen
// (Linux OBC terminal / /dev/fb0 pointer / A320 MCDU) while suppressing flight shortcuts and double-click
// camera resets until the pilot clicks outside the screen or presses Shift+Esc / Alt+Esc.

import { keyEventToAnsi } from "../ui/obc-console";
import type { ObcRuntime } from "./runtime";

export type CockpitScreenTargetKind = "obc" | "mcdu";

export interface CockpitScreenFocus {
  id: string;
  label: string;
  kind: CockpitScreenTargetKind;
  side?: 0 | 1;
  slot?: number;
}

export interface McduCaptureLike {
  pageId: string;
  type(text: string): void;
  button(k: string): void;
  arrow(dir: "left" | "right" | "up" | "down"): void;
  lsk(side: "L" | "R", n: number): void;
}

let activeScreenCapture = false;

/** Global fast predicate checked by `isTyping(e)` so flight keys never fire while a 3D screen is captured. */
export function isCockpitScreenCaptured(): boolean {
  return activeScreenCapture;
}

/** Pure helper: whether double-click camera reset must be suppressed on the 3D canvas. */
export function shouldSuppressCameraDblClick(hitScreenOrControl: boolean, captured: boolean, recentlyHitScreen: boolean): boolean {
  return hitScreenOrControl || captured || recentlyHitScreen;
}

/** Pure helper: map a DOM keyboard event to an A320 MCDU action when typing directly on a 3D MCDU screen. */
export function translateMcduKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">,
): { kind: "type"; text: string } | { kind: "button"; key: string } | { kind: "arrow"; dir: "left" | "right" | "up" | "down" } | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case "Backspace":
    case "Delete":
      return { kind: "button", key: "CLR" };
    case "ArrowUp":
      return { kind: "arrow", dir: "up" };
    case "ArrowDown":
      return { kind: "arrow", dir: "down" };
    case "ArrowLeft":
      return { kind: "arrow", dir: "left" };
    case "ArrowRight":
      return { kind: "arrow", dir: "right" };
    default:
      if (e.key.length === 1 && /^[a-zA-Z0-9./+\- ]$/.test(e.key)) {
        return { kind: "type", text: e.key.toUpperCase() };
      }
      return null;
  }
}

function isObcConsoleToggleKey(e: KeyboardEvent): boolean {
  return (
    e.key === "F11" ||
    (e.ctrlKey && !e.altKey && !e.metaKey && (e.code === "Backslash" || e.code === "Backquote" || e.key === "\\" || e.key === "²"))
  );
}

export class CockpitScreenCapture {
  private focus: CockpitScreenFocus | null = null;
  private lastScreenHitAt = -Infinity;
  private badgeEl: HTMLElement | null = null;
  private badgeTextEl: HTMLElement | null = null;
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;

  constructor(
    private obc: ObcRuntime,
    private getMcdus: () => [McduCaptureLike, McduCaptureLike] | null,
    private isHudConsoleOpen: () => boolean,
  ) {
    this.onKeyDownBound = (e) => this.handleKeyDown(e);
    this.onKeyUpBound = (e) => this.handleKeyUp(e);
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.onKeyDownBound, true);
      window.addEventListener("keyup", this.onKeyUpBound, true);
    }
  }

  get active(): boolean {
    return this.focus !== null;
  }

  current(): CockpitScreenFocus | null {
    return this.focus ? { ...this.focus } : null;
  }

  /** Record any interaction with ANY 3D cockpit screen so fast double-clicks never reset the camera. */
  markScreenHit() {
    this.lastScreenHitAt = performance.now();
  }

  recentlyHitScreen(windowMs = 650): boolean {
    return performance.now() - this.lastScreenHitAt < windowMs;
  }

  /** Capture keyboard & mouse input into the given 3D cockpit screen. */
  attach(target: CockpitScreenFocus) {
    this.markScreenHit();
    this.focus = { ...target };
    activeScreenCapture = true;
    if (target.kind === "obc" && this.obc.status().phase === "off") {
      void this.obc.boot();
    }
    this.renderBadge();
  }

  /** Release keyboard & mouse capture cleanly back to the simulator. */
  release() {
    if (!this.focus && !activeScreenCapture) return;
    this.focus = null;
    activeScreenCapture = false;
    this.renderBadge();
  }

  /** Forward normalized 3D screen pointer coordinates `(u, v)` to `/dev/fb0` evdev when active. */
  forwardPointer(u: number, v: number, buttons: number) {
    this.markScreenHit();
    if (this.focus?.kind !== "obc") return;
    if (this.obc.status().fbActive) {
      this.obc.sendPointer(Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)), buttons > 0);
    }
  }

  /** Forward mouse wheel over a 3D OBC screen (evdev wheel in `/dev/fb0` mode, Up/Down arrows in TTY/TUI mode). */
  forwardWheel(dir: number): boolean {
    this.markScreenHit();
    if (!dir) return true;
    if (this.focus?.kind === "mcdu") {
      const m = this.getMcdus()?.[this.focus.side ?? 0];
      if (m) m.arrow(dir > 0 ? "down" : "up");
      return true;
    }
    if (this.obc.status().fbActive) {
      this.obc.sendWheel(dir > 0 ? 1 : -1);
      return true;
    }
    if (this.obc.status().phase === "ready") {
      // Arrow Down / Arrow Up for seamless TUI scrolling directly on 3D cockpit screens
      this.obc.write(dir > 0 ? "\x1b[B" : "\x1b[A");
    }
    return true;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (!this.focus) return;
    if (this.isHudConsoleOpen()) {
      this.release();
      return;
    }
    // Let global HUD OBC console toggle shortcut work and hand off cleanly
    if (isObcConsoleToggleKey(e)) {
      this.release();
      return;
    }
    // Shift+Esc or Alt+Esc releases 3D screen capture while keeping bare Esc free for TUIs/vim
    if (e.key === "Escape" && (e.shiftKey || e.altKey)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.release();
      return;
    }
    if (e.metaKey) return;

    if (this.focus.kind === "obc") {
      const seq = keyEventToAnsi(e);
      if (seq !== null) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (this.obc.status().phase === "ready") {
          this.obc.write(seq);
        }
      } else if (!e.ctrlKey && !e.altKey) {
        // Swallow bare modifier/unknown keys so they never trigger simulator shortcuts
        e.stopPropagation();
      }
      return;
    }

    if (this.focus.kind === "mcdu") {
      const m = this.getMcdus()?.[this.focus.side ?? 0];
      if (!m) {
        this.release();
        return;
      }
      // If user navigated the MCDU onto the OBC page, transparently upgrade to OBC terminal typing!
      if (m.pageId === "obc") {
        const seq = keyEventToAnsi(e);
        if (seq !== null) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (this.obc.status().phase === "ready") this.obc.write(seq);
          return;
        }
      }
      const act = translateMcduKey(e);
      if (act) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (act.kind === "type") m.type(act.text);
        else if (act.kind === "button") m.button(act.key);
        else m.arrow(act.dir);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.release();
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    if (!this.focus || this.isHudConsoleOpen() || isObcConsoleToggleKey(e) || e.metaKey) return;
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  private ensureBadge() {
    if (this.badgeEl || typeof document === "undefined") return;
    const el = document.createElement("div");
    el.className = "obc-screen-capture-badge";
    el.dataset.testid = "obc-screen-capture-badge";
    el.style.display = "none";

    const dot = document.createElement("span");
    dot.className = "obc-scb-dot";
    const text = document.createElement("span");
    text.className = "obc-scb-text";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "obc-scb-btn";
    btn.dataset.testid = "obc-screen-capture-release";
    btn.textContent = "Release";
    btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.release();
    });

    el.append(dot, text, btn);
    document.body.append(el);
    this.badgeEl = el;
    this.badgeTextEl = text;
  }

  private renderBadge() {
    if (typeof document === "undefined") return;
    this.ensureBadge();
    if (!this.badgeEl || !this.badgeTextEl) return;
    if (!this.focus) {
      this.badgeEl.style.display = "none";
      return;
    }
    const modeHint = this.focus.kind === "obc" ? "TTY / Arrows / Mouse" : "MCDU Keyboard";
    this.badgeTextEl.textContent = `${this.focus.label} · ${modeHint} captured · Click outside or Shift+Esc`;
    this.badgeEl.style.display = "flex";
  }

  dispose() {
    this.release();
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.onKeyDownBound, true);
      window.removeEventListener("keyup", this.onKeyUpBound, true);
    }
    this.badgeEl?.remove();
    this.badgeEl = null;
    this.badgeTextEl = null;
  }
}
