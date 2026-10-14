// The server's clock read from the page (docs/PLAN-RESEAU.md, « Horloge »): NTP's exchange — the page's
// time sent, the server's stamped, the page's on return —, the offset of the fastest exchanges kept (the
// least queued: the most symmetric), followed slowly so it never jumps.

export interface ClockSample {
  rtt: number;
  offset: number;
  at: number;
}

export class NetClock {
  /** server's ms − local ms */
  offset = 0;
  rtt = 0;
  /** the spread of the round trips [ms] */
  jitter = 0;
  synced = false;
  /** exchanges so far */
  count = 0;
  private win: ClockSample[] = [];

  constructor(private size = 64) {}

  /** A pong: `c` the local time it was sent, `s` the server's stamp, `now` the local time it came back. */
  onPong(c: number, s: number, now: number) {
    const rtt = now - c;
    // (a real exchange only: a stamp read without its round trip — 0 ms — would be the "fastest" one for good,
    // however late the page read it)
    if (!(rtt > 0) || !Number.isFinite(s)) return;
    this.win.push({ rtt, offset: s - (c + now) / 2, at: now });
    if (this.win.length > this.size) this.win.shift();
    // (the eighth of the fastest exchanges, their offsets averaged: the least queued, the asymmetries evened)
    const fast = [...this.win].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.floor(this.win.length / 8)));
    const best = { offset: fast.reduce((a, x) => a + x.offset, 0) / fast.length };
    const rtts = this.win.map((x) => x.rtt).sort((a, b) => a - b);
    this.rtt = rtts[Math.floor(rtts.length / 2)]!;
    this.jitter = rtts[Math.floor(rtts.length * 0.9)]! - rtts[0]!;
    this.count++;
    if (!this.synced) {
      this.offset = best.offset;
      this.synced = this.win.length >= 8;
      return;
    }
    // (settling — the first 30 exchanges, a page still loading slowed the first ones —: taken by halves;
    // then followed by fifths: the scene's time itself is eased onto it, ±1 % of its pace — R1)
    const d = best.offset - this.offset;
    this.offset += d * (this.count < 30 ? 0.5 : 0.2);
  }

  serverNow(localNow: number) {
    return localNow + this.offset;
  }

  toLocal(serverMs: number) {
    return serverMs - this.offset;
  }
}
