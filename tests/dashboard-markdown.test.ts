import { expect, test } from "bun:test";
import { renderMarkdown, slug, splitSections } from "../scripts/dashboard/markdown.ts";

test("headings get ids only when asked, and are levelled 1 to 4", () => {
  expect(renderMarkdown("# Top\n## Two Words\n### Three\n#### Four")).toBe(
    "<h1>Top</h1>\n<h2>Two Words</h2>\n<h3>Three</h3>\n<h4>Four</h4>",
  );
  expect(renderMarkdown("## Run `x` now", { headingIds: true })).toBe('<h2 id="run-x-now">Run <code>x</code> now</h2>');
  expect(renderMarkdown("## Same\n## Same", { headingIds: true })).toContain('id="same-1"');
});

test("slug follows GitHub anchors", () => {
  expect(slug("E2E: run & check")).toBe("e2e-run--check");
  expect(slug("`BH.render` API_v2")).toBe("bhrender-api_v2");
});

test("paragraphs, emphasis and inline code", () => {
  expect(renderMarkdown("one **bold** and *it* with `a*b*`\nnext line")).toBe(
    "<p>one <strong>bold</strong> and <em>it</em> with <code>a*b*</code> next line</p>",
  );
});

test("fenced code is escaped and carries its language", () => {
  const html = renderMarkdown("```ts\nconst x = a < b && **c**;\n```");
  expect(html).toBe('<pre><code class="lang-ts">const x = a &lt; b &amp;&amp; **c**;</code></pre>');
  expect(renderMarkdown("```\nplain\n```")).toBe("<pre><code>plain</code></pre>");
});

test("raw HTML is never passed through", () => {
  const html = renderMarkdown('<script>alert("x")</script> & <b>hi</b>');
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<b>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&amp;");
  expect(renderMarkdown("```\n<script>x</script>\n```")).not.toContain("<script>");
});

test("links: http, anchors, relative .md, and everything else as text", () => {
  expect(renderMarkdown("[site](https://example.org/a?b=1)")).toBe('<p><a href="https://example.org/a?b=1">site</a></p>');
  expect(renderMarkdown("[top](#intro)")).toBe('<p><a href="#intro">top</a></p>');
  expect(renderMarkdown("[api](BH-API.md)")).toBe('<p><a href="#doc/BH-API.md">api</a></p>');
  expect(renderMarkdown("[e2e](E2E.md#x)")).toBe('<p><a href="#doc/E2E.md#x">e2e</a></p>');
  expect(renderMarkdown("[src](../scripts/x.ts)")).toBe("<p><code>src</code></p>");
  expect(renderMarkdown("[bad](javascript:alert(1))")).not.toContain("<a");
  expect(renderMarkdown("[bad](javascript:alert(1))")).not.toContain('javascript:alert(1)"');
  expect(renderMarkdown("[bad](//evil.example/x)")).not.toContain("<a");
});

test("unordered and ordered lists, with one nesting level", () => {
  expect(renderMarkdown("- a\n- **b**\n  - b1\n  - b2\n- c")).toBe(
    "<ul><li>a</li><li><strong>b</strong><ul><li>b1</li><li>b2</li></ul></li><li>c</li></ul>",
  );
  expect(renderMarkdown("1. first\n2. second")).toBe("<ol><li>first</li><li>second</li></ol>");
});

test("GFM tables with alignment, inline code and escaped pipes", () => {
  const md = ["| Name | Cmd | Note |", "| :--- | :-: | ---: |", "| one | `a \\| b` | **x** |", "| two | `c` |"].join("\n");
  const html = renderMarkdown(md);
  expect(html).toContain("<table");
  expect(html).toContain('<th style="text-align:left">Name</th>');
  expect(html).toContain('<td style="text-align:center"><code>a | b</code></td>');
  expect(html).toContain('<td style="text-align:right"><strong>x</strong></td>');
  expect(html).toContain('<td style="text-align:center"><code>c</code></td><td style="text-align:right"></td>');
});

test("horizontal rules and blockquotes", () => {
  expect(renderMarkdown("above\n\n---\n\nbelow")).toBe("<p>above</p>\n<hr>\n<p>below</p>");
  expect(renderMarkdown("> quoted *text*\n> more")).toBe("<blockquote><p>quoted <em>text</em> more</p></blockquote>");
});

test("splitSections cuts at headings of the same or higher level", () => {
  const md = ["intro", "## One", "text one", "### sub", "more", "## Two", "text two", "# Top", "tail"].join("\n");
  expect(splitSections(md, 2)).toEqual([
    { title: "One", slug: "one", body: "text one\n### sub\nmore" },
    { title: "Two", slug: "two", body: "text two" },
  ]);
  expect(splitSections(md, 3)).toEqual([{ title: "sub", slug: "sub", body: "more" }]);
});

test("splitSections ignores headings inside fenced code", () => {
  const md = "## Real\n```md\n## Fake\n```\nafter";
  const sections = splitSections(md, 2);
  expect(sections.length).toBe(1);
  expect(sections[0]?.body).toContain("## Fake");
});

test("the real E2E guide renders to a table without throwing", async () => {
  const md = await Bun.file(new URL("../docs/E2E.md", import.meta.url)).text();
  const html = renderMarkdown(md, { headingIds: true });
  expect(html).toContain("<table");
  expect(html).toContain('<h2 id="1-in-five-commands">');
  expect(splitSections(md, 2).length).toBeGreaterThan(0);
});
