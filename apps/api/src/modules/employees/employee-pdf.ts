/**
 * Printable employee documents built with the shared LiteHubs PDF layout:
 * « Fiche employé » and « Attestation de travail ».
 *
 * Data is always loaded through the existing employee service functions, so a
 * PDF never contains a field the matching JSON endpoint would hide from the
 * same caller (private data stays masked for non Owner/HR readers).
 */
import type { PoolClient } from "pg";
import { BadRequestError, ForbiddenError } from "../../utils/errors";
import { buildPdf, loadPdfCompany, pdfDate, pdfText } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import * as service from "./employee.service";

type EmployeeData = Awaited<ReturnType<typeof service.getEmployee>>;

const STATUS: Record<string, string> = {
  active: "Actif",
  probation: "Période d'essai",
  on_leave: "En congé",
  suspended: "Suspendu",
  terminated: "Sorti des effectifs",
};
const CONTRACT: Record<string, string> = {
  permanent: "Contrat à durée indéterminée (CDI)",
  temporary: "Contrat à durée déterminée (CDD)",
  contract: "Contrat de prestation",
  casual: "Journalier / occasionnel",
  intern: "Stage",
};
const CATEGORY: Record<string, string> = {
  worker: "Ouvrier",
  supervisor: "Superviseur",
  officer: "Cadre / agent",
  manager: "Manager",
};

const label = (map: Record<string, string>, value: string | null | undefined) =>
  value ? (map[value] ?? value.replace(/_/g, " ")) : null;

function safeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function companyCity(client: PoolClient, organizationId: string) {
  const result = await client.query<{ city: string | null }>(
    "SELECT city FROM organizations WHERE id = $1",
    [organizationId],
  );
  return result.rows[0]?.city?.trim() || null;
}

function employeeFile(employee: EmployeeData, company: Awaited<ReturnType<typeof loadPdfCompany>>) {
  const pdf = buildPdf(company, {
    title: "Fiche employé",
    subtitle: `${employee.fullName} · Document confidentiel`,
    reference: employee.employeeNumber,
  });
  const address = [
    employee.address.line1,
    employee.address.line2,
    employee.address.city,
    employee.address.region,
    employee.address.postalCode,
    employee.address.country,
  ]
    .filter(Boolean)
    .join(", ");

  pdf.section("Identité").fields([
    ["Matricule", employee.employeeNumber],
    ["Nom complet", employee.fullName],
    ["Nom", employee.identity.lastName],
    ["Post-nom", employee.identity.postName],
    ["Prénom", employee.identity.firstName],
    ["Date de naissance", employee.identity.dateOfBirth ? pdfDate(employee.identity.dateOfBirth) : null],
    ["Lieu de naissance", employee.identity.placeOfBirth],
    ["N° de pièce d'identité", employee.identity.identityDocumentNumber],
    ["N° de sécurité sociale", employee.identity.socialSecurityNumber],
  ]);

  pdf.section("Emploi").fields([
    ["Poste", employee.jobTitle],
    ["Catégorie", label(CATEGORY, employee.positionCategory)],
    ["Statut", label(STATUS, employee.employment.status)],
    ["Type de contrat", label(CONTRACT, employee.employment.type)],
    ["Date d'embauche", employee.employment.startDate ? pdfDate(employee.employment.startDate) : null],
    ["Département", employee.department?.name],
  ]);

  pdf.section("Affectation").fields([
    ["Province", employee.province?.name],
    ["Site / ferme", employee.site?.name],
    ["Compte LiteHubs", employee.member?.fullName],
    ["E-mail professionnel", employee.member?.email],
  ]);

  pdf.section("Coordonnées").fields([
    ["Téléphone", employee.contact.phone],
    ["Adresse", address || null],
    ["Contact d'urgence", employee.contact.emergencyContactName],
    ["Téléphone d'urgence", employee.contact.emergencyContactPhone],
  ]);

  if (employee.notes) pdf.section("Notes").paragraph(employee.notes);

  pdf.signatures(["Employé", "Responsable RH"]);
  return pdf.finish();
}

function workCertificate(
  employee: EmployeeData,
  company: Awaited<ReturnType<typeof loadPdfCompany>>,
  city: string | null,
) {
  if (employee.employment.status === "terminated")
    throw new BadRequestError(
      "Une attestation de travail ne peut être délivrée que pour un employé en poste",
    );
  if (!employee.employment.startDate)
    throw new BadRequestError(
      "La date d'embauche de cet employé doit être renseignée avant de délivrer une attestation de travail",
    );

  const pdf = buildPdf(company, {
    title: "Attestation de travail",
    reference: employee.employeeNumber,
  });
  const doc = pdf.doc;
  const today = new Date();
  const contract = label(CONTRACT, employee.employment.type);
  const assignment = [employee.site?.name, employee.province?.name].filter(Boolean).join(", ");

  doc.y += 18;
  pdf.paragraph(
    `Nous soussignés, ${company.name}, attestons par la présente que M./Mme ${employee.fullName}` +
      `, matricule ${employee.employeeNumber}, est employé(e) au sein de notre entreprise depuis le ` +
      `${pdfDate(employee.employment.startDate)} en qualité de ${employee.jobTitle}` +
      `${contract ? `, sous ${contract.charAt(0).toLowerCase()}${contract.slice(1)}` : ""}` +
      `${assignment ? `, affecté(e) à ${assignment}` : ""}.`,
    { size: 11.5 },
  );
  doc.y += 6;
  pdf.paragraph(
    "À ce jour, l'intéressé(e) fait toujours partie de notre personnel.",
    { size: 11.5 },
  );
  doc.y += 6;
  pdf.paragraph(
    "En foi de quoi, la présente attestation lui est délivrée pour servir et valoir ce que de droit.",
    { size: 11.5 },
  );
  doc.y += 24;
  pdf.paragraph(city ? `Fait à ${city}, le ${pdfDate(today)}` : `Fait le ${pdfDate(today)}`, { size: 11.5 });
  doc.y += 12;

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const boxWidth = width / 2 - 8;
  const x = doc.page.margins.left + width - boxWidth;
  if (doc.y + 110 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const y = doc.y;
  doc.roundedRect(x, y, boxWidth, 100, 4).strokeColor("#D5DDEB").lineWidth(0.8).stroke();
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#1E3A6E").text("Pour la Direction", x + 10, y + 8, { width: boxWidth - 20 });
  doc.font("Helvetica").fontSize(7.5).fillColor("#61708B").text(pdfText("Nom, qualité, signature et cachet"), x + 10, y + 84, { width: boxWidth - 20 });
  doc.y = y + 112;
  doc.x = doc.page.margins.left;
  return pdf.finish();
}

export function employeePdfFileName(kind: "file" | "certificate", employee: { fullName: string; employeeNumber: string }) {
  const base = safeName(employee.fullName) || employee.employeeNumber;
  return `${kind === "file" ? "fiche-employe" : "attestation-de-travail"}-${base}.pdf`;
}

/** Owner/HR or anyone allowed to open this employee record (masking applies). */
export async function employeeFilePdf(context: service.EmployeeContext, employeeId: string) {
  const employee = await service.getEmployee(context, employeeId);
  const buffer = await withTenantContext(context, async (client) =>
    employeeFile(employee, await loadPdfCompany(client, context.organizationId)),
  );
  return { buffer, fileName: employeePdfFileName("file", employee) };
}

/** A formal HR document: Owner and HR Officer only. */
export async function employeeCertificatePdf(context: service.EmployeeContext, employeeId: string) {
  const allowed = await withTenantContext(context, (client) =>
    service.canReadPrivateEmployeeData(client, context),
  );
  if (!allowed)
    throw new ForbiddenError(
      "Only the workspace owner or HR Officer can issue a work certificate",
    );
  const employee = await service.getEmployee(context, employeeId);
  const buffer = await withTenantContext(context, async (client) =>
    workCertificate(
      employee,
      await loadPdfCompany(client, context.organizationId),
      await companyCity(client, context.organizationId),
    ),
  );
  return { buffer, fileName: employeePdfFileName("certificate", employee) };
}

/** Self-service: the employee's own record from the personal account endpoint. */
export async function myEmployeePdf(context: service.EmployeeContext, kind: "file" | "certificate") {
  const { employee } = await service.getMyAccount(context);
  const buffer = await withTenantContext(context, async (client) => {
    const company = await loadPdfCompany(client, context.organizationId);
    return kind === "file"
      ? employeeFile(employee, company)
      : workCertificate(employee, company, await companyCity(client, context.organizationId));
  });
  return { buffer, fileName: employeePdfFileName(kind, employee) };
}
