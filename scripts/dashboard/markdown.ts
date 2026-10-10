// Safe, dependency-free Markdown to HTML for the repo's own docs (the dashboard).
// Every text is HTML-escaped; raw HTML is never passed through; only http(s), #anchors
// and relative .md links become hrefs, anything else is shown as text.

export type Section = { title: string; slug: string; body: string };

type Ctx = { headingIds: boolean; seen: Map<string, number> };

const HEADING = /^(#{1,4})\s+(\S.*?)\s*$/;
const FENCE_OPEN = /^\s{0,3}```\s*([^\s`]*)/;
const FENCE_CLOSE = /^\s{0,3}```\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
// Private-use character marking inline code spans while the rest is processed.
const MARK = "";

export function renderMarkdown(md: string, o?: { headingIds?: boolean }): string {
  const ctx: Ctx = { headingIds: o?.headingIds ?? false, seen: new Map() };
  return renderBlocks(normalize(md).split("\n"), ctx);
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

export function splitSections(md: string, level: 2 | 3): Section[] {
  const out: Section[] = [];
  let cur: { title: string; body: string[] } | null = null;
  let inFence = false;
  const finish = (s: { title: string; body: string[] }) => {
    out.push({ title: s.title, slug: slug(s.title), body: s.body.join("\n").trim() });
  };
  for (const line of normalize(md).split("\n")) {
    if (/^\s{0,3}```/.test(line)) inFence = !inFence;
    const h = inFence ? null : HEADING.exec(line);
    if (h && (h[1] ?? "").length <= level) {
      if (cur) finish(cur);
      cur = (h[1] ?? "").length === level ? { title: (h[2] ?? "").trim(), body: [] } : null;
      continue;
    }
    cur?.body.push(line);
  }
  if (cur) finish(cur);
  return out;
}

function normalize(md: string): string {
  return md.replace(/\r\n?/g, "\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  return FENCE_OPEN.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST_ITEM.test(line) || isTableStart(lines, i);
}

function renderBlocks(lines: string[], ctx: Ctx): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE_OPEN.exec(line);
    const heading = HEADING.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++;
      const cls = (fence[1] ?? "").replace(/[^\w+-]/g, "");
      const attr = cls ? ` class="lang-${cls}"` : "";
      out.push(`<pre><code${attr}>${escapeHtml(body.join("\n"))}</code></pre>`);
    } else if (heading) {
      const level = (heading[1] ?? "").length;
      const text = heading[2] ?? "";
      const id = ctx.headingIds ? ` id="${escapeHtml(uniqueId(slug(text), ctx.seen))}"` : "";
      out.push(`<h${level}${id}>${inline(text)}</h${level}>`);
      i++;
    } else if (HR.test(line)) {
      out.push("<hr>");
      i++;
    } else if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) inner.push(QUOTE.exec(lines[i++] ?? "")?.[1] ?? "");
      out.push(`<blockquote>${renderBlocks(inner, ctx)}</blockquote>`);
    } else if (isTableStart(lines, i)) {
      const { html, next } = renderTable(lines, i);
      out.push(html);
      i = next;
    } else if (LIST_ITEM.test(line)) {
      const { html, next } = renderList(lines, i);
      out.push(html);
      i = next;
    } else {
      const parts: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim() && !startsBlock(lines, i)) parts.push((lines[i++] ?? "").trim());
      out.push(`<p>${inline(parts.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}

function uniqueId(base: string, seen: Map<string, number>): string {
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

function isTableStart(lines: string[], i: number): boolean {
  if (i + 1 >= lines.length) return false;
  const header = lines[i] ?? "";
  const sep = lines[i + 1] ?? "";
  return header.includes("|") && TABLE_SEP.test(sep) && splitRow(header).length === splitRow(sep).length;
}

function splitRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const head = splitRow(lines[start] ?? "");
  const aligns = splitRow(lines[start + 1] ?? "").map(alignOf);
  const width = head.length;
  const cell = (tag: "th" | "td", text: string, col: number) => {
    const align = aligns[col] ? ` style="text-align:${aligns[col]}"` : "";
    return `<${tag}${align}>${inline(text)}</${tag}>`;
  };
  let i = start + 2;
  const rows: string[] = [];
  while (i < lines.length && (lines[i] ?? "").trim() && !startsBlock(lines, i)) {
    const cells = splitRow(lines[i++] ?? "");
    const tds = Array.from({ length: width }, (_, c) => cell("td", cells[c] ?? "", c));
    rows.push(`<tr>${tds.join("")}</tr>`);
  }
  const ths = head.map((h, c) => cell("th", h, c)).join("");
  const html = `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  return { html, next: i };
}

function alignOf(sep: string): string {
  const c = sep.trim();
  if (c.startsWith(":") && c.endsWith(":")) return "center";
  if (c.endsWith(":")) return "right";
  if (c.startsWith(":")) return "left";
  return "";
}

// One nesting level: items indented past the first item's indent belong to the item above.
function renderList(lines: string[], start: number): { html: string; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? "");
  if (!first) return { html: "", next: start + 1 };
  const base = (first[1] ?? "").length;
  const ordered = /\d/.test(first[2] ?? "");
  const items: { text: string; subs: string[] }[] = [];
  let i = start;
  let inSub = false;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m = LIST_ITEM.exec(line);
    if (m) {
      const indent = (m[1] ?? "").length;
      if (indent <= base) {
        if (/\d/.test(m[2] ?? "") !== ordered) break;
        items.push({ text: m[3] ?? "", subs: [] });
        inSub = false;
      } else if (items.length) {
        items[items.length - 1]!.subs.push(m[3] ?? "");
        inSub = true;
      }
    } else if (line.trim() && /^\s/.test(line) && items.length) {
      const item = items[items.length - 1]!;
      if (inSub && item.subs.length) item.subs[item.subs.length - 1]! += ` ${line.trim()}`;
      else item.text += ` ${line.trim()}`;
    } else {
      break;
    }
    i++;
  }
  const tag = ordered ? "ol" : "ul";
  const li = items.map((it) => {
    const subs = it.subs.length ? `<ul>${it.subs.map((s) => `<li>${inline(s)}</li>`).join("")}</ul>` : "";
    return `<li>${inline(it.text)}${subs}</li>`;
  });
  return { html: `<${tag}>${li.join("")}</${tag}>`, next: i };
}

function linkHref(url: string): string | null {
  if (/^https?:\/\//i.test(url) || url.startsWith("#")) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return null;
  const hash = url.indexOf("#");
  const path = hash >= 0 ? url.slice(0, hash) : url;
  const frag = hash >= 0 ? url.slice(hash) : "";
  if (/\.md$/i.test(path)) return `#doc/${path.split("/").pop() ?? ""}${frag}`;
  return null;
}

function inline(text: string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(code);
    return `${MARK}${codes.length - 1}${MARK}`;
  });
  s = escapeHtml(s);
  s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\s][^*]*?)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^()\s]+)\)/g, (_, label: string, url: string) => {
    const href = linkHref(url);
    return href ? `<a href="${escapeHtml(href)}">${label}</a>` : `<code>${label}</code>`;
  });
  return s.replace(new RegExp(`${MARK}(\\d+)${MARK}`, "g"), (_, n: string) => `<code>${escapeHtml(codes[Number(n)] ?? "")}</code>`);
}
