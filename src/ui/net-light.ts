// The network's light — a small square in the screen's top-left corner, live (Sam, 6 Nov 2026: « un indicateur temps réel
// pendant le téléchargement des tuiles ; en vol on devrait toujours être en téléchargement »). Settings › Render › Show the
// network. Its states (data-state, for the tests):
//   loading  green — requests in flight (net-activity.ts: the page's and its workers'); it flashes at each answer in;
//   waiting  amber — data asked (the relief's or the photographs' tiles queued, a scene building) and nothing in flight: a
//            stall — a rate gate, a decode, a queue that does not feed the network;
//   error    red — a request failed or was rate-limited (429/503) in the last ERROR_MS;
//   idle     grey — nothing asked, nothing in flight.
// It also keeps the time spent in each state since its last reset — `__bh.netLight.stats()` —: a flight's share of network idle
// while data was asked is what the streaming leaves on the table.
import { type NetCounts, netSnapshot } from "../system/net-activity";

export type NetState = "idle" | "loading" | "waiting" | "error";
const ERROR_MS = 2500;
const TICK_MS = 100;

export type NetLightStats = NetCounts & {
  state: NetState;
  scopes: number;
  /** since the last reset: seconds in each state, and the share of the time data was asked with nothing in flight */
  seconds: Record<NetState, number>;
  stallShare: number;
  /** since the last reset: requests begun, ended, failed, rate-limited, MB read */
  since: { started: number; done: number; failed: number; limited: number; cached: number; mb: number };
};

export class NetLight {
  readonly el: HTMLDivElement;
  private state: NetState = "idle";
  private seconds: Record<NetState, number> = { idle: 0, loading: 0, waiting: 0, error: 0 };
  private base = netSnapshot();
  private lastDone = 0;
  private lastTick = performance.now();
  private snap = netSnapshot();

  /** `asked`: whether data is wanted now (the queues), `shown`: the setting */
  constructor(
    private asked: () => boolean,
    private shown: () => boolean,
  ) {
    this.el = Object.assign(document.createElement("div"), { className: "net-light", hidden: true });
    this.el.dataset.testid = "net-light";
    this.el.dataset.state = "idle";
    this.el.setAttribute("aria-hidden", "true");
    document.body.append(this.el);
    setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const s = (this.snap = netSnapshot());
    const wall = Date.now();
    let asked = false;
    try {
      asked = this.asked();
    } catch {
      /* (the renderer not there yet) */
    }
    const st: NetState =
      wall - Math.max(s.failAt, s.limitAt) < ERROR_MS && s.failAt + s.limitAt > 0
        ? "error"
        : s.inflight > 0
          ? "loading"
          : asked
            ? "waiting"
            : "idle";
    this.seconds[st] += dt;
    const shown = this.shown();
    if (this.el.hidden === shown) this.el.hidden = !shown;
    if (st !== this.state) {
      this.state = st;
      this.el.dataset.state = st;
    }
    this.el.dataset.inflight = String(s.inflight);
    // (an answer in: a flash — the light's blink, a disk's —, animated without reading the layout)
    if (shown && s.done !== this.lastDone)
      this.el.animate(
        [
          { filter: "brightness(2.2)", transform: "scale(1.25)" },
          { filter: "none", transform: "none" },
        ],
        {
          duration: 160,
          easing: "ease-out",
        },
      );
    this.lastDone = s.done;
  }

  /** the counts now and the time in each state since the last reset */
  stats(): NetLightStats {
    const s = this.snap,
      b = this.base;
    const asked = this.seconds.loading + this.seconds.waiting;
    return {
      ...s,
      state: this.state,
      seconds: { ...this.seconds },
      stallShare: asked > 0 ? +(this.seconds.waiting / asked).toFixed(3) : 0,
      since: {
        started: s.started - b.started,
        done: s.done - b.done,
        failed: s.failed - b.failed,
        limited: s.limited - b.limited,
        cached: s.cached - b.cached,
        mb: +((s.bytes - b.bytes) / 1e6).toFixed(1),
      },
    };
  }

  reset() {
    this.seconds = { idle: 0, loading: 0, waiting: 0, error: 0 };
    this.base = netSnapshot();
  }
}
