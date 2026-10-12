/**
 * Shared LiteHubs PDF layout for printable documents (invoices, leave forms,
 * attendance sheets, reports…): company logo and name, title block, fields,
 * tables, text, signature boxes, and « Page X / N » with a controlled-document
 * mention on every page.
 *
 *   const pdf = await createPdf(client, organizationId, { title: "Facture", reference: "FAC-0012" });
 *   pdf.section("Client"); pdf.fields([["Nom", "Jean"], ["Téléphone", "+243…"]]);
 *   pdf.table([{ label: "Article", width: 3 }, { label: "Montant", width: 1, align: "right" }], rows);
 *   pdf.signatures(["Client", "Pour l’entreprise"]);
 *   return pdf.finish();
 */
import PDFDocument from "pdfkit";
import type { PoolClient } from "pg";
import { companyLogo } from "../modules/contracts/contract-pdf";

export type PdfCompany = { name: string; logo: { bytes: Uint8Array; kind: "png" | "jpg" } | null; address: string; phone: string | null; email: string | null };
export type PdfColumn = { label: string; width?: number; align?: "left" | "right" | "center" };
export type PdfOptions = { title: string; subtitle?: string; reference?: string; french?: boolean; landscape?: boolean; date?: Date };

const NAVY = "#1E3A6E";
const INK = "#172033";
const MUTED = "#61708B";
const BORDER = "#D5DDEB";
const PALE = "#F2F5FB";

/** Standard PDF fonts only know Latin-1: replace what they cannot draw. */
export function pdfText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "·")
    .replace(/[  ]/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, "");
}

export function pdfMoney(value: unknown, currency = "") {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(number).replace(/ | /g, " ")}${currency ? ` ${currency}` : ""}`;
}

export function pdfDate(value: unknown, withTime = false) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value).length === 10 ? `${String(value)}T12:00:00Z` : String(value));
  if (Number.isNaN(date.getTime())) return pdfText(value);
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Africa/Kinshasa",
  });
}

export async function loadPdfCompany(client: PoolClient, organizationId: string): Promise<PdfCompany> {
  const result = await client.query<Record<string, string | null>>(
    `SELECT COALESCE(o.display_name, o.legal_name, o.slug) AS name, settings.logo_url,
            o.address_line1, o.address_line2, o.city, o.region,
            web.contact_phone, web.contact_email
       FROM organizations o
       LEFT JOIN organization_settings settings ON settings.organization_id = o.id
       LEFT JOIN organization_website_settings web ON web.organization_id = o.id
      WHERE o.id = $1`,
    [organizationId],
  );
  const row = result.rows[0] ?? {};
  return {
    name: row.name ?? "LiteHubs",
    logo: await companyLogo(row.logo_url),
    address: [row.address_line1, row.address_line2, row.city, row.region].filter(Boolean).join(", "),
    phone: row.contact_phone ?? null,
    email: row.contact_email ?? null,
  };
}

export async function createPdf(client: PoolClient, organizationId: string, options: PdfOptions) {
  return buildPdf(await loadPdfCompany(client, organizationId), options);
}

export function buildPdf(company: PdfCompany, options: PdfOptions) {
  const doc = new PDFDocument({
    size: "A4",
    layout: options.landscape ? "landscape" : "portrait",
    margins: { top: 42, bottom: 54, left: 42, right: 42 },
    bufferPages: true,
    info: { Title: pdfText(options.title), Author: pdfText(company.name), Creator: "LiteHubs" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const left = doc.page.margins.left;
  const width = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const printed = options.date ?? new Date();

  const smallHeader = () => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY).text(pdfText(company.name), left, 24, { width: width() / 2, lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(pdfText(options.title + (options.reference ? ` · ${options.reference}` : "")), left + width() / 2, 24, { width: width() / 2, align: "right", lineBreak: false });
    doc.moveTo(left, 36).lineTo(left + width(), 36).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.y = 46;
  };
  doc.on("pageAdded", smallHeader);

  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };

  /* First-page header: logo, company, title. */
  const top = doc.y;
  let textX = left;
  if (company.logo) {
    try {
      doc.image(Buffer.from(company.logo.bytes), left, top, { fit: [64, 48] });
      textX = left + 76;
    } catch {
      textX = left;
    }
  }
  doc.font("Helvetica-Bold").fontSize(14).fillColor(NAVY).text(pdfText(company.name), textX, top + 2, { width: width() * 0.55 - (textX - left) });
  const contact = [company.address, company.phone, company.email].filter(Boolean).join(" · ");
  if (contact) doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(pdfText(contact), textX, doc.y + 2, { width: width() * 0.55 - (textX - left) });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  doc.text(`${options.french === false ? "Printed" : "Édité le"} ${pdfDate(printed, true)}`, left + width() * 0.55, top + 4, { width: width() * 0.45, align: "right" });
  if (options.reference) doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(pdfText(options.reference), left + width() * 0.55, doc.y + 2, { width: width() * 0.45, align: "right" });
  doc.y = Math.max(doc.y, top + 54);
  doc.rect(left, doc.y + 4, width(), 3).fill(NAVY);
  doc.y += 18;
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(pdfText(options.title), left, doc.y, { width: width() });
  if (options.subtitle) doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(pdfText(options.subtitle), left, doc.y + 2, { width: width() });
  doc.y += 12;

  const api = {
    doc,
    section(title: string) {
      ensure(40);
      doc.y += 6;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(pdfText(title).toUpperCase(), left, doc.y, { width: width(), characterSpacing: 0.6 });
      doc.moveTo(left, doc.y + 3).lineTo(left + width(), doc.y + 3).strokeColor(BORDER).lineWidth(0.7).stroke();
      doc.y += 9;
      return api;
    },
    /** Label / value pairs in 2 (or 3) columns. */
    fields(pairs: [string, unknown][], columns = 2) {
      const gap = 14;
      const colWidth = (width() - gap * (columns - 1)) / columns;
      for (let start = 0; start < pairs.length; start += columns) {
        const row = pairs.slice(start, start + columns);
        const heights = row.map(([, value]) => doc.font("Helvetica").fontSize(10).heightOfString(pdfText(value), { width: colWidth }) + 14);
        const height = Math.max(...heights);
        ensure(height + 4);
        const y = doc.y;
        row.forEach(([label, value], index) => {
          const x = left + index * (colWidth + gap);
          doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(pdfText(label).toUpperCase(), x, y, { width: colWidth, characterSpacing: 0.3 });
          doc.font("Helvetica").fontSize(10).fillColor(INK).text(pdfText(value), x, y + 11, { width: colWidth });
        });
        doc.y = y + height + 4;
      }
      doc.x = left;
      return api;
    },
    paragraph(text: string, options: { size?: number; color?: string; bold?: boolean } = {}) {
      const value = pdfText(text);
      doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size ?? 10);
      ensure(Math.min(doc.heightOfString(value, { width: width() }), 120) + 6);
      doc.fillColor(options.color ?? INK).text(value, left, doc.y, { width: width(), lineGap: 2 });
      doc.y += 6;
      return api;
    },
    /** A boxed note (warnings, legal mentions). */
    note(text: string) {
      const value = pdfText(text);
      doc.font("Helvetica").fontSize(8.5);
      const height = doc.heightOfString(value, { width: width() - 20 }) + 14;
      ensure(height + 6);
      const y = doc.y;
      doc.roundedRect(left, y, width(), height, 4).fill(PALE);
      doc.fillColor(MUTED).text(value, left + 10, y + 7, { width: width() - 20 });
      doc.y = y + height + 8;
      return api;
    },
    /** Table with proportional column widths; repeats the header on each new page. */
    table(columns: PdfColumn[], rows: unknown[][], options: { totals?: unknown[]; empty?: string } = {}) {
      const total = columns.reduce((sum, column) => sum + (column.width ?? 1), 0);
      const widths = columns.map((column) => ((column.width ?? 1) / total) * width());
      const pad = 5;
      const drawHeader = () => {
        const y = doc.y;
        doc.rect(left, y, width(), 18).fill(NAVY);
        let x = left;
        columns.forEach((column, index) => {
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF").text(pdfText(column.label).toUpperCase(), x + pad, y + 5.5, { width: widths[index]! - pad * 2, align: column.align ?? "left", lineBreak: false, ellipsis: true });
          x += widths[index]!;
        });
        doc.y = y + 18;
      };
      ensure(40);
      drawHeader();
      const body = rows.length ? rows : [[options.empty ?? "Aucune donnée."]];
      const cellText = (value: unknown) => (value === "" ? "" : pdfText(value));
      const draw = (row: unknown[], index: number, bold = false) => {
        const cells = rows.length || bold ? row : [row[0]];
        const cellWidths = rows.length || bold ? widths : [width()];
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
        const height = Math.max(16, ...cells.map((cell, cellIndex) => doc.heightOfString(cellText(cell) || " ", { width: cellWidths[cellIndex]! - pad * 2 }) + 8));
        if (doc.y + height > bottom()) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        if (bold) doc.rect(left, y, width(), height).fill("#E6ECF7");
        else if (index % 2 === 1) doc.rect(left, y, width(), height).fill(PALE);
        let x = left;
        cells.forEach((cell, cellIndex) => {
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(rows.length || bold ? INK : MUTED).text(cellText(cell), x + pad, y + 4, { width: cellWidths[cellIndex]! - pad * 2, align: rows.length || bold ? (columns[cellIndex]?.align ?? "left") : "left" });
          x += cellWidths[cellIndex]!;
        });
        doc.moveTo(left, y + height).lineTo(left + width(), y + height).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.y = y + height;
      };
      body.forEach((row, index) => draw(row, index));
      if (options.totals) draw(options.totals, 0, true);
      doc.y += 8;
      doc.x = left;
      return api;
    },
    /** Signature boxes side by side (name, date, signature). */
    signatures(labels: string[]) {
      const gap = 16;
      const boxWidth = (width() - gap * (labels.length - 1)) / labels.length;
      ensure(96);
      doc.y += 8;
      const y = doc.y;
      labels.forEach((label, index) => {
        const x = left + index * (boxWidth + gap);
        doc.roundedRect(x, y, boxWidth, 80, 4).strokeColor(BORDER).lineWidth(0.8).stroke();
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(NAVY).text(pdfText(label), x + 8, y + 7, { width: boxWidth - 16 });
        doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("Nom, date et signature", x + 8, y + 66, { width: boxWidth - 16 });
      });
      doc.y = y + 92;
      doc.x = left;
      return api;
    },
    /** Big summary figures in a row (KPI tiles). */
    stats(items: [string, unknown][]) {
      const gap = 8;
      const tile = (width() - gap * (items.length - 1)) / items.length;
      ensure(50);
      const y = doc.y;
      items.forEach(([label, value], index) => {
        const x = left + index * (tile + gap);
        doc.roundedRect(x, y, tile, 42, 4).fill(PALE);
        doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(pdfText(label).toUpperCase(), x + 7, y + 6, { width: tile - 14, lineBreak: false, ellipsis: true });
        doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(pdfText(value), x + 7, y + 19, { width: tile - 14, lineBreak: false, ellipsis: true });
      });
      doc.y = y + 50;
      doc.x = left;
      return api;
    },
    finish(): Promise<Buffer> {
      const range = doc.bufferedPageRange();
      for (let index = 0; index < range.count; index += 1) {
        doc.switchToPage(range.start + index);
        doc.page.margins.bottom = 0;
        const y = doc.page.height - 32;
        doc.moveTo(left, y - 6).lineTo(doc.page.width - doc.page.margins.right, y - 6).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.font("Helvetica").fontSize(7).fillColor(MUTED);
        doc.text(pdfText(`${company.name} · ${options.title}${options.reference ? ` · ${options.reference}` : ""} · Document contrôlé LiteHubs`), left, y, { width: width() * 0.75, lineBreak: false, ellipsis: true });
        doc.text(`Page ${index + 1} / ${range.count}`, left + width() * 0.75, y, { width: width() * 0.25, align: "right", lineBreak: false });
      }
      doc.end();
      return done;
    },
  };
  return api;
}

export type PdfBuilder = ReturnType<typeof buildPdf>;

/** Sends a generated PDF as a download (or inline with ?inline=1). */
export function sendPdf(res: import("express").Response, buffer: Buffer, fileName: string, inline = false) {
  const safe = fileName.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "document.pdf";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safe.endsWith(".pdf") ? safe : `${safe}.pdf`}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", String(buffer.length));
  res.end(buffer);
}
