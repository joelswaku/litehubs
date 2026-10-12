import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Stamps « Page X / N » at the bottom right of every page of a generated PDF.
 * Used by the documents that do not draw their own page numbers, so a printed
 * or forwarded copy always shows whether a page is missing.
 */
export async function numberPdfPages(buffer: Buffer): Promise<Buffer> {
  try {
    const pdf = await PDFDocument.load(buffer);
    const pages = pdf.getPages();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const size = 7.5;
    pages.forEach((page, index) => {
      const label = `Page ${index + 1} / ${pages.length}`;
      const { width } = page.getSize();
      page.drawText(label, {
        x: width - 36 - font.widthOfTextAtSize(label, size),
        y: 12,
        size,
        font,
        color: rgb(0.42, 0.45, 0.5),
      });
    });
    return Buffer.from(await pdf.save());
  } catch {
    // Never block a download because of the page numbers.
    return buffer;
  }
}
