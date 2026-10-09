import type { WebCode } from "./types.ts";

/**
 * Assemble the three files into one self-contained document.
 * Used by tool_1 (browser automation) and tool_5 translate (webpage preview).
 * `<link href="style.css">` and `<script src="script.js">` are replaced by inline
 * content; if they are missing, CSS goes into <head> and JS before </body>.
 */
export function toPreviewDocument(code: WebCode): string {
  let html = code.html || "<!doctype html><html><head></head><body></body></html>";
  const style = `<style>\n${code.css}\n</style>`;
  const script = `<script>\n${code.js.replace(/<\/script/gi, "<\\/script")}\n</script>`;

  const linkRe = /<link\b[^>]*href=["']?\.?\/?style\.css["']?[^>]*>/i;
  const scriptRe = /<script\b[^>]*src=["']?\.?\/?script\.js["']?[^>]*>\s*<\/script>/i;

  if (linkRe.test(html)) html = html.replace(linkRe, () => style);
  else if (code.css.trim()) html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => `${style}</head>`) : style + html;

  if (scriptRe.test(html)) html = html.replace(scriptRe, () => script);
  else if (code.js.trim()) html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${script}</body>`) : html + script;

  return html;
}
