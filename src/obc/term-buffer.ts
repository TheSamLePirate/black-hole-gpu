// Lightweight pure VT100/ANSI terminal screen buffer for the embedded Linux OBC.
// Feeds 3D cockpit displays (Ranger/F-35/A320), the Crew console mirror, MCDU lines, and `__bh.obc.readScreen()`
// without pulling xterm.js into workers, unit tests, or crew/.

export interface TermCell {
  ch: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
}

const ANSI_16 = [
  "#0c161c",
  "#ff5a46",
  "#7dff9a",
  "#ffb347",
  "#58b8ff",
  "#d58cff",
  "#62e6ff",
  "#c6f7ff",
  "#466a78",
  "#ff8273",
  "#a8ffb9",
  "#ffd27d",
  "#8ad2ff",
  "#e6b5ff",
  "#9bf2ff",
  "#ffffff",
] as const;

function xterm256(n: number): string {
  if (n < 16) return ANSI_16[n] ?? "#c6f7ff";
  if (n < 232) {
    const i = n - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const c = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

const blankCell = (): TermCell => ({ ch: " ", fg: null, bg: null, bold: false, dim: false });

export class TermBuffer {
  cols: number;
  rows: number;
  grid: TermCell[][];
  row = 0;
  col = 0;
  /** Monotonic revision incremented on every visible change (for dirty-checked cockpit canvas redraws). */
  rev = 0;

  private fg: string | null = null;
  private bg: string | null = null;
  private bold = false;
  private dim = false;
  private state: "text" | "esc" | "csi" | "osc" = "text";
  private csi = "";
  private savedRow = 0;
  private savedCol = 0;
  private decoder = new TextDecoder();

  constructor(cols = 64, rows = 24) {
    this.cols = cols;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, () => Array.from({ length: cols }, blankCell));
  }

  clear() {
    for (let r = 0; r < this.rows; r++) {
      const line = this.grid[r]!;
      for (let c = 0; c < this.cols; c++) line[c] = blankCell();
    }
    this.row = 0;
    this.col = 0;
    this.rev++;
  }

  /** Resize the screen mirror to match the live xterm.js dimensions (preserving existing content). */
  resize(cols: number, rows: number) {
    const c = Math.max(20, Math.min(240, Math.round(cols)));
    const r = Math.max(8, Math.min(80, Math.round(rows)));
    if (c === this.cols && r === this.rows) return;
    const next: TermCell[][] = Array.from({ length: r }, (_, rowIdx) => {
      const oldRow = this.grid[rowIdx];
      return Array.from({ length: c }, (_, colIdx) => (oldRow && colIdx < oldRow.length ? oldRow[colIdx]! : blankCell()));
    });
    this.cols = c;
    this.rows = r;
    this.grid = next;
    this.row = Math.min(this.row, r - 1);
    this.col = Math.min(this.col, c - 1);
    this.rev++;
  }

  write(data: string | Uint8Array) {
    const text = typeof data === "string" ? data : this.decoder.decode(data, { stream: true });
    if (!text) return;
    let changed = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const code = ch.charCodeAt(0);

      if (this.state === "esc") {
        if (ch === "[") {
          this.state = "csi";
          this.csi = "";
        } else if (ch === "]") {
          this.state = "osc";
        } else if (ch === "7") {
          this.savedRow = this.row;
          this.savedCol = this.col;
          this.state = "text";
        } else if (ch === "8") {
          this.row = this.savedRow;
          this.col = this.savedCol;
          this.state = "text";
        } else if (ch === "c") {
          this.resetSgr();
          this.clear();
          this.state = "text";
        } else {
          this.state = "text";
        }
        continue;
      }

      if (this.state === "osc") {
        // End of OSC: BEL (\x07) or ST (\x1b\\)
        if (code === 7 || (ch === "\\" && i > 0 && text.charCodeAt(i - 1) === 27)) {
          this.state = "text";
        }
        continue;
      }

      if (this.state === "csi") {
        if (code >= 0x40 && code <= 0x7e) {
          if (this.handleCsi(this.csi, ch)) changed = true;
          this.state = "text";
          this.csi = "";
        } else if (this.csi.length < 48) {
          this.csi += ch;
        }
        continue;
      }

      // Normal text state
      if (code === 0x1b) {
        this.state = "esc";
      } else if (ch === "\r") {
        this.col = 0;
      } else if (ch === "\n") {
        this.newline();
        changed = true;
      } else if (ch === "\b" || code === 0x7f) {
        if (this.col > 0) this.col--;
      } else if (ch === "\t") {
        this.col = Math.min(this.cols - 1, (Math.floor(this.col / 8) + 1) * 8);
      } else if (code >= 0x20) {
        if (this.col >= this.cols) {
          this.col = 0;
          this.newline();
        }
        this.grid[this.row]![this.col] = {
          ch,
          fg: this.fg,
          bg: this.bg,
          bold: this.bold,
          dim: this.dim,
        };
        this.col++;
        changed = true;
      }
    }

    if (changed) this.rev++;
  }

  private newline() {
    if (this.row < this.rows - 1) {
      this.row++;
    } else {
      this.grid.shift();
      this.grid.push(Array.from({ length: this.cols }, blankCell));
    }
  }

  private resetSgr() {
    this.fg = null;
    this.bg = null;
    this.bold = false;
    this.dim = false;
  }

  private handleCsi(rawParams: string, cmd: string): boolean {
    const clean = rawParams.startsWith("?") ? rawParams.slice(1) : rawParams;
    const nums = clean ? clean.split(";").map((s) => (s === "" ? 0 : Number.parseInt(s, 10))) : [];
    const p0 = nums[0] ?? 0;
    const p1 = nums[1] ?? 0;

    switch (cmd) {
      case "H":
      case "f": {
        this.row = Math.max(0, Math.min(this.rows - 1, (p0 || 1) - 1));
        this.col = Math.max(0, Math.min(this.cols - 1, (p1 || 1) - 1));
        return false;
      }
      case "A":
        this.row = Math.max(0, this.row - (p0 || 1));
        return false;
      case "B":
        this.row = Math.min(this.rows - 1, this.row + (p0 || 1));
        return false;
      case "C":
        this.col = Math.min(this.cols - 1, this.col + (p0 || 1));
        return false;
      case "D":
        this.col = Math.max(0, this.col - (p0 || 1));
        return false;
      case "G":
        this.col = Math.max(0, Math.min(this.cols - 1, (p0 || 1) - 1));
        return false;
      case "J": {
        if (p0 === 2 || p0 === 3) {
          this.clear();
          return true;
        }
        if (p0 === 0) {
          for (let c = this.col; c < this.cols; c++) this.grid[this.row]![c] = blankCell();
          for (let r = this.row + 1; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) this.grid[r]![c] = blankCell();
          }
          return true;
        }
        return false;
      }
      case "K": {
        const line = this.grid[this.row]!;
        if (p0 === 0) for (let c = this.col; c < this.cols; c++) line[c] = blankCell();
        else if (p0 === 1) for (let c = 0; c <= this.col && c < this.cols; c++) line[c] = blankCell();
        else if (p0 === 2) for (let c = 0; c < this.cols; c++) line[c] = blankCell();
        return true;
      }
      case "m": {
        const list = nums.length ? nums : [0];
        for (let i = 0; i < list.length; i++) {
          const v = list[i] ?? 0;
          if (v === 0) this.resetSgr();
          else if (v === 1) this.bold = true;
          else if (v === 2) this.dim = true;
          else if (v === 22) (this.bold = false), (this.dim = false);
          else if (v >= 30 && v <= 37) this.fg = ANSI_16[v - 30]!;
          else if (v === 39) this.fg = null;
          else if (v >= 40 && v <= 47) this.bg = ANSI_16[v - 40]!;
          else if (v === 49) this.bg = null;
          else if (v >= 90 && v <= 97) this.fg = ANSI_16[v - 90 + 8]!;
          else if (v >= 100 && v <= 107) this.bg = ANSI_16[v - 100 + 8]!;
          else if ((v === 38 || v === 48) && list[i + 1] === 5 && list[i + 2] !== undefined) {
            const col = xterm256(list[i + 2]!);
            if (v === 38) this.fg = col;
            else this.bg = col;
            i += 2;
          } else if ((v === 38 || v === 48) && list[i + 1] === 2 && list[i + 4] !== undefined) {
            const col = `rgb(${list[i + 2]},${list[i + 3]},${list[i + 4]})`;
            if (v === 38) this.fg = col;
            else this.bg = col;
            i += 4;
          }
        }
        return false;
      }
      case "s":
        this.savedRow = this.row;
        this.savedCol = this.col;
        return false;
      case "u":
        this.row = this.savedRow;
        this.col = this.savedCol;
        return false;
      default:
        return false;
    }
  }

  /** Plain text lines trimmed of trailing whitespace (for Crew, MCDU, and `__bh.obc.readScreen()`). */
  lines(): string[] {
    return this.grid.map((row) =>
      row
        .map((c) => c.ch)
        .join("")
        .replace(/\s+$/, ""),
    );
  }

  /** Non-empty tail lines (most recent `count` lines). */
  tail(count: number): string[] {
    const all = this.lines();
    let end = all.length;
    while (end > 0 && !all[end - 1]) end--;
    return all.slice(Math.max(0, end - count), end);
  }
}
