import { transform as cssTransform } from "lightningcss";
import { minify as terserMinify } from "terser";
import { minify as htmlMinify } from "html-minifier-terser";
import type { WebCode } from "../../shared/types.ts";

/**
 * tool_3: rule-based frontend optimization toolchain.
 * LightningCSS (CSS), Terser (JS), HTML-Minifier-Terser (HTML), plus a small set of
 * deterministic energy rules that keep behaviour intact. Each rule records what it did.
 */

export interface RuleResult {
  code: WebCode;
  /** rules applied but not minified */
  readable: WebCode;
  applied: string[];
}

type Rule = { id: string; apply: (c: WebCode) => WebCode };

const RULES: Rule[] = [
  {
    id: "clamp-fast-timers",
    // setInterval/setTimeout faster than one frame cannot be displayed; clamp to 16 ms
    apply: (c) => ({
      ...c,
      js: c.js.replace(/set(Interval|Timeout)\(([\s\S]*?),\s*([0-9]|1[0-5])\s*\)/g, "set$1($2, 16)"),
    }),
  },
  {
    id: "remove-blanket-will-change",
    apply: (c) => ({ ...c, css: c.css.replace(/^\s*will-change\s*:[^;]+;\s*$/gm, "") }),
  },
  {
    id: "passive-listeners",
    apply: (c) => ({
      ...c,
      js: c.js.replace(
        /addEventListener\(\s*(["'])(scroll|wheel|touchstart|touchmove)\1\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g,
        "addEventListener($1$2$1, $3, { passive: true })",
      ),
    }),
  },
  {
    id: "lazy-images",
    apply: (c) => ({
      ...c,
      html: c.html.replace(/<img\b(?![^>]*\bloading=)([^>]*)>/gi, '<img loading="lazy" decoding="async"$1>'),
    }),
  },
  {
    id: "pause-hidden-animations",
    // only animate while visible: browsers skip rendering for hidden tabs anyway, but
    // `content-visibility: auto` on large sections skips off-screen layout/paint
    apply: (c) =>
      /content-visibility/.test(c.css) || !/<section\b/i.test(c.html)
        ? c
        : { ...c, css: c.css + "\nsection{content-visibility:auto;contain-intrinsic-size:auto 600px}\n" },
  },
];

async function minifyAll(c: WebCode): Promise<{ code: WebCode; applied: string[] }> {
  const applied: string[] = [];
  let css = c.css;
  try {
    css = Buffer.from(cssTransform({ filename: "style.css", code: Buffer.from(c.css), minify: true }).code).toString();
    applied.push("lightningcss");
  } catch {
    /* keep original on parse error */
  }
  let js = c.js;
  try {
    const r = await terserMinify(c.js, { compress: true, mangle: true });
    if (r.code !== undefined) {
      js = r.code;
      applied.push("terser");
    }
  } catch {
    /* keep */
  }
  let html = c.html;
  try {
    html = await htmlMinify(c.html, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      useShortDoctype: true,
      minifyCSS: false,
      minifyJS: false,
    });
    applied.push("html-minifier-terser");
  } catch {
    /* keep */
  }
  return { code: { html, css, js }, applied };
}

/** tool_3 modify: training_webpages_1 → training_webpages_2 */
export async function ruleOptimize(code: WebCode): Promise<RuleResult> {
  const applied: string[] = [];
  let c = code;
  for (const r of RULES) {
    const next = r.apply(c);
    if (next.html !== c.html || next.css !== c.css || next.js !== c.js) applied.push(r.id);
    c = next;
  }
  const m = await minifyAll(c);
  return { code: m.code, readable: c, applied: [...applied, ...m.applied] };
}
