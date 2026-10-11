/**
 * Imports the text of an uploaded contract (PDF or Word) so it can be laid
 * out with the LiteHubs professional contract format: same header, title,
 * article headings, justified text, signature block and security marks as a
 * contract generated from a template.
 *
 * Returns null when the file has no usable text (a scanned PDF): the caller
 * then keeps the original pages and appends the signature sheet.
 */
import JSZip from "jszip";
import { normalizeContractBlocks, stripTemplateSignatureSection, type WorkspaceBlock } from "./contract-pdf";

export const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const IMPORTABLE_CONTRACT_MIME = new Set(["application/pdf", WORD_MIME]);

const HEADING = /^((article|art\.)\s*\d+|(chapitre|titre|section|annexe)\s+([ivxlc]+|\d+)\b|pr[ée]ambule\b)/i;
const NUMBERED_HEADING = /^\d+(\.\d+)*\.?\s+[A-ZÀ-Ý][^.]{0,70}$/;
const LIST_ITEM = /^(\d+[.)]|[a-z][.)]|[-•●▪◦*–])\s+/i;
const SIGNATURE_START = /^(fait\s+(à|a)\s|pour\s+l|le travailleur\b|l['’]\s*employeur\s*:|lu et approuv|signatures?\b|nom\s*:|date\s*:)/i;
const PAGE_NUMBER = /^(page\s*)?\d+\s*((sur|of|\/)\s*\d+)?$/i;

function clean(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isAllCapsTitle(line: string) {
  const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length < 4 || line.length > 80) return false;
  const upper = letters.replace(/[^A-ZÀ-Ý]/g, "").length;
  return upper / letters.length > 0.85;
}

function isHeading(line: string) {
  if (line.length > 110) return false;
  return HEADING.test(line) || NUMBERED_HEADING.test(line) || isAllCapsTitle(line);
}

function listItem(line: string) {
  const match = line.match(LIST_ITEM);
  if (!match) return null;
  const marker = match[1]!;
  const rest = line.slice(match[0].length);
  // "1. Objet" style short lines are headings, not list items.
  if (/^\d/.test(marker) && NUMBERED_HEADING.test(line) && !/[.;:]$/.test(line)) return null;
  return /^[-•●▪◦*–]$/.test(marker) ? `- ${rest}` : `${marker} ${rest}`;
}

/** Turns plain lines (with blank lines between paragraphs) into blocks. */
function linesToBlocks(paragraphs: string[][]): WorkspaceBlock[] {
  const blocks: WorkspaceBlock[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) blocks.push({ type: "paragraph", text: list.join("\n") });
    list = [];
  };
  for (const lines of paragraphs) {
    const text = joinLines(lines);
    if (!text) continue;
    if (isHeading(text)) {
      flushList();
      blocks.push({ type: "heading", text });
      continue;
    }
    const item = listItem(text);
    if (item) {
      list.push(item);
      continue;
    }
    flushList();
    blocks.push({ type: "paragraph", text });
  }
  flushList();
  return mergeArticleTitles(blocks);
}

function joinLines(lines: string[]) {
  let out = "";
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    if (!out) out = line;
    else if (/[a-zà-ÿ]-$/i.test(out) && /^[a-zà-ÿ]/.test(line)) out = out.slice(0, -1) + line;
    else if (/[A-Za-z0-9]-$/.test(out) && /^[A-Za-z0-9]/.test(line)) out += line;
    else out += ` ${line}`;
  }
  return out;
}

/** "Article 1" followed by a short title line becomes "Article 1 — Title". */
function mergeArticleTitles(blocks: WorkspaceBlock[]) {
  const out: WorkspaceBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    const next = blocks[index + 1];
    if (
      block.type === "heading" &&
      /^(article|art\.)\s*\d+\s*[:.\-–—]?\s*$/i.test(block.text ?? "") &&
      next &&
      (next.type === "paragraph" || next.type === "heading") &&
      (next.text ?? "").length <= 80 &&
      !/[.;]$/.test(next.text ?? "") &&
      !(next.text ?? "").includes("\n")
    ) {
      out.push({ type: "heading", text: `${(block.text ?? "").replace(/\s*[:.\-–—]?\s*$/, "")} — ${next.text}` });
      index += 1;
      continue;
    }
    out.push(block);
  }
  return out;
}

type Line = { page: number; y: number; x: number; end: number; text: string; height: number; pageHeight: number };

async function pdfLines(bytes: Buffer): Promise<{ lines: Line[]; pages: number }> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const lines: Line[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const pageHeight = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    type Item = { str: string; transform: number[]; width: number; height: number };
    const items = (content.items as unknown as Item[]).filter(
      (item) =>
        typeof item.str === "string" &&
        item.str.trim() &&
        // Rotated text is a watermark; very small text is microprint.
        Math.abs(item.transform[1] ?? 0) < 0.01 &&
        Math.abs(item.transform[2] ?? 0) < 0.01 &&
        (item.height || Math.abs(item.transform[3] ?? 0)) >= 6,
    );
    items.sort((a, b) => b.transform[5]! - a.transform[5]! || a.transform[4]! - b.transform[4]!);
    let current: { y: number; parts: Item[] } | null = null;
    const flush = () => {
      if (!current) return;
      const parts = current.parts.sort((a, b) => a.transform[4]! - b.transform[4]!);
      let text = "";
      let end = -Infinity;
      for (const part of parts) {
        const x = part.transform[4]!;
        if (text && x - end > 1.2 && !text.endsWith(" ") && !part.str.startsWith(" ")) text += " ";
        text += part.str;
        end = x + part.width;
      }
      const height = Math.max(...parts.map((part) => part.height || Math.abs(part.transform[3] ?? 0)));
      // Symbol-font bullets come out as private-use characters.
      text = text.replace(/^\s*[\uE000-\uF8FF]\s*/, "• ").replace(/[\uE000-\uF8FF]/g, "");
      lines.push({ page: pageNumber, y: current.y, x: parts[0]!.transform[4]!, end, text: clean(text), height, pageHeight });
      current = null;
    };
    for (const item of items) {
      const y = item.transform[5]!;
      if (current && Math.abs(current.y - y) <= 2.5) current.parts.push(item);
      else {
        flush();
        current = { y, parts: [item] };
      }
    }
    flush();
  }
  return { lines: lines.filter((line) => line.text), pages: pdf.numPages };
}

function pdfParagraphs(lines: Line[], pages: number): string[][] {
  // Running headers and footers repeat on most pages: drop them.
  const key = (text: string) => text.toLowerCase().replace(/\d+/g, "#");
  const seen = new Map<string, Set<number>>();
  for (const line of lines) {
    const pagesFor = seen.get(key(line.text)) ?? new Set<number>();
    pagesFor.add(line.page);
    seen.set(key(line.text), pagesFor);
  }
  const repeated = (line: Line) => pages >= 2 && (seen.get(key(line.text))?.size ?? 0) >= Math.max(2, Math.ceil(pages * 0.5));
  const heights = lines.map((line) => line.height).sort((a, b) => a - b);
  const bodyHeight = heights.length ? heights[Math.floor(heights.length / 2)]! : 10;
  // Page header/footer bands: small text in the top 8% or bottom 6% of a page.
  const inBand = (line: Line) => line.height <= bodyHeight * 1.05 && (line.y > line.pageHeight * 0.92 || line.y < line.pageHeight * 0.06);
  const body = lines.filter((line) => !PAGE_NUMBER.test(line.text) && !repeated(line) && !inBand(line));
  const rightEdge = Math.max(...body.map((line) => line.end), 0);

  const gaps = body
    .slice(1)
    .map((line, index) => (line.page === body[index]!.page ? body[index]!.y - line.y : 0))
    .filter((gap) => gap > 0 && gap < 40)
    .sort((a, b) => a - b);
  const lineGap = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 14;

  const paragraphs: string[][] = [];
  let currentParagraph: string[] = [];
  let previous: Line | null = null;
  for (const line of body) {
    let breakBefore = false;
    if (!previous) breakBefore = true;
    else if (line.page === previous.page && previous.y - line.y > lineGap * 1.45) breakBefore = true;
    else if (line.page !== previous.page && /[.:;!?»]$/.test(previous.text)) breakBefore = true;
    // A short line ending a sentence closes its paragraph.
    else if (line.page === previous.page && /[.:;!?»]$/.test(previous.text) && previous.end < rightEdge * 0.85) breakBefore = true;
    else if (line.page === previous.page && previous.end < rightEdge * 0.6) breakBefore = true;
    if (SIGNATURE_START.test(line.text)) breakBefore = true;
    const titleContinues = previous && line.page === previous.page && isAllCapsTitle(previous.text) && isAllCapsTitle(line.text) && !HEADING.test(line.text) && previous.y - line.y <= lineGap * 1.8;
    if (isHeading(line.text) || LIST_ITEM.test(line.text)) breakBefore = true;
    if (previous && isHeading(previous.text)) breakBefore = true;
    if (titleContinues) breakBefore = false;
    if (breakBefore && currentParagraph.length) {
      paragraphs.push(currentParagraph);
      currentParagraph = [];
    }
    currentParagraph.push(line.text);
    previous = line;
  }
  if (currentParagraph.length) paragraphs.push(currentParagraph);
  return paragraphs;
}

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

function wordParagraphText(xml: string) {
  const tokens = xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br[^>]*\/>/g) ?? [];
  return decodeXml(tokens.map((token) => (token.startsWith("<w:tab") ? " " : token.startsWith("<w:br") ? "\n" : token.replace(/<[^>]+>/g, ""))).join(""));
}

async function wordBlocks(bytes: Buffer): Promise<WorkspaceBlock[]> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return [];
  const body = xml.replace(/^[\s\S]*?<w:body>/, "").replace(/<w:sectPr[\s\S]*$/, "");
  const blocks: WorkspaceBlock[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) blocks.push({ type: "paragraph", text: list.join("\n") });
    list = [];
  };
  for (const match of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const part = match[0];
    if (part.startsWith("<w:tbl>")) {
      flushList();
      const rows = [...part.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((row) =>
        [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) =>
          clean([...cell[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => wordParagraphText(p[0])).join(" ")),
        ),
      ).filter((row) => row.some(Boolean));
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    const text = clean(wordParagraphText(part).replace(/\n+/g, " "));
    if (!text) continue;
    const style = part.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const numbered = /<w:numPr>/.test(part) || /list|liste|puce|bullet/i.test(style);
    const runs = [...part.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].filter((run) => /<w:t[ >]/.test(run[0]));
    const allBold = runs.length > 0 && runs.every((run) => /<w:b\/>|<w:b w:val="(1|true)"\/>/.test(run[0]));
    if (/heading|titre|title/i.test(style) || isHeading(text) || (allBold && text.length <= 90 && !/[.;]$/.test(text))) {
      flushList();
      blocks.push({ type: "heading", text });
      continue;
    }
    const item = numbered ? (LIST_ITEM.test(text) ? text : `- ${text}`) : listItem(text);
    if (item) {
      list.push(item.replace(/^[•●▪◦*–]\s+/, "- "));
      continue;
    }
    flushList();
    blocks.push({ type: "paragraph", text });
  }
  flushList();
  return mergeArticleTitles(blocks);
}

/** The contract's own title is printed by the layout: drop a leading title line. */
function dropLeadingTitle(blocks: WorkspaceBlock[]) {
  const first = blocks[0];
  if (first?.type === "heading" && /contrat|contract|convention|accord/i.test(first.text ?? "") && !HEADING.test(first.text ?? "")) return blocks.slice(1);
  return blocks;
}

export async function importContractBlocks(bytes: Buffer, mimeType: string): Promise<WorkspaceBlock[] | null> {
  let blocks: WorkspaceBlock[] = [];
  if (mimeType === WORD_MIME) blocks = await wordBlocks(bytes);
  else if (mimeType === "application/pdf") {
    const { lines, pages } = await pdfLines(bytes);
    blocks = linesToBlocks(pdfParagraphs(lines, pages));
  } else return null;
  // Text that could be read as Markdown must stay literal.
  blocks = blocks.map((block) => (block.text ? { ...block, text: block.text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "") } : block));
  blocks = stripTemplateSignatureSection(normalizeContractBlocks(dropLeadingTitle(blocks)));
  // The original signature section (two columns, "Fait à …") is replaced by
  // the standard LiteHubs block: cut from its start when it sits at the end.
  const signatureStart = blocks.findIndex(
    (block, index) =>
      index >= blocks.length * 0.6 &&
      /^(fait\s+(à|a)\s|signatures?(\s+des\s+parties)?\s*:?$|pour\s+l['’]\s*employeur|lu et approuv)/i.test(block.text ?? ""),
  );
  if (signatureStart > 0) blocks = blocks.slice(0, signatureStart);
  // A reference line under the old title is printed again by the layout.
  blocks = blocks.filter((block, index) => !(index < 3 && block.type === "paragraph" && /^r[ée]f(\.|[ée]rence)\s*:?\s*\S+(\s*·\s*v\d+)?$/i.test(block.text ?? "")));
  const characters = blocks.reduce((total, block) => total + (block.text?.length ?? 0) + (block.rows?.flat().join("").length ?? 0), 0);
  return characters >= 300 && blocks.length >= 2 ? blocks : null;
}
