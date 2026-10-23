// The crew console (crew/) in a frame of the simulator's page, joined to the pilot's room as instruments: its window
// reached by expression, its controls pressed by real mouse events (CDP, at the element's place on the screen — proven
// to receive the pointer there, as App.click does: docs/E2E.md, "real input").
import type { App } from "./app";

export class CrewFrame {
  constructor(
    readonly app: App,
    readonly id = "crew-frame",
  ) {}
  /** an expression evaluated in the console's window (any: \`!x\`, \`[...y]\`, \`a || b\`) */
  w(js: string) {
    return `document.querySelector('#${this.id}').contentWindow.eval(${JSON.stringify(`(${js})`)})`;
  }
  /** an expression on the console's document */
  d(js: string) {
    return `document.querySelector('#${this.id}').contentDocument.${js}`;
  }
  js<T>(js: string) {
    return this.app.js<T>(this.w(js));
  }
  /** the frame opened (size, place), the console loaded, joined to the room `code` as `name` (its station's) */
  async open(code: string, name = "Ben", o: { w?: number; h?: number; hash?: string } = {}) {
    // (its language: App.boot's crewLang)
    await this.app.js(`(() => {
      const f = document.createElement('iframe'); f.id = '${this.id}'; f.src = '/crew/${o.hash ?? ""}';
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:${o.w ?? 1100}px;height:${o.h ?? 760}px;border:0;z-index:99999';
      document.body.append(f); return true; })()`);
    await this.app.waitFor(`!!${this.w("__crew")}`, 20_000);
    await this.js(`__crew.join('${code}', '${name}')`);
  }
  /** the element's centre on the page's screen, the frame's own hit test proving it is the one under the pointer */
  async hit(selector: string): Promise<{ x: number; y: number }> {
    const until = performance.now() + 3000;
    for (;;) {
      const r = await this.app.js<{ ok: boolean; x: number; y: number; why: string }>(`(() => {
        const f = document.querySelector('#${this.id}'), d = f.contentDocument;
        const el = d.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, x: 0, y: 0, why: 'absent' };
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        const b = el.getBoundingClientRect(), fb = f.getBoundingClientRect();
        const x = b.left + b.width / 2, y = b.top + b.height / 2;
        const top = d.elementFromPoint(x, y);
        return { ok: b.width > 0 && !!top && (top === el || el.contains(top)), x: fb.left + x, y: fb.top + y,
          why: top ? top.tagName + '.' + top.className : 'nothing' };
      })()`);
      if (r.ok) return r;
      if (performance.now() > until) throw new Error(`${selector} is not clickable in the crew frame: ${r.why}`);
      await Bun.sleep(150);
    }
  }
  /** a real click on a control of the console */
  async click(selector: string) {
    const { x, y } = await this.hit(selector);
    await this.app.mouse("move", x, y);
    await this.app.mouse("down", x, y);
    await this.app.mouse("up", x, y);
    await Bun.sleep(80);
  }
  /** a real click at a point of an element (its fraction across and down: 0.5, 0.5 its centre) — a canvas's place */
  async clickAt(selector: string, fx: number, fy: number) {
    const r = await this.app.js<{ x: number; y: number }>(`(() => {
      const f = document.querySelector('#${this.id}'), el = f.contentDocument.querySelector(${JSON.stringify(selector)});
      const b = el.getBoundingClientRect(), fb = f.getBoundingClientRect();
      return { x: fb.left + b.left + b.width * ${fx}, y: fb.top + b.top + b.height * ${fy} };
    })()`);
    await this.app.mouse("move", r.x, r.y);
    await this.app.mouse("down", r.x, r.y);
    await this.app.mouse("up", r.x, r.y);
    await Bun.sleep(120);
  }
  /** an ordering control clicked, its answer waited for; the journal's newest line */
  async order(selector: string) {
    await this.click(selector);
    await this.app.waitFor(`!${this.w("__crew.actions.busy")}`, 8000);
    return this.app.js<{ ok: boolean; what: string; msg: string }>(this.w("__crew.actions.board[0]"));
  }
  /** a popover (<details>) of the console opened by its summary, if closed */
  async openPop(inside: string) {
    const open = await this.app.js<boolean>(this.d(`querySelector(${JSON.stringify(inside)})?.closest('details')?.open ?? true`));
    if (!open)
      await this.app.js(
        this.d(`querySelector(${JSON.stringify(inside)}).closest('details').querySelector('summary').setAttribute('data-e2e-pop', '1')`),
      );
    if (!open) await this.click("[data-e2e-pop='1']");
    await this.app.js(this.d(`querySelectorAll('[data-e2e-pop]').forEach((e) => e.removeAttribute('data-e2e-pop'))`));
  }
}
