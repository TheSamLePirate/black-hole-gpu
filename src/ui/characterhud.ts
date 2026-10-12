import type { CameraController } from "../controls";
import { keyFor, heldCode, keyLabel } from "../input/bindings";
import { tr } from "../i18n";
import { BODY_NAMES } from "../targeting";
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
    this.root.setAttribute("aria-label", "Exploration");
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
    jump.textContent = tr({ fr: "Sauter", en: "Jump" });
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
    const status = on
      ? `${tr({ fr: "À PIED", en: "ON FOOT" })} · ${BODY_NAMES[ch.body as keyof typeof BODY_NAMES] ?? ch.body} · ${ch.speed.toFixed(1)} m/s`
      : tr({ fr: "Vaisseau posé", en: "Craft landed" });
    const label = `${keyFor("leaveShip") ?? "⇧K"} — ${tr(on ? { fr: "Entrer dans le vaisseau", en: "Board the craft" } : { fr: "Quitter le vaisseau", en: "Leave the craft" })}`;
    const text = on
      ? `${["camForward", "camLeft", "camBack", "camRight"].map((a) => keyLabel({ code: heldCode(a as "camForward") })).join(" ")} · ${tr({ fr: "Marcher · Maj : courir", en: "Walk · Shift: run" })} · ${keyFor("characterJump", undefined, "character") ?? keyLabel({ code: "Space" })} : ${tr({ fr: "sauter", en: "jump" })} · ${tr({ fr: "Glisser : caméra", en: "Drag: camera" })} · ${keyFor("standOn", undefined, "scene") ?? "⇧T"} : ${tr({ fr: "trépied ici", en: "tripod here" })}${ch.body === "earth" ? ` · ${keyFor("skyEvents", undefined, "system") ?? "⇧F8"} : ${tr({ fr: "le ciel d'ici", en: "the sky from here" })}` : ""}`
      : "";
    const key = status + label + text + near;
    if (key !== this.last) {
      this.last = key;
      this.status.textContent = status;
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
