// The link to the room server (docs/PLAN-RESEAU.md, « Transport »): a WebSocket, and the network lab that
// sits on it in tests — latency, jitter and loss made up, to fly at 200 ms and 5 % lost on one machine.
// (WebRTC between the players comes with R1: the same Link.)

export type Payload = string | ArrayBuffer;

export interface Link {
  send(m: Payload): void;
  close(): void;
  onmessage: ((m: Payload) => void) | null;
  onopen: (() => void) | null;
  onclose: ((why: string) => void) | null;
  readonly open: boolean;
  /** bytes sent and received */
  readonly bytes: { up: number; down: number };
}

const size = (m: Payload) => (typeof m === "string" ? m.length : m.byteLength);

export class WsLink implements Link {
  onmessage: ((m: Payload) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: ((why: string) => void) | null = null;
  readonly bytes = { up: 0, down: 0 };
  private ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => this.onopen?.();
    this.ws.onmessage = (e) => {
      const m = e.data as Payload;
      this.bytes.down += size(m);
      this.onmessage?.(m);
    };
    this.ws.onclose = (e) => this.onclose?.(e.reason || String(e.code));
    this.ws.onerror = () => {};
  }

  get open() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(m: Payload) {
    if (!this.open) return;
    this.bytes.up += size(m);
    this.ws.send(m);
  }

  close() {
    this.ws.close(1000, "bye");
  }
}

export interface LabSettings {
  /** one way [ms] */
  latency: number;
  /** ± [ms] */
  jitter: number;
  /** the binary samples lost, 0–1 (the text frames ride TCP: late, never lost) */
  loss: number;
}

/** `#netlab=latency,jitter,loss` (e.g. 100,20,0.05) */
export function parseLab(s: string | null | undefined): LabSettings | null {
  if (!s) return null;
  const [l, j, p] = s.split(",").map(Number);
  if (!Number.isFinite(l)) return null;
  return { latency: Math.max(0, l!), jitter: Math.max(0, j || 0), loss: Math.min(1, Math.max(0, p || 0)) };
}

/** A link with a made-up network both ways: the text in order, the binary in any order and some lost. */
export class LabLink implements Link {
  onmessage: ((m: Payload) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: ((why: string) => void) | null = null;
  private textUp = 0;
  private textDown = 0;

  constructor(
    private inner: Link,
    public lab: LabSettings,
    private rand: () => number = Math.random,
  ) {
    inner.onopen = () => this.onopen?.();
    inner.onclose = (w) => this.onclose?.(w);
    inner.onmessage = (m) => this.later(m, false, (x) => this.onmessage?.(x));
  }

  get open() {
    return this.inner.open;
  }

  get bytes() {
    return this.inner.bytes;
  }

  private later(m: Payload, up: boolean, deliver: (m: Payload) => void) {
    const { latency, jitter, loss } = this.lab;
    let d = latency + (this.rand() * 2 - 1) * jitter;
    if (typeof m !== "string") {
      if (this.rand() < loss) return;
    } else {
      // (TCP: in order — never before the text sent ahead of it)
      const at = performance.now() + d;
      const prev = up ? this.textUp : this.textDown;
      const when = Math.max(at, prev);
      if (up) this.textUp = when;
      else this.textDown = when;
      d = when - performance.now();
    }
    setTimeout(() => deliver(m), Math.max(0, d));
  }

  send(m: Payload) {
    this.later(m, true, (x) => this.inner.send(x));
  }

  close() {
    this.inner.close();
  }
}
