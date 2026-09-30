import PDFDocument from "pdfkit";
import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import {
  createNotificationInTransaction,
  notifyOrganizationOwnersInTransaction,
} from "../notifications/notifications.service";
import type {
  FleetAuthorizationInput,
  FleetProfileInput,
  FleetProfileUpdateInput,
  FleetRunReturnInput,
  FleetRunStartInput,
} from "./owner-management.validation";
import type { OwnerManagementContext } from "./owner-management.service";

type Row = Record<string, unknown>;
type InspectionStage = "pre_trip" | "post_trip";
type InspectionResult = "pass" | "fail" | "not_applicable";

const map = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z0-9])/g, (_, character: string) =>
        character.toUpperCase(),
      ),
      value instanceof Date ? value.toISOString() : value,
    ]),
  );

const today = () => new Date().toISOString().slice(0, 10);
const asNumber = (value: unknown) => Number(value ?? 0);
const hasValue = (value: unknown) => value !== null && value !== undefined;

type ChecklistItem = {
  itemCode: string;
  itemLabel: string;
  guidance: string | null;
  isRequired: boolean;
};

const defaultInspectionItems: Record<InspectionStage, ChecklistItem[]> = {
  pre_trip: [
    {
      itemCode: "meter_reading",
      itemLabel: "Le compteur correspond au relevé de départ",
      guidance: "Vérifiez le kilométrage ou les heures moteur avant le départ.",
      isRequired: true,
    },
    {
      itemCode: "fuel_level",
      itemLabel: "Le niveau de carburant est relevé et cohérent",
      guidance: "Signalez toute fuite, jauge anormale ou niveau inattendu.",
      isRequired: true,
    },
    {
      itemCode: "fluids_leaks",
      itemLabel: "Aucune fuite visible d’huile, carburant ou liquide",
      guidance: "Ne partez pas si une fuite présente un risque.",
      isRequired: true,
    },
    {
      itemCode: "safety_controls",
      itemLabel: "Freins, pneus/chenilles, éclairage et commandes sont sûrs",
      guidance:
        "Pour un engin fixe, vérifiez les protections, câbles et arrêt d’urgence.",
      isRequired: true,
    },
    {
      itemCode: "documents_and_load",
      itemLabel: "Permis, documents et chargement sont conformes",
      guidance:
        "Le conducteur confirme être autorisé et que la charge est sécurisée.",
      isRequired: true,
    },
  ],
  post_trip: [
    {
      itemCode: "return_meter",
      itemLabel: "Le compteur de retour est relevé",
      guidance: "Le compteur ne peut jamais diminuer.",
      isRequired: true,
    },
    {
      itemCode: "return_fuel",
      itemLabel: "Le niveau de carburant au retour est relevé",
      guidance: "Ajoutez tout plein et le justificatif lorsqu’il y en a un.",
      isRequired: true,
    },
    {
      itemCode: "damage_check",
      itemLabel: "Tout dommage, incident ou bruit anormal est signalé",
      guidance: "Un problème doit être déclaré avant de fermer la fiche.",
      isRequired: true,
    },
    {
      itemCode: "parking_and_security",
      itemLabel: "L’équipement est garé, arrêté et sécurisé",
      guidance: "Retirez les clés et placez l’engin à son emplacement prévu.",
      isRequired: true,
    },
  ],
};

async function profileForUpdate(
  client: PoolClient,
  context: OwnerManagementContext,
  profileId: string,
) {
  const result = await client.query<Row>(
    `SELECT fp.*,a.name AS asset_name,a.asset_number,a.status AS asset_status,
            a.site_id AS asset_site_id,a.project_id AS asset_project_id,
            a.meter_type,a.current_meter_reading,a.fuel_type
       FROM management_fleet_profiles fp
       JOIN management_assets a ON a.organization_id=fp.organization_id AND a.id=fp.asset_id
      WHERE fp.organization_id=$1 AND fp.id=$2
      FOR UPDATE OF fp,a`,
    [context.organizationId, profileId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Fleet profile not found");
  return row;
}

async function assertMember(
  client: PoolClient,
  context: OwnerManagementContext,
  memberId: string | null | undefined,
  field: string,
) {
  if (!memberId) return;
  const result = await client.query<{ id: string }>(
    `SELECT id FROM organization_members
      WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [context.organizationId, memberId],
  );
  if (!result.rowCount)
    throw new BadRequestError("Choose an active member in this company", {
      field,
    });
}

async function assertAsset(
  client: PoolClient,
  context: OwnerManagementContext,
  assetId: string,
) {
  const result = await client.query<Row>(
    `SELECT id,site_id,project_id,meter_type,status
       FROM management_assets
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, assetId],
  );
  if (!result.rows[0])
    throw new BadRequestError("Choose equipment in this company", {
      field: "assetId",
    });
  return result.rows[0];
}

async function assertDocument(
  client: PoolClient,
  context: OwnerManagementContext,
  documentId: string | null | undefined,
  field: string,
) {
  if (!documentId) return;
  const result = await client.query<{ id: string }>(
    "SELECT id FROM documents WHERE organization_id=$1 AND id=$2",
    [context.organizationId, documentId],
  );
  if (!result.rowCount)
    throw new BadRequestError("Choose a document in this company", { field });
}

async function checklistFor(
  client: PoolClient,
  context: OwnerManagementContext,
  operationKind: string,
  stage: InspectionStage,
): Promise<ChecklistItem[]> {
  const result = await client.query<{
    item_code: string;
    label: string;
    guidance: string | null;
    is_required: boolean;
  }>(
    `SELECT ti.item_code,ti.label,ti.guidance,ti.is_required
       FROM management_fleet_inspection_templates t
       JOIN management_fleet_inspection_template_items ti
         ON ti.organization_id=t.organization_id AND ti.template_id=t.id
      WHERE t.organization_id=$1 AND t.operation_kind=$2
        AND t.inspection_stage=$3 AND t.is_active=true
      ORDER BY ti.sort_order,ti.created_at`,
    [context.organizationId, operationKind, stage],
  );
  if (!result.rowCount) return defaultInspectionItems[stage];
  return result.rows.map((row) => ({
    itemCode: row.item_code,
    itemLabel: row.label,
    guidance: row.guidance,
    isRequired: row.is_required,
  }));
}

async function activeAuthorization(
  client: PoolClient,
  context: OwnerManagementContext,
  profileId: string,
  memberId: string,
  responsibilities: readonly string[],
) {
  const result = await client.query<Row>(
    `SELECT * FROM management_fleet_authorizations
      WHERE organization_id=$1 AND fleet_profile_id=$2 AND member_id=$3
        AND responsibility=ANY($4::text[]) AND is_active=true
        AND starts_on <= current_date AND (ends_on IS NULL OR ends_on >= current_date)
      ORDER BY created_at DESC LIMIT 1`,
    [context.organizationId, profileId, memberId, responsibilities],
  );
  return result.rows[0] ?? null;
}

/**
 * Company-wide fleet authority is granted only through the dedicated
 * permission.  Per-asset authorisations below remain narrower: a driver or
 * supervisor of one engine never gains access to the entire fleet.
 */
async function canManageFleetGlobally(
  client: PoolClient,
  context: OwnerManagementContext,
) {
  if (context.isOwner) return true;
  const result = await client.query<{ allowed: boolean }>(
    `SELECT EXISTS(
       SELECT 1
         FROM member_roles mr
         JOIN roles r
           ON r.organization_id=mr.organization_id AND r.id=mr.role_id
         JOIN role_permissions rp
           ON rp.organization_id=r.organization_id AND rp.role_id=r.id
         JOIN permissions permission ON permission.id=rp.permission_id
        WHERE mr.organization_id=$1 AND mr.member_id=$2
          AND permission.code='vehicles.fleet_control.update'
     ) AS allowed`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.allowed === true;
}

async function canOperateProfile(
  client: PoolClient,
  context: OwnerManagementContext,
  profile: Row,
) {
  if (await canManageFleetGlobally(client, context)) return true;
  if (
    String(profile.fleet_controller_member_id ?? "") === context.memberId ||
    String(profile.maintenance_controller_member_id ?? "") === context.memberId
  )
    return true;
  return Boolean(
    await activeAuthorization(
      client,
      context,
      String(profile.id),
      context.memberId,
      ["driver", "operator"],
    ),
  );
}

async function canCompleteFleetSheet(
  client: PoolClient,
  context: OwnerManagementContext,
  profile: Row,
) {
  if (await canManageFleetGlobally(client, context)) return true;
  if (
    String(profile.fleet_controller_member_id ?? "") === context.memberId ||
    String(profile.maintenance_controller_member_id ?? "") === context.memberId
  )
    return true;
  return Boolean(
    await activeAuthorization(
      client,
      context,
      String(profile.id),
      context.memberId,
      ["fleet_controller", "maintenance_controller"],
    ),
  );
}

async function assertValidLicence(
  client: PoolClient,
  context: OwnerManagementContext,
  profile: Row,
  operatorMemberId: string,
) {
  if (!profile.requires_operator_licence) return;
  const authorization = await activeAuthorization(
    client,
    context,
    String(profile.id),
    operatorMemberId,
    ["driver", "operator"],
  );
  if (!authorization)
    throw new ForbiddenError(
      "Only an assigned driver or operator can use this equipment",
    );
  const licence = await client.query<{
    credential_number: string | null;
    expires_on: string | null;
  }>(
    `SELECT dossier.credential_number,dossier.expires_on
       FROM employees e
       JOIN management_employee_dossier_documents dossier
         ON dossier.organization_id=e.organization_id AND dossier.employee_id=e.id
      WHERE e.organization_id=$1 AND e.member_id=$2
        AND dossier.document_kind='driving_licence' AND dossier.verified_at IS NOT NULL
        AND (dossier.expires_on IS NULL OR dossier.expires_on >= current_date)
      ORDER BY dossier.expires_on NULLS LAST,dossier.verified_at DESC LIMIT 1`,
    [context.organizationId, operatorMemberId],
  );
  if (!licence.rows[0])
    throw new ForbiddenError(
      "A verified, current driver licence is required before this equipment can leave",
    );
  if (profile.required_licence_class && !licence.rows[0].credential_number)
    throw new ForbiddenError(
      "Record the licence number in the employee dossier before dispatching this equipment",
    );
}

async function assertDispatchMaintenance(
  client: PoolClient,
  context: OwnerManagementContext,
  profile: Row,
  startMeter: number | null,
) {
  if (!profile.prevent_dispatch_when_due) return;
  const plans = await client.query<Row>(
    `SELECT id,name,next_due_date,next_due_meter,blocks_dispatch_when_due
       FROM management_maintenance_plans
      WHERE organization_id=$1 AND asset_id=$2 AND is_active=true
        AND blocks_dispatch_when_due=true
        AND ((next_due_date IS NOT NULL AND next_due_date <= current_date)
          OR (next_due_meter IS NOT NULL AND $3::numeric IS NOT NULL AND next_due_meter <= $3::numeric))
      ORDER BY next_due_date NULLS LAST,next_due_meter NULLS LAST LIMIT 1`,
    [context.organizationId, profile.asset_id, startMeter],
  );
  const plan = plans.rows[0];
  if (plan)
    throw new ConflictError(
      `Dispatch is blocked: ${String(plan.name)} is due. Complete the safety maintenance first.`,
      { field: "startMeter" },
    );
}

function assertChecklist(
  expected: ChecklistItem[],
  answers:
    | FleetRunStartInput["preTripResponses"]
    | FleetRunReturnInput["postTripResponses"],
  stage: InspectionStage,
) {
  const byCode = new Map(answers.map((answer) => [answer.itemCode, answer]));
  for (const item of expected) {
    const answer = byCode.get(item.itemCode);
    if (item.isRequired && !answer)
      throw new BadRequestError(
        `Complete the required ${stage === "pre_trip" ? "pre-trip" : "post-trip"} check: ${item.itemLabel}`,
        {
          field:
            stage === "pre_trip" ? "preTripResponses" : "postTripResponses",
        },
      );
    if (item.isRequired && answer?.result === "fail" && stage === "pre_trip")
      throw new BadRequestError(
        `Correct or escalate the failed pre-trip check before departure: ${item.itemLabel}`,
        { field: "preTripResponses" },
      );
  }
}

async function writeInspectionResponses(
  client: PoolClient,
  context: OwnerManagementContext,
  runId: string,
  stage: InspectionStage,
  expected: ChecklistItem[],
  answers:
    | FleetRunStartInput["preTripResponses"]
    | FleetRunReturnInput["postTripResponses"],
) {
  const expectedByCode = new Map(expected.map((item) => [item.itemCode, item]));
  for (const answer of answers) {
    const definition = expectedByCode.get(answer.itemCode);
    await assertDocument(
      client,
      context,
      answer.photoDocumentId ?? null,
      "photoDocumentId",
    );
    await client.query(
      `INSERT INTO management_fleet_inspection_responses
        (organization_id,run_id,inspection_stage,item_code,item_label,is_required,result,notes,photo_document_id,recorded_by_member_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        context.organizationId,
        runId,
        stage,
        answer.itemCode,
        definition?.itemLabel ?? answer.itemLabel,
        definition?.isRequired ?? false,
        answer.result,
        answer.notes ?? null,
        answer.photoDocumentId ?? null,
        context.memberId,
      ],
    );
  }
}

async function createFleetAlert(
  client: PoolClient,
  context: OwnerManagementContext,
  input: {
    assetId: string;
    runId?: string | null;
    profile: Row;
    alertType:
      | "failed_inspection"
      | "meter_anomaly"
      | "fuel_variance"
      | "fuel_capacity"
      | "maintenance_due"
      | "licence_expired"
      | "gate_check_missing"
      | "missing_inspection";
    severity: "notice" | "warning" | "critical";
    title: string;
    details?: string | null;
    detectedValue?: number | null;
    expectedValue?: number | null;
  },
) {
  const assigned =
    (input.profile.fleet_controller_member_id as string | null) ?? null;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO management_fleet_alerts
      (organization_id,asset_id,run_id,alert_type,severity,title,details,detected_value,expected_value,assigned_member_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      context.organizationId,
      input.assetId,
      input.runId ?? null,
      input.alertType,
      input.severity,
      input.title,
      input.details ?? null,
      input.detectedValue ?? null,
      input.expectedValue ?? null,
      assigned,
    ],
  );
  const recipient = assigned;
  if (recipient)
    await createNotificationInTransaction(client, {
      organizationId: context.organizationId,
      recipientMemberId: recipient,
      actorUserId: context.userId,
      category: "maintenance",
      type: `fleet_${input.alertType}`,
      priority: input.severity === "critical" ? "urgent" : "high",
      title: input.title,
      message: input.details ?? null,
      actionUrl: "/fleet-control",
      entityType: "management_fleet_alerts",
      entityId: inserted.rows[0]?.id ?? null,
      deduplicationKey: `fleet:${input.alertType}:${input.runId ?? input.assetId}`,
    });
  else
    await notifyOrganizationOwnersInTransaction(client, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      category: "maintenance",
      type: `fleet_${input.alertType}`,
      priority: input.severity === "critical" ? "urgent" : "high",
      title: input.title,
      message: input.details ?? null,
      actionUrl: "/fleet-control",
      entityType: "management_fleet_alerts",
      entityId: inserted.rows[0]?.id ?? null,
      deduplicationKey: `fleet:${input.alertType}:${input.runId ?? input.assetId}`,
    });
}

async function runForRead(
  client: PoolClient,
  context: OwnerManagementContext,
  runId: string,
) {
  const result = await client.query<Row>(
    `SELECT r.*,a.name AS asset_name,a.asset_number,a.meter_type,a.fuel_type,
            p.name AS project_name,s.name AS site_name,u.full_name AS operator_name,
            fp.operation_kind,fp.fleet_controller_member_id,fp.maintenance_controller_member_id,
            fp.expected_consumption,fp.expected_consumption_unit,
            fp.consumption_tolerance_percent,fp.fuel_tank_capacity_litres
       FROM management_fleet_runs r
       JOIN management_assets a ON a.organization_id=r.organization_id AND a.id=r.asset_id
       JOIN management_fleet_profiles fp ON fp.organization_id=r.organization_id AND fp.id=r.fleet_profile_id
       LEFT JOIN management_projects p ON p.organization_id=r.organization_id AND p.id=r.project_id
       LEFT JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id
       LEFT JOIN organization_members om ON om.organization_id=r.organization_id AND om.id=r.operator_member_id
       LEFT JOIN users u ON u.id=om.user_id
      WHERE r.organization_id=$1 AND r.id=$2`,
    [context.organizationId, runId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Fleet record not found");
  return row;
}

async function assertRunAccess(
  client: PoolClient,
  context: OwnerManagementContext,
  run: Row,
) {
  if (context.isOwner || String(run.operator_member_id) === context.memberId)
    return;
  if (
    await canOperateProfile(client, context, {
      id: run.fleet_profile_id,
      fleet_controller_member_id: run.fleet_controller_member_id,
      maintenance_controller_member_id: run.maintenance_controller_member_id,
    })
  )
    return;
  throw new ForbiddenError("You cannot access this fleet record");
}

export async function listFleetOverview(
  context: OwnerManagementContext,
  ownOnly = false,
) {
  return withTenantContext(context, async (client) => {
    const filter = ownOnly
      ? `AND (fp.fleet_controller_member_id=$2 OR fp.maintenance_controller_member_id=$2
          OR EXISTS(SELECT 1 FROM management_fleet_authorizations fa WHERE fa.organization_id=fp.organization_id AND fa.fleet_profile_id=fp.id AND fa.member_id=$2 AND fa.is_active=true AND fa.responsibility IN ('driver','operator','fleet_controller','maintenance_controller') AND fa.starts_on<=current_date AND (fa.ends_on IS NULL OR fa.ends_on>=current_date)))`
      : "";
    const values = ownOnly
      ? [context.organizationId, context.memberId]
      : [context.organizationId];
    const profileRows = await client.query<Row>(
      `SELECT fp.*,a.name AS asset_name,a.asset_number,a.status AS asset_status,a.site_id,a.project_id,
              a.meter_type,a.current_meter_reading,a.fuel_type,s.name AS site_name,
              p.name AS project_name,controller_user.full_name AS fleet_controller_name,
              maintenance_user.full_name AS maintenance_controller_name,
              (SELECT r.id FROM management_fleet_runs r WHERE r.organization_id=fp.organization_id AND r.asset_id=fp.asset_id AND r.status='open' LIMIT 1) AS open_run_id,
              (SELECT count(*) FROM management_fleet_alerts al WHERE al.organization_id=fp.organization_id AND al.asset_id=fp.asset_id AND al.status IN ('open','investigating'))::int AS open_alert_count
         FROM management_fleet_profiles fp
         JOIN management_assets a ON a.organization_id=fp.organization_id AND a.id=fp.asset_id
         LEFT JOIN sites s ON s.organization_id=a.organization_id AND s.id=a.site_id
         LEFT JOIN management_projects p ON p.organization_id=a.organization_id AND p.id=a.project_id
         LEFT JOIN organization_members controller_member ON controller_member.organization_id=fp.organization_id AND controller_member.id=fp.fleet_controller_member_id
         LEFT JOIN users controller_user ON controller_user.id=controller_member.user_id
         LEFT JOIN organization_members maintenance_member ON maintenance_member.organization_id=fp.organization_id AND maintenance_member.id=fp.maintenance_controller_member_id
         LEFT JOIN users maintenance_user ON maintenance_user.id=maintenance_member.user_id
        WHERE fp.organization_id=$1 AND fp.is_active=true ${filter}
        ORDER BY a.name`,
      values,
    );
    const authorizationRows = profileRows.rowCount
      ? await client.query<Row>(
          `SELECT fa.fleet_profile_id,fa.member_id,fa.responsibility,fa.licence_expires_on,
                  u.full_name AS member_name
             FROM management_fleet_authorizations fa
             JOIN organization_members om ON om.organization_id=fa.organization_id AND om.id=fa.member_id
             JOIN users u ON u.id=om.user_id
            WHERE fa.organization_id=$1 AND fa.fleet_profile_id=ANY($2::uuid[])
              AND fa.is_active=true AND fa.starts_on<=current_date
              AND (fa.ends_on IS NULL OR fa.ends_on>=current_date)
            ORDER BY u.full_name,fa.responsibility`,
          [
            context.organizationId,
            profileRows.rows.map((profile) => String(profile.id)),
          ],
        )
      : { rows: [] as Row[] };
    const authorizationsByProfile = new Map<string, Row[]>();
    for (const authorization of authorizationRows.rows) {
      const key = String(authorization.fleet_profile_id);
      authorizationsByProfile.set(key, [
        ...(authorizationsByProfile.get(key) ?? []),
        map(authorization),
      ]);
    }
    const profiles = await Promise.all(
      profileRows.rows.map(async (profile) => ({
        ...map(profile),
        authorizations: authorizationsByProfile.get(String(profile.id)) ?? [],
        currentMemberResponsibilities: (
          authorizationsByProfile.get(String(profile.id)) ?? []
        )
          .filter(
            (authorization) =>
              String(authorization.memberId) === context.memberId,
          )
          .map((authorization) => String(authorization.responsibility)),
        preTripChecklist: await checklistFor(
          client,
          context,
          String(profile.operation_kind),
          "pre_trip",
        ),
        postTripChecklist: await checklistFor(
          client,
          context,
          String(profile.operation_kind),
          "post_trip",
        ),
      })),
    );
    const runs = await client.query<Row>(
      `SELECT r.*,a.name AS asset_name,a.asset_number,u.full_name AS operator_name,
              pre_trip_user.full_name AS pre_trip_signer_name,
              post_trip_user.full_name AS post_trip_signer_name,
              p.name AS project_name,s.name AS site_name,
              (SELECT count(*) FROM management_fleet_inspection_responses ir WHERE ir.organization_id=r.organization_id AND ir.run_id=r.id AND ir.inspection_stage='pre_trip' AND ir.result='fail')::int AS pre_trip_failures,
              (SELECT count(*) FROM management_fleet_inspection_responses ir WHERE ir.organization_id=r.organization_id AND ir.run_id=r.id AND ir.inspection_stage='post_trip' AND ir.result='fail')::int AS post_trip_failures
         FROM management_fleet_runs r
         JOIN management_assets a ON a.organization_id=r.organization_id AND a.id=r.asset_id
         JOIN organization_members om ON om.organization_id=r.organization_id AND om.id=r.operator_member_id
         JOIN users u ON u.id=om.user_id
         LEFT JOIN organization_members pre_trip_member ON pre_trip_member.organization_id=r.organization_id AND pre_trip_member.id=r.pre_trip_signed_by_member_id
         LEFT JOIN users pre_trip_user ON pre_trip_user.id=pre_trip_member.user_id
         LEFT JOIN organization_members post_trip_member ON post_trip_member.organization_id=r.organization_id AND post_trip_member.id=r.post_trip_signed_by_member_id
         LEFT JOIN users post_trip_user ON post_trip_user.id=post_trip_member.user_id
         LEFT JOIN management_projects p ON p.organization_id=r.organization_id AND p.id=r.project_id
         LEFT JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id
        WHERE r.organization_id=$1 ${
          ownOnly
            ? `AND (
          r.operator_member_id=$2
          OR EXISTS(
            SELECT 1 FROM management_fleet_profiles controlled
             WHERE controlled.organization_id=r.organization_id AND controlled.id=r.fleet_profile_id
               AND (
                 controlled.fleet_controller_member_id=$2
                 OR controlled.maintenance_controller_member_id=$2
                 OR EXISTS(
                   SELECT 1 FROM management_fleet_authorizations controller_authorization
                    WHERE controller_authorization.organization_id=controlled.organization_id
                      AND controller_authorization.fleet_profile_id=controlled.id
                      AND controller_authorization.member_id=$2
                      AND controller_authorization.is_active=true
                      AND controller_authorization.responsibility IN ('fleet_controller','maintenance_controller')
                      AND controller_authorization.starts_on<=current_date
                      AND (controller_authorization.ends_on IS NULL OR controller_authorization.ends_on>=current_date)
                 )
               )
          )
        )`
            : ""
        }
        ORDER BY r.dispatched_at DESC LIMIT 60`,
      values,
    );
    const alerts = ownOnly
      ? []
      : (
          await client.query<Row>(
            `SELECT al.*,a.name AS asset_name,r.run_code
               FROM management_fleet_alerts al
               JOIN management_assets a ON a.organization_id=al.organization_id AND a.id=al.asset_id
               LEFT JOIN management_fleet_runs r ON r.organization_id=al.organization_id AND r.id=al.run_id
              WHERE al.organization_id=$1 AND al.status IN ('open','investigating')
              ORDER BY CASE al.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,al.created_at DESC
              LIMIT 60`,
            [context.organizationId],
          )
        ).rows.map(map);
    return { profiles, runs: runs.rows.map(map), alerts };
  });
}

export async function createFleetProfile(
  context: OwnerManagementContext,
  input: FleetProfileInput,
) {
  return withTenantContext(context, async (client) => {
    await assertAsset(client, context, input.assetId);
    await assertMember(
      client,
      context,
      input.fleetControllerMemberId,
      "fleetControllerMemberId",
    );
    await assertMember(
      client,
      context,
      input.maintenanceControllerMemberId,
      "maintenanceControllerMemberId",
    );
    const duplicate = await client.query(
      "SELECT id FROM management_fleet_profiles WHERE organization_id=$1 AND asset_id=$2",
      [context.organizationId, input.assetId],
    );
    if (duplicate.rowCount)
      throw new ConflictError(
        "This equipment already has a fleet control profile",
        {
          field: "assetId",
        },
      );
    const result = await client.query<Row>(
      `INSERT INTO management_fleet_profiles
        (organization_id,asset_id,operation_kind,fleet_controller_member_id,maintenance_controller_member_id,requires_pre_trip,requires_post_trip,requires_gate_check,requires_operator_licence,required_licence_class,daily_meter_required,prevent_dispatch_when_due,fuel_tank_capacity_litres,expected_consumption,expected_consumption_unit,consumption_tolerance_percent,is_active,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        context.organizationId,
        input.assetId,
        input.operationKind,
        input.fleetControllerMemberId ?? null,
        input.maintenanceControllerMemberId ?? null,
        input.requiresPreTrip ?? true,
        input.requiresPostTrip ?? true,
        input.requiresGateCheck ?? false,
        input.requiresOperatorLicence ?? false,
        input.requiredLicenceClass ?? null,
        input.dailyMeterRequired ?? true,
        input.preventDispatchWhenDue ?? true,
        input.fuelTankCapacityLitres ?? null,
        input.expectedConsumption ?? null,
        input.expectedConsumptionUnit ?? null,
        input.consumptionTolerancePercent ?? 20,
        input.isActive ?? true,
        input.notes ?? null,
      ],
    );
    return map(result.rows[0]!);
  });
}

export async function updateFleetProfile(
  context: OwnerManagementContext,
  profileId: string,
  input: FleetProfileUpdateInput,
) {
  return withTenantContext(context, async (client) => {
    await profileForUpdate(client, context, profileId);
    const result = await client.query<Row>(
      `UPDATE management_fleet_profiles
          SET operation_kind=$3,
              requires_pre_trip=COALESCE($4,requires_pre_trip),
              requires_post_trip=COALESCE($5,requires_post_trip),
              requires_gate_check=COALESCE($6,requires_gate_check),
              requires_operator_licence=COALESCE($7,requires_operator_licence),
              required_licence_class=$8,
              daily_meter_required=COALESCE($9,daily_meter_required),
              prevent_dispatch_when_due=COALESCE($10,prevent_dispatch_when_due),
              fuel_tank_capacity_litres=$11,
              expected_consumption=$12,
              expected_consumption_unit=$13,
              consumption_tolerance_percent=COALESCE($14,consumption_tolerance_percent),
              is_active=COALESCE($15,is_active),
              notes=$16,
              updated_at=now()
        WHERE organization_id=$1 AND id=$2
        RETURNING *`,
      [
        context.organizationId,
        profileId,
        input.operationKind,
        input.requiresPreTrip,
        input.requiresPostTrip,
        input.requiresGateCheck,
        input.requiresOperatorLicence,
        input.requiredLicenceClass ?? null,
        input.dailyMeterRequired,
        input.preventDispatchWhenDue,
        input.fuelTankCapacityLitres ?? null,
        input.expectedConsumption ?? null,
        input.expectedConsumptionUnit ?? null,
        input.consumptionTolerancePercent,
        input.isActive,
        input.notes ?? null,
      ],
    );
    return map(result.rows[0]!);
  });
}

export async function addFleetAuthorization(
  context: OwnerManagementContext,
  profileId: string,
  input: FleetAuthorizationInput,
) {
  return withTenantContext(context, async (client) => {
    await profileForUpdate(client, context, profileId);
    await assertMember(client, context, input.memberId, "memberId");
    await assertDocument(
      client,
      context,
      input.licenceDocumentId ?? null,
      "licenceDocumentId",
    );
    // A controlled asset has one current accountable person for each
    // responsibility. Reassigning keeps the former row as history but removes
    // its active authority before granting the new person access.
    await client.query(
      `UPDATE management_fleet_authorizations
          SET is_active=false,updated_at=now()
        WHERE organization_id=$1 AND fleet_profile_id=$2
          AND responsibility=$3 AND is_active=true AND member_id<>$4`,
      [context.organizationId, profileId, input.responsibility, input.memberId],
    );
    const result = await client.query<Row>(
      `INSERT INTO management_fleet_authorizations
       (organization_id,fleet_profile_id,member_id,responsibility,licence_document_id,licence_number,licence_expires_on,starts_on,ends_on,is_active,assigned_by_member_id,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date,current_date),$9,$10,$11,$12)
       ON CONFLICT(organization_id,fleet_profile_id,member_id,responsibility)
       DO UPDATE SET licence_document_id=EXCLUDED.licence_document_id,licence_number=EXCLUDED.licence_number,licence_expires_on=EXCLUDED.licence_expires_on,starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on,is_active=EXCLUDED.is_active,assigned_by_member_id=EXCLUDED.assigned_by_member_id,notes=EXCLUDED.notes
       RETURNING *`,
      [
        context.organizationId,
        profileId,
        input.memberId,
        input.responsibility,
        input.licenceDocumentId ?? null,
        input.licenceNumber ?? null,
        input.licenceExpiresOn ?? null,
        input.startsOn ?? null,
        input.endsOn ?? null,
        input.isActive ?? true,
        context.memberId,
        input.notes ?? null,
      ],
    );
    if (input.responsibility === "fleet_controller")
      await client.query(
        `UPDATE management_fleet_profiles
            SET fleet_controller_member_id=$3,updated_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, profileId, input.memberId],
      );
    if (input.responsibility === "maintenance_controller")
      await client.query(
        `UPDATE management_fleet_profiles
            SET maintenance_controller_member_id=$3,updated_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, profileId, input.memberId],
      );
    return map(result.rows[0]!);
  });
}

export async function startFleetRun(
  context: OwnerManagementContext,
  input: FleetRunStartInput,
) {
  return withTenantContext(context, async (client) => {
    const profile = await profileForUpdate(client, context, input.profileId);
    if (!profile.is_active)
      throw new ConflictError("This fleet control profile is inactive");
    if (
      !["available", "assigned", "in_use"].includes(
        String(profile.asset_status),
      )
    )
      throw new ConflictError("This equipment is not available for dispatch");
    const operatorMemberId = input.operatorMemberId ?? context.memberId;
    const runDate = input.runDate ?? new Date().toISOString().slice(0, 10);
    if (runDate > new Date().toISOString().slice(0, 10))
      throw new BadRequestError("A daily sheet cannot be dated in the future", {
        field: "runDate",
      });
    const operatorAuthorization = await activeAuthorization(
      client,
      context,
      String(profile.id),
      operatorMemberId,
      ["driver", "operator"],
    );
    if (!operatorAuthorization)
      throw new ForbiddenError(
        "Choose a driver or operator assigned to this vehicle or engine",
      );
    if (
      operatorMemberId !== context.memberId &&
      !(await canCompleteFleetSheet(client, context, profile))
    )
      throw new ForbiddenError(
        "Only the fleet controller, maintenance controller or owner can complete a sheet for another operator",
      );
    if (
      operatorMemberId === context.memberId &&
      !(await canOperateProfile(client, context, profile))
    )
      throw new ForbiddenError(
        "You are not assigned to operate this vehicle or engine",
      );
    await assertValidLicence(client, context, profile, operatorMemberId);
    if (profile.requires_gate_check) {
      if (!input.gateVerifierMemberId)
        throw new BadRequestError(
          "A gate verifier must confirm this departure",
          {
            field: "gateVerifierMemberId",
          },
        );
      if (input.gateVerifierMemberId === operatorMemberId)
        throw new BadRequestError(
          "The driver cannot verify their own gate departure",
          {
            field: "gateVerifierMemberId",
          },
        );
      const gate = await activeAuthorization(
        client,
        context,
        String(profile.id),
        input.gateVerifierMemberId,
        ["gate_verifier"],
      );
      if (!gate && !context.isOwner)
        throw new BadRequestError("Choose an assigned gate verifier", {
          field: "gateVerifierMemberId",
        });
    }
    const meterRequired =
      Boolean(profile.daily_meter_required) &&
      String(profile.meter_type) !== "none";
    if (meterRequired && !hasValue(input.startMeter))
      throw new BadRequestError("Record the departure meter reading", {
        field: "startMeter",
      });
    const priorMeter =
      profile.current_meter_reading == null
        ? null
        : asNumber(profile.current_meter_reading);
    if (
      hasValue(input.startMeter) &&
      priorMeter != null &&
      Number(input.startMeter) < priorMeter
    )
      throw new BadRequestError(
        "The departure meter cannot be lower than the last verified reading",
        {
          field: "startMeter",
        },
      );
    if (
      hasValue(input.openingFuelLitres) &&
      profile.fuel_tank_capacity_litres != null &&
      Number(input.openingFuelLitres) >
        asNumber(profile.fuel_tank_capacity_litres)
    )
      throw new BadRequestError(
        "The declared fuel exceeds this asset's tank capacity",
        {
          field: "openingFuelLitres",
        },
      );
    await assertDispatchMaintenance(
      client,
      context,
      profile,
      input.startMeter ?? null,
    );
    const expected = await checklistFor(
      client,
      context,
      String(profile.operation_kind),
      "pre_trip",
    );
    if (profile.requires_pre_trip)
      assertChecklist(expected, input.preTripResponses, "pre_trip");
    // When a vehicle or engine was acquired for a project, its daily work
    // follows that project unless the operator deliberately links another one.
    let projectId = input.projectId ?? profile.asset_project_id ?? null;
    let taskId = input.projectTaskId ?? null;
    if (taskId) {
      const task = await client.query<{ project_id: string }>(
        "SELECT project_id FROM management_project_tasks WHERE organization_id=$1 AND id=$2",
        [context.organizationId, taskId],
      );
      if (!task.rows[0])
        throw new BadRequestError("Choose a project task in this company", {
          field: "projectTaskId",
        });
      if (projectId && projectId !== task.rows[0].project_id)
        throw new BadRequestError(
          "The selected task belongs to another project",
          {
            field: "projectTaskId",
          },
        );
      projectId = task.rows[0].project_id;
    }
    if (projectId) {
      const project = await client.query(
        "SELECT id FROM management_projects WHERE organization_id=$1 AND id=$2",
        [context.organizationId, projectId],
      );
      if (!project.rowCount)
        throw new BadRequestError("Choose a project in this company", {
          field: "projectId",
        });
    }
    let created: Row;
    try {
      const result = await client.query<Row>(
        `INSERT INTO management_fleet_runs
          (organization_id,fleet_profile_id,asset_id,project_id,project_task_id,site_id,run_date,operator_member_id,gate_verified_by_member_id,purpose,destination,start_meter,opening_fuel_litres,pre_trip_signed_at,pre_trip_signed_by_member_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$14) RETURNING *`,
        [
          context.organizationId,
          profile.id,
          profile.asset_id,
          projectId,
          taskId,
          profile.asset_site_id ?? null,
          runDate,
          operatorMemberId,
          input.gateVerifierMemberId ?? null,
          input.purpose,
          input.destination ?? null,
          input.startMeter ?? null,
          input.openingFuelLitres ?? null,
          context.memberId,
        ],
      );
      created = result.rows[0]!;
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505")
        throw new ConflictError(
          "This vehicle or engine already has an open daily record",
        );
      throw error;
    }
    if (profile.requires_pre_trip)
      await writeInspectionResponses(
        client,
        context,
        String(created.id),
        "pre_trip",
        expected,
        input.preTripResponses,
      );
    await client.query(
      "UPDATE management_assets SET status='in_use',updated_at=now() WHERE organization_id=$1 AND id=$2",
      [context.organizationId, profile.asset_id],
    );
    return map(await runForRead(client, context, String(created.id)));
  });
}

export async function returnFleetRun(
  context: OwnerManagementContext,
  runId: string,
  input: FleetRunReturnInput,
) {
  return withTenantContext(context, async (client) => {
    const run = await runForRead(client, context, runId);
    await assertRunAccess(client, context, run);
    if (String(run.status) !== "open")
      throw new ConflictError("Only an open fleet record can be returned");
    const profile = await profileForUpdate(
      client,
      context,
      String(run.fleet_profile_id),
    );
    const meterRequired =
      Boolean(profile.daily_meter_required) &&
      String(run.meter_type) !== "none";
    if (meterRequired && !hasValue(input.endMeter))
      throw new BadRequestError("Record the return meter reading", {
        field: "endMeter",
      });
    if (
      hasValue(input.endMeter) &&
      hasValue(run.start_meter) &&
      Number(input.endMeter) < asNumber(run.start_meter)
    )
      throw new BadRequestError(
        "The return meter cannot be lower than the departure reading",
        { field: "endMeter" },
      );
    if (
      hasValue(input.closingFuelLitres) &&
      profile.fuel_tank_capacity_litres != null &&
      Number(input.closingFuelLitres) >
        asNumber(profile.fuel_tank_capacity_litres)
    )
      throw new BadRequestError(
        "The declared fuel exceeds this asset's tank capacity",
        { field: "closingFuelLitres" },
      );
    if (
      hasValue(input.fuelAddedLitres) &&
      profile.fuel_tank_capacity_litres != null &&
      asNumber(run.opening_fuel_litres) + asNumber(input.fuelAddedLitres) >
        asNumber(profile.fuel_tank_capacity_litres) +
          asNumber(input.closingFuelLitres)
    )
      throw new BadRequestError(
        "The fuel record is inconsistent with the declared tank level",
        { field: "fuelAddedLitres" },
      );
    await assertDocument(
      client,
      context,
      input.fuelReceiptDocumentId ?? null,
      "fuelReceiptDocumentId",
    );
    const expected = await checklistFor(
      client,
      context,
      String(profile.operation_kind),
      "post_trip",
    );
    if (profile.requires_post_trip)
      assertChecklist(expected, input.postTripResponses, "post_trip");
    if (profile.requires_post_trip)
      await writeInspectionResponses(
        client,
        context,
        runId,
        "post_trip",
        expected,
        input.postTripResponses,
      );
    await client.query(
      `UPDATE management_fleet_runs
          SET status='returned',returned_at=now(),end_meter=$3,closing_fuel_litres=$4,
              post_trip_signed_at=now(),post_trip_signed_by_member_id=$5,return_notes=$6,updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        runId,
        input.endMeter ?? null,
        input.closingFuelLitres ?? null,
        context.memberId,
        input.returnNotes ?? null,
      ],
    );
    if (hasValue(input.endMeter))
      await client.query(
        `UPDATE management_assets SET current_meter_reading=GREATEST(COALESCE(current_meter_reading,0),$3),status='available',updated_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, profile.asset_id, input.endMeter],
      );
    else
      await client.query(
        "UPDATE management_assets SET status='available',updated_at=now() WHERE organization_id=$1 AND id=$2",
        [context.organizationId, profile.asset_id],
      );
    if (input.fuelAddedLitres) {
      await client.query(
        `INSERT INTO management_fleet_fuel_logs
          (organization_id,run_id,asset_id,project_id,log_type,meter_reading,quantity_litres,total_cost,currency_code,receipt_document_id,recorded_by_member_id)
         VALUES($1,$2,$3,$4,'purchased',$5,$6,$7,$8,$9,$10)`,
        [
          context.organizationId,
          runId,
          profile.asset_id,
          run.project_id ?? null,
          input.endMeter ?? run.end_meter ?? run.start_meter ?? null,
          input.fuelAddedLitres,
          input.fuelAmount ?? null,
          input.fuelCurrencyCode ?? null,
          input.fuelReceiptDocumentId ?? null,
          context.memberId,
        ],
      );
    }
    const failed = input.postTripResponses.filter(
      (answer) => answer.result === "fail",
    );
    for (const answer of failed)
      await createFleetAlert(client, context, {
        assetId: String(profile.asset_id),
        runId,
        profile,
        alertType: "failed_inspection",
        severity: "warning",
        title: `Post-trip anomaly: ${answer.itemLabel}`,
        details:
          answer.notes ??
          "The operator reported a failed return inspection check.",
      });
    const distanceOrHours =
      hasValue(input.endMeter) && hasValue(run.start_meter)
        ? Number(input.endMeter) - asNumber(run.start_meter)
        : 0;
    const fuelConsumed =
      hasValue(run.opening_fuel_litres) && hasValue(input.closingFuelLitres)
        ? asNumber(run.opening_fuel_litres) +
          asNumber(input.fuelAddedLitres) -
          asNumber(input.closingFuelLitres)
        : null;
    if (fuelConsumed != null && fuelConsumed < -0.001)
      await createFleetAlert(client, context, {
        assetId: String(profile.asset_id),
        runId,
        profile,
        alertType: "meter_anomaly",
        severity: "critical",
        title: "Inconsistent fuel reading",
        details:
          "The return fuel level is higher than the departure level and added fuel combined.",
        detectedValue: fuelConsumed,
      });
    if (
      fuelConsumed != null &&
      fuelConsumed >= 0 &&
      distanceOrHours > 0 &&
      profile.expected_consumption != null
    ) {
      const actual =
        String(profile.expected_consumption_unit) === "litres_per_100km"
          ? (fuelConsumed / distanceOrHours) * 100
          : fuelConsumed / distanceOrHours;
      const limit =
        asNumber(profile.expected_consumption) *
        (1 + asNumber(profile.consumption_tolerance_percent) / 100);
      if (actual > limit)
        await createFleetAlert(client, context, {
          assetId: String(profile.asset_id),
          runId,
          profile,
          alertType: "fuel_variance",
          severity: actual > limit * 1.25 ? "critical" : "warning",
          title: "Fuel use exceeds the approved control range",
          details: `Recorded ${actual.toFixed(2)} ${String(profile.expected_consumption_unit)}; control limit ${limit.toFixed(2)}. Verify the meter, fuel receipt and tank level.`,
          detectedValue: actual,
          expectedValue: limit,
        });
    }
    return map(await runForRead(client, context, runId));
  });
}

export async function cancelFleetRun(
  context: OwnerManagementContext,
  runId: string,
  reason: string,
) {
  return withTenantContext(context, async (client) => {
    if (!context.isOwner)
      throw new ForbiddenError(
        "Only the workspace owner can cancel a signed fleet record",
      );
    const run = await runForRead(client, context, runId);
    if (String(run.status) !== "open")
      throw new ConflictError("Only an open fleet record can be cancelled");
    if (!reason.trim())
      throw new BadRequestError("Explain why this fleet record is cancelled", {
        field: "reason",
      });
    await client.query(
      `UPDATE management_fleet_runs
          SET status='cancelled',cancelled_at=now(),cancelled_by_member_id=$3,cancellation_reason=$4,updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, runId, context.memberId, reason.trim()],
    );
    await client.query(
      "UPDATE management_assets SET status='available',updated_at=now() WHERE organization_id=$1 AND id=$2",
      [context.organizationId, run.asset_id],
    );
    return map(await runForRead(client, context, runId));
  });
}

export async function fleetRunPdf(
  context: OwnerManagementContext,
  runId: string,
) {
  return withTenantContext(context, async (client) => {
    const run = await runForRead(client, context, runId);
    await assertRunAccess(client, context, run);
    const checks = await client.query<Row>(
      `SELECT inspection_stage,item_label,result,notes,recorded_at
         FROM management_fleet_inspection_responses
        WHERE organization_id=$1 AND run_id=$2
        ORDER BY inspection_stage,recorded_at,item_label`,
      [context.organizationId, runId],
    );
    const organization = await client.query<{ name: string }>(
      "SELECT name FROM organizations WHERE id=$1",
      [context.organizationId],
    );
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 44, size: "A4" });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    doc
      .fillColor("#0B5E55")
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("LITEHUBS · FICHE VÉHICULE / ENGIN");
    doc
      .fillColor("#475569")
      .font("Helvetica")
      .fontSize(10)
      .text(organization.rows[0]?.name ?? "LiteHubs", { align: "right" });
    doc.moveDown(1);
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(15)
      .text(String(run.run_code));
    doc.font("Helvetica").fontSize(10).fillColor("#334155");
    const lines: Array<[string, string]> = [
      ["Équipement", `${String(run.asset_name)} · ${String(run.asset_number)}`],
      ["Conducteur / opérateur", String(run.operator_name)],
      ["Date", String(run.run_date)],
      ["Projet", String(run.project_name ?? "—")],
      ["But", String(run.purpose)],
      ["Destination", String(run.destination ?? "—")],
      [
        "Départ",
        `${run.start_meter ?? "—"} · carburant ${run.opening_fuel_litres ?? "—"} L`,
      ],
      [
        "Retour",
        `${run.end_meter ?? "—"} · carburant ${run.closing_fuel_litres ?? "—"} L`,
      ],
      ["Statut", String(run.status)],
    ];
    lines.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
      doc.font("Helvetica").text(value);
    });
    for (const stage of ["pre_trip", "post_trip"] as const) {
      doc
        .moveDown(0.9)
        .fillColor("#0B5E55")
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(
          stage === "pre_trip"
            ? "Contrôle avant départ"
            : "Contrôle après retour",
        );
      const items = checks.rows.filter(
        (check) => check.inspection_stage === stage,
      );
      if (!items.length)
        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#64748B")
          .text("Aucun contrôle enregistré.");
      items.forEach((check) => {
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor(
            check.result === "pass"
              ? "#166534"
              : check.result === "fail"
                ? "#B91C1C"
                : "#64748B",
          )
          .text(
            `${check.result === "pass" ? "CONFORME" : check.result === "fail" ? "ANOMALIE" : "N/A"} · `,
            { continued: true },
          );
        doc
          .font("Helvetica")
          .fillColor("#1F2937")
          .text(String(check.item_label));
        if (check.notes)
          doc
            .fillColor("#475569")
            .fontSize(8)
            .text(`Note : ${String(check.notes)}`, { indent: 12 });
      });
    }
    doc
      .moveDown(1)
      .strokeColor("#94A3B8")
      .moveTo(44, doc.y)
      .lineTo(550, doc.y)
      .stroke();
    doc
      .moveDown(0.6)
      .fontSize(8)
      .fillColor("#64748B")
      .text(
        "Document généré par LiteHubs. Le code unique et les relevés sont conservés dans le journal d’audit.",
      );
    doc.end();
    return { filename: `${String(run.run_code)}.pdf`, buffer: await finished };
  });
}
