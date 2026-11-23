// Pure terminal mouse & focus sequence guard for xterm.js <-> Unkernel serial TTY.
// Solves three classic terminal mouse bugs without breaking real TUI clicks/scrolls (claude, pi, vim, htop, bh-tui):
//   1. Stuck DEC mouse/focus tracking (?1000/?1002/?1003/?1006/?1015/?1004) after Ctrl+C or TUI crash -> auto-resets.
//   2. 120 Hz bare hover-motion floods (\x1b[<35;col;rowM) overflowing Unkernel's virtual serial TTY FIFO and splitting
//      escape codes into visible garbage text (`35;42;12M`) -> bare hover motion is suppressed; clicks pass instantly;
//      button-drag & wheel events are cleanly rate-limited.
//   3. Mouse sequences emitted while dragging/resizing the OBC HUD window or when mouse reporting is off -> dropped.

export const TERMINAL_MOUSE_RESET_SEQ = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1004l";

export const TERMINAL_FULL_SANE_SEQ = `${TERMINAL_MOUSE_RESET_SEQ}\x1b[?1049l\x1b[?25h\x1b[0m`;

// Matches SGR (\x1b[<btn;x;yM|m), URXVT (\x1b[btn;x;yM), X10 (\x1b[M + 3 bytes), or Focus (\x1b[I|\x1b[O).
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CSI escape parser intentionally matches ESC (\x1b).
const MOUSE_OR_FOCUS_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])|\x1b\[(\d+);(\d+);(\d+)M|\x1b\[M([\s\S]{3})|\x1b\[([IO])/g;

// Matches DEC private mode set/reset sequences (\x1b[?1000;1006h / \x1b[?1003l) or RIS (\x1bc).
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CSI escape parser intentionally matches ESC (\x1b).
const DEC_MODE_RE = /\x1b\[\?([0-9;]+)([hl])|\x1bc/g;

// Shell prompt pattern on normal screen indicating a TUI has exited back to ash/bash.
const SHELL_PROMPT_RE = /(?:\/home\/pilot\s*[→>$#]|~[/$# ]|root@[^\n]*[#])\s*$/;

export interface MouseFilterState {
  clickTracking: boolean; // ?1000
  dragTracking: boolean; // ?1002
  anyMotionTracking: boolean; // ?1003
  sgrEncoding: boolean; // ?1006
  focusReporting: boolean; // ?1004
  altScreen: boolean; // ?1049 / ?1047 / ?47
}

export class TerminalMouseGuard {
  private clickTracking = false;
  private dragTracking = false;
  private anyMotionTracking = false;
  private sgrEncoding = false;
  private focusReporting = false;
  private altScreen = false;
  private lastDragAt = 0;
  private lastWheelAt = 0;
  private tailText = "";

  get mouseTrackingActive(): boolean {
    return this.clickTracking || this.dragTracking || this.anyMotionTracking;
  }

  get state(): MouseFilterState {
    return {
      clickTracking: this.clickTracking,
      dragTracking: this.dragTracking,
      anyMotionTracking: this.anyMotionTracking,
      sgrEncoding: this.sgrEncoding,
      focusReporting: this.focusReporting,
      altScreen: this.altScreen,
    };
  }

  /** Reset tracked mouse/focus state (call after sending TERMINAL_MOUSE_RESET_SEQ to xterm). */
  resetModes(resetAltScreen = false) {
    this.clickTracking = false;
    this.dragTracking = false;
    this.anyMotionTracking = false;
    this.sgrEncoding = false;
    this.focusReporting = false;
    if (resetAltScreen) this.altScreen = false;
  }

  /**
   * Observe guest -> host PTY output to track active DEC mouse/focus/alt-screen modes.
   * Returns `true` if stale mouse/focus modes were detected after returning to a normal shell prompt
   * (caller should write `TERMINAL_MOUSE_RESET_SEQ` locally into xterm.js).
   */
  observeGuestOutput(text: string): boolean {
    if (!text) return false;
    let sawModeDisableOrAltLeave = false;
    DEC_MODE_RE.lastIndex = 0;
    for (let m = DEC_MODE_RE.exec(text); m !== null; m = DEC_MODE_RE.exec(text)) {
      if (m[0] === "\x1bc") {
        this.resetModes(true);
        continue;
      }
      const enable = m[2] === "h";
      const codes = (m[1] ?? "").split(";");
      for (const c of codes) {
        switch (c) {
          case "1000":
            this.clickTracking = enable;
            break;
          case "1002":
            this.dragTracking = enable;
            break;
          case "1003":
            this.anyMotionTracking = enable;
            break;
          case "1006":
            this.sgrEncoding = enable;
            break;
          case "1004":
            this.focusReporting = enable;
            break;
          case "47":
          case "1047":
          case "1049":
            this.altScreen = enable;
            if (!enable) sawModeDisableOrAltLeave = true;
            break;
          default:
            break;
        }
      }
    }

    // If a TUI left the alternate screen without turning off mouse/focus tracking, heal immediately.
    if (sawModeDisableOrAltLeave && (this.mouseTrackingActive || this.focusReporting)) {
      this.resetModes(false);
      return true;
    }

    // Strip ANSI escape codes from a short rolling tail to detect returning to the shell prompt on normal screen.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Stripping ANSI CSI/OSC sequences from rolling output tail.
    const plain = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
    this.tailText = (this.tailText + plain).slice(-120);
    if (!this.altScreen && (this.mouseTrackingActive || this.focusReporting) && SHELL_PROMPT_RE.test(this.tailText)) {
      this.resetModes(false);
      return true;
    }

    return false;
  }

  /**
   * Filter `xterm.js` `onData` payload before sending to Unkernel's virtual serial TTY.
   * - Normal keyboard text & arrow/control keys are untouched.
   * - Stale mouse/focus sequences (when guest didn't enable tracking, or `allowMouse=false`, or `suppressAllMouse=true`) are dropped.
   * - Bare hover-motion sequences (`btn & 32` with `(btn & 3) === 3`, e.g. SGR `<35;x;yM`) are ALWAYS dropped so moving the mouse
   *   never floods the serial FIFO or prints `[<35;...M` characters into the console.
   * - Click/release events pass immediately; button-drag is capped to 20 Hz; wheel is capped to 30 Hz.
   */
  filterInput(data: string, opts: { allowMouse: boolean; suppressAllMouse?: boolean; nowMs?: number }): string {
    if (!data || !data.includes("\x1b[")) return data;
    const now = opts.nowMs ?? Date.now();
    const allow = opts.allowMouse && !opts.suppressAllMouse;

    let out = "";
    let lastIndex = 0;
    MOUSE_OR_FOCUS_RE.lastIndex = 0;
    for (let m = MOUSE_OR_FOCUS_RE.exec(data); m !== null; m = MOUSE_OR_FOCUS_RE.exec(data)) {
      if (m.index > lastIndex) out += data.slice(lastIndex, m.index);
      lastIndex = m.index + m[0].length;

      // FocusIn / FocusOut (\x1b[I or \x1b[O)
      if (m[9]) {
        if (allow && this.focusReporting) out += m[0];
        continue;
      }

      if (!allow || !this.mouseTrackingActive) continue;

      let btn = -1;
      let isRelease = false;
      if (m[1] !== undefined) {
        // SGR: \x1b[<btn;col;rowM|m
        btn = Number.parseInt(m[1], 10);
        isRelease = m[4] === "m";
      } else if (m[5] !== undefined) {
        // URXVT: \x1b[btn;col;rowM
        btn = Number.parseInt(m[5], 10) - 32;
      } else if (m[8] !== undefined) {
        // X10: \x1b[M + 3 bytes
        btn = m[8].charCodeAt(0) - 32;
      }

      if (btn < 0) continue;

      // Wheel events (bit 64): allow, rate-limited to 30 Hz
      if ((btn & 64) !== 0) {
        if (now - this.lastWheelAt >= 33) {
          this.lastWheelAt = now;
          out += m[0];
        }
        continue;
      }

      // Motion events (bit 32):
      // - Bare hover motion ((btn & 3) === 3, e.g. SGR 35 / 39 / 43 / 51): NEVER forward (prevents serial FIFO spam)
      // - Active button-drag ((btn & 3) !== 3, e.g. 32/33/34): allow, rate-limited to 20 Hz
      if ((btn & 32) !== 0 && !isRelease) {
        if ((btn & 3) === 3) continue;
        if (now - this.lastDragAt >= 50) {
          this.lastDragAt = now;
          out += m[0];
        }
        continue;
      }

      // Button press / release: always pass immediately
      out += m[0];
    }

    if (lastIndex < data.length) out += data.slice(lastIndex);
    return out;
  }
}
