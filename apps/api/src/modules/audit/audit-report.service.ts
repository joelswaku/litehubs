import PDFDocument from "pdfkit";
import { withTenantContext } from "../../utils/tenant-query";
import type { AuditQuery } from "./audit.validation";
import { list, type AuditContext } from "./audit.service";

type OrganizationRow = { name: string };

const text = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

const title = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const date = (value: unknown, french: boolean) => {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return text(value);
  return new Intl.DateTimeFormat(french ? "fr-FR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

async function organizationName(context: AuditContext) {
  return withTenantContext(context, async (client) =>
    (
      await client.query<OrganizationRow>(
        "SELECT name FROM organizations WHERE id = $1",
        [context.organizationId],
      )
    ).rows[0]?.name ?? "Organization",
  );
}

function addPageIfNeeded(doc: PDFKit.PDFDocument, height: number) {
  if (doc.y + height < doc.page.height - 52) return;
  doc.addPage();
  doc.y = 52;
}

/**
 * Produces a read-only audit evidence report. The underlying audit records stay
 * append-only; exporting them never alters, redacts or removes an event.
 */
export async function exportAuditPdf(
  context: AuditContext,
  query: AuditQuery,
  french: boolean,
): Promise<Buffer> {
  const [organization, entries] = await Promise.all([
    organizationName(context),
    list(context, query),
  ]);
  const reportTitle = french ? "Journal d’audit" : "Audit log";
  const generated = date(new Date(), french);

  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: reportTitle, Author: organization },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    document.rect(0, 0, document.page.width, 88).fill("#10243f");
    document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18).text(organization, 48, 30);
    document
      .fillColor("#cbdff7")
      .font("Helvetica")
      .fontSize(9)
      .text(french ? "Registre de traçabilité confidentiel" : "Confidential audit record", 48, 57);
    document
      .fillColor("#10243f")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(reportTitle, 48, 113);
    document
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(8)
      .text(`${french ? "Généré le" : "Generated"} ${generated} · ${entries.length} ${french ? "événement(s)" : "event(s)"}`, 48, 138);
    document.y = 166;

    if (!entries.length) {
      document
        .fillColor("#64748b")
        .font("Helvetica-Oblique")
        .fontSize(10)
        .text(french ? "Aucun événement ne correspond aux filtres actuels." : "No events match the current filters.");
    }

    for (const entry of entries) {
      const entity = [title(entry.entity.table), entry.entity.label ?? entry.entity.id]
        .filter(Boolean)
        .join(" · ");
      const actor = entry.actor.name ?? entry.actor.email ?? (french ? "Système" : "System");
      const details = [
        `${date(entry.occurredAt, french)} · ${actor}`,
        `${title(entry.action)} · ${entity}`,
        `${french ? "Niveau" : "Severity"}: ${title(entry.severity)}`,
        entry.route ? `${french ? "Route" : "Route"}: ${entry.route}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const height = document.heightOfString(details, { width: document.page.width - 120 }) + 28;
      addPageIfNeeded(document, height);
      const top = document.y;
      document
        .roundedRect(48, top, document.page.width - 96, height, 7)
        .fillAndStroke("#f7f8fa", "#d8e1ea");
      document
        .fillColor("#10243f")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(title(entry.action), 60, top + 11, { width: document.page.width - 120 });
      document
        .fillColor("#475569")
        .font("Helvetica")
        .fontSize(8.5)
        .text(details, 60, top + 28, { width: document.page.width - 120, lineGap: 2 });
      document.y = top + height + 10;
    }

    document
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(7)
      .text(
        `${organization} · ${french ? "Export protégé du journal d’audit" : "Protected audit-log export"}`,
        48,
        document.page.height - 34,
        { width: document.page.width - 96, align: "center" },
      );
    document.end();
  });
}