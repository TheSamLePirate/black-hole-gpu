// TARS's budget (PLAN-TARS-AGENT B1, the owner's decision): what his own initiatives may cost in an hour (the
// setting, 0.05 $ by default), and the least time between two of them. What the pilot asks is never
// refused; it is counted. At the ceiling his reflexes and rules wait for the hour to roll on.

export class Budget {
  private spent: { at: number; usd: number }[] = [];
  private lastWake = -Infinity;

  constructor(
    private perHour: () => number,
    private minGapMs: () => number = () => 20_000,
    private now: () => number = () => Date.now(),
  ) {}

  /** a cost counted (any turn, asked or his own) */
  add(usd: number) {
    if (usd > 0) this.spent.push({ at: this.now(), usd });
  }

  /** what the last hour cost [USD] */
  lastHour(): number {
    const t = this.now() - 3_600_000;
    this.spent = this.spent.filter((s) => s.at > t);
    return this.spent.reduce((a, s) => a + s.usd, 0);
  }

  /** whether he may wake himself now: under the ceiling, the gap since his last waking passed */
  canWake(): boolean {
    return this.lastHour() < this.perHour() && this.now() - this.lastWake >= this.minGapMs();
  }

  /** why not, in a word, or null */
  why(): "budget" | "gap" | null {
    if (this.lastHour() >= this.perHour()) return "budget";
    if (this.now() - this.lastWake < this.minGapMs()) return "gap";
    return null;
  }

  woke() {
    this.lastWake = this.now();
  }
}
