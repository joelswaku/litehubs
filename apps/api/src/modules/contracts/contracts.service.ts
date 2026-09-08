import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from "pdf-lib";
import type { PoolClient } from "pg";
import { readPrivateDocument, storePrivateDocument } from "../../services/file-storage.service";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import type {
  ContractQuery,
  CreateContractInput,
  UpdateContractInput,
} from "./contracts.validation";

export interface ContractsContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}

type Scope = "organization" | "province" | "self";

type ContractRow = {
  id: string;
  reference: string;
  title: string;
  contract_type: string;
  supplier_id: string | null;
  customer_id: string | null;
  employee_id: string | null;
  counterparty_name: string | null;
  starts_on: string;
  ends_on: string | null;
  auto_renews: boolean;
  renewal_notice_days: number | null;
  currency: string | null;
  contract_value: string | null;
  payment_terms: string | null;
  employer_signer_role: string | null;
  status: string;
  document_id: string | null;
  province_id: string | null;
  owner_member_id: string | null;
  notes: string | null;
  signed_on: string | null;
  terminated_on: string | null;
  termination_reason: string | null;
  employee_signed_by_member_id: string | null;
  employee_signature_name: string | null;
  employee_signed_at: string | null;
  created_at: Date;
  updated_at: Date;
  supplier_name: string | null;
  customer_name: string | null;
  employee_name: string | null;
  province_name: string | null;
  document_title: string | null;
  owner_name: string | null;
};

type MyContractRow = {
  id: string;
  reference: string;
  title: string;
  contract_type: string;
  starts_on: string;
  ends_on: string | null;
  auto_renews: boolean;
  renewal_notice_days: number | null;
  currency: string | null;
  contract_value: string | null;
  payment_terms: string | null;
  status: string;
  document_id: string | null;
  document_title: string | null;
  document_file_name: string | null;
  signed_on: string | null;
  terminated_on: string | null;
  termination_reason: string | null;
  employee_signature_name: string | null;
  employee_signed_at: string | null;
  updated_at: Date;
};

type ContractDocumentRow = {
  id: string;
  reference: string;
  document_id: string;
  title: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
};

const fields = `
  c.id,c.reference,c.title,c.contract_type,c.supplier_id,c.customer_id,c.employee_id,
  c.counterparty_name,c.starts_on::text,c.ends_on::text,c.auto_renews,
  c.renewal_notice_days,c.currency,c.contract_value::text,c.payment_terms,c.employer_signer_role,c.status,
  c.document_id,c.province_id,c.owner_member_id,c.notes,c.signed_on::text,
  c.terminated_on::text,c.termination_reason,c.employee_signed_by_member_id,
  c.employee_signature_name,c.employee_signed_at::text,c.created_at,c.updated_at,
  sup.name AS supplier_name,cust.name AS customer_name,e.full_name AS employee_name,
  p.name AS province_name,d.title AS document_title,owner_user.full_name AS owner_name
`;

function map(row: ContractRow) {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    contractType: row.contract_type,
    counterparty: row.supplier_id
      ? { type: "supplier", id: row.supplier_id, name: row.supplier_name }
      : row.customer_id
        ? { type: "customer", id: row.customer_id, name: row.customer_name }
        : row.employee_id
          ? { type: "employee", id: row.employee_id, name: row.employee_name }
          : { type: "other", id: null, name: row.counterparty_name },
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    autoRenews: row.auto_renews,
    renewalNoticeDays: row.renewal_notice_days,
    currency: row.currency,
    contractValue:
      row.contract_value === null ? null : Number(row.contract_value),
    paymentTerms: row.payment_terms,
    employerSignerRole: row.employer_signer_role,
    status: row.status,
    document: row.document_id
      ? { id: row.document_id, title: row.document_title }
      : null,
    province: row.province_id
      ? { id: row.province_id, name: row.province_name }
      : null,
    ownerName: row.owner_name,
    notes: row.notes,
    signedOn: row.signed_on,
    terminatedOn: row.terminated_on,
    terminationReason: row.termination_reason,
    employeeSignature: row.employee_signed_at ? { name: row.employee_signature_name, signedAt: row.employee_signed_at } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapForContext(row: ContractRow, context: ContractsContext) {
  const contract = map(row);
  // Financial terms are controlled by the owner. An employee still receives
  // their own final employment contract through the separate self-scoped route.
  return context.isOwner
    ? contract
    : { ...contract, currency: null, contractValue: null, paymentTerms: null };
}
async function scopeOf(
  client: PoolClient,
  context: ContractsContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{ organization: boolean; province: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM member_roles mr
       JOIN roles ro ON ro.organization_id=mr.organization_id AND ro.id=mr.role_id
       WHERE mr.organization_id=$1 AND mr.member_id=$2 AND ro.data_scope='organization'
     ) AS organization,
     EXISTS(
       SELECT 1 FROM member_roles mr
       JOIN roles ro ON ro.organization_id=mr.organization_id AND ro.id=mr.role_id
       WHERE mr.organization_id=$1 AND mr.member_id=$2 AND ro.data_scope='province'
     ) AS province`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.organization
    ? "organization"
    : result.rows[0]?.province
      ? "province"
      : "self";
}

async function mayCountersignForEmployer(client: PoolClient, context: ContractsContext) {
  if (context.isOwner) return true;
  const result = await client.query<{ allowed: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM member_roles mr
       JOIN roles role ON role.organization_id=mr.organization_id AND role.id=mr.role_id
        WHERE mr.organization_id=$1 AND mr.member_id=$2 AND role.code='general_manager'
     ) AS allowed`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.allowed === true;
}
async function assertProvince(
  client: PoolClient,
  context: ContractsContext,
  provinceId: string | null | undefined,
) {
  if (!provinceId) return;
  const existing = await client.query(
    "SELECT 1 FROM provinces WHERE organization_id=$1 AND id=$2",
    [context.organizationId, provinceId],
  );
  if (!existing.rowCount)
    throw new BadRequestError("Choose a province in this company", {
      field: "provinceId",
    });
  const scope = await scopeOf(client, context);
  if (scope === "self")
    throw new ForbiddenError("Contracts are managed by authorized staff");
  if (scope === "province") {
    const allowed = await client.query(
      `SELECT 1 FROM member_provinces
        WHERE organization_id=$1 AND member_id=$2 AND province_id=$3`,
      [context.organizationId, context.memberId, provinceId],
    );
    if (!allowed.rowCount) throw new NotFoundError("Contract not found");
  }
}

async function assertScopedId(
  client: PoolClient,
  organizationId: string,
  table: string,
  id: string | null | undefined,
  field: string,
) {
  if (!id) return;
  const allowedTables = new Set([
    "management_suppliers",
    "customers",
    "employees",
    "documents",
  ]);
  if (!allowedTables.has(table))
    throw new BadRequestError("Unsupported linked record", { field });
  const result = await client.query(
    `SELECT 1 FROM ${table} WHERE organization_id=$1 AND id=$2`,
    [organizationId, id],
  );
  if (!result.rowCount)
    throw new BadRequestError("Choose a record in this company", { field });
}

async function select(
  client: PoolClient,
  context: ContractsContext,
  id: string,
): Promise<ContractRow> {
  const result = await client.query<ContractRow>(
    `SELECT ${fields}
       FROM contracts c
       LEFT JOIN management_suppliers sup ON sup.organization_id=c.organization_id AND sup.id=c.supplier_id
       LEFT JOIN customers cust ON cust.organization_id=c.organization_id AND cust.id=c.customer_id
       LEFT JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id
       LEFT JOIN provinces p ON p.organization_id=c.organization_id AND p.id=c.province_id
       LEFT JOIN documents d ON d.organization_id=c.organization_id AND d.id=c.document_id
       LEFT JOIN organization_members owner_member ON owner_member.organization_id=c.organization_id AND owner_member.id=c.owner_member_id
       LEFT JOIN users owner_user ON owner_user.id=owner_member.user_id
      WHERE c.organization_id=$1 AND c.id=$2`,
    [context.organizationId, id],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Contract not found");
  await assertProvince(client, context, row.province_id);
  return row;
}

async function selectOwnEmploymentContract(client: PoolClient, context: ContractsContext, contractId: string, employeeId: string): Promise<ContractRow> {
  const result = await client.query<ContractRow>(
    `SELECT ${fields}
       FROM contracts c
       LEFT JOIN management_suppliers sup ON sup.organization_id=c.organization_id AND sup.id=c.supplier_id
       LEFT JOIN customers cust ON cust.organization_id=c.organization_id AND cust.id=c.customer_id
       LEFT JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id
       LEFT JOIN provinces p ON p.organization_id=c.organization_id AND p.id=c.province_id
       LEFT JOIN documents d ON d.organization_id=c.organization_id AND d.id=c.document_id
       LEFT JOIN organization_members owner_member ON owner_member.organization_id=c.organization_id AND owner_member.id=c.owner_member_id
       LEFT JOIN users owner_user ON owner_user.id=owner_member.user_id
      WHERE c.organization_id=$1 AND c.id=$2 AND c.employee_id=$3 AND c.contract_type='employment' AND c.status NOT IN ('draft','cancelled')`,
    [context.organizationId, contractId, employeeId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Employment contract not found");
  return row;
}
function reference() {
  return `CTR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 7).toUpperCase()}`;
}

function assertCounterparty(input: {
  supplierId?: string | null;
  customerId?: string | null;
  employeeId?: string | null;
  counterpartyName?: string | null;
}) {
  const count = [input.supplierId, input.customerId, input.employeeId].filter(
    Boolean,
  ).length;
  if (count > 1 || (!count && !input.counterpartyName))
    throw new BadRequestError(
      "Choose one counterparty or provide its name",
      { field: "counterpartyName" },
    );
}

async function assertEditable(
  client: PoolClient,
  context: ContractsContext,
  provinceId: string | null | undefined,
) {
  if ((await scopeOf(client, context)) === "self")
    throw new ForbiddenError("Contracts are managed by authorized staff");
  await assertProvince(client, context, provinceId);
}

async function notifyEmployeeOfEmploymentContract(
  client: PoolClient,
  context: ContractsContext,
  contract: ContractRow,
  event: "available" | "updated",
) {
  if (
    !contract.employee_id ||
    !["pending_signature", "active", "renewed"].includes(contract.status)
  )
    return;

  const employee = await client.query<{ member_id: string | null }>(
    `SELECT member_id FROM employees
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, contract.employee_id],
  );
  const memberId = employee.rows[0]?.member_id;
  // Employment records may exist before an employee accepts their LiteHubs
  // invitation. Once linked, later updates will notify them automatically.
  if (!memberId) return;

  const ready = contract.status === "active" || contract.status === "renewed";
  await createNotificationInTransaction(client, {
    organizationId: context.organizationId,
    recipientMemberId: memberId,
    recipientEmployeeId: contract.employee_id,
    actorUserId: context.userId,
    provinceId: contract.province_id,
    category: "contract",
    type: ready ? "employment_contract_available" : "employment_contract_signature_requested",
    priority: ready ? "normal" : "high",
    title: ready
      ? "Your employment contract is available"
      : "Your employment contract needs attention",
    message: ready
      ? `${contract.title} (${contract.reference}) is available in My account.`
      : `${contract.title} (${contract.reference}) is ready for review and signature.`,
    actionUrl: "/my-account",
    entityType: "contract",
    entityId: contract.id,
    deduplicationKey: [
      "employment-contract",
      event,
      contract.id,
      contract.status,
      contract.document_id ?? "no-document",
      contract.signed_on ?? "unsigned",
      contract.ends_on ?? "open-ended",
    ].join(":"),
  });
}

async function ownEmployeeId(client: PoolClient, context: ContractsContext) {
  const own = await client.query<{ id: string }>(
    `SELECT id FROM employees
      WHERE organization_id=$1 AND member_id=$2
      LIMIT 1`,
    [context.organizationId, context.memberId],
  );
  const employeeId = own.rows[0]?.id;
  if (!employeeId)
    throw new NotFoundError(
      "No employee profile is linked to this LiteHubs account",
    );
  return employeeId;
}

export async function listContracts(
  context: ContractsContext,
  query: ContractQuery,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    if (scope === "self")
      throw new ForbiddenError("Contracts are managed by authorized staff");
    const params: unknown[] = [context.organizationId];
    const where = ["c.organization_id=$1"];
    if (query.status) {
      params.push(query.status);
      where.push(`c.status=$${params.length}`);
    }
    if (query.contractType) {
      params.push(query.contractType);
      where.push(`c.contract_type=$${params.length}`);
    }
    if (query.provinceId) {
      await assertProvince(client, context, query.provinceId);
      params.push(query.provinceId);
      where.push(`c.province_id=$${params.length}`);
    }
    if (query.expiringOnly)
      where.push(
        "c.status='active' AND c.ends_on IS NOT NULL AND c.ends_on <= CURRENT_DATE + 60",
      );
    if (scope === "province") {
      params.push(context.memberId);
      where.push(
        `c.province_id IN (
          SELECT province_id FROM member_provinces
           WHERE organization_id=$1 AND member_id=$${params.length}
        )`,
      );
    }
    const result = await client.query<ContractRow>(
      `SELECT ${fields}
         FROM contracts c
         LEFT JOIN management_suppliers sup ON sup.organization_id=c.organization_id AND sup.id=c.supplier_id
         LEFT JOIN customers cust ON cust.organization_id=c.organization_id AND cust.id=c.customer_id
         LEFT JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id
         LEFT JOIN provinces p ON p.organization_id=c.organization_id AND p.id=c.province_id
         LEFT JOIN documents d ON d.organization_id=c.organization_id AND d.id=c.document_id
         LEFT JOIN organization_members owner_member ON owner_member.organization_id=c.organization_id AND owner_member.id=c.owner_member_id
         LEFT JOIN users owner_user ON owner_user.id=owner_member.user_id
        WHERE ${where.join(" AND ")}
        ORDER BY CASE WHEN c.status='active' AND c.ends_on <= CURRENT_DATE+30 THEN 0 ELSE 1 END,
                 c.ends_on NULLS LAST,c.created_at DESC`,
      params,
    );
    return result.rows.map((row) => mapForContext(row, context));
  });
}

export async function createContract(
  context: ContractsContext,
  input: CreateContractInput,
) {
  return withTenantContext(context, async (client) => {
    if ((input.contractValue !== undefined || input.currency !== undefined || input.paymentTerms !== undefined) && !context.isOwner) throw new ForbiddenError("Only the owner can set or change confidential contract financial terms");
    if (input.employerSignerRole !== undefined && !context.isOwner) throw new ForbiddenError("Only the owner can set the employer signer role");
    await assertEditable(client, context, input.provinceId);
    assertCounterparty(input);
    await Promise.all([
      assertScopedId(client, context.organizationId, "management_suppliers", input.supplierId, "supplierId"),
      assertScopedId(client, context.organizationId, "customers", input.customerId, "customerId"),
      assertScopedId(client, context.organizationId, "employees", input.employeeId, "employeeId"),
      assertScopedId(client, context.organizationId, "documents", input.documentId, "documentId"),
    ]);
    if (input.contractType === "employment" && !input.employeeId)
      throw new BadRequestError("Choose the employee for this employment contract", {
        field: "employeeId",
      });
    if (input.endsOn && input.endsOn < input.startsOn)
      throw new BadRequestError("End date cannot be before start date", {
        field: "endsOn",
      });
    if (input.contractValue !== null && input.contractValue !== undefined && !input.currency)
      throw new BadRequestError("Choose a currency for the contract value", {
        field: "currency",
      });

    const result = await client.query<{ id: string }>(
      `INSERT INTO contracts (
         organization_id,reference,title,contract_type,supplier_id,customer_id,
         employee_id,counterparty_name,starts_on,ends_on,auto_renews,
         renewal_notice_days,currency,contract_value,payment_terms,status,
         document_id,province_id,owner_member_id,notes,signed_on,terminated_on,
         termination_reason,employer_signer_role,created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         $17,$18,$19,$20,$21,$22,$23,$24,$25
       ) RETURNING id`,
      [
        context.organizationId,
        input.reference ?? reference(),
        input.title,
        input.contractType,
        input.supplierId ?? null,
        input.customerId ?? null,
        input.employeeId ?? null,
        input.counterpartyName ?? null,
        input.startsOn,
        input.endsOn ?? null,
        input.autoRenews ?? false,
        input.renewalNoticeDays ?? null,
        input.currency ?? null,
        input.contractValue ?? null,
        input.paymentTerms ?? null,
        input.contractType === "employment" ? "draft" : input.status ?? "draft",
        input.documentId ?? null,
        input.provinceId ?? null,
        context.memberId,
        input.notes ?? null,
        input.contractType === "employment" ? null : input.signedOn ?? null,
        input.terminatedOn ?? null,
        input.terminationReason ?? null,
        input.employerSignerRole ?? null,
        context.userId,
      ],
    );
    const contract = await select(client, context, result.rows[0]!.id);
    await notifyEmployeeOfEmploymentContract(client, context, contract, "available");
    return mapForContext(contract, context);
  });
}

export async function updateContract(
  context: ContractsContext,
  id: string,
  input: UpdateContractInput,
) {
  return withTenantContext(context, async (client) => {
    const old = await select(client, context, id);
    if ((input.contractValue !== undefined || input.currency !== undefined || input.paymentTerms !== undefined) && !context.isOwner) throw new ForbiddenError("Only the owner can set or change confidential contract financial terms");
    if (input.employerSignerRole !== undefined && input.employerSignerRole !== old.employer_signer_role && !context.isOwner) throw new ForbiddenError("Only the owner can change the employer signer role");
    const electronicEmployment = old.contract_type === "employment" || input.contractType === "employment";
    if (electronicEmployment && input.status !== undefined && input.status !== old.status)
      throw new BadRequestError("Employment contract status is managed by the secure signature workflow", { field: "status" });
    if (electronicEmployment && input.signedOn !== undefined && input.signedOn !== old.signed_on)
      throw new BadRequestError("Employment contract signature date is recorded by the secure signature workflow", { field: "signedOn" });
    const next = {
      supplierId: input.supplierId === undefined ? old.supplier_id : input.supplierId,
      customerId: input.customerId === undefined ? old.customer_id : input.customerId,
      employeeId: input.employeeId === undefined ? old.employee_id : input.employeeId,
      counterpartyName:
        input.counterpartyName === undefined
          ? old.counterparty_name
          : input.counterpartyName,
      provinceId: input.provinceId === undefined ? old.province_id : input.provinceId,
      documentId: input.documentId === undefined ? old.document_id : input.documentId,
      contractType: input.contractType ?? old.contract_type,
      startsOn: input.startsOn ?? old.starts_on,
      endsOn: input.endsOn === undefined ? old.ends_on : input.endsOn,
      currency: input.currency === undefined ? old.currency : input.currency,
      contractValue:
        input.contractValue === undefined
          ? old.contract_value === null
            ? null
            : Number(old.contract_value)
          : input.contractValue,
      employerSignerRole: input.employerSignerRole === undefined ? old.employer_signer_role : input.employerSignerRole,
      status: input.status ?? old.status,
      terminatedOn:
        input.terminatedOn === undefined ? old.terminated_on : input.terminatedOn,
    };
    await assertEditable(client, context, next.provinceId);
    assertCounterparty(next);
    await Promise.all([
      assertScopedId(client, context.organizationId, "management_suppliers", next.supplierId, "supplierId"),
      assertScopedId(client, context.organizationId, "customers", next.customerId, "customerId"),
      assertScopedId(client, context.organizationId, "employees", next.employeeId, "employeeId"),
      assertScopedId(client, context.organizationId, "documents", next.documentId, "documentId"),
    ]);
    if (next.contractType === "employment" && !next.employeeId)
      throw new BadRequestError("Choose the employee for this employment contract", {
        field: "employeeId",
      });
    if (next.endsOn && next.endsOn < next.startsOn)
      throw new BadRequestError("End date cannot be before start date", {
        field: "endsOn",
      });
    if (next.contractValue !== null && !next.currency)
      throw new BadRequestError("Choose a currency for the contract value", {
        field: "currency",
      });
    if (next.status === "terminated" && !next.terminatedOn)
      throw new BadRequestError("Termination date is required", {
        field: "terminatedOn",
      });

    await client.query(
      `UPDATE contracts
          SET reference=$3,title=$4,contract_type=$5,supplier_id=$6,customer_id=$7,
              employee_id=$8,counterparty_name=$9,starts_on=$10,ends_on=$11,
              auto_renews=$12,renewal_notice_days=$13,currency=$14,
              contract_value=$15,payment_terms=$16,status=$17,document_id=$18,
              province_id=$19,notes=$20,signed_on=$21,terminated_on=$22,
              termination_reason=$23,employer_signer_role=$24
        WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        id,
        input.reference ?? old.reference,
        input.title ?? old.title,
        next.contractType,
        next.supplierId,
        next.customerId,
        next.employeeId,
        next.counterpartyName,
        next.startsOn,
        next.endsOn,
        input.autoRenews ?? old.auto_renews,
        input.renewalNoticeDays === undefined
          ? old.renewal_notice_days
          : input.renewalNoticeDays,
        next.currency,
        next.contractValue,
        input.paymentTerms === undefined ? old.payment_terms : input.paymentTerms,
        next.status,
        next.documentId,
        next.provinceId,
        input.notes === undefined ? old.notes : input.notes,
        input.signedOn === undefined ? old.signed_on : input.signedOn,
        next.terminatedOn,
        input.terminationReason === undefined
          ? old.termination_reason
          : input.terminationReason,
        next.employerSignerRole,
      ],
    );
    const contract = await select(client, context, id);
    await notifyEmployeeOfEmploymentContract(client, context, contract, "updated");
    return mapForContext(contract, context);
  });
}

export async function deleteContract(context: ContractsContext, id: string) {
  return withTenantContext(context, async (client) => {
    const row = await select(client, context, id);
    await assertEditable(client, context, row.province_id);
    const result = await client.query(
      "DELETE FROM contracts WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id],
    );
    if (!result.rowCount) throw new NotFoundError("Contract not found");
  });
}

export async function summary(context: ContractsContext) {
  const contracts = await listContracts(context, {});
  const today = new Date().toISOString().slice(0, 10);
  const deadline = new Date(Date.now() + 60 * 86400000)
    .toISOString()
    .slice(0, 10);
  const active = contracts.filter((contract) => contract.status === "active");
  const activeValueByCurrency = Object.entries(
    active.reduce<Record<string, number>>((totals, contract) => {
      if (contract.contractValue !== null && contract.currency)
        totals[contract.currency] =
          (totals[contract.currency] ?? 0) + contract.contractValue;
      return totals;
    }, {}),
  ).map(([currency, value]) => ({ currency, value }));
  return {
    metrics: {
      total: contracts.length,
      active: active.length,
      pending: contracts.filter((contract) =>
        ["draft", "pending_signature"].includes(contract.status),
      ).length,
      expiring: contracts.filter(
        (contract) =>
          contract.status === "active" &&
          contract.endsOn &&
          contract.endsOn >= today &&
          contract.endsOn <= deadline,
      ).length,
      activeValueByCurrency,
    },
  };
}

/** A self-scoped list for the employee's personal account. */
export async function listMyContracts(context: ContractsContext) {
  return withTenantContext(context, async (client) => {
    const employeeId = await ownEmployeeId(client, context);
    const result = await client.query<MyContractRow>(
      `SELECT c.id,c.reference,c.title,c.contract_type,c.starts_on::text,
              c.ends_on::text,c.auto_renews,c.renewal_notice_days,c.currency,
              c.contract_value::text,c.payment_terms,c.status,c.document_id,
              d.title AS document_title,d.file_name AS document_file_name,
              c.signed_on::text,c.terminated_on::text,c.termination_reason,
              c.employee_signature_name,c.employee_signed_at::text,c.updated_at
         FROM contracts c
         LEFT JOIN documents d ON d.organization_id=c.organization_id AND d.id=c.document_id
        WHERE c.organization_id=$1
          AND c.employee_id=$2
          AND c.contract_type='employment'
          AND c.status NOT IN ('draft','cancelled')
        ORDER BY CASE WHEN c.status='active' THEN 0 ELSE 1 END,
                 c.starts_on DESC,c.updated_at DESC`,
      [context.organizationId, employeeId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      title: row.title,
      contractType: row.contract_type,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      autoRenews: row.auto_renews,
      renewalNoticeDays: row.renewal_notice_days,
      currency: row.currency,
      contractValue:
        row.contract_value === null ? null : Number(row.contract_value),
      paymentTerms: row.payment_terms,
      status: row.status,
      document: row.document_id
        ? {
            id: row.document_id,
            title: row.document_title,
            fileName: row.document_file_name,
          }
        : null,
      signedOn: row.signed_on,
      terminatedOn: row.terminated_on,
      terminationReason: row.termination_reason,
      signatureName: row.employee_signature_name,
      signedAt: row.employee_signed_at,
      updatedAt: row.updated_at,
    }));
  });
}

/** Allows an employee to download only the file explicitly linked to their own
 * non-draft employment contract. This does not grant general document access. */
export async function myContractDocument(
  context: ContractsContext,
  contractId: string,
  options: { regenerateLayout?: boolean } = {},
) {
  return withTenantContext(context, async (client) => {
    const employeeId = await ownEmployeeId(client, context);
    const result = await client.query<ContractDocumentRow>(
      `SELECT c.id,c.reference,c.document_id,d.title,d.file_name,d.mime_type,d.storage_path
         FROM contracts c
         JOIN documents d ON d.organization_id=c.organization_id AND d.id=c.document_id
        WHERE c.organization_id=$1
          AND c.id=$2
          AND c.employee_id=$3
          AND c.contract_type='employment'
          AND c.status NOT IN ('draft','cancelled')`,
      [context.organizationId, contractId, employeeId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Employment contract document not found");

    const versionResult = await client.query<WorkspaceVersionRow>(
      `SELECT id,contract_id,version_number,template_id,source_document_id,rendered_document_id,final_document_id,status,rendered_content,document_hash_sha256,frozen_at::text,created_at::text
         FROM contract_document_versions
        WHERE organization_id=$1 AND contract_id=$2
        ORDER BY version_number DESC LIMIT 1`,
      [context.organizationId, contractId],
    );
    const version = versionResult.rows[0] ?? null;
    const hasPendingCountersignature =
      !version?.final_document_id &&
      version?.rendered_document_id === row.document_id &&
      ["awaiting_employee_signature", "awaiting_employer_signature"].includes(version?.status ?? "");
    const regenerated = (hasPendingCountersignature || options.regenerateLayout) && version
      ? await renderWorkspacePdf(client, context, version, row.title, row.reference)
      : null;

    if (regenerated) {
      const fileName = hasPendingCountersignature && regenerated.hasCompletedSignature
        ? row.file_name.replace(/\.pdf$/i, "") + "-pending-countersignature.pdf"
        : row.file_name;
      return {
        document: { id: row.document_id, title: row.title, fileName, mimeType: row.mime_type },
        // Preview rendering is deliberately fresh: layout changes never leave a
        // browser viewing a previously stored PDF, without mutating signed files.
        buffer: regenerated.buffer,
      };
    }

    return {
      document: { id: row.document_id, title: row.title, fileName: row.file_name, mimeType: row.mime_type },
      buffer: await readPrivateDocument(row.storage_path),
    };
  });
}/**
 * Employee-only electronic acknowledgement. The browser can never choose an
 * employee or contract owner: both are resolved from the authenticated member.
 */
export async function signMyEmploymentContract(
  context: ContractsContext,
  contractId: string,
  input: { acknowledged: boolean },
) {
  void input;
  return withTenantContext(context, async (client) => {
    const employeeId = await ownEmployeeId(client, context);
    const candidate = await client.query<{
      id: string;
      title: string;
      reference: string;
      status: string;
      document_id: string | null;
      owner_member_id: string | null;
      employee_signed_by_member_id: string | null;
      employee_signature_name: string | null;
      signed_on: string | null;
      employee_name: string;
    }>(
      `SELECT c.id,c.title,c.reference,c.status,c.document_id,c.owner_member_id,
              c.employee_signed_by_member_id,c.employee_signature_name,
              c.signed_on::text,e.full_name AS employee_name
         FROM contracts c
         JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id
        WHERE c.organization_id=$1
          AND c.id=$2
          AND c.employee_id=$3
          AND c.contract_type='employment'`,
      [context.organizationId, contractId, employeeId],
    );
    const current = candidate.rows[0];
    if (!current) throw new NotFoundError("Employment contract not found");
    if (
      current.status === "active" &&
      current.employee_signed_by_member_id === context.memberId
    ) {
      return {
        id: current.id,
        status: current.status,
        signedOn: current.signed_on,
        signatureName: current.employee_signature_name,
        alreadySigned: true,
      };
    }
    if (!["pending_signature", "active"].includes(current.status))
      throw new BadRequestError("This contract is not available for your signature");
    if (!current.document_id)
      throw new BadRequestError(
        "A signed contract file must be attached before the employee can sign",
      );

    const updated = await client.query<{
      id: string;
      title: string;
      reference: string;
      status: string;
      signed_on: string;
      owner_member_id: string | null;
      employee_signature_name: string;
      employee_signed_at: Date;
    }>(
      `UPDATE contracts
          SET status=CASE WHEN status='pending_signature' THEN 'active' ELSE status END,
              signed_on=COALESCE(signed_on,CURRENT_DATE),
              employee_signed_by_member_id=$4,
              employee_signature_name=$5,
              employee_signed_at=now()
        WHERE organization_id=$1 AND id=$2 AND employee_id=$3
          AND contract_type='employment'
          AND status IN ('pending_signature','active')
          AND employee_signed_at IS NULL
      RETURNING id,title,reference,status,signed_on::text,owner_member_id,
                employee_signature_name,employee_signed_at`,
      [
        context.organizationId,
        contractId,
        employeeId,
        context.memberId,
        current.employee_name,
      ],
    );
    const signed = updated.rows[0];
    if (!signed)
      throw new BadRequestError("This contract is no longer available for your signature");

    await client.query(
      `INSERT INTO audit_log
         (organization_id,user_id,member_id,actor_email,actor_name,action,
          entity_table,entity_id,entity_label,changes,severity)
       SELECT $1,$2,$3,u.email,u.full_name,'approve','contracts',$4,$5,$6::jsonb,'notice'
         FROM users u WHERE u.id=$2`,
      [
        context.organizationId,
        context.userId,
        context.memberId,
        signed.id,
        signed.title,
        JSON.stringify({
          event: "employment_contract_signed",
          reference: signed.reference,
          signedOn: signed.signed_on,
          signatureName: signed.employee_signature_name,
        }),
      ],
    );
    if (signed.owner_member_id && signed.owner_member_id !== context.memberId) {
      await createNotificationInTransaction(client, {
        organizationId: context.organizationId,
        recipientMemberId: signed.owner_member_id,
        recipientEmployeeId: null,
        actorUserId: context.userId,
        provinceId: null,
        category: "contract",
        type: "employment_contract_signed",
        priority: "normal",
        title: "Employment contract signed",
        message: `${current.employee_name} signed ${signed.title} (${signed.reference}).`,
        actionUrl: "/contracts",
        entityType: "contract",
        entityId: signed.id,
        deduplicationKey: `employment-contract-signed:${signed.id}:${context.memberId}`,
      });
    }
    return {
      id: signed.id,
      status: signed.status,
      signedOn: signed.signed_on,
      signatureName: signed.employee_signature_name,
      signedAt: signed.employee_signed_at,
      alreadySigned: false,
    };
  });
}
type WorkspaceVersionRow = {
  id: string; contract_id: string; version_number: number; template_id: string | null;
  source_document_id: string | null; rendered_document_id: string | null; final_document_id: string | null;
  status: string; rendered_content: { blocks?: WorkspaceBlock[] }; document_hash_sha256: string | null;
  frozen_at: string | null; created_at: string;
};
type WorkspaceFieldRow = {
  id: string; version_id: string; signer_role: "employee" | "employer"; label: string;
  page_number: number; x: string; y: string; width: string; height: string; field_order: number;
  is_required: boolean; status: string; signed_name: string | null; signature_method: string | null;
  signed_at: string | null;
  signature_data: string | null;
};
type WorkspaceBlock = { type: "heading" | "paragraph" | "table" | "page_break"; text?: string; rows?: string[][] };

type TemplateRow = { id: string; code: string; name: string; contract_type: string; language: string; body: { blocks?: WorkspaceBlock[] }; is_active: boolean; created_at: string; updated_at: string };

function contractMergeValues(contract: ContractRow, employee: { full_name: string | null; employee_number: string | null; job_title: string | null; site_name: string | null } | undefined, company: { name: string; address: string }) {
  return {
    "company.name": company.name,
    "company.address": company.address,
    "employee.fullName": employee?.full_name ?? contract.employee_name ?? "",
    "employee.employeeNumber": employee?.employee_number ?? "",
    "employee.jobTitle": employee?.job_title ?? "",
    "employee.workLocation": employee?.site_name ?? contract.province_name ?? "",
    "contract.startDate": contract.starts_on ?? "",
    "contract.endDate": contract.ends_on ?? "",
    "contract.salary": contract.contract_value ?? "",
    "contract.currency": contract.currency ?? "",
    "contract.reference": contract.reference,
    "contract.title": contract.title,
    "contract.employerSignerRole": contract.employer_signer_role ?? "",
  };
}
function substituteMerge(value: string, values: Record<string, string>) {
  return value.replace(/{{\s*([a-zA-Z]+\.[a-zA-Z]+)\s*}}/g, (_match, key: string) => values[key] ?? "");
}
function renderBlocks(blocks: WorkspaceBlock[], values: Record<string, string>): WorkspaceBlock[] {
  return blocks.map((block) => ({
    ...block,
    text: block.text ? substituteMerge(block.text, values) : undefined,
    rows: block.rows?.map((row) => row.map((cell) => substituteMerge(cell, values))),
  }));
}
function wrappedLines(text: string, max = 86): string[] {
  const words = text.replace(/\r/g, "").split(/\s+/).filter(Boolean);
  const lines: string[] = []; let line = "";
  for (const word of words) { if ((line ? `${line} ${word}` : word).length > max && line) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word; }
  if (line) lines.push(line); return lines.length ? lines : [""];
}
/**
 * A company logo is a branding asset rather than a contract attachment. It is
 * deliberately fetched only from Cloudinary, where LiteHubs stores company
 * logos. This prevents a profile URL from becoming a server-side request to an
 * arbitrary/private host when a contract PDF is generated.
 */
async function companyLogo(url: string | null | undefined): Promise<{ bytes: Uint8Array; kind: "png" | "jpg" } | null> {
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
    // A logo must never prevent a legally important contract from being made.
    return null;
  }
}


function companyInitials(companyName: string) {
  const initials = companyName.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || "CO";
}

type SignatureRole = "employee" | "employer";
type SignatureSlot = { pageNumber: number; x: number; y: number; width: number; height: number };
type ContractPdfBranding = { companyName: string; reference: string; logoUrl?: string | null };
type SignatureRequirements = Record<SignatureRole, number>;

/** A signature never belongs on a flowing text page. These coordinates point to
 * a dedicated signing sheet added after the contractual clauses. */
function signatureSlot(role: SignatureRole, index: number, pageNumber: number): SignatureSlot {
  return {
    pageNumber,
    x: role === "employee" ? 70 : 330,
    y: 455 - index * 58,
    width: 195,
    height: 46,
  };
}

function controlledSignatureFields<T extends { signerRole: SignatureRole }>(fields: T[], pageNumber: number) {
  const counts: Record<SignatureRole, number> = { employee: 0, employer: 0 };
  return fields.map((field) => {
    const index = counts[field.signerRole]++;
    return { ...field, ...signatureSlot(field.signerRole, index, pageNumber) };
  });
}

function signatureRequirements<T extends { signerRole?: SignatureRole; signer_role?: SignatureRole }>(fields: T[]): SignatureRequirements {
  const counts: SignatureRequirements = { employee: 0, employer: 0 };
  for (const field of fields) {
    const role = field.signerRole ?? field.signer_role;
    if (role === "employee" || role === "employer") counts[role] += 1;
  }
  return counts;
}
function storedSignatureSlots(fields: WorkspaceFieldRow[], pageNumber: number) {
  const counts: Record<SignatureRole, number> = { employee: 0, employer: 0 };
  const positions = new Map<string, SignatureSlot>();
  for (const field of fields) {
    const role: SignatureRole = field.signer_role === "employer" ? "employer" : "employee";
    positions.set(field.id, signatureSlot(role, counts[role]++, pageNumber));
  }
  return positions;
}

async function contractPdf(blocks: WorkspaceBlock[], title: string, referenceText: string, companyName: string, logoUrl?: string | null, signaturePlan: SignatureRequirements = { employee: 1, employer: 1 }): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fetchedLogo = await companyLogo(logoUrl);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 54;
  const ink = rgb(0.10, 0.14, 0.20);
  const muted = rgb(.34, .40, .48);
  const accent = rgb(.04, .43, .35);
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 58;
  const hasDocumentHeading = blocks.some((block) => block.type === "heading" && Boolean(block.text?.trim()));

  const drawHeader = (
    target: PDFPage,
    headerLogo: PDFImage | null,
    headerFont: PDFFont,
    headerBold: PDFFont,
  ) => {
    target.drawRectangle({ x: 0, y: pageHeight - 82, width: pageWidth, height: 82, color: rgb(.965, .98, .975) });
    target.drawRectangle({ x: 0, y: pageHeight - 5, width: pageWidth, height: 5, color: accent });
    const company = companyName.toLocaleUpperCase("fr-FR").slice(0, 62);
    const reference = referenceText.slice(0, 62);
    if (headerLogo) {
      const scale = Math.min(54 / headerLogo.width, 54 / headerLogo.height);
      const width = headerLogo.width * scale;
      const height = headerLogo.height * scale;
      target.drawImage(headerLogo, { x: margin, y: pageHeight - 72 + (54 - height) / 2, width, height, opacity: 1 });
    } else {
      target.drawCircle({ x: margin + 19, y: pageHeight - 45, size: 19, color: accent });
      const initials = companyInitials(companyName);
      const initialsWidth = headerBold.widthOfTextAtSize(initials, 8.5);
      target.drawText(initials, { x: margin + 19 - initialsWidth / 2, y: pageHeight - 48, size: 8.5, font: headerBold, color: rgb(1, 1, 1) });
    }
    const companyWidth = headerBold.widthOfTextAtSize(company, 13);
    target.drawText(company, {
      x: Math.max(margin + 82, pageWidth - margin - companyWidth),
      y: pageHeight - 32,
      size: 13,
      font: headerBold,
      color: rgb(.03, .22, .17),
      opacity: 1,
    });
    if (reference) {
      const referenceLabel = `Réf. ${reference}`;
      const referenceWidth = headerFont.widthOfTextAtSize(referenceLabel, 8);
      target.drawText(referenceLabel, {
        x: Math.max(margin + 82, pageWidth - margin - referenceWidth),
        y: pageHeight - 51,
        size: 8,
        font: headerFont,
        color: muted,
        opacity: 1,
      });
    }
  };

  const drawPageFrame = (firstPage: boolean) => {
    page.drawRectangle({ x: 0, y: pageHeight - 82, width: pageWidth, height: 82, color: rgb(.965, .98, .975) });
    page.drawRectangle({ x: 0, y: pageHeight - 5, width: pageWidth, height: 5, color: accent });
    y = pageHeight - 106;    if (firstPage && !hasDocumentHeading) {
      for (const line of wrappedLines(title, 48)) {
        page.drawText(line.slice(0, 130), { x: margin, y, size: 18, font: bold, color: ink });
        y -= 24;
      }
      y -= 8;
    } else if (!firstPage) {
      page.drawText(title.slice(0, 88), { x: margin, y, size: 10, font: bold, color: ink });
      y -= 20;
    }
  };
  const nextPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    drawPageFrame(false);
  };
  const ensure = (height: number) => { if (y - height < 62) nextPage(); };
  const drawLines = (value: string, size: number, strong = false, indent = 0, continuationIndent = 0) => {
    const lines = wrappedLines(value, size > 13 ? 56 : Math.max(58, 88 - Math.round(indent / 4)));
    for (const [index, line] of lines.entries()) {
      ensure(size + 7);
      page.drawText(line.slice(0, 180), {
        x: margin + indent + (index ? continuationIndent : 0),
        y,
        size,
        font: strong ? bold : font,
        color: ink,
      });
      y -= size + (size > 13 ? 7 : 6);
    }
  };
  const drawParagraph = (value: string) => {
    const lines = value.replace(/\r/g, "").replace(/\*\*/g, "").split(/\n+/).map((line) => line.trim());
    for (const line of lines) {
      if (!line || /^---+$/.test(line)) { y -= 8; continue; }
      const list = line.match(/^(\d+[.)]|[-•])\s+(.+)$/);
      if (list) {
        drawLines(`${list[1]} ${list[2]}`, 10, false, 8, 12);
        y -= 3;
      } else {
        drawLines(line, 10.5);
        y -= 8;
      }
    }
    y -= 4;
  };

  drawPageFrame(true);
  let firstDocumentHeading = true;
  for (const block of blocks) {
    if (block.type === "page_break") { nextPage(); continue; }
    if (block.type === "heading") {
      y -= firstDocumentHeading ? 8 : 6;
      // The first heading is the legal document title (for example
      // “CONTRAT DE TRAVAIL”). Give it a clear hierarchy without making the
      // following section titles oversized.
      drawLines((block.text ?? "").replace(/\*\*/g, ""), firstDocumentHeading ? 18 : 14, true);
      y -= firstDocumentHeading ? 11 : 8;
      firstDocumentHeading = false;
      continue;
    }
    if (block.type === "table") {
      for (const [rowIndex, row] of (block.rows ?? []).entries()) {
        drawLines(row.join("   |   "), 9.5, rowIndex === 0);
        y -= 3;
      }
      y -= 7;
      continue;
    }
    drawParagraph(block.text ?? "");
  }

    // Keep signatures on their own controlled page. Only the fields selected
  // for this contract are printed; unused “employee 2…6” slots never appear.
  if (signaturePlan.employee + signaturePlan.employer > 0) {
        nextPage();
    for (const role of ["employee", "employer"] as const) {
      const count = Math.max(0, Math.min(6, signaturePlan[role]));
      for (let index = 0; index < count; index += 1) {
        const slot = signatureSlot(role, index, pdf.getPageCount());
        const roleLabel = role === "employee" ? "Signature employé" : "Contre-signature employeur";
        const heading = count > 1 ? `${roleLabel} ${index + 1}` : roleLabel;
        page.drawText(heading, { x: slot.x, y: slot.y + slot.height + 8, size: 6.5, font: bold, color: muted });
        page.drawLine({ start: { x: slot.x, y: slot.y + 8 }, end: { x: slot.x + slot.width, y: slot.y + 8 }, thickness: .55, color: rgb(.55, .62, .62) });
      }
    }
  }

  // Stamp the header after the complete document has been laid out so every
  // content and signature page receives the same header with no watermark.
  const finalized = await PDFDocument.load(await pdf.save());
  const headerFont = await finalized.embedFont(StandardFonts.Helvetica);
  const headerBold = await finalized.embedFont(StandardFonts.HelveticaBold);
  let headerLogo: PDFImage | null = null;
  if (fetchedLogo) {
    try {
      headerLogo = fetchedLogo.kind === "png"
        ? await finalized.embedPng(fetchedLogo.bytes)
        : await finalized.embedJpg(fetchedLogo.bytes);
    } catch {
      headerLogo = null;
    }
  }
  const pages = finalized.getPages();
  for (const [index, current] of pages.entries()) {
    drawHeader(current, headerLogo, headerFont, headerBold);
    current.drawLine({ start: { x: margin, y: 40 }, end: { x: pageWidth - margin, y: 40 }, thickness: .5, color: rgb(.82, .86, .87) });
    const pageNumber = `${index + 1} / ${pages.length}`;
    current.drawText(pageNumber, { x: pageWidth - margin - headerFont.widthOfTextAtSize(pageNumber, 7), y: 27, size: 7, font: headerFont, color: muted });
  }
  return Buffer.from(await finalized.save());
}async function employeeDetails(client: PoolClient, organizationId: string, employeeId: string | null) {
  if (!employeeId) return undefined;
  const result = await client.query<{ full_name: string | null; employee_number: string | null; job_title: string | null; site_name: string | null }>(
    `SELECT e.full_name,e.employee_number,e.job_title,s.name AS site_name FROM employees e
       LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id
      WHERE e.organization_id=$1 AND e.id=$2`, [organizationId, employeeId]);
  return result.rows[0];
}
async function addWorkspaceEvent(client: PoolClient, context: ContractsContext, contractId: string, versionId: string | null, fieldId: string | null, eventType: string, detail: unknown) {
  await client.query(`INSERT INTO contract_signature_events (organization_id,contract_id,version_id,signature_field_id,actor_user_id,actor_member_id,event_type,detail)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [context.organizationId, contractId, versionId, fieldId, context.userId, context.memberId, eventType, JSON.stringify(detail ?? {})]);
}
async function versionFor(client: PoolClient, organizationId: string, contractId: string, versionId?: string) {
  const result = await client.query<WorkspaceVersionRow>(`SELECT id,contract_id,version_number,template_id,source_document_id,rendered_document_id,final_document_id,status,rendered_content,document_hash_sha256,frozen_at::text,created_at::text
    FROM contract_document_versions WHERE organization_id=$1 AND contract_id=$2 ${versionId ? "AND id=$3" : ""} ORDER BY version_number DESC LIMIT 1`, versionId ? [organizationId, contractId, versionId] : [organizationId, contractId]);
  const row = result.rows[0]; if (!row) throw new NotFoundError("Contract document version not found"); return row;
}
async function fieldsFor(client: PoolClient, organizationId: string, versionId: string) {
  const result = await client.query<WorkspaceFieldRow>(`SELECT id,version_id,signer_role,label,page_number,x::text,y::text,width::text,height::text,field_order,is_required,status,signed_name,signature_method,signed_at::text,signature_data
    FROM contract_signature_fields WHERE organization_id=$1 AND version_id=$2 ORDER BY signer_role,field_order`, [organizationId, versionId]); return result.rows;
}
function workspaceField(row: WorkspaceFieldRow) { return { id: row.id, signerRole: row.signer_role, label: row.label, pageNumber: row.page_number, x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height), order: row.field_order, required: row.is_required, status: row.status, signedName: row.signed_name, method: row.signature_method, signedAt: row.signed_at }; }

/** Rebuilds a preview from the frozen workspace blocks. It never updates the
 * immutable stored document; it only prevents a browser from seeing stale
 * layout or branding assets after a generator improvement. */
async function renderWorkspacePdf(
  client: PoolClient,
  context: ContractsContext,
  version: WorkspaceVersionRow,
  title: string,
  reference: string,
): Promise<{ buffer: Buffer; hasCompletedSignature: boolean } | null> {
  const blocks = version.rendered_content?.blocks;
  if (!blocks?.length) return null;
  const fields = await fieldsFor(client, context.organizationId, version.id);
  const organization = await client.query<{ display_name: string | null; logo_url: string | null }>(
    "SELECT o.display_name, settings.logo_url FROM organizations o LEFT JOIN organization_settings settings ON settings.organization_id=o.id WHERE o.id=$1",
    [context.organizationId],
  );
  const branding: ContractPdfBranding = {
    companyName: organization.rows[0]?.display_name?.trim() || "LiteHubs",
    reference,
    logoUrl: organization.rows[0]?.logo_url ?? null,
  };
  const layout = await contractPdf(blocks, title, reference, branding.companyName, branding.logoUrl, signatureRequirements(fields));
  const hasCompletedSignature = fields.some((field) => field.status === "signed");
  return {
    hasCompletedSignature,
    buffer: hasCompletedSignature
      ? await renderPdfWithSignedFields(layout, fields, { branding, signaturePageReady: true })
      : layout,
  };
}

export async function listContractTemplates(context: ContractsContext) {
  return withTenantContext(context, async (client) => {
    await assertEditable(client, context, null);
    const result = await client.query<TemplateRow>(`SELECT id,code,name,contract_type,language,body,is_active,created_at::text,updated_at::text FROM contract_templates WHERE organization_id=$1 ORDER BY is_active DESC,name`, [context.organizationId]);
    return result.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, contractType: row.contract_type, language: row.language, body: row.body, isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at }));
  });
}
export async function createContractTemplate(context: ContractsContext, input: import("./contracts.validation").ContractTemplateInput) {
  return withTenantContext(context, async (client) => {
    await assertEditable(client, context, null);
    const result = await client.query<TemplateRow>(`INSERT INTO contract_templates (organization_id,code,name,contract_type,language,body,is_active,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8) RETURNING id,code,name,contract_type,language,body,is_active,created_at::text,updated_at::text`, [context.organizationId,input.code,input.name,input.contractType,input.language,JSON.stringify(input.body),input.isActive ?? true,context.userId]);
    const row=result.rows[0]!; return { id:row.id,code:row.code,name:row.name,contractType:row.contract_type,language:row.language,body:row.body,isActive:row.is_active,createdAt:row.created_at,updatedAt:row.updated_at };
  });
}
export async function updateContractTemplate(context: ContractsContext, templateId: string, input: import("./contracts.validation").ContractTemplateInput) {
  return withTenantContext(context, async (client) => {
    await assertEditable(client, context, null);
    const result = await client.query<TemplateRow>(
      `UPDATE contract_templates
          SET code=$3,name=$4,contract_type=$5,language=$6,body=$7::jsonb,
              is_active=$8,updated_by=$9,updated_at=now()
        WHERE organization_id=$1 AND id=$2
        RETURNING id,code,name,contract_type,language,body,is_active,created_at::text,updated_at::text`,
      [context.organizationId, templateId, input.code, input.name, input.contractType,
        input.language, JSON.stringify(input.body), input.isActive ?? true, context.userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Contract template not found");
    return { id: row.id, code: row.code, name: row.name, contractType: row.contract_type,
      language: row.language, body: row.body, isActive: row.is_active,
      createdAt: row.created_at, updatedAt: row.updated_at };
  });
}
export async function contractWorkspace(context: ContractsContext, contractId: string) {
  return withTenantContext(context, async (client) => {
    const contract=await select(client,context,contractId); await assertEditable(client,context,contract.province_id);
    const versions=await client.query<WorkspaceVersionRow>(`SELECT id,contract_id,version_number,template_id,source_document_id,rendered_document_id,final_document_id,status,rendered_content,document_hash_sha256,frozen_at::text,created_at::text FROM contract_document_versions WHERE organization_id=$1 AND contract_id=$2 ORDER BY version_number DESC`,[context.organizationId,contractId]);
    const current=versions.rows[0] ?? null; const currentFields=current ? await fieldsFor(client,context.organizationId,current.id) : [];
    const events=await client.query<{id:string;event_type:string;detail:unknown;created_at:string;actor_name:string|null}>(`SELECT e.id,e.event_type,e.detail,e.created_at::text,u.full_name AS actor_name FROM contract_signature_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.organization_id=$1 AND e.contract_id=$2 ORDER BY e.created_at DESC LIMIT 100`,[context.organizationId,contractId]);
    return { contract:mapForContext(contract, context), versions:versions.rows.map((row)=>({id:row.id,number:row.version_number,status:row.status,templateId:row.template_id,sourceDocumentId:row.source_document_id,renderedDocumentId:row.rendered_document_id,finalDocumentId:row.final_document_id,hash:row.document_hash_sha256,frozenAt:row.frozen_at,createdAt:row.created_at})), currentVersion:current ? {id:current.id,number:current.version_number,status:current.status,blocks:(current.rendered_content?.blocks ?? []) as WorkspaceBlock[],fields:currentFields.map(workspaceField)} : null, events:events.rows.map((event)=>({id:event.id,type:event.event_type,detail:event.detail,createdAt:event.created_at,actorName:event.actor_name})) };
  });
}
export async function generateContractDocumentVersion(context: ContractsContext, contractId: string, input: import("./contracts.validation").GenerateContractVersionInput) {
  return withTenantContext(context, async (client) => {
    const contract=await select(client,context,contractId); await assertEditable(client,context,contract.province_id);
    let body=input.body ?? null; let templateId=input.templateId ?? null; let sourceDocumentId=input.sourceDocumentId ?? null;
    if (templateId) { const found=await client.query<TemplateRow>(`SELECT id,code,name,contract_type,language,body,is_active,created_at::text,updated_at::text FROM contract_templates WHERE organization_id=$1 AND id=$2 AND is_active`,[context.organizationId,templateId]); if (!found.rows[0]) throw new BadRequestError("Choose an active template in this company",{field:"templateId"}); if (found.rows[0].contract_type!==contract.contract_type) throw new BadRequestError("Choose a template that matches the contract type",{field:"templateId"}); body={ blocks: found.rows[0].body.blocks ?? [] }; }
    const employee=await employeeDetails(client,context.organizationId,contract.employee_id);
    const organization=await client.query<{display_name:string|null;address_line1:string|null;address_line2:string|null;city:string|null;region:string|null;postal_code:string|null;logo_url:string|null}>("SELECT o.display_name,o.address_line1,o.address_line2,o.city,o.region,o.postal_code,settings.logo_url FROM organizations o LEFT JOIN organization_settings settings ON settings.organization_id=o.id WHERE o.id=$1",[context.organizationId]);
    const organizationRow=organization.rows[0];
    const companyName=organizationRow?.display_name?.trim() || "Entreprise";
    const companyAddress=[organizationRow?.address_line1,organizationRow?.address_line2,organizationRow?.city,organizationRow?.region,organizationRow?.postal_code].filter((part): part is string => Boolean(part && part.trim())).join(", ");
    let documentId: string;
    let rendered: { blocks: WorkspaceBlock[] };
    if (sourceDocumentId) {
      const source=await client.query<{id:string;mime_type:string}>(`SELECT id,mime_type FROM documents WHERE organization_id=$1 AND id=$2`,[context.organizationId,sourceDocumentId]);
      if (!source.rows[0]) throw new BadRequestError("Choose an uploaded PDF from this company",{field:"sourceDocumentId"});
      if (source.rows[0].mime_type!=="application/pdf") throw new BadRequestError("Upload or choose a PDF contract document for electronic signature",{field:"sourceDocumentId"});
      documentId=source.rows[0].id; rendered={blocks:[]};
    } else {
      if (!body?.blocks?.length) throw new BadRequestError("Add contract content before generating a document",{field:"body"});
      rendered={blocks:renderBlocks(body.blocks,contractMergeValues(contract,employee,{name:companyName,address:companyAddress}))};
      const pdf=await contractPdf(rendered.blocks,contract.title,contract.reference,companyName,organizationRow?.logo_url ?? null,signatureRequirements(input.signatureFields));
      const stored=await storePrivateDocument({organizationId:context.organizationId,originalName:`${contract.reference}-v${Date.now()}.pdf`,mimeType:"application/pdf",buffer:pdf});
      const doc=await client.query<{id:string}>(`INSERT INTO documents (organization_id,title,description,category,storage_path,file_name,mime_type,size_bytes,checksum_sha256,subject_table,subject_id,province_id,is_confidential,uploaded_by) VALUES ($1,$2,$3,'contract',$4,$5,'application/pdf',$6,$7,'contracts',$8,$9,true,$10) RETURNING id`,[context.organizationId,`${contract.title} · brouillon`,"Version générée depuis le modèle de la société",stored.storagePath,`${contract.reference}-draft.pdf`,stored.bytes,stored.checksumSha256,contractId,contract.province_id,context.userId]);
      documentId=doc.rows[0]!.id;
    }
    const numberResult=await client.query<{number:number}>(`SELECT COALESCE(MAX(version_number),0)+1 AS number FROM contract_document_versions WHERE organization_id=$1 AND contract_id=$2`,[context.organizationId,contractId]);
    const version=await client.query<{id:string}>(`INSERT INTO contract_document_versions (organization_id,contract_id,version_number,template_id,source_document_id,rendered_document_id,status,rendered_content,created_by) VALUES ($1,$2,$3,$4,$5,$5,'draft',$6::jsonb,$7) RETURNING id`,[context.organizationId,contractId,numberResult.rows[0]!.number,templateId,documentId,JSON.stringify(rendered),context.userId]);
    const renderedDocument = await client.query<{ storage_path: string }>(
      `SELECT storage_path FROM documents WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, documentId],
    );
    if (!renderedDocument.rows[0]) throw new NotFoundError("Contract PDF not found");
    const renderedPdf = await PDFDocument.load(await readPrivateDocument(renderedDocument.rows[0].storage_path));
    // Template PDFs already include a dedicated signature page. An uploaded
    // source PDF receives its signing sheet only when the signed copy is made.
    const signaturePageNumber = sourceDocumentId
      ? renderedPdf.getPageCount() + 1
      : renderedPdf.getPageCount();
    const signatureFields = controlledSignatureFields(input.signatureFields, signaturePageNumber);
    for (const field of signatureFields) await client.query(`INSERT INTO contract_signature_fields (organization_id,version_id,signer_role,label,page_number,x,y,width,height,field_order,is_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[context.organizationId,version.rows[0]!.id,field.signerRole,field.label,field.pageNumber,field.x,field.y,field.width,field.height,field.fieldOrder,field.isRequired]);
    await addWorkspaceEvent(client,context,contractId,version.rows[0]!.id,null,"version_generated",{templateId,versionNumber:numberResult.rows[0]!.number}); return contractWorkspace(context,contractId);
  });
}
export async function sendContractForSignature(context: ContractsContext, contractId: string, input: import("./contracts.validation").SendForSignatureInput) {
  return withTenantContext(context, async (client) => {
    const contract=await select(client,context,contractId); await assertEditable(client,context,contract.province_id); if (contract.contract_type!=="employment" || !contract.employee_id) throw new BadRequestError("Electronic employee signing is available for employment contracts with an employee",{field:"employeeId"});
    const version=await versionFor(client,context.organizationId,contractId,input.versionId); if (version.status!=="draft") throw new BadRequestError("Only a draft version can be sent for signature"); const fields=await fieldsFor(client,context.organizationId,version.id);
    if (!fields.some((field)=>field.signer_role==="employee" && field.is_required) || !fields.some((field)=>field.signer_role==="employer" && field.is_required)) throw new BadRequestError("Add at least one required employee and employer signature field",{field:"signatureFields"});
    const source=await client.query<{mime_type:string}>(`SELECT mime_type FROM documents WHERE organization_id=$1 AND id=$2`,[context.organizationId,version.rendered_document_id]); if (source.rows[0]?.mime_type!=="application/pdf") throw new BadRequestError("Only a secure PDF contract can be sent for signature");
    await client.query(`UPDATE contract_document_versions SET status='awaiting_employee_signature',frozen_at=now() WHERE organization_id=$1 AND id=$2`,[context.organizationId,version.id]); await client.query(`UPDATE contracts SET status='awaiting_employee_signature',document_id=$3 WHERE organization_id=$1 AND id=$2`,[context.organizationId,contractId,version.rendered_document_id]);
    await addWorkspaceEvent(client,context,contractId,version.id,null,"sent_for_employee_signature",{}); const member=await client.query<{member_id:string|null}>(`SELECT member_id FROM employees WHERE organization_id=$1 AND id=$2`,[context.organizationId,contract.employee_id]); if (member.rows[0]?.member_id) await createNotificationInTransaction(client,{organizationId:context.organizationId,recipientMemberId:member.rows[0].member_id!,recipientEmployeeId:contract.employee_id,actorUserId:context.userId,provinceId:contract.province_id,category:"contract",type:"contract_signature_requested",priority:"high",title:"Contract signature required",message:`${contract.title} (${contract.reference}) is ready for your secure review and signature.`,actionUrl:"/my-account",entityType:"contract",entityId:contractId,deduplicationKey:`contract-signature-request:${version.id}`}); return contractWorkspace(context,contractId);
  });
}
export async function remindContractSignature(context: ContractsContext, contractId: string) {
  return withTenantContext(context, async (client) => {
    const contract = await select(client, context, contractId);
    await assertEditable(client, context, contract.province_id);
    if (contract.contract_type !== "employment" || !contract.employee_id)
      throw new BadRequestError("Choose an employment contract linked to an employee");
    if (contract.status !== "awaiting_employee_signature")
      throw new BadRequestError("This contract is not awaiting the employee signature");
    const version = await versionFor(client, context.organizationId, contractId);
    const employee = await client.query<{ member_id: string | null }>(
      `SELECT member_id FROM employees WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, contract.employee_id],
    );
    const memberId = employee.rows[0]?.member_id;
    if (!memberId)
      throw new BadRequestError("Link and activate the employee LiteHubs account before sending a reminder");
    await createNotificationInTransaction(client, {
      organizationId: context.organizationId,
      recipientMemberId: memberId,
      recipientEmployeeId: contract.employee_id,
      actorUserId: context.userId,
      provinceId: contract.province_id,
      category: "contract",
      type: "contract_signature_reminder",
      priority: "high",
      title: "Contract signature reminder",
      message: `${contract.title} (${contract.reference}) still needs your secure review and signature.`,
      actionUrl: "/my-account",
      entityType: "contract",
      entityId: contractId,
      deduplicationKey: `contract-signature-reminder:${version.id}:${new Date().toISOString().slice(0, 10)}`,
    });
    await addWorkspaceEvent(client, context, contractId, version.id, null, "signature_reminder_sent", {});
    return { sent: true };
  });
}

type SignedPdfRenderOptions = {
  branding?: ContractPdfBranding;
  /** The supplied source was generated by contractPdf and already ends with a signing sheet. */
  signaturePageReady?: boolean;
};

async function appendControlledSignaturePage(pdf: PDFDocument, branding: ContractPdfBranding, fields: WorkspaceFieldRow[]) {
  // Build the sheet with the same logo, header, footer and evidence
  // wording as a regular LiteHubs contract, then append only that final page.
  const template = await PDFDocument.load(
    await contractPdf([], "Signatures électroniques", branding.reference, branding.companyName, branding.logoUrl, signatureRequirements(fields)),
  );
  const [signaturePage] = await pdf.copyPages(template, [template.getPageCount() - 1]);
  pdf.addPage(signaturePage);
}

async function renderPdfWithSignedFields(
  source: Buffer,
  fields: WorkspaceFieldRow[],
  options: SignedPdfRenderOptions = {},
): Promise<Buffer> {
  const pdf = await PDFDocument.load(source);
  const sourcePageCount = pdf.getPageCount();
  // Fields created by the current workspace are placed in the safe area of a
  // final signing sheet. Older records used page 1 / y=88, so deliberately
  // remap those records instead of writing over a clause.
  const fieldsAlreadyOnSigningSheet = fields.length > 0 && fields.every(
    (field) => Number(field.page_number) === sourcePageCount && Number(field.y) >= 100,
  );
  const signaturePageReady = options.signaturePageReady || fieldsAlreadyOnSigningSheet;
  if (!signaturePageReady) {
    await appendControlledSignaturePage(pdf, options.branding ?? {
      companyName: "LiteHubs",
      reference: "",
      logoUrl: null,
    }, fields);
  }  const remappedSlots = fieldsAlreadyOnSigningSheet
    ? null
    : storedSignatureSlots(fields, pdf.getPageCount());
  const font = await pdf.embedFont(StandardFonts.HelveticaOblique);
  for (const field of fields.filter((item) => item.status === "signed")) {
    const slot = remappedSlots?.get(field.id) ?? {
      pageNumber: Number(field.page_number),
      x: Number(field.x),
      y: Number(field.y),
      width: Number(field.width),
      height: Number(field.height),
    };
    const page = pdf.getPages()[slot.pageNumber - 1];
    if (!page) throw new BadRequestError("A signature field refers to an unavailable PDF page");
    const { x, y, width, height } = slot;
    const imageMatch = field.signature_data?.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    const signerName = field.signed_name?.trim() || "Signed signer";
    // The legal name is always printed, including for hand-drawn or uploaded
    // signatures. The template provides the location; the signer provides the name.
    page.drawText(signerName.slice(0, 72), { x: x + 5, y: y + height - 10, size: 8, font, color: rgb(.05, .28, .20) });
    if (imageMatch) {
      const imageBytes = Buffer.from(imageMatch[2]!, "base64");
      const image = imageMatch[1] === "png" ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
      const ratio = Math.min((width - 10) / image.width, Math.max(height - 24, 8) / image.height);
      page.drawImage(image, { x: x + 5, y: y + 10, width: image.width * ratio, height: image.height * ratio });
    } else {
      page.drawText(signerName.slice(0, 72), { x: x + 5, y: y + height / 2 - 5, size: 14, font, color: rgb(.05, .28, .20) });
    }
    page.drawText(`Signed ${new Date(field.signed_at ?? Date.now()).toLocaleString("fr-FR")}`, { x: x + 5, y: y + 3, size: 6, font, color: rgb(.25, .3, .35) });
  }
  return Buffer.from(await pdf.save());
}
async function rebuildSignedContract(client: PoolClient, context: ContractsContext, contract: ContractRow, version: WorkspaceVersionRow) {
  const source = await client.query<{ storage_path: string }>(`SELECT storage_path FROM documents WHERE organization_id=$1 AND id=$2`, [context.organizationId, version.rendered_document_id]);
  if (!source.rows[0]) throw new NotFoundError("Contract PDF not found");
    const fields = await fieldsFor(client, context.organizationId, version.id);
  const organization = await client.query<{ display_name: string | null; logo_url: string | null }>(
    "SELECT o.display_name, settings.logo_url FROM organizations o LEFT JOIN organization_settings settings ON settings.organization_id=o.id WHERE o.id=$1",
    [context.organizationId],
  );
    const branding: ContractPdfBranding = {
    companyName: organization.rows[0]?.display_name?.trim() || "LiteHubs",
    reference: contract.reference,
    logoUrl: organization.rows[0]?.logo_url ?? null,
  };
  // A template version is rendered again from its frozen content. This lets an
  // older pending contract benefit from the current safe layout and company
  // branding without changing a completed/signed version.
  const sourceBytes = version.rendered_content?.blocks?.length
    ? await contractPdf(version.rendered_content.blocks, contract.title, contract.reference, branding.companyName, branding.logoUrl, signatureRequirements(fields))
    : await readPrivateDocument(source.rows[0].storage_path);
  const bytes = await renderPdfWithSignedFields(sourceBytes, fields, {
    branding,
    signaturePageReady: Boolean(version.rendered_content?.blocks?.length),
  });
  const stored = await storePrivateDocument({ organizationId: context.organizationId, originalName: `${contract.reference}-signed.pdf`, mimeType: "application/pdf", buffer: bytes });
  const doc = await client.query<{ id: string }>(`INSERT INTO documents (organization_id,title,description,category,storage_path,file_name,mime_type,size_bytes,checksum_sha256,subject_table,subject_id,province_id,is_confidential,uploaded_by) VALUES ($1,$2,$3,'contract',$4,$5,'application/pdf',$6,$7,'contracts',$8,$9,true,$10) RETURNING id`, [context.organizationId, `${contract.title} · signé`, "Exemplaire final figé avec signatures électroniques", stored.storagePath, `${contract.reference}-signed.pdf`, stored.bytes, stored.checksumSha256, contract.id, contract.province_id, context.userId]);
  await client.query(`UPDATE contract_document_versions SET final_document_id=$3,document_hash_sha256=$4,status='signed',frozen_at=COALESCE(frozen_at,now()) WHERE organization_id=$1 AND id=$2`, [context.organizationId, version.id, doc.rows[0]!.id, stored.checksumSha256]);
  await client.query(`UPDATE contracts SET document_id=$3,status='active',signed_on=COALESCE(signed_on,CURRENT_DATE) WHERE organization_id=$1 AND id=$2`, [context.organizationId, contract.id, doc.rows[0]!.id]);
  return { documentId: doc.rows[0]!.id, hash: stored.checksumSha256 };
}export async function signContractSignatureField(context: ContractsContext, contractId: string, fieldId: string, input: import("./contracts.validation").SignContractFieldInput, signer: "employee" | "employer") {
  return withTenantContext(context, async (client) => {
    let contract: ContractRow; if (signer === "employer") { contract=await select(client,context,contractId); await assertEditable(client,context,contract.province_id); if (!await mayCountersignForEmployer(client, context)) throw new ForbiddenError("Only the owner or a General Manager may countersign an employment contract"); } else { const employeeId=await ownEmployeeId(client,context); contract=await selectOwnEmploymentContract(client,context,contractId,employeeId); }
    const version=await versionFor(client,context.organizationId,contractId); const found=await client.query<WorkspaceFieldRow>(`SELECT id,version_id,signer_role,label,page_number,x::text,y::text,width::text,height::text,field_order,is_required,status,signed_name,signature_method,signed_at::text FROM contract_signature_fields WHERE organization_id=$1 AND id=$2 AND version_id=$3`,[context.organizationId,fieldId,version.id]); const field=found.rows[0]; if (!field || field.signer_role!==signer) throw new NotFoundError("Signature field not found"); if (field.status==="signed") return contractWorkspace(context,contractId);
    if ((signer==="employee" && version.status!=="awaiting_employee_signature") || (signer==="employer" && version.status!=="awaiting_employer_signature")) throw new BadRequestError("This signature is not currently available");
    if (input.method !== "typed" && !input.signatureData) throw new BadRequestError("Draw or upload your signature before signing",{field:"signatureData"});
    if (input.signatureData && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(input.signatureData)) throw new BadRequestError("Use a PNG or JPEG signature image",{field:"signatureData"});
    await client.query(`UPDATE contract_signature_fields SET status='signed',signed_by_member_id=$4,signed_name=$5,signature_method=$6,signature_data=$7,consent_text=$8,signed_at=now() WHERE organization_id=$1 AND id=$2 AND version_id=$3 AND status='pending'`,[context.organizationId,fieldId,version.id,context.memberId,input.legalName,input.method,input.signatureData ?? null,"Electronic signature consent accepted"]); await addWorkspaceEvent(client,context,contractId,version.id,fieldId,`${signer}_signature_added`,{label:field.label,method:input.method});
    const fields=await fieldsFor(client,context.organizationId,version.id); const required=fields.filter((item)=>item.is_required); const employeesDone=required.filter((item)=>item.signer_role==="employee").every((item)=>item.status==="signed"); const employersDone=required.filter((item)=>item.signer_role==="employer").every((item)=>item.status==="signed");
    if (signer==="employee" && employeesDone) { await client.query(`UPDATE contract_document_versions SET status='awaiting_employer_signature' WHERE organization_id=$1 AND id=$2`,[context.organizationId,version.id]); await client.query(`UPDATE contracts SET status='awaiting_employer_signature' WHERE organization_id=$1 AND id=$2`,[context.organizationId,contractId]); if (contract.owner_member_id) await createNotificationInTransaction(client,{organizationId:context.organizationId,recipientMemberId:contract.owner_member_id,recipientEmployeeId:null,actorUserId:context.userId,provinceId:contract.province_id,category:"contract",type:"contract_employer_signature_required",priority:"high",title:"Employer signature required",message:`${contract.title} has been signed by the employee and awaits countersignature.`,actionUrl:"/contracts",entityType:"contract",entityId:contractId,deduplicationKey:`contract-employer-signature:${version.id}`}); }
    if (signer==="employer" && employeesDone && employersDone) { const final=await rebuildSignedContract(client,context,contract,version); await addWorkspaceEvent(client,context,contractId,version.id,null,"contract_finalized",final); }
    return signer === "employee" ? { signed: true } : contractWorkspace(context,contractId);
  });
}
export async function myContractWorkspace(context: ContractsContext, contractId: string) {
  return withTenantContext(context, async (client) => {
    const employeeId=await ownEmployeeId(client,context); const contract=await selectOwnEmploymentContract(client,context,contractId,employeeId); const version=await versionFor(client,context.organizationId,contractId); const fields=await fieldsFor(client,context.organizationId,version.id); return { contract:map(contract), version:{id:version.id,number:version.version_number,status:version.status,documentId:version.final_document_id ?? version.rendered_document_id,hash:version.document_hash_sha256,blocks:version.rendered_content?.blocks ?? [],fields:fields.filter((field)=>field.signer_role==="employee").map(workspaceField)}, employeeCanSign:version.status==="awaiting_employee_signature" };
  });
}
export async function contractWorkspaceDocument(
  context: ContractsContext,
  contractId: string,
  options: { regenerateLayout?: boolean } = {},
) {
  return withTenantContext(context, async (client) => {
    const contract = await select(client, context, contractId); await assertEditable(client, context, contract.province_id);
    const version = await versionFor(client, context.organizationId, contractId);
    const documentId = version.final_document_id ?? version.rendered_document_id ?? version.source_document_id;
    if (!documentId) throw new NotFoundError("Contract document not found");
    const row = await client.query<{ id:string; title:string; file_name:string; mime_type:string; storage_path:string }>(`SELECT id,title,file_name,mime_type,storage_path FROM documents WHERE organization_id=$1 AND id=$2`, [context.organizationId, documentId]);
    if (!row.rows[0]) throw new NotFoundError("Contract document not found");
    const regenerated = options.regenerateLayout
      ? await renderWorkspacePdf(client, context, version, contract.title, contract.reference)
      : null;
    return {
      document: { id: row.rows[0].id, title: row.rows[0].title, fileName: row.rows[0].file_name, mimeType: row.rows[0].mime_type },
      buffer: regenerated?.buffer ?? await readPrivateDocument(row.rows[0].storage_path),
    };
  });
}