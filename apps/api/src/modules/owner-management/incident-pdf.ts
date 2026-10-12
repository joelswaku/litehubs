/**
 * Rapport d'incident: one printable incident record. The record itself is
 * loaded through getOwnerManagementRecord, so the same province/site scope as
 * the incident register applies; this file only adds readable labels.
 */
import type { Request, RequestHandler } from "express";
import { createPdf, pdfDate, pdfMoney, pdfText, sendPdf } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import * as service from "./owner-management.service";

const CATEGORY: Record<string, string> = {
  injury: "Blessure",
  near_miss: "Presque-accident",
  equipment_damage: "Dommage matériel",
  fire: "Incendie",
  theft: "Vol",
  disease_outbreak: "Foyer de maladie",
  security_breach: "Atteinte à la sécurité",
  other: "Autre",
};
const SEVERITY: Record<string, string> = {
  minor: "Mineure",
  moderate: "Modérée",
  serious: "Grave",
  critical: "Critique",
  fatal: "Mortelle",
};
const STATUS: Record<string, string> = {
  open: "Ouvert",
  investigating: "En enquête",
  action_required: "Action requise",
  closed: "Clôturé",
};
const ACTION: Record<string, string> = {
  create: "Déclaration",
  update: "Mise à jour",
  delete: "Suppression",
  approve: "Approbation",
  reject: "Rejet",
};

const label = (map: Record<string, string>, value: unknown) =>
  value ? (map[String(value)] ?? String(value).replace(/_/g, " ")) : "—";
const yesNo = (value: unknown) => (value === true ? "Oui" : value === false ? "Non" : "—");

function contextOf(req: Request): service.OwnerManagementContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
  };
}

export const exportIncidentPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const raw = req.params.recordId;
  const recordId = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  // Throws NotFound when the incident is outside the member's scope.
  const incident = await service.getOwnerManagementRecord(context, "incidents", recordId);
  const buffer = await withTenantContext(context, async (client) => {
    const names = await client.query<Record<string, string | null>>(
      `SELECT
         (SELECT name FROM provinces WHERE organization_id=$1 AND id=$2::uuid) AS province_name,
         (SELECT name FROM sites WHERE organization_id=$1 AND id=$3::uuid) AS site_name,
         (SELECT concat_ws(' · ', full_name, employee_number) FROM employees WHERE organization_id=$1 AND id=$4::uuid) AS employee_name,
         (SELECT full_name FROM users WHERE id=$5::uuid) AS reported_by_name,
         (SELECT full_name FROM users WHERE id=$6::uuid) AS investigated_by_name,
         (SELECT full_name FROM users WHERE id=$7::uuid) AS closed_by_name`,
      [
        context.organizationId,
        incident.provinceId ?? null,
        incident.siteId ?? null,
        incident.employeeId ?? null,
        incident.reportedBy ?? null,
        incident.investigatedBy ?? null,
        incident.closedBy ?? null,
      ],
    );
    const name = names.rows[0] ?? {};
    const history = await client.query<{ action: string; actor_name: string | null; occurred_at: Date; fields: string | null }>(
      `SELECT action, actor_name, occurred_at,
              (SELECT string_agg(value, ', ') FROM jsonb_array_elements_text(COALESCE(changes->'fields','[]'::jsonb))) AS fields
         FROM audit_log
        WHERE organization_id=$1 AND entity_table='incidents' AND entity_id=$2
        ORDER BY occurred_at ASC
        LIMIT 100`,
      [context.organizationId, recordId],
    );

    const pdf = await createPdf(client, context.organizationId, {
      title: "Rapport d'incident",
      subtitle: pdfText(incident.title),
      reference: incident.reference ? String(incident.reference) : undefined,
    });
    pdf.stats([
      ["Gravité", label(SEVERITY, incident.severity)],
      ["Statut", label(STATUS, incident.status)],
      ["Catégorie", label(CATEGORY, incident.category)],
      ["Blessure", yesNo(incident.injuryOccurred)],
    ]);

    pdf.section("Quoi, où, quand");
    pdf.fields([
      ["Intitulé", incident.title],
      ["Référence", incident.reference],
      ["Survenu le", pdfDate(incident.occurredAt, true)],
      ["Déclaré le", pdfDate(incident.reportedAt ?? incident.createdAt, true)],
      ["Province", name.province_name],
      ["Site / ferme", name.site_name],
      ["Lieu précis", incident.locationDetail],
      ["Catégorie", label(CATEGORY, incident.category)],
    ]);

    pdf.section("Personnes concernées");
    pdf.fields([
      ["Employé concerné", name.employee_name],
      ["Autres parties", incident.otherParties],
      ["Déclaré par", name.reported_by_name],
      ["Enquête menée par", name.investigated_by_name],
    ]);

    pdf.section("Description");
    pdf.paragraph(pdfText(incident.description));

    pdf.section("Conséquences");
    pdf.fields(
      [
        ["Blessure", yesNo(incident.injuryOccurred)],
        ["Jours perdus", incident.daysLost ?? "—"],
        ["Perte estimée", incident.estimatedLoss != null ? pdfMoney(incident.estimatedLoss, String(incident.currency ?? "")) : "—"],
      ],
      3,
    );

    pdf.section("Actions et enquête");
    pdf.fields(
      [
        ["Action immédiate", incident.immediateAction],
        ["Cause racine", incident.rootCause],
        ["Signalé aux autorités", yesNo(incident.reportedToAuthorities)],
        ["Référence autorité", incident.authorityReference],
        ["Clôturé le", pdfDate(incident.closedAt, true)],
        ["Clôturé par", name.closed_by_name],
      ],
      2,
    );

    pdf.section("Historique du statut");
    pdf.table(
      [
        { label: "Date", width: 1.3 },
        { label: "Action", width: 1.1 },
        { label: "Par", width: 1.6 },
        { label: "Champs modifiés", width: 2.6 },
      ],
      history.rows.map((row) => [
        pdfDate(row.occurred_at, true),
        ACTION[row.action] ?? row.action,
        row.actor_name ?? "—",
        row.fields ?? "—",
      ]),
      { empty: "Aucun historique enregistré." },
    );
    pdf.note(`Statut actuel : ${label(STATUS, incident.status)}. Le journal d'audit conserve les champs modifiés, pas leurs valeurs.`);

    pdf.signatures(["Déclarant", "Responsable"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `rapport-incident-${String(incident.reference ?? recordId)}.pdf`, req.query.inline === "1");
};
