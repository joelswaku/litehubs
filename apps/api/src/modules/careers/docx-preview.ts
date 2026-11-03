/**
 * Read-only preview of a Word .docx (CVs, letters) as simple HTML, so the
 * team can "Voir" a document instead of downloading it.  Built from the text
 * of word/document.xml only: every piece of text is escaped and no markup
 * from the file is copied, so the result cannot carry scripts or links.
 * Paragraphs, headings, bold / italic / underline, bullet lists, line breaks
 * and tables are kept; images and exotic layouts are not.
 */
import JSZip from "jszip";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function isDocx(mimeType: string, fileName = "") {
  return mimeType === DOCX_MIME || /\.docx$/i.test(fileName);
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function runHtml(run: string) {
  const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? "";
  const on = (tag: string) => new RegExp(`<w:${tag}(?:\\s[^>]*)?/?>`).test(props) && !new RegExp(`<w:${tag}\\s+w:val="(?:0|false)"`).test(props);
  let text = "";
  for (const piece of run.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>/g)) {
    if (piece[0].startsWith("<w:t")) text += escapeHtml(decodeXml(piece[1] ?? ""));
    else if (piece[0].startsWith("<w:tab")) text += "&emsp;";
    else text += "<br>";
  }
  if (!text) return "";
  if (on("b")) text = `<strong>${text}</strong>`;
  if (on("i")) text = `<em>${text}</em>`;
  if (/<w:u\s+w:val="(?!none)/.test(props)) text = `<u>${text}</u>`;
  return text;
}

function paragraphHtml(paragraph: string) {
  const props = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(paragraph)?.[1] ?? "";
  const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(props)?.[1] ?? "";
  const inner = [...paragraph.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].map((run) => runHtml(run[1] ?? "")).join("");
  if (!inner.replace(/<br>|&emsp;/g, "").trim()) return { html: "<p>&nbsp;</p>", list: false };
  const heading = /^(?:Heading|Titre|Title)(\d?)$/i.exec(style);
  if (heading) {
    const level = Math.min(4, Math.max(1, Number(heading[1] || 1) + 1));
    return { html: `<h${level}>${inner}</h${level}>`, list: false };
  }
  if (/<w:numPr>/.test(props) || /List/i.test(style)) return { html: `<li>${inner}</li>`, list: true };
  const centered = /<w:jc\s+w:val="center"/.test(props);
  return { html: `<p${centered ? ' style="text-align:center"' : ""}>${inner}</p>`, list: false };
}

function blocksHtml(xml: string): string {
  const out: string[] = [];
  let inList = false;
  // Top-level paragraphs and tables, in order.
  for (const block of xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>|<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*)?\/>/g)) {
    if (block[0].startsWith("<w:tbl")) {
      if (inList) out.push("</ul>"), (inList = false);
      const rows = [...(block[1] ?? "").matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)].map(
        (row) =>
          `<tr>${[...(row[1] ?? "").matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)]
            .map((cell) => `<td>${blocksHtml(cell[1] ?? "")}</td>`)
            .join("")}</tr>`,
      );
      out.push(`<table>${rows.join("")}</table>`);
      continue;
    }
    const { html, list } = paragraphHtml(block[2] ?? "");
    if (list && !inList) out.push("<ul>"), (inList = true);
    if (!list && inList) out.push("</ul>"), (inList = false);
    out.push(html);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

/** A complete, self-contained HTML page (no scripts, no external resources). */
export async function docxToHtml(buffer: Buffer, title: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const document = await zip.file("word/document.xml")?.async("string");
  if (!document) throw new Error("Not a Word document");
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(document)?.[1] ?? document;
  const hasImages = /<w:drawing>|<w:pict>/.test(body);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#eef2f6;font:15px/1.55 Calibri,Arial,sans-serif;color:#1f2937}
.page{max-width:820px;margin:24px auto;background:#fff;padding:48px 56px;box-shadow:0 10px 30px -15px rgba(15,23,42,.35);border-radius:6px}
.bar{max-width:820px;margin:16px auto 0;font:12px Arial,sans-serif;color:#64748b}
h2,h3,h4{margin:1.1em 0 .4em;color:#0f172a}p{margin:.35em 0}ul{margin:.3em 0 .6em 1.3em;padding:0}
table{border-collapse:collapse;width:100%;margin:.6em 0}td{border:1px solid #dbe2ea;padding:6px 8px;vertical-align:top}
@media (max-width:640px){.page{padding:24px 18px;margin:8px}}
</style></head><body>
<div class="bar">Aperçu : ${escapeHtml(title)}${hasImages ? " · les images du document ne sont pas affichées" : ""} — téléchargez le fichier pour la mise en page exacte.</div>
<div class="page">${blocksHtml(body)}</div>
</body></html>`;
}
