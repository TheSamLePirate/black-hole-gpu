// WCAG contrast of every visible text of the page (audit §16.7 T7), measured in the page: the text's
// colour (its opacity and its ancestors' included) over its background — the ancestors' backgrounds
// composed down to the view behind, taken as black space (the HUD's panels float over the render;
// the bright disc behind is the worst case, and the panels' own backgrounds are what is measured).
// A text passes at 4.5:1, or 3:1 when large (≥ 24 px, or ≥ 18.66 px bold) — the WCAG AA rule.

/**
 * In the page: the visible texts under the ratio, as "selector «text» ratio (needed)" — over `behind`,
 * the view's colour behind the interface (black space; the bright disc: the worst case).
 */
export const contrast = (behind: [number, number, number] = [0, 0, 0]) => `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    const chain = [];
    // (up to the body, not its own background: the view covers it)
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) chain.push([c[0], c[1], c[2], c[3] * +cs.opacity]);
      // (a gradient: its first stop, as an approximation)
      else if (cs.backgroundImage.includes("gradient")) { const g = parse(cs.backgroundImage); if (g && g[3] > 0) chain.push(g); }
    }
    let bg = [${behind.join(", ")}, 1];
    for (let i = chain.length - 1; i >= 0; i--) bg = over(chain[i], bg);
    return bg;
  };
  const opacity = (el) => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const desc = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim()) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") continue;
    const o = opacity(el);
    if (o < 0.05) continue;
    // (exempt: a disabled control, as in WCAG; a decoration hidden from screen readers; an SVG's text,
    // whose backing is the SVG's own shapes — the attitude ball's ring —, not a CSS background)
    if (el.closest("button:disabled, [aria-disabled=true], .off, [data-why]:not([data-why='']), [aria-hidden=true], svg")) continue;
    const c = parse(cs.color); if (!c) continue;
    const bg = bgOf(el);
    const fg = over([c[0], c[1], c[2], c[3] * o], bg);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const k = ratio(fg, bg);
    if (k < need) bad.push(desc(el) + " «" + n.textContent.trim().slice(0, 24) + "» " + k.toFixed(2) + " (" + need + ")");
  }
  return bad;
})()`;
