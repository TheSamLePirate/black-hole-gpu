import type { CameraController } from "../controls";
import { keyFor, heldCode, keyLabel } from "../input/bindings";
import { t, tf } from "../i18n";

/** The walking keys, as bound now (the sky's events on the Earth only). */
function keysLine(earth: boolean): string {
  const moves = ["camForward", "camLeft", "camBack", "camRight"].map((a) => keyLabel({ code: heldCode(a as "camForward") })).join(" ");
  const jumpKey = keyFor("characterJump", undefined, "character") ?? keyLabel({ code: "Space" });
  const tripodKey = keyFor("standOn", undefined, "scene") ?? "⇧T";
  const sky = earth ? ` · ${tf("{0}: the sky from here", keyFor("skyEvents", undefined, "system") ?? "⇧F8")}` : "";
  return `${moves} · ${t("Walk · Shift: run")} · ${tf("{0}: jump", jumpKey)} · ${t("Drag: camera")} · ${tf("{0}: tripod here", tripodKey)}${sky}`;
}

/** The walker's card: the keys and the board button (walking, the place and the speed are the on-foot HUD's —
 *  ui/foothud.ts — and the top bar's); the craft landed, its status and the way out. */
export class CharacterHud {
  readonly root = document.createElement("section");
  private status = document.createElement("div");
  private controls = document.createElement("div");
  private board = document.createElement("button");
  private last = "";
  private at = 0;
  constructor(
    private c: CameraController,
    private notify: (text: string) => void,
  ) {
    this.root.className = "character-hud";
    this.root.dataset.testid = "character-hud";
    this.root.setAttribute("aria-label", t("Exploration"));
    this.status.className = "character-status";
    this.controls.className = "character-controls";
    this.board.type = "button";
    this.board.dataset.testid = "character-board";
    this.board.onclick = () => {
      const error = c.character.toggle();
      if (error) this.notify(error);
    };
    this.root.append(this.status, this.controls, this.board);
    document.body.append(this.root);
    const touch = document.createElement("div");
    touch.className = "character-touch";
    for (const [text, f, r] of [
      ["↑", 1, 0],
      ["←", 0, -1],
      ["↓", -1, 0],
      ["→", 0, 1],
    ] as const) {
      const b = document.createElement("button");
      b.textContent = text;
      b.type = "button";
      b.onpointerdown = (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        c.character.move(f, r, 10);
      };
      b.onpointerup = b.onpointercancel = () => c.character.releaseMove();
      touch.append(b);
    }
    const jump = document.createElement("button");
    jump.textContent = t("Jump");
    jump.onclick = () => c.character.jump();
    touch.append(jump);
    this.root.append(touch);
  }
  update(now: number, force = false) {
    if (!force && now - this.at < 100) return;
    this.at = now;
    const ch = this.c.character,
      on = ch.active,
      landed = !!this.c.ourLanded || this.c.landed;
    document.body.classList.toggle("on-foot", on);
    this.root.hidden = !(on || (this.c.piloting && landed));
    if (this.root.hidden) return;
    const distance = on ? ch.accessDistance() : 0,
      near = Number.isFinite(distance) && distance <= 3;
    // (walking: no status — the on-foot HUD's card says the world, the place and the speed)
    const status = on ? "" : t("Craft landed");
    const label = `${keyFor("leaveShip") ?? "⇧K"} — ${on ? t("Board the craft") : t("Leave the craft")}`;
    const text = on ? keysLine(ch.body === "earth") : "";
    const key = status + label + text + near;
    if (key !== this.last) {
      this.last = key;
      this.status.textContent = status;
      this.status.hidden = !status;
      this.controls.textContent = text;
      this.board.textContent = label;
      this.board.disabled = on && !near;
    }
  }
  show() {
    this.update(performance.now(), true);
    this.root.scrollIntoView({ block: "nearest" });
  }
}
