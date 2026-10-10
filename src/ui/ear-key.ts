// Where to give TARS's ear its Deepgram key (under the setting "TARS's ear", and in his console): how he hears
// now — the key kept (its end), the dev server's relay, or the browser's own recognition —, the key pasted in
// a hidden field, tried with Deepgram before it is kept, changed, forgotten. Kept in this browser only.

import { checkDeepgramKey, deepgramKey, earState } from "../ai/deepgram";
import { t } from "../i18n";
import "./ear-key.css";

/** The line: its state and its buttons; `changed`: after a key kept or forgotten. update(): its state shown
 *  again (not while a key is being typed). */
export function earKeyLine(o: { changed?: () => void; testid?: string } = {}): HTMLElement & { update(): void } {
  const root = document.createElement("div") as HTMLDivElement & { update(): void };
  let editing = false;
  root.className = "ek";
  if (o.testid) root.dataset.testid = o.testid;
  const link = (label: string, id: string, fn: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sp-link";
    b.textContent = label;
    b.dataset.testid = id;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  };
  const say = (note = "") => {
    editing = false;
    root.replaceChildren();
    const s = earState();
    const text = document.createElement("span");
    text.className = "ek-state";
    text.textContent =
      s.by === "key"
        ? `${t("Deepgram key")} ${s.hint}`
        : s.by === "relay"
          ? t("Deepgram through the local server (.env)")
          : t("No Deepgram key: the browser's recognition");
    root.append(text);
    if (s.by === "key")
      root.append(
        link(t("change"), "ek-change", () => edit()),
        link(t("forget"), "ek-forget", () => {
          deepgramKey.clear();
          o.changed?.();
          say(t("Deepgram key forgotten."));
        }),
      );
    else root.append(link(t("paste a Deepgram key"), "ek-paste", () => edit()));
    if (note) {
      const n = document.createElement("em");
      n.className = "ek-note";
      n.textContent = note;
      root.append(n);
    }
  };
  // (the field: hidden as it is typed, tried with Deepgram on Enter or OK)
  const edit = () => {
    editing = true;
    root.replaceChildren();
    const input = document.createElement("input");
    input.type = "password";
    input.className = "ek-input";
    input.placeholder = t("Paste your Deepgram key — Enter");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dataset.testid = "ek-input";
    const ok = link(t("check and keep"), "ek-ok", () => void keep());
    const cancel = link(t("cancel"), "ek-cancel", () => say());
    const keep = async () => {
      const k = input.value.trim();
      if (!k) return say();
      input.disabled = true;
      ok.textContent = t("checking…");
      const r = await checkDeepgramKey(k);
      if (r === "ok" && deepgramKey.set(k)) {
        o.changed?.();
        return say(t("Deepgram key kept in this browser only: hold F6 to speak."));
      }
      say(r === "format" ? t("That is not a Deepgram key.") : t("Deepgram refused this key (or cannot be reached)."));
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void keep();
      if (e.key === "Escape") say();
    });
    input.addEventListener("keyup", (e) => e.stopPropagation());
    root.append(input, ok, cancel);
    input.focus();
  };
  root.update = () => {
    if (!editing) say();
  };
  say();
  return root;
}
