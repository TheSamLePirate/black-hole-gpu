// The cockpit control's tip (PLAN-COCKPIT K2): beside the pointer, the control's name, its state, its key —
// shown while it is under the pointer or held.

export class CockpitTip {
  private el: HTMLDivElement;

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement("div");
    this.el.className = "ck-tip";
    this.el.dataset.testid = "cockpit-tip";
    this.el.setAttribute("role", "tooltip");
    Object.assign(this.el.style, {
      position: "fixed",
      zIndex: "40",
      pointerEvents: "none",
      display: "none",
      padding: "6px 9px",
      borderRadius: "6px",
      background: "rgba(10, 16, 26, 0.88)",
      border: "1px solid rgba(140, 180, 220, 0.35)",
      color: "#e8eef6",
      font: "12px/1.35 ui-monospace, Menlo, monospace",
      whiteSpace: "nowrap",
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
  }

  /** Shown at (x, y) [client px] with its lines, or hidden (null). */
  show(tip: { name: string; state: string; key: string | null } | null, x = 0, y = 0) {
    if (!tip) {
      this.el.style.display = "none";
      return;
    }
    this.el.replaceChildren();
    const name = document.createElement("div");
    name.textContent = tip.name;
    name.style.fontWeight = "700";
    const st = document.createElement("div");
    st.textContent = tip.key ? `${tip.state} · ${tip.key}` : tip.state;
    st.style.color = "#9fc4e6";
    this.el.append(name, st);
    this.el.style.display = "block";
    // (beside the pointer, kept in the window)
    const w = this.el.offsetWidth,
      h = this.el.offsetHeight;
    this.el.style.left = `${Math.min(x + 16, innerWidth - w - 8)}px`;
    this.el.style.top = `${Math.min(y + 18, innerHeight - h - 8)}px`;
  }
}
