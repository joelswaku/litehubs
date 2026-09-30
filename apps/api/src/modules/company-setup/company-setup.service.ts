import crypto from "node:crypto";
import type { PoolClient } from "pg";
import PDFDocument from "pdfkit";
import { env } from "../../config/env";
import {
  sendSms,
  sendTeamInvitationEmail,
} from "../../services/notification.service";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  CreateDepartmentInput,
  CreateInvitationInput,
  CompanyRulesInput,
  CreateProvinceInput,
  CreateRoleInput,
  CreateSiteInput,
  ReplaceMemberProvincesInput,
  ReplaceMemberRolesInput,
  UpdateDepartmentInput,
  UpdateProvinceInput,
  UpdateRoleInput,
  UpdateSiteInput,
} from "./company-setup.validation";

export interface SetupContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}

interface ProvinceRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface SiteRow extends ProvinceRow {
  province_id: string;
  province_code: string;
  province_name: string;
  site_type: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
}

interface DepartmentRow extends ProvinceRow {
  site_id: string | null;
  site_code: string | null;
  site_name: string | null;
  manager_member_id: string | null;
  manager_name: string | null;
  description: string | null;
}

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  level: number;
  data_scope: "organization" | "province" | "self";
  is_system: boolean;
  permission_codes: string[];
}

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  status: string;
  is_owner: boolean;
  job_title: string | null;
  joined_at: Date;
  role_codes: string[];
  provinces: ProvinceSummary[];
  employee_id: string | null;
  employee_number: string | null;
}

interface ProvinceSummary {
  id: string;
  code: string;
  name: string;
}

interface InvitationRow {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  email: string;
  job_title: string | null;
  role_codes: string[];
  provinces: ProvinceSummary[];
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

interface CompanyRulesVersionRow {
  id: string;
  version_number: number;
  title: string;
  content: string;
  change_note: string | null;
  status: "published" | "superseded";
  created_at: Date;
  created_by_name: string | null;
}

interface CompanyRulesCompanyRow {
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
}

const INVITATION_TTL_DAYS = 7;

function mapCompanyRulesVersion(row: CompanyRulesVersionRow) {
  return {
    id: row.id,
    versionNumber: row.version_number,
    title: row.title,
    content: row.content,
    changeNote: row.change_note,
    status: row.status,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
  };
}

const companyRulesVersionFields = `
  v.id,v.version_number,v.title,v.content,v.change_note,v.status,v.created_at,
  author_user.full_name AS created_by_name
`;

const defaultCompanyRules = {
  fr: `1. Objet, application et responsabilité
Ce règlement organise le travail, la protection des personnes, des animaux, des biens et de l’argent de Congo Omega.
1.1 Il s’applique à tout employé, manager, prestataire et visiteur lorsqu’il intervient pour Congo Omega.
1.2 La loi applicable, les exigences vétérinaires, fiscales, sanitaires et de travail prévalent toujours sur ce règlement interne.
1.3 Chaque personne est responsable de signaler un risque, une erreur, un incident ou une fraude sans attendre.

2. Gouvernance, rôles et accès LiteHubs
Chaque accès est donné pour une fonction, un site, une province ou un projet précis — jamais par commodité.
2.1 Le Owner contrôle les budgets, approbations, rôles, accès sensibles et décisions exceptionnelles.
2.2 Un Project Manager ne travaille que sur les projets qui lui sont attribués ; il ne gère pas les dossiers RH privés ni le budget principal.
2.3 Les employés consultent uniquement leurs tâches, horaires, formations, documents et opérations autorisés.
2.4 Les mots de passe, téléphones, adresses, contrats, permis et fiches de paie sont confidentiels. Les dossiers RH complets restent réservés au Owner et au responsable RH.

3. Personnel, présence, formation et conduite
Le personnel est affecté à un site et travaille avec une identité, un horaire et des responsabilités clairs.
3.1 Toute arrivée et tout départ sont pointés avec le matricule personnel. Il est interdit de pointer pour une autre personne.
3.2 Une formation obligatoire doit être terminée avant l’exécution d’un travail qui l’exige, notamment en sécurité, biosécurité et conduite.
3.3 Les absences, accidents, conflits, actes dangereux et manquements sont signalés dans LiteHubs selon le circuit de supervision.

4. Sécurité, biosécurité et bien-être animal
La protection de la vie, de la santé et des animaux passe avant la rapidité ou la production.
4.1 Toute personne respecte les règles de tenue, lavage, désinfection, contrôle des visiteurs et circulation propres à chaque site.
4.2 Une mortalité inhabituelle, une maladie suspecte, une fuite, un incendie, un vol ou un danger immédiat est signalé immédiatement au responsable.
4.3 Les soins, vaccins, traitements et quarantaines sont enregistrés ; aucun produit vétérinaire ne peut être utilisé sans l’autorisation appropriée.

5. Production agricole, avicole et porcine
Les données de terrain servent à protéger les animaux et à calculer le coût réel, la production et le bénéfice.
5.1 Les relevés de ponte, mortalité, aliment, eau, poids, santé, récolte et utilisation sont saisis le jour même par la personne autorisée.
5.2 Un lot, un animal, un champ, une parcelle ou une récolte est créé une seule fois et peut être relié au projet qui l’a financé.
5.3 Toute correction après validation doit être justifiée et reste visible dans le journal d’audit.

6. Investissements, projets et bénéfices
Un projet suit un investissement jusqu’à son résultat réel, pas seulement jusqu’à l’achat.
6.1 Chaque projet doit avoir un objectif mesurable, un site, un responsable, un budget principal et une étape : Investissement, Mise en service, Exploitation ou Clôturé.
6.2 Le budget principal est unique. Les budgets de tâches ne l’augmentent pas : ils répartissent seulement ce qui est prévu.
6.3 Une clôture exige les tâches importantes terminées, les preuves classées, les réceptions contrôlées et une évaluation du résultat attendu.

7. Achats, fournisseurs et réceptions
Aucun achat ne doit contourner la décision, la preuve ou le contrôle de réception.
7.1 La chaîne normale est : besoin → demande d’achat → approbation → bon de commande → réception → stock, actif ou ressource.
7.2 Une demande en brouillon ne dépense rien ; un bon envoyé engage le budget ; une réception confirmée devient une dépense réelle.
7.3 La réception précise les quantités acceptées, endommagées, refusées ou retournées, avec photo, facture ou bon de livraison lorsque disponible.
7.4 Un paiement fournisseur règle une réception ou une facture ; il ne réduit jamais le budget une seconde fois.

8. Stocks, entrepôts et provenderie
Chaque objet physique existe une seule fois dans le stock de l’entreprise, même s’il est financé par un projet.
8.1 Toute entrée, sortie, retour, transfert ou ajustement de stock est enregistré avec l’entrepôt, la date, la quantité, le motif et la personne responsable.
8.2 Un transfert indique toujours le site et l’entrepôt de départ et d’arrivée. Aucun mouvement ne doit mélanger les provinces ou sites par erreur.
8.3 La provenderie utilise uniquement des matières premières réellement disponibles ; la fabrication déduit les intrants et crée l’aliment fini traçable.

9. Équipements, flotte et carburant
Les actifs durables restent identifiés, entretenus et affectés à une personne ou un lieu connu.
9.1 Tout équipement reçoit un numéro, une catégorie, un état, un site et un responsable. Les affectations et transferts restent dans son historique.
9.2 Pour un véhicule ou engin motorisé, le conducteur remplit les contrôles avant départ et retour, compteur, carburant, destination et anomalies.
9.3 Un permis valide, un contrôle de sécurité et l’entretien requis sont obligatoires avant l’utilisation lorsqu’ils sont configurés pour l’engin.

10. Finance, ventes et rentabilité
Le bénéfice, la trésorerie et le budget sont liés, mais ce ne sont pas la même chose.
10.1 Les dépenses directes doivent avoir une catégorie, un montant, une date, une preuve et l’approbation requise avant de réduire le budget.
10.2 Une vente livrée devient une recette ; l’encaissement client suit séparément la trésorerie et la créance restante.
10.3 Les prix, remises, factures, annulations et remboursements doivent être traçables et réservés aux personnes autorisées.

11. Documents, données, audit et communication
Les données saisies dans LiteHubs constituent le dossier opérationnel de l’entreprise.
11.1 Les contrats, reçus, preuves, photos, permis et documents sont classés dans le bon dossier, sans créer de doublon.
11.2 Les actions importantes — création, modification, décision, accès sensible ou annulation — restent enregistrées dans le journal d’audit.
11.3 Les alertes SMS ou e-mail servent à protéger l’exploitation. Elles ne remplacent pas la décision ni l’intervention humaine.

12. Contrôle, non-respect et amélioration
Les règles sont contrôlées avec équité, preuves et droit d’explication.
12.1 Toute irrégularité est vérifiée par le responsable compétent avant décision, sauf mesure urgente de sécurité ou de biosécurité.
12.2 La fraude, la falsification, le vol, le partage d’accès, le pointage pour autrui ou le contournement d’approbation sont interdits.
12.3 Le Owner peut réviser ce règlement. Toute version nouvelle est communiquée et, si nécessaire, affectée comme formation obligatoire.`,
  en: [
    "1. PURPOSE, SCOPE AND ACCOUNTABILITY",
    "These rules organise work and protect people, animals, company assets and funds.",
    "1.1 They apply to every employee, manager, contractor and visitor working for the company.",
    "1.2 Every person promptly reports a risk, mistake, incident, fraud or danger.",
    "2. GOVERNANCE, ROLES AND LITEHUBS ACCESS",
    "LiteHubs access is granted for a specific function, site, province or project.",
    "2.1 The owner controls budgets, approvals, roles, sensitive access and exceptional decisions.",
    "2.2 Each employee sees only authorised tasks, training, schedules, documents and operations.",
    "3. PEOPLE, SAFETY AND BIOSECURITY",
    "Protection of life, health, animals and sites takes priority over speed or production.",
    "4. PRODUCTION AND FIELD DATA",
    "Production records protect animals, track cost and measure the actual result.",
    "5. PROJECTS, PROCUREMENT AND RECEIVING",
    "An investment is followed through to its actual outcome: project, task, purchase, receipt, production, sales, invoice, collection and benefit.",
    "6. STOCK, FEED MILL AND EQUIPMENT",
    "Every physical item exists once in company stock, even when funded by a project.",
    "7. FINANCE, SALES, DOCUMENTS AND CONTROL",
    "Budget, profit and cash are linked but remain distinct.",
    "8. VERSION, COMMUNICATION AND IMPROVEMENT",
    "The owner may revise these rules. Every version is dated, attributed, retained and communicated to affected people.",
  ].join("\n\n"),
};

function formatCompanyRulesDate(value: Date, french: boolean) {
  return new Intl.DateTimeFormat(french ? "fr-CD" : "en-US", {
    dateStyle: "long",
  }).format(value);
}

function safeRulesText(value: unknown, maxLength = 800) {
  return String(value ?? "")
    // Core PDF fonts are deliberately used so the document works offline on
    // phones and low-bandwidth devices. Normalise symbols they cannot embed.
    .replaceAll("→", " -> ")
    .replace(/[—–]/g, " - ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export async function currentCompanyRules(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<CompanyRulesVersionRow>(
      `SELECT ${companyRulesVersionFields}
         FROM company_rules_versions v
         LEFT JOIN organization_members author_member
           ON author_member.organization_id=v.organization_id
          AND author_member.id=v.created_by_member_id
         LEFT JOIN users author_user ON author_user.id=author_member.user_id
        WHERE v.organization_id=$1
        ORDER BY v.version_number DESC
        LIMIT 1`,
      [context.organizationId],
    );
    return result.rows[0] ? mapCompanyRulesVersion(result.rows[0]) : null;
  });
}

export async function listCompanyRulesVersions(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<CompanyRulesVersionRow>(
      `SELECT ${companyRulesVersionFields}
         FROM company_rules_versions v
         LEFT JOIN organization_members author_member
           ON author_member.organization_id=v.organization_id
          AND author_member.id=v.created_by_member_id
         LEFT JOIN users author_user ON author_user.id=author_member.user_id
        WHERE v.organization_id=$1
        ORDER BY v.version_number DESC
        LIMIT 30`,
      [context.organizationId],
    );
    return result.rows.map(mapCompanyRulesVersion);
  });
}

export async function publishCompanyRules(
  context: SetupContext,
  input: CompanyRulesInput,
) {
  return withTenantContext(context, async (client) => {
    // Serialize version allocation per company. Two browser tabs cannot both
    // publish version 2, and neither can overwrite a prior rulebook.
    await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      context.organizationId,
    ]);
    const current = await client.query<{ version_number: number }>(
      `SELECT version_number
         FROM company_rules_versions
        WHERE organization_id=$1
        ORDER BY version_number DESC
        LIMIT 1`,
      [context.organizationId],
    );
    const versionNumber = (current.rows[0]?.version_number ?? 0) + 1;
    await client.query(
      `UPDATE company_rules_versions
          SET status='superseded'
        WHERE organization_id=$1 AND status='published'`,
      [context.organizationId],
    );
    const inserted = await client.query<CompanyRulesVersionRow>(
      `INSERT INTO company_rules_versions (
         organization_id,version_number,title,content,change_note,status,created_by_member_id
       ) VALUES ($1,$2,$3,$4,$5,'published',$6)
       RETURNING id,version_number,title,content,change_note,status,created_at,
                 NULL::text AS created_by_name`,
      [
        context.organizationId,
        versionNumber,
        input.title,
        input.content,
        input.changeNote ?? null,
        context.memberId,
      ],
    );
    return mapCompanyRulesVersion(inserted.rows[0]!);
  });
}

/**
 * A controlled, printable version of the company rulebook.  This deliberately
 * renders on the server instead of relying on `window.print()`: browser print
 * captures are inconsistent, can include UI chrome and are not an auditable
 * document layout.
 */
export async function exportCompanyRulesPdf(
  context: SetupContext,
  french: boolean,
): Promise<Buffer> {
  const [policy, company] = await Promise.all([
    currentCompanyRules(context),
    withTenantContext(context, async (client) => {
      const result = await client.query<CompanyRulesCompanyRow>(
        `SELECT COALESCE(display_name, legal_name, slug) AS name,
                address_line1,address_line2,city,region,postal_code
           FROM organizations
          WHERE id=$1`,
        [context.organizationId],
      );
      return result.rows[0] ?? {
        name: "LiteHubs",
        address_line1: null,
        address_line2: null,
        city: null,
        region: null,
        postal_code: null,
      };
    }),
  ]);
  const title =
    policy?.title ??
    (french
      ? "Règlement général d’exploitation et de gestion"
      : "General operating and management rules");
  const content = policy?.content ?? (french ? defaultCompanyRules.fr : defaultCompanyRules.en);
  const version = policy?.versionNumber ?? 1;
  const generatedAt = policy?.createdAt ? new Date(policy.createdAt) : new Date();
  const author = policy?.createdByName ?? (french ? "Version de référence LiteHubs" : "LiteHubs reference version");
  const note = policy?.changeNote ?? (french ? "Cadre interne de référence" : "Reference internal framework");
  const address = [
    company.address_line1,
    company.address_line2,
    [company.city, company.region].filter(Boolean).join(", "),
    company.postal_code,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" · ");
  const initials =
    company.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join("") || "LH";

  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margins: { top: 44, bottom: 52, left: 42, right: 42 },
      bufferPages: true,
      info: {
        Title: title,
        Author: company.name,
        Subject: french ? "Règlement officiel de l’entreprise" : "Official company rulebook",
      },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    const navy = "#10243F";
    const brand = "#087E8B";
    const pale = "#EEF6F7";
    const ink = "#162334";
    const muted = "#64748B";
    const border = "#D7E2EA";
    const pageWidth = document.page.width;
    const pageHeight = document.page.height;
    const left = document.page.margins.left;
    const contentWidth = pageWidth - left * 2;
    const bottom = pageHeight - 58;
    let cursorY = 118;

    const drawHeader = () => {
      document.rect(0, 0, pageWidth, 16).fill(navy);
      document.roundedRect(left, 34, 48, 48, 10).fill("#FFFFFF");
      document
        .fillColor(navy)
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(initials, left, 50, { width: 48, align: "center" });
      document
        .fillColor(ink)
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(safeRulesText(company.name, 70), left + 60, 39, {
          width: 220,
          ellipsis: true,
        });
      document
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          address || (french ? "Adresse officielle non renseignée" : "Official address not provided"),
          left + 60,
          60,
          { width: 240, height: 24, ellipsis: true },
        );
      document
        .fillColor(navy)
        .font("Helvetica-Bold")
        .fontSize(16)
        .text(french ? "REGLEMENT D’ENTREPRISE" : "COMPANY RULEBOOK", pageWidth - left - 252, 39, {
          width: 252,
          align: "right",
        });
      document
        .fillColor(brand)
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .text(`REG-${String(version).padStart(3, "0")} · v${version}`, pageWidth - left - 252, 60, {
          width: 252,
          align: "right",
        });
      document
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          `${french ? "Publié le" : "Published"} : ${formatCompanyRulesDate(generatedAt, french)}`,
          pageWidth - left - 252,
          75,
          { width: 252, align: "right" },
        );
      document
        .moveTo(left, 100)
        .lineTo(pageWidth - left, 100)
        .strokeColor(border)
        .lineWidth(0.7)
        .stroke();
      document.y = 118;
      cursorY = 118;
    };

    const addPage = () => {
      document.addPage();
      // Explicitly draw the template for intentional chapter breaks.  The
      // event below remains as a safeguard for any automatic PDFKit break.
      drawHeader();
    };
    const ensureSpace = (height: number) => {
      if (cursorY + height > bottom) addPage();
    };
    const metaCard = (x: number, y: number, label: string, value: string) => {
      document.roundedRect(x, y, 160, 44, 7).fill(pale);
      document
        .fillColor(brand)
        .font("Helvetica-Bold")
        .fontSize(6.8)
        .text(label.toUpperCase(), x + 9, y + 8, { width: 142 });
      document
        .fillColor(ink)
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text(safeRulesText(value, 84), x + 9, y + 20, {
          width: 142,
          height: 17,
          ellipsis: true,
        });
    };
    const chapter = (line: string) => {
      // Keep a heading with at least the opening paragraph of its chapter.
      // This avoids a stranded heading at the foot of a page.
      ensureSpace(105);
      document.roundedRect(left, cursorY, contentWidth, 23, 6).fill(navy);
      document
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text(safeRulesText(line, 180).toUpperCase(), left + 10, cursorY + 7, {
          width: contentWidth - 20,
          ellipsis: true,
        });
      cursorY += 31;
    };
    const paragraph = (line: string) => {
      const rendered = safeRulesText(line);
      document.font("Helvetica").fontSize(9.2);
      const height = Math.max(
        16,
        document.heightOfString(rendered, {
          width: contentWidth - 26,
          lineGap: 2,
        }) + 10,
      );
      ensureSpace(height);
      const rule = /^\d+\.\d+\s/.test(rendered);
      if (rule) {
        document.circle(left + 4, cursorY + 5, 2).fill(brand);
      }
      document
        .fillColor(ink)
        .font("Helvetica")
        .fontSize(9.2)
        .text(rendered, left + (rule ? 14 : 0), cursorY, {
          width: contentWidth - (rule ? 14 : 0),
          lineGap: 2,
        });
      cursorY += height;
    };

    // PDFKit can create a page itself when a long paragraph reaches the
    // bottom.  Decorating that event keeps those pages identical to pages we
    // add explicitly through `ensureSpace`.
    document.on("pageAdded", drawHeader);
    drawHeader();
    document
      .fillColor(ink)
      .font("Helvetica-Bold")
      .fontSize(19)
      .text(title, left, cursorY, { width: contentWidth });
    cursorY += document.heightOfString(title, { width: contentWidth }) + 5;
    document
      .fillColor(muted)
      .font("Helvetica")
      .fontSize(8.4)
      .text(
        french
          ? "Document interne contrôlé - applicable à toute l’entreprise"
          : "Controlled internal document - applies to the whole company",
        left,
        cursorY,
      );
    cursorY += 26;
    const cardsY = cursorY;
    metaCard(left, cardsY, french ? "Version" : "Version", `v${version}`);
    metaCard(
      left + 170,
      cardsY,
      french ? "Responsable de publication" : "Published by",
      author,
    );
    metaCard(
      left + 340,
      cardsY,
      french ? "Motif / référence" : "Reason / reference",
      note,
    );
    cursorY = cardsY + 61;
    const noticeY = cursorY;
    document
      .roundedRect(left, noticeY, contentWidth, 31, 7)
      .fill("#F7FAFC");
    document
      .fillColor(muted)
      .font("Helvetica")
      .fontSize(7.8)
      .text(
        french
          ? "Les versions antérieures restent disponibles dans LiteHubs. Ce document ne remplace pas les obligations légales applicables en République démocratique du Congo."
          : "Earlier versions remain available in LiteHubs. This document does not replace applicable legal obligations in the Democratic Republic of the Congo.",
        left + 10,
        noticeY + 8,
        { width: contentWidth - 20 },
      );
    cursorY = noticeY + 45;

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        cursorY += 4;
        continue;
      }
      if (/^\d+\.\s/.test(line)) chapter(safeRulesText(line));
      else paragraph(line);
    }

    const pageRange = document.bufferedPageRange();
    for (let index = pageRange.start; index < pageRange.start + pageRange.count; index += 1) {
      document.switchToPage(index);
      const footerLineY = pageHeight - 76;
      const footerTextY = pageHeight - 66;
      document
        .moveTo(left, footerLineY)
        .lineTo(pageWidth - left, footerLineY)
        .strokeColor(border)
        .lineWidth(0.6)
        .stroke();
      document
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.2)
        .text(`${safeRulesText(company.name, 56)} · ${french ? "Document contrôlé" : "Controlled document"} · v${version}`, left, footerTextY, { width: 300, lineBreak: false });
      document
        .text(`${french ? "Page" : "Page"} ${index + 1} / ${pageRange.count}`, pageWidth - left - 100, footerTextY, { width: 100, align: "right", lineBreak: false });
    }
    document.end();
  });
}

function mapProvince(row: ProvinceRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSite(row: SiteRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    province: {
      id: row.province_id,
      code: row.province_code,
      name: row.province_name,
    },
    siteType: row.site_type,
    address: {
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      city: row.city,
      postalCode: row.postal_code,
    },
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDepartment(row: DepartmentRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    site: row.site_id
      ? { id: row.site_id, code: row.site_code, name: row.site_name }
      : null,
    manager: row.manager_member_id
      ? { memberId: row.manager_member_id, fullName: row.manager_name }
      : null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRole(row: RoleRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    level: row.level,
    dataScope: row.data_scope,
    isSystem: row.is_system,
    permissionCodes: row.permission_codes,
  };
}

function conflict(error: unknown, message: string, details?: unknown): never {
  const pg = error as { code?: string };
  if (pg.code === "23505") throw new ConflictError(message, details);
  throw error;
}

function invitationTokenHash(token: string): string {
  return crypto
    .createHmac("sha256", env.refreshTokenSecret)
    .update(token)
    .digest("hex");
}

export function hashInvitationToken(token: string): string {
  return invitationTokenHash(token);
}

async function organizationScope(
  client: PoolClient,
  context: SetupContext,
): Promise<boolean> {
  if (context.isOwner) return true;

  const result = await client.query<{ has_scope: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM member_roles mr
         JOIN roles r
           ON r.organization_id = mr.organization_id
          AND r.id = mr.role_id
        WHERE mr.organization_id = $1
          AND mr.member_id = $2
          AND r.data_scope = 'organization'
     ) AS has_scope`,
    [context.organizationId, context.memberId],
  );

  return result.rows[0]?.has_scope ?? false;
}

async function requireOrganizationScope(
  client: PoolClient,
  context: SetupContext,
): Promise<void> {
  if (!(await organizationScope(client, context))) {
    throw new ForbiddenError(
      "This action requires a company-wide role such as Owner or Farm Operations Manager",
    );
  }
}

async function assertProvinceAccess(
  client: PoolClient,
  context: SetupContext,
  provinceId: string,
): Promise<void> {
  if (await organizationScope(client, context)) return;

  const result = await client.query(
    `SELECT 1
       FROM member_provinces
      WHERE organization_id = $1
        AND member_id = $2
        AND province_id = $3`,
    [context.organizationId, context.memberId, provinceId],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError("Province not found");
  }
}

async function siteProvinceId(
  client: PoolClient,
  organizationId: string,
  siteId: string,
): Promise<string> {
  const result = await client.query<{ province_id: string }>(
    `SELECT province_id
       FROM sites
      WHERE organization_id = $1
        AND id = $2`,
    [organizationId, siteId],
  );
  const provinceId = result.rows[0]?.province_id;
  if (!provinceId) throw new NotFoundError("Site not found");
  return provinceId;
}

async function assertSiteAccess(
  client: PoolClient,
  context: SetupContext,
  siteId: string,
): Promise<void> {
  await assertProvinceAccess(
    client,
    context,
    await siteProvinceId(client, context.organizationId, siteId),
  );
}

async function departmentSiteId(
  client: PoolClient,
  organizationId: string,
  departmentId: string,
): Promise<string | null> {
  const result = await client.query<{ site_id: string | null }>(
    `SELECT site_id
       FROM departments
      WHERE organization_id = $1
        AND id = $2`,
    [organizationId, departmentId],
  );
  if (result.rowCount === 0) throw new NotFoundError("Department not found");
  return result.rows[0]!.site_id;
}

async function assertDepartmentAccess(
  client: PoolClient,
  context: SetupContext,
  departmentId: string,
): Promise<void> {
  const siteId = await departmentSiteId(
    client,
    context.organizationId,
    departmentId,
  );
  if (!siteId) {
    await requireOrganizationScope(client, context);
    return;
  }
  await assertSiteAccess(client, context, siteId);
}

async function assertMemberExists(
  client: PoolClient,
  organizationId: string,
  memberId: string,
): Promise<{ isOwner: boolean }> {
  const result = await client.query<{ is_owner: boolean }>(
    `SELECT is_owner
       FROM organization_members
      WHERE organization_id = $1
        AND id = $2
        AND status = 'active'`,
    [organizationId, memberId],
  );
  const member = result.rows[0];
  if (!member) throw new NotFoundError("Active team member not found");
  return { isOwner: member.is_owner };
}

async function permissionIds(
  client: PoolClient,
  codes: string[],
): Promise<{ id: string; code: string }[]> {
  const result = await client.query<{ id: string; code: string }>(
    `SELECT id, code
       FROM permissions
      WHERE code = ANY($1::text[])`,
    [codes],
  );
  if (result.rowCount !== new Set(codes).size) {
    throw new BadRequestError("One or more permission codes are not valid");
  }
  return result.rows;
}

function assertCanGrantPermissions(
  context: SetupContext,
  codes: string[],
): void {
  // Role configuration is Owner-only. An Owner must be able to restore a
  // permission they deliberately removed from their own role, otherwise a
  // temporary restriction becomes irreversible without database access.
  if (context.isOwner) return;
  const missing = codes.filter((code) => !context.permissions.includes(code));
  if (missing.length > 0) {
    throw new ForbiddenError(
      "You cannot put a permission into a role unless you hold it yourself",
      { missing },
    );
  }
}

async function roleIds(
  client: PoolClient,
  organizationId: string,
  codes: string[],
): Promise<{ id: string; code: string }[]> {
  const result = await client.query<{ id: string; code: string }>(
    `SELECT id, code
       FROM roles
      WHERE organization_id = $1
        AND code = ANY($2::text[])`,
    [organizationId, codes],
  );
  if (result.rowCount !== new Set(codes).size) {
    throw new BadRequestError(
      "One or more roles do not belong to this company",
    );
  }
  return result.rows;
}

type EmployeePositionCategory =
  "manager" | "supervisor" | "officer" | "employee";

function positionCategoryForRoleCodes(
  roleCodes: string[],
): EmployeePositionCategory {
  if (
    roleCodes.some((code) =>
      [
        "owner",
        "general_manager",
        "provincial_manager",
        "site_manager",
        "farm_operations_manager",
        "site_manager",
        "project_manager",
      ].includes(code),
    )
  )
    return "manager";
  if (
    roleCodes.some((code) =>
      [
        "supervisor",
        "poultry_supervisor",
        "pig_supervisor",
        "agriculture_supervisor",
        "veterinarian",
        "agronomist",
      ].includes(code),
    )
  )
    return "supervisor";
  if (
    roleCodes.some((code) =>
      ["hr_officer", "accountant", "storekeeper", "security_officer"].includes(
        code,
      ),
    )
  )
    return "officer";
  return "employee";
}

async function assertProvinceIds(
  client: PoolClient,
  organizationId: string,
  provinceIds: string[],
): Promise<void> {
  if (provinceIds.length === 0) return;
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM provinces
      WHERE organization_id = $1
        AND id = ANY($2::uuid[])`,
    [organizationId, provinceIds],
  );
  if (result.rowCount !== new Set(provinceIds).size) {
    throw new BadRequestError(
      "One or more provinces do not belong to this company",
    );
  }
}

// ------------------------------------------------------------- provinces ----

export async function listProvinces(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const companyWide = await organizationScope(client, context);
    const result = await client.query<ProvinceRow>(
      companyWide
        ? `SELECT id, code, name, is_active, created_at, updated_at
             FROM provinces
            WHERE organization_id = $1
            ORDER BY name`
        : `SELECT p.id, p.code, p.name, p.is_active, p.created_at, p.updated_at
             FROM provinces p
             JOIN member_provinces mp
               ON mp.organization_id = p.organization_id
              AND mp.province_id = p.id
            WHERE p.organization_id = $1
              AND mp.member_id = $2
            ORDER BY p.name`,
      companyWide
        ? [context.organizationId]
        : [context.organizationId, context.memberId],
    );
    return result.rows.map(mapProvince);
  });
}

export async function createProvince(
  context: SetupContext,
  input: CreateProvinceInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      await requireOrganizationScope(client, context);
      const result = await client.query<ProvinceRow>(
        `INSERT INTO provinces (organization_id, code, name)
         VALUES ($1, $2, $3)
         RETURNING id, code, name, is_active, created_at, updated_at`,
        [context.organizationId, input.code, input.name],
      );
      return mapProvince(result.rows[0]!);
    });
  } catch (error) {
    return conflict(error, "A province with that code already exists", {
      field: "code",
    });
  }
}

export async function updateProvince(
  context: SetupContext,
  provinceId: string,
  input: UpdateProvinceInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      await requireOrganizationScope(client, context);
      const current = await client.query<ProvinceRow>(
        `SELECT id, code, name, is_active, created_at, updated_at
           FROM provinces
          WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, provinceId],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError("Province not found");

      const result = await client.query<ProvinceRow>(
        `UPDATE provinces
            SET code = $3,
                name = $4,
                is_active = $5
          WHERE organization_id = $1 AND id = $2
        RETURNING id, code, name, is_active, created_at, updated_at`,
        [
          context.organizationId,
          provinceId,
          input.code ?? row.code,
          input.name ?? row.name,
          input.isActive ?? row.is_active,
        ],
      );
      return mapProvince(result.rows[0]!);
    });
  } catch (error) {
    return conflict(error, "A province with that code already exists", {
      field: "code",
    });
  }
}

export async function deleteProvince(
  context: SetupContext,
  provinceId: string,
) {
  return withTenantContext(context, async (client) => {
    await requireOrganizationScope(client, context);
    const result = await client.query(
      `DELETE FROM provinces
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, provinceId],
    );
    if (result.rowCount === 0) throw new NotFoundError("Province not found");
  });
}

// ----------------------------------------------------------------- sites ----

const siteFields = `s.id, s.code, s.name, s.province_id, p.code AS province_code,
  p.name AS province_name, s.site_type, s.address_line1, s.address_line2,
  s.city, s.postal_code, s.is_active, s.created_at, s.updated_at`;

export async function listSites(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const companyWide = await organizationScope(client, context);
    const result = await client.query<SiteRow>(
      companyWide
        ? `SELECT ${siteFields}
             FROM sites s
             JOIN provinces p
               ON p.organization_id = s.organization_id AND p.id = s.province_id
            WHERE s.organization_id = $1
            ORDER BY p.name, s.name`
        : `SELECT ${siteFields}
             FROM sites s
             JOIN provinces p
               ON p.organization_id = s.organization_id AND p.id = s.province_id
             JOIN member_provinces mp
               ON mp.organization_id = s.organization_id AND mp.province_id = s.province_id
            WHERE s.organization_id = $1 AND mp.member_id = $2
            ORDER BY p.name, s.name`,
      companyWide
        ? [context.organizationId]
        : [context.organizationId, context.memberId],
    );
    return result.rows.map(mapSite);
  });
}

export async function createSite(
  context: SetupContext,
  input: CreateSiteInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      await assertProvinceAccess(client, context, input.provinceId);
      const result = await client.query<SiteRow>(
        `INSERT INTO sites (
           organization_id, province_id, code, name, site_type, address_line1,
           address_line2, city, postal_code
         )
         SELECT $1, p.id, $3, $4, $5, $6, $7, $8, $9
           FROM provinces p
          WHERE p.organization_id = $1 AND p.id = $2
         RETURNING id, code, name, province_id,
                   (SELECT code FROM provinces WHERE id = province_id) AS province_code,
                   (SELECT name FROM provinces WHERE id = province_id) AS province_name,
                   site_type, address_line1, address_line2, city, postal_code,
                   is_active, created_at, updated_at`,
        [
          context.organizationId,
          input.provinceId,
          input.code,
          input.name,
          input.siteType,
          input.addressLine1 ?? null,
          input.addressLine2 ?? null,
          input.city ?? null,
          input.postalCode ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundError("Province not found");
      return mapSite(row);
    });
  } catch (error) {
    return conflict(error, "A site with that code already exists");
  }
}

export async function updateSite(
  context: SetupContext,
  siteId: string,
  input: UpdateSiteInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      await assertSiteAccess(client, context, siteId);
      const current = await client.query<SiteRow>(
        `SELECT ${siteFields}
           FROM sites s
           JOIN provinces p
             ON p.organization_id = s.organization_id AND p.id = s.province_id
          WHERE s.organization_id = $1 AND s.id = $2`,
        [context.organizationId, siteId],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError("Site not found");

      const provinceId = input.provinceId ?? row.province_id;
      await assertProvinceAccess(client, context, provinceId);

      const result = await client.query<SiteRow>(
        `UPDATE sites
            SET province_id = $3,
                code = $4,
                name = $5,
                site_type = $6,
                address_line1 = $7,
                address_line2 = $8,
                city = $9,
                postal_code = $10,
                is_active = $11
          WHERE organization_id = $1 AND id = $2
        RETURNING id, code, name, province_id,
                  (SELECT code FROM provinces WHERE id = province_id) AS province_code,
                  (SELECT name FROM provinces WHERE id = province_id) AS province_name,
                  site_type, address_line1, address_line2, city, postal_code,
                  is_active, created_at, updated_at`,
        [
          context.organizationId,
          siteId,
          provinceId,
          input.code ?? row.code,
          input.name ?? row.name,
          input.siteType ?? row.site_type,
          input.addressLine1 === undefined
            ? row.address_line1
            : input.addressLine1,
          input.addressLine2 === undefined
            ? row.address_line2
            : input.addressLine2,
          input.city === undefined ? row.city : input.city,
          input.postalCode === undefined ? row.postal_code : input.postalCode,
          input.isActive ?? row.is_active,
        ],
      );
      return mapSite(result.rows[0]!);
    });
  } catch (error) {
    return conflict(error, "A site with that code already exists");
  }
}

export async function deleteSite(context: SetupContext, siteId: string) {
  return withTenantContext(context, async (client) => {
    await assertSiteAccess(client, context, siteId);
    const result = await client.query(
      `DELETE FROM sites
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, siteId],
    );
    if (result.rowCount === 0) throw new NotFoundError("Site not found");
  });
}

// ----------------------------------------------------------- departments ----

const departmentFields = `d.id, d.code, d.name, d.description, d.site_id,
  s.code AS site_code, s.name AS site_name, d.manager_member_id,
  manager_user.full_name AS manager_name, d.is_active, d.created_at, d.updated_at`;

async function assertDepartmentReferences(
  client: PoolClient,
  context: SetupContext,
  siteId: string | null | undefined,
  managerMemberId: string | null | undefined,
): Promise<void> {
  if (siteId) await assertSiteAccess(client, context, siteId);
  if (siteId === null) await requireOrganizationScope(client, context);
  if (managerMemberId) {
    await assertMemberExists(client, context.organizationId, managerMemberId);
  }
}

export async function listDepartments(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const companyWide = await organizationScope(client, context);
    const result = await client.query<DepartmentRow>(
      companyWide
        ? `SELECT ${departmentFields}
             FROM departments d
             LEFT JOIN sites s
               ON s.organization_id = d.organization_id AND s.id = d.site_id
             LEFT JOIN organization_members manager
               ON manager.organization_id = d.organization_id
              AND manager.id = d.manager_member_id
            LEFT JOIN users manager_user ON manager_user.id = manager.user_id
            WHERE d.organization_id = $1
            ORDER BY d.name`
        : `SELECT ${departmentFields}
             FROM departments d
             JOIN sites s
               ON s.organization_id = d.organization_id AND s.id = d.site_id
             JOIN member_provinces mp
               ON mp.organization_id = s.organization_id AND mp.province_id = s.province_id
             LEFT JOIN organization_members manager
               ON manager.organization_id = d.organization_id
              AND manager.id = d.manager_member_id
            LEFT JOIN users manager_user ON manager_user.id = manager.user_id
            WHERE d.organization_id = $1 AND mp.member_id = $2
            ORDER BY d.name`,
      companyWide
        ? [context.organizationId]
        : [context.organizationId, context.memberId],
    );
    return result.rows.map(mapDepartment);
  });
}

export async function createDepartment(
  context: SetupContext,
  input: CreateDepartmentInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      if (!input.siteId) await requireOrganizationScope(client, context);
      await assertDepartmentReferences(
        client,
        context,
        input.siteId,
        input.managerMemberId,
      );

      const result = await client.query<DepartmentRow>(
        `INSERT INTO departments (
           organization_id, site_id, manager_member_id, code, name, description
         )
         VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, code, name, description, site_id,
                  (SELECT code FROM sites WHERE id = site_id) AS site_code,
                  (SELECT name FROM sites WHERE id = site_id) AS site_name,
                  manager_member_id,
                  (SELECT u.full_name
                     FROM organization_members m
                     JOIN users u ON u.id = m.user_id
                    WHERE m.id = manager_member_id) AS manager_name,
                  is_active, created_at, updated_at`,
        [
          context.organizationId,
          input.siteId ?? null,
          input.managerMemberId ?? null,
          input.code,
          input.name,
          input.description ?? null,
        ],
      );
      return mapDepartment(result.rows[0]!);
    });
  } catch (error) {
    return conflict(error, "A department with that code already exists");
  }
}

export async function updateDepartment(
  context: SetupContext,
  departmentId: string,
  input: UpdateDepartmentInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      await assertDepartmentAccess(client, context, departmentId);
      const current = await client.query<DepartmentRow>(
        `SELECT ${departmentFields}
           FROM departments d
           LEFT JOIN sites s
             ON s.organization_id = d.organization_id AND s.id = d.site_id
           LEFT JOIN organization_members manager
             ON manager.organization_id = d.organization_id
            AND manager.id = d.manager_member_id
          LEFT JOIN users manager_user ON manager_user.id = manager.user_id
          WHERE d.organization_id = $1 AND d.id = $2`,
        [context.organizationId, departmentId],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError("Department not found");

      const siteId = input.siteId === undefined ? row.site_id : input.siteId;
      const managerMemberId =
        input.managerMemberId === undefined
          ? row.manager_member_id
          : input.managerMemberId;
      await assertDepartmentReferences(
        client,
        context,
        siteId,
        managerMemberId,
      );

      const result = await client.query<DepartmentRow>(
        `UPDATE departments
            SET site_id = $3,
                manager_member_id = $4,
                code = $5,
                name = $6,
                description = $7,
                is_active = $8
          WHERE organization_id = $1 AND id = $2
        RETURNING id, code, name, description, site_id,
                  (SELECT code FROM sites WHERE id = site_id) AS site_code,
                  (SELECT name FROM sites WHERE id = site_id) AS site_name,
                  manager_member_id,
                  (SELECT u.full_name
                     FROM organization_members m
                     JOIN users u ON u.id = m.user_id
                    WHERE m.id = manager_member_id) AS manager_name,
                  is_active, created_at, updated_at`,
        [
          context.organizationId,
          departmentId,
          siteId,
          managerMemberId,
          input.code ?? row.code,
          input.name ?? row.name,
          input.description === undefined ? row.description : input.description,
          input.isActive ?? row.is_active,
        ],
      );
      return mapDepartment(result.rows[0]!);
    });
  } catch (error) {
    return conflict(error, "A department with that code already exists");
  }
}

export async function deleteDepartment(
  context: SetupContext,
  departmentId: string,
) {
  return withTenantContext(context, async (client) => {
    await assertDepartmentAccess(client, context, departmentId);
    const result = await client.query(
      `DELETE FROM departments
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, departmentId],
    );
    if (result.rowCount === 0) throw new NotFoundError("Department not found");
  });
}

// --------------------------------------------------------------- roles ----

const roleFields = `r.id, r.code, r.name, r.description, r.level, r.data_scope,
  r.is_system,
  COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permission_codes`;

export async function listRoles(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<RoleRow>(
      `SELECT ${roleFields}
         FROM roles r
         LEFT JOIN role_permissions rp
           ON rp.organization_id = r.organization_id AND rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE r.organization_id = $1
        GROUP BY r.id
        ORDER BY r.level, r.name`,
      [context.organizationId],
    );
    return result.rows.map(mapRole);
  });
}

export async function listPermissions(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<{
      code: string;
      resource: string;
      action: string;
      module_code: string | null;
      description: string | null;
    }>(
      `SELECT code, resource, action, module_code, description
         FROM permissions
        ORDER BY module_code NULLS FIRST, resource, action`,
    );
    return result.rows.map((row) => ({
      code: row.code,
      resource: row.resource,
      action: row.action,
      moduleCode: row.module_code,
      description: row.description,
    }));
  });
}

export async function createRole(
  context: SetupContext,
  input: CreateRoleInput,
) {
  assertCanGrantPermissions(context, input.permissionCodes);

  try {
    return await withTenantContext(context, async (client) => {
      const permissions = await permissionIds(client, input.permissionCodes);
      const created = await client.query<RoleRow>(
        `INSERT INTO roles (
           organization_id, code, name, description, level, data_scope, is_system
         )
         VALUES ($1, $2, $3, $4, $5, $6, false)
        RETURNING id, code, name, description, level, data_scope, is_system,
                  '{}'::text[] AS permission_codes`,
        [
          context.organizationId,
          input.code,
          input.name,
          input.description ?? null,
          input.level,
          input.dataScope,
        ],
      );
      const role = created.rows[0]!;

      await client.query(
        `INSERT INTO role_permissions (organization_id, role_id, permission_id)
         SELECT $1, $2, permission_id
           FROM unnest($3::uuid[]) AS permission_id`,
        [
          context.organizationId,
          role.id,
          permissions.map((permission) => permission.id),
        ],
      );

      return {
        ...mapRole(role),
        permissionCodes: permissions
          .map((permission) => permission.code)
          .sort(),
      };
    });
  } catch (error) {
    return conflict(error, "A role with that code already exists");
  }
}

export async function updateRole(
  context: SetupContext,
  roleId: string,
  input: UpdateRoleInput,
) {
  if (input.permissionCodes) {
    assertCanGrantPermissions(context, input.permissionCodes);
  }

  return withTenantContext(context, async (client) => {
    const current = await client.query<RoleRow>(
      `SELECT ${roleFields}
         FROM roles r
         LEFT JOIN role_permissions rp
           ON rp.organization_id = r.organization_id AND rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE r.organization_id = $1 AND r.id = $2
        GROUP BY r.id`,
      [context.organizationId, roleId],
    );
    const role = current.rows[0];
    if (!role) throw new NotFoundError("Role not found");

    // System roles belong to the current organization. Their identity and
    // scope stay stable so existing assignments and province restrictions do
    // not become ambiguous, but an Owner may tailor their permission set.
    // The Owner role keeps a small recovery set: otherwise an owner could
    // remove role/member administration and lock the company out of Settings.
    const changesSystemIdentity =
      input.name !== undefined ||
      input.description !== undefined ||
      input.level !== undefined ||
      input.dataScope !== undefined;
    if (role.is_system && changesSystemIdentity) {
      throw new BadRequestError(
        "Built-in role name, level and scope cannot be edited; only its permissions can be tailored",
      );
    }
    if (role.is_system && role.code === "owner" && input.permissionCodes) {
      const protectedOwnerPermissions = [
        "organization.read",
        "organization.update",
        "members.read",
        "members.update",
        "roles.read",
        "roles.update",
      ];
      const missingCorePermission = protectedOwnerPermissions.find(
        (code) => !input.permissionCodes!.includes(code),
      );
      if (missingCorePermission) {
        throw new BadRequestError(
          "Owner role must retain its core company and access-management permissions",
          { protectedPermission: missingCorePermission },
        );
      }
    }

    const result = await client.query<RoleRow>(
      `UPDATE roles
          SET name = $3,
              description = $4,
              level = $5,
              data_scope = $6
        WHERE organization_id = $1 AND id = $2
      RETURNING id, code, name, description, level, data_scope, is_system,
                '{}'::text[] AS permission_codes`,
      [
        context.organizationId,
        roleId,
        input.name ?? role.name,
        input.description === undefined ? role.description : input.description,
        input.level ?? role.level,
        input.dataScope ?? role.data_scope,
      ],
    );

    let codes = role.permission_codes;
    if (input.permissionCodes) {
      const permissions = await permissionIds(client, input.permissionCodes);
      await client.query(
        `DELETE FROM role_permissions
          WHERE organization_id = $1 AND role_id = $2`,
        [context.organizationId, roleId],
      );
      await client.query(
        `INSERT INTO role_permissions (organization_id, role_id, permission_id)
         SELECT $1, $2, permission_id
           FROM unnest($3::uuid[]) AS permission_id`,
        [
          context.organizationId,
          roleId,
          permissions.map((permission) => permission.id),
        ],
      );
      codes = permissions.map((permission) => permission.code).sort();
    }

    return { ...mapRole(result.rows[0]!), permissionCodes: codes };
  });
}

export async function deleteRole(context: SetupContext, roleId: string) {
  return withTenantContext(context, async (client) => {
    const role = await client.query<{ is_system: boolean }>(
      `SELECT is_system
         FROM roles
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, roleId],
    );
    const row = role.rows[0];
    if (!row) throw new NotFoundError("Role not found");
    if (row.is_system)
      throw new BadRequestError("Built-in roles cannot be deleted");

    try {
      await client.query(
        `DELETE FROM roles
          WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, roleId],
      );
    } catch (error) {
      const pg = error as { code?: string };
      if (pg.code === "23503") {
        throw new ConflictError("Remove this role from team members first");
      }
      throw error;
    }
  });
}

// ---------------------------------------------------------- team members ----

export async function listMembers(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<MemberRow>(
      `SELECT m.id, m.user_id, u.email, u.full_name, m.status, m.is_owner,
              m.job_title, m.joined_at, e.id AS employee_id,
              e.employee_number,
              COALESCE(array_agg(DISTINCT r.code)
                FILTER (WHERE r.code IS NOT NULL), '{}') AS role_codes,
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name)
                  ORDER BY p.name
                )
                  FROM member_provinces mp
                  JOIN provinces p
                    ON p.organization_id = mp.organization_id
                   AND p.id = mp.province_id
                 WHERE mp.organization_id = m.organization_id
                   AND mp.member_id = m.id
              ), '[]'::jsonb) AS provinces
         FROM organization_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN employees e
           ON e.organization_id = m.organization_id AND e.member_id = m.id
         LEFT JOIN member_roles mr
           ON mr.organization_id = m.organization_id AND mr.member_id = m.id
         LEFT JOIN roles r
           ON r.organization_id = mr.organization_id AND r.id = mr.role_id
        WHERE m.organization_id = $1
        GROUP BY m.id, u.id, e.id, e.employee_number
        ORDER BY m.is_owner DESC, u.full_name`,
      [context.organizationId],
    );
    return result.rows.map((row) => ({
      memberId: row.id,
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      status: row.status,
      isOwner: row.is_owner,
      jobTitle: row.job_title,
      joinedAt: row.joined_at,
      roleCodes: row.role_codes,
      provinces: row.provinces,
      employee: row.employee_id
        ? { id: row.employee_id, employeeNumber: row.employee_number }
        : null,
    }));
  });
}

export async function replaceMemberRoles(
  context: SetupContext,
  memberId: string,
  input: ReplaceMemberRolesInput,
) {
  return withTenantContext(context, async (client) => {
    const target = await assertMemberExists(
      client,
      context.organizationId,
      memberId,
    );
    if (target.isOwner) {
      throw new BadRequestError(
        "The owner role cannot be changed through this endpoint",
      );
    }

    // A person with an employee profile always keeps the Employee role as their
    // self-service base. Management roles add responsibility; they do not take
    // away personal schedule, leave, attendance and payslip access.
    const linkedEmployee = await client.query<{ id: string }>(
      `SELECT id FROM employees
        WHERE organization_id = $1 AND member_id = $2
        LIMIT 1`,
      [context.organizationId, memberId],
    );
    const employeeRole = await client.query<{ id: string }>(
      `SELECT id FROM roles
        WHERE organization_id = $1 AND code = 'employee'
        LIMIT 1`,
      [context.organizationId],
    );
    const effectiveRoleCodes =
      linkedEmployee.rowCount && employeeRole.rowCount
        ? [...new Set([...input.roleCodes, "employee"])]
        : input.roleCodes;
    const roles = await roleIds(
      client,
      context.organizationId,
      effectiveRoleCodes,
    );
    if (roles.some((role) => role.code === "owner")) {
      throw new BadRequestError(
        "The owner role cannot be assigned through member access management",
      );
    }
    await client.query(
      `DELETE FROM member_roles
        WHERE organization_id = $1 AND member_id = $2`,
      [context.organizationId, memberId],
    );
    await client.query(
      `INSERT INTO member_roles (organization_id, member_id, role_id, assigned_by)
       SELECT $1, $2, role_id, $3
         FROM unnest($4::uuid[]) AS role_id
      ON CONFLICT DO NOTHING`,
      [
        context.organizationId,
        memberId,
        context.userId,
        roles.map((role) => role.id),
      ],
    );

    const roleCodes = roles.map((role) => role.code).sort();
    // The HR level is derived from LiteHubs access. An employee number stays
    // permanent; changing a role must never disrupt attendance history.
    await client.query(
      "UPDATE employees SET position_category = $3 WHERE organization_id = $1 AND member_id = $2",
      [
        context.organizationId,
        memberId,
        positionCategoryForRoleCodes(roleCodes),
      ],
    );

    return { memberId, roleCodes };
  });
}

export async function replaceMemberProvinces(
  context: SetupContext,
  memberId: string,
  input: ReplaceMemberProvincesInput,
) {
  return withTenantContext(context, async (client) => {
    await assertMemberExists(client, context.organizationId, memberId);
    await assertProvinceIds(client, context.organizationId, input.provinceIds);

    await client.query(
      `DELETE FROM member_provinces
        WHERE organization_id = $1 AND member_id = $2`,
      [context.organizationId, memberId],
    );
    if (input.provinceIds.length > 0) {
      await client.query(
        `INSERT INTO member_provinces (
           organization_id, member_id, province_id, assigned_by
         )
         SELECT $1, $2, province_id, $3
           FROM unnest($4::uuid[]) AS province_id
        ON CONFLICT DO NOTHING`,
        [context.organizationId, memberId, context.userId, input.provinceIds],
      );
    }

    return { memberId, provinceIds: input.provinceIds };
  });
}

// ------------------------------------------------------------- invitations ----

export async function listInvitations(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<InvitationRow>(
      `SELECT i.id, i.employee_id, e.full_name AS employee_name, i.email::text, i.job_title, i.expires_at, i.accepted_at,
              i.revoked_at, i.created_at,
              COALESCE(array_agg(DISTINCT r.code)
                FILTER (WHERE r.code IS NOT NULL), '{}') AS role_codes,
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name)
                  ORDER BY p.name
                )
                  FROM organization_invitation_provinces ip
                  JOIN provinces p
                    ON p.organization_id = ip.organization_id
                   AND p.id = ip.province_id
                 WHERE ip.organization_id = i.organization_id
                   AND ip.invitation_id = i.id
              ), '[]'::jsonb) AS provinces
         FROM organization_invitations i
         LEFT JOIN employees e
           ON e.organization_id = i.organization_id AND e.id = i.employee_id
         LEFT JOIN roles r
           ON r.organization_id = i.organization_id AND r.id = ANY(i.role_ids)
        WHERE i.organization_id = $1
        GROUP BY i.id, e.full_name
        ORDER BY i.created_at DESC`,
      [context.organizationId],
    );

    return result.rows.map((row) => ({
      invitationId: row.id,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      email: row.email,
      jobTitle: row.job_title,
      roleCodes: row.role_codes,
      provinces: row.provinces,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    }));
  });
}

export async function createInvitation(
  context: SetupContext,
  input: CreateInvitationInput,
) {
  const rawToken = crypto.randomBytes(48).toString("base64url");
  const tokenHash = invitationTokenHash(rawToken);
  const expiresAt = new Date(
    Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  let invitation: {
    id: string;
    employeeId: string | null;
    email: string;
    phone: string | null;
    roleCodes: string[];
    provinceIds: string[];
  };

  try {
    invitation = await withTenantContext(context, async (client) => {
      const roles = await roleIds(
        client,
        context.organizationId,
        input.roleCodes,
      );
      if (roles.some((role) => role.code === "owner"))
        throw new BadRequestError(
          "The owner role cannot be assigned through an access assignment",
        );
      await assertProvinceIds(
        client,
        context.organizationId,
        input.provinceIds,
      );

      let employeeId: string | null = null;
      let employeePhone: string | null = null;
      if (input.employeeId) {
        const employee = await client.query<{
          id: string;
          member_id: string | null;
          employment_status: string;
          phone: string | null;
        }>(
          `SELECT id, member_id, employment_status, phone
             FROM employees
            WHERE organization_id = $1 AND id = $2
            FOR UPDATE`,
          [context.organizationId, input.employeeId],
        );
        const employeeRow = employee.rows[0];
        if (!employeeRow)
          throw new NotFoundError("Employee profile was not found");
        if (employeeRow.member_id)
          throw new ConflictError("This employee already has LiteHubs access");
        if (employeeRow.employment_status === "terminated")
          throw new BadRequestError(
            "LiteHubs access cannot be assigned to a terminated employee",
          );
        if (
          input.deliveryMethod !== "email" &&
          !employeeRow.phone?.trim()
        ) {
          throw new BadRequestError(
            "Add a phone number to this employee before sending access by SMS",
          );
        }
        employeeId = employeeRow.id;
        employeePhone = employeeRow.phone;
      }

      if (input.deliveryMethod !== "email" && !input.employeeId) {
        throw new BadRequestError(
          "Choose an employee profile before sending access by SMS",
        );
      }

      const created = await client.query<{
        id: string;
        employee_id: string | null;
        email: string;
      }>(
        `INSERT INTO organization_invitations (
           organization_id, employee_id, email, token_hash, role_ids, job_title, invited_by, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, employee_id, email::text`,
        [
          context.organizationId,
          employeeId,
          input.email,
          tokenHash,
          roles.map((role) => role.id),
          input.jobTitle ?? null,
          context.userId,
          expiresAt,
        ],
      );
      const row = created.rows[0]!;

      if (input.provinceIds.length > 0) {
        await client.query(
          `INSERT INTO organization_invitation_provinces (
             organization_id, invitation_id, province_id
           )
           SELECT $1, $2, province_id
             FROM unnest($3::uuid[]) AS province_id`,
          [context.organizationId, row.id, input.provinceIds],
        );
      }

      return {
        id: row.id,
        employeeId: row.employee_id,
        email: row.email,
        phone: employeePhone ?? null,
        roleCodes: roles.map((role) => role.code).sort(),
        provinceIds: input.provinceIds,
      };
    });
  } catch (error) {
    return conflict(
      error,
      "There is already an active access assignment for that email",
    );
  }

  const acceptUrl = `${env.frontendUrl}/accept-invitation?token=${rawToken}`;
  const shouldSendEmail = input.deliveryMethod !== "sms";
  const shouldSendSms = input.deliveryMethod !== "email";
  const [emailDelivery, smsDelivery] = await Promise.all([
    shouldSendEmail
      ? env.isTest
        ? Promise.resolve({ sent: false, reason: "email_skipped_in_test" })
        : sendTeamInvitationEmail(
            invitation.email,
            context.organizationId,
            acceptUrl,
            INVITATION_TTL_DAYS,
          )
      : Promise.resolve({ sent: false, reason: "email_not_selected" }),
    shouldSendSms
      ? sendSms({
          to: invitation.phone!,
          content: `LiteHubs · Votre accès Congo Omega est prêt. Créez votre mot de passe dans les ${INVITATION_TTL_DAYS} jours : ${acceptUrl}`,
        })
      : Promise.resolve({ sent: false, reason: "sms_not_selected" }),
  ]);

  return {
    invitation: {
      invitationId: invitation.id,
      employeeId: invitation.employeeId,
      email: invitation.email,
      roleCodes: invitation.roleCodes,
      provinceIds: invitation.provinceIds,
      expiresAt,
    },
    deliveryMethod: input.deliveryMethod,
    emailDelivery,
    smsDelivery,
    // A local Postman user needs a link while SMTP is deliberately unavailable.
    ...(env.isProduction ? {} : { acceptUrl }),
  };
}

export async function revokeInvitation(
  context: SetupContext,
  invitationId: string,
) {
  return withTenantContext(context, async (client) => {
    const result = await client.query(
      `UPDATE organization_invitations
          SET revoked_at = now()
        WHERE organization_id = $1
          AND id = $2
          AND accepted_at IS NULL
          AND revoked_at IS NULL`,
      [context.organizationId, invitationId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundError("Active access assignment not found");
    }
  });
}
