// Explicit state machine: permission resolving later must never reopen a released microphone.
export class TalkGate {
  ready = false;
  online = false;
  active = false;
  private held = new Set<string>();
  constructor(private changed: (active: boolean) => void) {}
  press(id: string) {
    if (!this.ready || !this.online) return;
    this.held.add(id);
    this.sync();
  }
  release(id: string) {
    this.held.delete(id);
    this.sync();
  }
  toggle() {
    if (this.active) this.cancel();
    else this.press("toggle");
  }
  cancel() {
    this.held.clear();
    this.sync();
  }
  availability(ready: boolean, online: boolean) {
    this.ready = ready;
    this.online = online;
    if (!ready || !online) this.held.clear();
    this.sync();
  }
  private sync() {
    const active = this.ready && this.online && this.held.size > 0;
    if (this.active === active) return;
    this.active = active;
    this.changed(active);
  }
}

/** Pointer capture keeps release reliable while another finger moves the map. */
export function bindTalk(button: HTMLButtonElement, gate: TalkGate, toggle: () => boolean) {
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || toggle()) return;
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    gate.press(`pointer:${e.pointerId}`);
  });
  button.addEventListener("pointerup", (e) => gate.release(`pointer:${e.pointerId}`));
  // An interrupted gesture closes every source, including the accessible toggle.
  button.addEventListener("pointercancel", () => gate.cancel());
  button.addEventListener("lostpointercapture", (e) => gate.release(`pointer:${e.pointerId}`));
  button.addEventListener("click", (e) => {
    if (toggle() || e.detail === 0) gate.toggle();
  });
  button.addEventListener("keydown", (e) => {
    if ((e.code === "Space" || e.code === "Enter") && !toggle()) {
      e.preventDefault();
      gate.press(`key:${e.code}`);
    }
  });
  button.addEventListener("keyup", (e) => {
    if ((e.code === "Space" || e.code === "Enter") && !toggle()) {
      e.preventDefault();
      gate.release(`key:${e.code}`);
    }
  });
  button.addEventListener("blur", () => {
    gate.release("key:Space");
    gate.release("key:Enter");
  });
  addEventListener("blur", () => gate.cancel());
  addEventListener("pagehide", () => gate.cancel());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) gate.cancel();
  });
}
