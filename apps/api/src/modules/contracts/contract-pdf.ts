/**
 * Contract PDF layout.
 *
 * One generator for every contract copy LiteHubs produces: the draft, the copy
 * printed for a handwritten signature, the employee/employer preview and the
 * final electronically signed original.  The layout is deterministic: the same
 * frozen blocks always give the same pages, so the signature positions computed
 * here are where signatures are stamped later.
 *
 * - Clauses: Markdown-style headings (#, ##), **bold**, numbered and bulleted
 *   lists and tables, justified, with widths measured from the real font.
 * - Signature block: placed right after the last clause (same page when it
 *   fits), « Fait à …, le …, en deux exemplaires originaux », one column per
 *   party with name, function, « Lu et approuvé », a signature box and a date.
 * - Paper copies get an initials (paraphe) box on every page.
 * - Every page: company header, reference, « Page x sur y ».
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

export type WorkspaceBlock = { type: "heading" | "paragraph" | "table" | "page_break"; text?: string; rows?: string[][] };
export type SignatureRole = "employee" | "employer";
export type SignatureRequirements = Record<SignatureRole, number>;
export type ContractSecurityMark = { versionLabel?: string | null; documentHash?: string | null };

/** Where one party signs.  `y` is the bottom of the signature box. */
export type SignatureSlot = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Baseline and x of the value written after « Nom : » / « Représenté par : ». */
  name: { x: number; y: number; prefilled: boolean };
  mention: { x: number; y: number };
  date: { x: number; y: number };
};
export type SignatureSlots = Record<SignatureRole, SignatureSlot[]>;

export type ContractParties = {
  employeeName?: string | null;
  employeeTitle?: string | null;
  employerName: string;
  employerRole?: string | null;
  city?: string | null;
};

export type ContractLayoutOptions = {
  title: string;
  reference: string;
  companyName: string;
  logoUrl?: string | null;
  signaturePlan?: SignatureRequirements;
  security?: ContractSecurityMark;
  parties?: ContractParties;
  /** « paper » adds initials boxes; « electronic » is the default. */
  mode?: "electronic" | "paper";
  /** Printed in « Fait à …, le … » once the contract is fully signed. */
  signedOn?: string | null;
};

export type SignedField = {
  signerRole: SignatureRole;
  status: string;
  signedName: string | null;
  signatureData: string | null;
  signedAt: string | null;
  method: string | null;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 62;
const CONTENT_TOP = PAGE_HEIGHT - 112;
const CONTENT_BOTTOM = 78;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const INK = rgb(0.1, 0.13, 0.18);
const BODY = rgb(0.17, 0.2, 0.25);
const MUTED = rgb(0.38, 0.43, 0.5);
const RULE = rgb(0.8, 0.84, 0.86);
const ACCENT = rgb(0.04, 0.4, 0.33);
const ACCENT_DARK = rgb(0.03, 0.22, 0.17);
const BLANK = "________________";

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const fontCache = new WeakMap<PDFFont, Map<string, boolean>>();
/** Standard PDF fonts only encode WinAnsi: anything else becomes a close
 * equivalent or is dropped, so one odd character never breaks a contract. */
function safe(font: PDFFont, text: string): string {
  const replaced = text
    .replace(/[‐-‒−]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/\t/g, " ");
  let cache = fontCache.get(font);
  if (!cache) {
    cache = new Map();
    fontCache.set(font, cache);
  }
  let out = "";
  for (const char of replaced) {
    let ok = cache.get(char);
    if (ok === undefined) {
      try {
        font.widthOfTextAtSize(char, 10);
        ok = true;
      } catch {
        ok = false;
      }
      cache.set(char, ok);
    }
    if (ok) out += char;
  }
  return out;
}

type Run = { text: string; bold: boolean };
/** « **gras** » → runs.  Unfilled merge fields print as a blank line. */
function runsOf(text: string): Run[] {
  const cleaned = text.replace(/\{\{\s*[^}]*\}\}/g, BLANK).replace(/\\$/gm, "");
  const runs: Run[] = [];
  for (const part of cleaned.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) runs.push({ text: part.slice(2, -2), bold: true });
    else runs.push({ text: part.replace(/\*\*/g, ""), bold: false });
  }
  return runs;
}

/** A word may mix fonts (« **Congo Omega**, ci-après »): parts with no space
 * between them stay glued together. */
type Word = { parts: { text: string; bold: boolean; width: number }[]; width: number };

/* ------------------------------------------------------------------ */
/* Block normalisation                                                 */
/* ------------------------------------------------------------------ */

/** Splits a heading that was written on the same line as its first sentence
 * (« ## Article 2 — Lieu de travail Le lieu principal… »), as found in older
 * templates where line breaks were lost. */
function splitGluedHeading(line: string): [string, string] {
  if (line.length <= 70) return [line, ""];
  const article = line.match(/^((?:article|art\.)\s*\d+[a-z]?\s*[—–:.-]\s*)(.+)$/i);
  if (article) {
    const words = article[2]!.split(/\s+/);
    for (let index = 1; index < words.length; index += 1) {
      if (/^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’]/.test(words[index]!)) {
        return [`${article[1]}${words.slice(0, index).join(" ")}`, words.slice(index).join(" ")];
      }
    }
    return [line, ""];
  }
  const caps = line.match(/^([A-ZÀ-ÖØ-Þ0-9'’ ,-]{6,}?)\s+([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ].*)$/);
  if (caps) return [caps[1]!.trim(), caps[2]!];
  return [line, ""];
}

/** Turns free text (Markdown headings inside paragraphs, glued headings) into
 * clean heading / paragraph blocks.  Used for the PDF and the on-screen reader
 * so both always show the same structure. */
export function normalizeContractBlocks(blocks: WorkspaceBlock[]): WorkspaceBlock[] {
  const out: WorkspaceBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "paragraph" && block.type !== "heading") {
      out.push(block);
      continue;
    }
    const raw = (block.text ?? "").replace(/\r/g, "");
    if (block.type === "heading") {
      out.push({ type: "heading", text: raw.replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").trim() });
      continue;
    }
    // A Markdown heading in the middle of a line starts a new line.
    const text = raw.replace(/[ \t]+(#{1,6})[ \t]+(?=\S)/g, "\n$1 ");
    let paragraph: string[] = [];
    const flush = () => {
      const value = paragraph.join("\n").trim();
      if (value) out.push({ type: "paragraph", text: value });
      paragraph = [];
    };
    for (const line of text.split("\n")) {
      const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
      if (heading) {
        flush();
        const [title, rest] = splitGluedHeading(heading[1]!.replace(/\*\*/g, "").trim());
        out.push({ type: "heading", text: title });
        if (rest) paragraph.push(rest);
        continue;
      }
      paragraph.push(line);
    }
    flush();
  }
  return out;
}

const SIGNATURE_HEADING = /^(signatures?|pour\s+(l['’]\s*employeur|la soci[ée]t[ée]|l['’]entreprise|.{2,60})|l['’]\s*employeur|le travailleur|l['’]employ[ée]|le salari[ée]|employee|employer|worker)\s*:?$/i;
const SIGNATURE_LINE = /^(fait\s+(à|a)\s.*|lu et approuv[ée].*|(nom|pr[ée]nom|fonction|qualit[ée]|date|signature|nom du signataire autoris[ée]|repr[ée]sent[ée]e? par|matricule|poste)\s*:.*|_{3,}.*|\.{3,}.*)$/i;

/** Templates often end with their own signature lines.  The standard
 * signature block replaces them, so they are removed from the end. */
export function stripTemplateSignatureSection(blocks: WorkspaceBlock[]): WorkspaceBlock[] {
  const plain = (value?: string) => (value ?? "").replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
  const isSignatureBlock = (block: WorkspaceBlock) => {
    if (block.type === "page_break") return true;
    if (block.type === "table") return false;
    if (block.type === "heading") return SIGNATURE_HEADING.test(plain(block.text)) || SIGNATURE_LINE.test(plain(block.text));
    const lines = (block.text ?? "").split("\n").map((line) => plain(line)).filter(Boolean);
    return lines.length > 0 && lines.every((line) => SIGNATURE_LINE.test(line) || SIGNATURE_HEADING.test(line));
  };
  let cut = blocks.length;
  while (cut > 0 && isSignatureBlock(blocks[cut - 1]!)) cut -= 1;
  // Only cut when what is removed really looks like a signature section.
  const removed = blocks.slice(cut);
  const hasSignatureWord = removed.some((block) => /signature|lu et approuv|fait\s+(à|a)\s/i.test(block.text ?? ""));
  return hasSignatureWord ? blocks.slice(0, cut) : blocks;
}

/* ------------------------------------------------------------------ */
/* Logo                                                                */
/* ------------------------------------------------------------------ */

/**
 * A company logo is a branding asset rather than a contract attachment. It is
 * deliberately fetched only from Cloudinary, where LiteHubs stores company
 * logos, so a profile URL can never become a request to an arbitrary host.
 */
export async function companyLogo(url: string | null | undefined): Promise<{ bytes: Uint8Array; kind: "png" | "jpg" } | null> {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/(^|\.)res\.cloudinary\.com$/i.test(parsed.hostname)) return null;
    const response = await fetch(parsed, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const declaredSize = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > 2_000_000) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > 2_000_000) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("image/png")) return { bytes, kind: "png" };
    if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) return { bytes, kind: "jpg" };
    return null;
  } catch {
    return null;
  }
}

function companyInitials(companyName: string) {
  const initials = companyName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || "CO";
}

const frDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(date);
};

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export async function layoutContractPdf(
  sourceBlocks: WorkspaceBlock[],
  options: ContractLayoutOptions,
): Promise<{ bytes: Buffer; slots: SignatureSlots }> {
  const plan = options.signaturePlan ?? { employee: 1, employer: 1 };
  const security = options.security ?? {};
  const mode = options.mode ?? "electronic";
  const parties: ContractParties = options.parties ?? { employerName: options.companyName };
  const blocks = stripTemplateSignatureSection(normalizeContractBlocks(sourceBlocks));

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const fetchedLogo = await companyLogo(options.logoUrl);
  let logo: PDFImage | null = null;
  if (fetchedLogo) {
    try {
      logo = fetchedLogo.kind === "png" ? await pdf.embedPng(fetchedLogo.bytes) : await pdf.embedJpg(fetchedLogo.bytes);
    } catch {
      logo = null;
    }
  }

  const securityCaption = [security.versionLabel, security.documentHash ? `SHA ${security.documentHash.slice(0, 10).toUpperCase()}` : null]
    .filter(Boolean)
    .join(" · ") || "EXEMPLAIRE CONTROLE";

  /**
   * Security watermark, drawn per page before any clause text, so the text
   * stays crisp on top of it: a guilloche rosette, the logo or initials in its
   * centre, and diagonal microtext with the company, reference, version and
   * hash.  It raises the cost of a casual forgery; the SHA-256 printed in the
   * footer is what actually proves the file unaltered.
   */
  const drawWatermark = (page: PDFPage) => {
    const cx = PAGE_WIDTH / 2;
    const cy = PAGE_HEIGHT / 2;
    for (let index = 0; index < 60; index += 1) {
      const angle = (index / 60) * Math.PI * 2;
      page.drawCircle({ x: cx + Math.cos(angle) * 56, y: cy + Math.sin(angle) * 56, size: 72, borderWidth: 0.3, borderColor: ACCENT, borderOpacity: 0.06 });
    }
    // No logo or initials in the watermark: the company logo stays in the header only.
    const unit = safe(font, `${options.companyName.toLocaleUpperCase("fr-FR").slice(0, 48)} · ${options.reference.slice(0, 48)} · ${securityCaption} · DOCUMENT ORIGINAL · `);
    const unitWidth = Math.max(font.widthOfTextAtSize(unit, 4.6), 1);
    const line = unit.repeat(Math.ceil(980 / unitWidth) + 1);
    for (let row = -3; row <= 19; row += 1) {
      page.drawText(line, { x: -150, y: row * 46, size: 4.6, font, color: ACCENT, opacity: 0.09, rotate: degrees(24) });
    }
  };

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = CONTENT_TOP;
  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawWatermark(page);
    y = CONTENT_TOP;
    // A discreet running title, so a loose page is still identifiable.
    page.drawText(safe(font, options.title.slice(0, 90)), { x: MARGIN_X, y: y + 6, size: 7.5, font: italic, color: MUTED });
    y -= 16;
  };
  const ensure = (height: number) => {
    if (y - height < CONTENT_BOTTOM) newPage();
  };

  const wordsOf = (runs: Run[], size: number): Word[] => {
    const words: Word[] = [];
    let spaceBefore = true;
    for (const run of runs) {
      const runFont = run.bold ? bold : font;
      for (const token of safe(runFont, run.text).split(/(\s+)/)) {
        if (!token) continue;
        if (/^\s+$/.test(token)) {
          spaceBefore = true;
          continue;
        }
        const previous = words.at(-1);
        // French punctuation never starts a line (« … ; ») and « never ends one.
        const glueAfterSpace = Boolean(previous) && spaceBefore && (/^[;:!?»]+[.,]?$/.test(token) || previous!.parts.at(-1)?.text.endsWith("«"));
        const text = glueAfterSpace ? ` ${token}` : token;
        const part = { text, bold: run.bold, width: runFont.widthOfTextAtSize(text, size) };
        if ((!spaceBefore || glueAfterSpace) && previous) {
          previous.parts.push(part);
          previous.width += part.width;
        } else words.push({ parts: [part], width: part.width });
        spaceBefore = false;
      }
    }
    return words;
  };

  /** Justified rich text.  Returns nothing; advances `y`. */
  const drawRich = (runs: Run[], { size = 10.2, leading = 15.2, indent = 0, hanging = 0, color = BODY, justify = true } = {}) => {
    const words = wordsOf(runs, size);
    if (!words.length) return;
    const space = font.widthOfTextAtSize(" ", size);
    const lines: Word[][] = [];
    let current: Word[] = [];
    let width = 0;
    for (const word of words) {
      const available = CONTENT_WIDTH - indent - (lines.length || current.length ? hanging : 0);
      const next = current.length ? width + space + word.width : word.width;
      if (current.length && next > available) {
        lines.push(current);
        current = [word];
        width = word.width;
      } else {
        current.push(word);
        width = next;
      }
    }
    if (current.length) lines.push(current);
    lines.forEach((line, index) => {
      ensure(leading);
      const x0 = MARGIN_X + indent + (index ? hanging : 0);
      const available = CONTENT_WIDTH - indent - (index ? hanging : 0);
      const natural = line.reduce((sum, word) => sum + word.width, 0) + space * (line.length - 1);
      const last = index === lines.length - 1;
      const gap = justify && !last && line.length > 1 && natural > available * 0.82 ? space + (available - natural) / (line.length - 1) : space;
      let x = x0;
      for (const word of line) {
        let partX = x;
        for (const part of word.parts) {
          page.drawText(part.text, { x: partX, y, size, font: part.bold ? bold : font, color });
          partX += part.width;
        }
        x += word.width + gap;
      }
      y -= leading;
    });
  };

  const drawHeading = (text: string, first: boolean) => {
    const value = safe(bold, text.replace(/\*\*/g, "").trim());
    if (!value) return;
    if (first) {
      // Legal document title, e.g. « CONTRAT DE TRAVAIL À DURÉE DÉTERMINÉE ».
      y -= 4;
      const words = value.split(/\s+/);
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && bold.widthOfTextAtSize(candidate, 16.5) > CONTENT_WIDTH) {
          lines.push(line);
          line = word;
        } else line = candidate;
      }
      if (line) lines.push(line);
      for (const current of lines) {
        ensure(24);
        const w = bold.widthOfTextAtSize(current, 16.5);
        page.drawText(current, { x: MARGIN_X + (CONTENT_WIDTH - w) / 2, y, size: 16.5, font: bold, color: INK });
        y -= 22;
      }
      const ref = safe(font, `Réf. ${options.reference}${security.versionLabel ? ` · ${security.versionLabel}` : ""}`);
      const rw = font.widthOfTextAtSize(ref, 8.5);
      page.drawText(ref, { x: MARGIN_X + (CONTENT_WIDTH - rw) / 2, y: y + 4, size: 8.5, font, color: MUTED });
      y -= 12;
      page.drawLine({ start: { x: MARGIN_X + CONTENT_WIDTH / 2 - 40, y }, end: { x: MARGIN_X + CONTENT_WIDTH / 2 + 40, y }, thickness: 1.2, color: ACCENT });
      y -= 24;
      return;
    }
    // Keep a heading with at least two lines of its clause.
    ensure(14 + 34);
    y -= 6;
    drawRich([{ text: value, bold: true }], { size: 11, leading: 15, color: ACCENT_DARK, justify: false });
    y -= 3;
  };

  const drawParagraph = (text: string) => {
    const lines = text.replace(/\r/g, "").split("\n").map((line) => line.trim());
    for (const line of lines) {
      if (!line || /^---+$/.test(line)) {
        y -= 6;
        continue;
      }
      const numbered = line.match(/^(\d+[.)]|[a-z][.)])\s+(.+)$/i);
      const bullet = line.match(/^[-•*]\s+(.+)$/);
      if (numbered) {
        ensure(15);
        const marker = numbered[1]!;
        page.drawText(safe(font, marker), { x: MARGIN_X + 10, y, size: 10.2, font, color: BODY });
        drawRich(runsOf(numbered[2]!), { indent: 28 });
        y -= 2;
      } else if (bullet) {
        ensure(15);
        page.drawCircle({ x: MARGIN_X + 14, y: y + 3.4, size: 1.6, color: ACCENT });
        drawRich(runsOf(bullet[1]!), { indent: 24 });
        y -= 2;
      } else {
        drawRich(runsOf(line));
        y -= 5;
      }
    }
    y -= 4;
  };

  const drawTable = (rows: string[][]) => {
    if (!rows.length) return;
    const columns = Math.max(...rows.map((row) => row.length), 1);
    const colWidth = CONTENT_WIDTH / columns;
    for (const [rowIndex, row] of rows.entries()) {
      const header = rowIndex === 0;
      const cellLines = Array.from({ length: columns }, (_, column) => {
        const cellFont = header ? bold : font;
        const words = safe(cellFont, (row[column] ?? "").replace(/\*\*/g, "")).split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        let line = "";
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && cellFont.widthOfTextAtSize(candidate, 9.2) > colWidth - 12) {
            lines.push(line);
            line = word;
          } else line = candidate;
        }
        if (line) lines.push(line);
        return lines.length ? lines : [""];
      });
      const height = Math.max(...cellLines.map((lines) => lines.length)) * 12.5 + 9;
      ensure(height);
      if (header) page.drawRectangle({ x: MARGIN_X, y: y - height + 10, width: CONTENT_WIDTH, height, color: rgb(0.93, 0.96, 0.95) });
      page.drawRectangle({ x: MARGIN_X, y: y - height + 10, width: CONTENT_WIDTH, height, borderColor: RULE, borderWidth: 0.5 });
      cellLines.forEach((lines, column) => {
        lines.forEach((line, index) => {
          page.drawText(line, { x: MARGIN_X + column * colWidth + 6, y: y - 2 - index * 12.5, size: 9.2, font: header ? bold : font, color: INK });
        });
        if (column) page.drawLine({ start: { x: MARGIN_X + column * colWidth, y: y + 10 }, end: { x: MARGIN_X + column * colWidth, y: y - height + 10 }, thickness: 0.5, color: RULE });
      });
      y -= height;
    }
    y -= 10;
  };

  /* ---- Clauses -------------------------------------------------- */
  drawWatermark(page);
  const hasTitle = blocks[0]?.type === "heading";
  if (!hasTitle) drawHeading(options.title, true);
  let firstHeading = hasTitle;
  for (const block of blocks) {
    if (block.type === "page_break") {
      newPage();
      continue;
    }
    if (block.type === "heading") {
      drawHeading(block.text ?? "", firstHeading);
      firstHeading = false;
      continue;
    }
    firstHeading = false;
    if (block.type === "table") {
      drawTable(block.rows ?? []);
      continue;
    }
    drawParagraph(block.text ?? "");
  }

  /* ---- Signature block ------------------------------------------ */
  const slots: SignatureSlots = { employee: [], employer: [] };
  const employeeCount = Math.max(0, Math.min(6, plan.employee));
  const employerCount = Math.max(0, Math.min(6, plan.employer));
  const rowsCount = Math.max(employeeCount, employerCount);
  if (rowsCount > 0) {
    const columnWidth = (CONTENT_WIDTH - 34) / 2;
    const boxHeight = 66;
    const rowHeight = 150;
    // « Fait à » line + every row stays together: never split a party's block.
    ensure(46 + rowHeight);
    y -= 8;
    const place = parties.city?.trim() || BLANK;
    const signedDate = frDate(options.signedOn) ?? BLANK;
    const madeAt = safe(font, `Fait à ${place}, le ${signedDate}, en deux (2) exemplaires originaux, chaque partie reconnaissant avoir reçu le sien.`);
    drawRich([{ text: madeAt, bold: false }], { justify: false });
    y -= 14;

    const drawLabelValue = (x: number, label: string, value: string | null | undefined, width: number) => {
      const labelText = safe(font, `${label} : `);
      page.drawText(labelText, { x, y, size: 9, font, color: MUTED });
      const valueX = x + font.widthOfTextAtSize(labelText, 9);
      const filled = Boolean(value && value.trim());
      if (filled) {
        let text = safe(bold, value!.trim());
        while (text.length > 3 && bold.widthOfTextAtSize(text, 9.5) > width - (valueX - x)) text = text.slice(0, -1);
        page.drawText(text, { x: valueX, y, size: 9.5, font: bold, color: INK });
      } else {
        page.drawLine({ start: { x: valueX, y: y - 2 }, end: { x: x + width, y: y - 2 }, thickness: 0.5, color: RULE });
      }
      return { x: valueX + 1, y, prefilled: filled };
    };

    for (let row = 0; row < rowsCount; row += 1) {
      ensure(rowHeight);
      const top = y;
      for (const role of ["employer", "employee"] as const) {
        const count = role === "employee" ? employeeCount : employerCount;
        if (row >= count) continue;
        const x = role === "employer" ? MARGIN_X : MARGIN_X + columnWidth + 34;
        y = top;
        const heading = role === "employer" ? "POUR L’EMPLOYEUR" : "LE TRAVAILLEUR";
        const label = count > 1 ? `${heading} (${row + 1})` : heading;
        page.drawText(safe(bold, label), { x, y, size: 9, font: bold, color: ACCENT_DARK });
        page.drawLine({ start: { x, y: y - 4 }, end: { x: x + columnWidth, y: y - 4 }, thickness: 0.8, color: ACCENT });
        y -= 18;
        let name: SignatureSlot["name"];
        if (role === "employer") {
          page.drawText(safe(bold, parties.employerName.slice(0, 60)), { x, y, size: 9.5, font: bold, color: INK });
          y -= 14;
          name = drawLabelValue(x, "Représenté par", null, columnWidth);
          y -= 14;
          drawLabelValue(x, "Fonction", parties.employerRole, columnWidth);
        } else {
          name = drawLabelValue(x, "Nom", row === 0 ? parties.employeeName : null, columnWidth);
          y -= 14;
          drawLabelValue(x, "Poste", row === 0 ? parties.employeeTitle : null, columnWidth);
          y -= 14;
          page.drawText(" ", { x, y, size: 9, font });
        }
        y -= 15;
        page.drawText(safe(italic, "Mention « Lu et approuvé » :"), { x, y, size: 8, font: italic, color: MUTED });
        const mention = { x: x + italic.widthOfTextAtSize(safe(italic, "Mention « Lu et approuvé » :"), 8) + 6, y };
        page.drawLine({ start: { x: mention.x - 2, y: y - 2 }, end: { x: x + columnWidth, y: y - 2 }, thickness: 0.5, color: RULE });
        y -= 10;
        const boxBottom = y - boxHeight;
        page.drawRectangle({ x, y: boxBottom, width: columnWidth, height: boxHeight, borderColor: rgb(0.7, 0.76, 0.78), borderWidth: 0.6, color: rgb(1, 1, 1), opacity: 0.7, borderOpacity: 1 });
        page.drawText("Signature", { x: x + 5, y: boxBottom + boxHeight - 10, size: 6.5, font, color: MUTED });
        y = boxBottom - 14;
        const date = drawLabelValue(x, "Date", null, columnWidth);
        slots[role].push({
          pageNumber: pdf.getPageCount(),
          x,
          y: boxBottom,
          width: columnWidth,
          height: boxHeight,
          name,
          mention,
          date: { x: date.x, y: date.y },
        });
      }
      y = top - rowHeight;
    }
  }

  /* ---- Header and footer on every page --------------------------- */
  const pages = pdf.getPages();
  for (const [index, current] of pages.entries()) {
    current.drawRectangle({ x: 0, y: PAGE_HEIGHT - 76, width: PAGE_WIDTH, height: 76, color: rgb(0.965, 0.98, 0.975) });
    current.drawRectangle({ x: 0, y: PAGE_HEIGHT - 4, width: PAGE_WIDTH, height: 4, color: ACCENT });
    if (logo) {
      const scale = Math.min(46 / logo.width, 46 / logo.height);
      current.drawImage(logo, { x: MARGIN_X, y: PAGE_HEIGHT - 63 + (46 - logo.height * scale) / 2, width: logo.width * scale, height: logo.height * scale });
    } else {
      current.drawCircle({ x: MARGIN_X + 18, y: PAGE_HEIGHT - 40, size: 18, color: ACCENT });
      const initials = companyInitials(options.companyName);
      current.drawText(initials, { x: MARGIN_X + 18 - bold.widthOfTextAtSize(initials, 8.5) / 2, y: PAGE_HEIGHT - 43, size: 8.5, font: bold, color: rgb(1, 1, 1) });
    }
    const company = safe(bold, options.companyName.toLocaleUpperCase("fr-FR").slice(0, 60));
    current.drawText(company, { x: PAGE_WIDTH - MARGIN_X - bold.widthOfTextAtSize(company, 12), y: PAGE_HEIGHT - 34, size: 12, font: bold, color: ACCENT_DARK });
    const ref = safe(font, `Réf. ${options.reference.slice(0, 60)}`);
    current.drawText(ref, { x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(ref, 8), y: PAGE_HEIGHT - 50, size: 8, font, color: MUTED });

    // Footer, kept well inside the printable area of office printers.
    current.drawLine({ start: { x: MARGIN_X, y: 52 }, end: { x: PAGE_WIDTH - MARGIN_X, y: 52 }, thickness: 0.5, color: RULE });
    const pageLabel = `Page ${index + 1} sur ${pages.length}`;
    current.drawText(pageLabel, { x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(pageLabel, 8), y: 39, size: 8, font, color: MUTED });
    const left = safe(font, `${options.reference}${security.versionLabel ? ` · ${security.versionLabel}` : ""}`);
    current.drawText(left, { x: MARGIN_X, y: 39, size: 7.5, font, color: MUTED });
    if (security.documentHash) {
      current.drawText(`Empreinte SHA-256 : ${security.documentHash.slice(0, 40)}…`, { x: MARGIN_X, y: 28, size: 6, font, color: MUTED });
    }
    if (mode === "paper") {
      // Initials of both parties on every page of a printed contract.
      const label = "Paraphes";
      const boxX = PAGE_WIDTH / 2 - 52;
      current.drawText(label, { x: boxX - font.widthOfTextAtSize(label, 7) - 6, y: 36, size: 7, font, color: MUTED });
      current.drawRectangle({ x: boxX, y: 30, width: 48, height: 18, borderColor: RULE, borderWidth: 0.6 });
      current.drawRectangle({ x: boxX + 56, y: 30, width: 48, height: 18, borderColor: RULE, borderWidth: 0.6 });
      current.drawText("Employeur", { x: boxX + 3, y: 23, size: 5.5, font, color: MUTED });
      current.drawText("Travailleur", { x: boxX + 59, y: 23, size: 5.5, font, color: MUTED });
    }
  }

  return { bytes: Buffer.from(await pdf.save()), slots };
}

/* ------------------------------------------------------------------ */
/* Stamping electronic signatures                                       */
/* ------------------------------------------------------------------ */

/** Writes each signed field into its slot: name, « Lu et approuvé », the
 * signature itself, the date and a small electronic-signature caption. */
export async function stampSignatures(source: Buffer | Uint8Array, slots: SignatureSlots, fields: SignedField[]): Promise<Buffer> {
  const pdf = await PDFDocument.load(source);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const counters: Record<SignatureRole, number> = { employee: 0, employer: 0 };
  const signed = rgb(0.04, 0.26, 0.42);
  for (const field of fields) {
    const slot = slots[field.signerRole][counters[field.signerRole]++];
    if (!slot || field.status !== "signed") continue;
    const page = pdf.getPages()[slot.pageNumber - 1];
    if (!page) continue;
    const name = safe(bold, field.signedName?.trim() || "");
    if (name && !slot.name.prefilled) page.drawText(name.slice(0, 48), { x: slot.name.x, y: slot.name.y, size: 9.5, font: bold, color: signed });
    page.drawText(safe(italic, "Lu et approuvé"), { x: slot.mention.x, y: slot.mention.y, size: 9, font: italic, color: signed });
    const image = field.signatureData?.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if (image) {
      try {
        const bytes = Buffer.from(image[2]!, "base64");
        const embedded = image[1] === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const ratio = Math.min((slot.width - 16) / embedded.width, (slot.height - 22) / embedded.height);
        const width = embedded.width * ratio;
        const height = embedded.height * ratio;
        page.drawImage(embedded, { x: slot.x + (slot.width - width) / 2, y: slot.y + 8 + (slot.height - 22 - height) / 2, width, height });
      } catch {
        page.drawText(name || "Signé", { x: slot.x + 10, y: slot.y + slot.height / 2 - 6, size: 15, font: italic, color: signed });
      }
    } else {
      page.drawText((name || "Signé").slice(0, 34), { x: slot.x + 10, y: slot.y + slot.height / 2 - 6, size: 15, font: italic, color: signed });
    }
    const when = field.signedAt ? new Date(field.signedAt) : new Date();
    const day = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(when);
    page.drawText(safe(font, day), { x: slot.date.x, y: slot.date.y, size: 9.5, font, color: signed });
    const caption = safe(font, `Signé électroniquement via LiteHubs le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(when)} UTC`);
    page.drawText(caption, { x: slot.x + 5, y: slot.y + 3, size: 5.8, font, color: MUTED });
  }
  return Buffer.from(await pdf.save());
}
