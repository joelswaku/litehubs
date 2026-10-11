import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { layoutContractPdf, stampSignatures, type ContractParties, type SignatureRole, type SignatureRequirements, type SignatureSlots, type SignedField, type WorkspaceBlock } from "./contract-pdf";
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
    if (query.employeeId) {
      await assertScopedId(
        client,
        context.organizationId,
        "employees",
        query.employeeId,
        "employeeId",
      );
      params.push(query.employeeId);
      where.push(`c.employee_id=${params.length}`);
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
      ? await renderWorkspacePdf(client, context, version)
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

type TemplateRow = { id: string; code: string; name: string; contract_type: string; language: string; body: { blocks?: WorkspaceBlock[] }; is_active: boolean; created_at: string; updated_at: string };

/** Merge fields a template may use, with a short description. */
const MERGE_LABELS: Record<string, string> = {
  "company.name": "nom de l’entreprise",
  "company.address": "adresse de l’entreprise",
  "employee.fullName": "nom complet",
  "employee.employeeNumber": "matricule",
  "employee.jobTitle": "poste",
  "employee.workLocation": "lieu de travail",
  "contract.startDate": "date de début",
  "contract.endDate": "date de fin",
  "contract.salary": "rémunération",
  "contract.currency": "devise",
  "contract.reference": "référence",
  "contract.title": "titre",
  "contract.employerSignerRole": "fonction du signataire",
};
const longDate = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(date);
};
const amount = (value: string | null | undefined) => {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("fr-FR", { minimumFractionDigits: parsed % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(parsed).replace(/\u202f|\u00a0/g, " ") : String(value);
};
function contractMergeValues(contract: ContractRow, employee: { full_name: string | null; employee_number: string | null; job_title: string | null; site_name: string | null } | undefined, company: { name: string; address: string }) {
  return {
    "company.name": company.name,
    "company.address": company.address,
    "employee.fullName": employee?.full_name ?? contract.employee_name ?? "",
    "employee.employeeNumber": employee?.employee_number ?? "",
    "employee.jobTitle": employee?.job_title ?? "",
    "employee.workLocation": employee?.site_name ?? contract.province_name ?? "",
    "contract.startDate": longDate(contract.starts_on),
    "contract.endDate": longDate(contract.ends_on),
    "contract.salary": amount(contract.contract_value),
    "contract.currency": contract.currency ?? "",
    "contract.reference": contract.reference,
    "contract.title": contract.title,
    "contract.employerSignerRole": contract.employer_signer_role ?? "",
  } as Record<string, string>;
}
/** Placeholders a template uses that LiteHubs cannot fill. */
function unknownMergeFields(blocks: WorkspaceBlock[]) {
  const found = new Set<string>();
  const scan = (value?: string) => {
    for (const match of (value ?? "").matchAll(/{{\s*([^}]*?)\s*}}/g)) if (!(match[1]! in MERGE_LABELS)) found.add(`{{${match[1]}}}`);
  };
  for (const block of blocks) {
    scan(block.text);
    block.rows?.forEach((row) => row.forEach(scan));
  }
  return [...found];
}
/** A known field without a value prints a blank line to fill in by hand. */
function substituteMerge(value: string, values: Record<string, string>) {
  return value.replace(/{{\s*([a-zA-Z]+\.[a-zA-Z]+)\s*}}/g, (_match, key: string) => values[key]?.trim() || "________________");
}
function renderBlocks(blocks: WorkspaceBlock[], values: Record<string, string>): WorkspaceBlock[] {
  return blocks.map((block) => ({
    ...block,
    text: block.text ? substituteMerge(block.text, values) : undefined,
    rows: block.rows?.map((row) => row.map((cell) => substituteMerge(cell, values))),
  }));
}
/* Contract PDF: layout, signature slots and stamping live in ./contract-pdf. */

/** The data printed in the signature block and « Fait à … ». */
type RenderContext = {
  title: string;
  reference: string;
  companyName: string;
  logoUrl: string | null;
  parties: ContractParties;
};
async function renderContextFor(client: PoolClient, organizationId: string, contractId: string): Promise<RenderContext> {
  const result = await client.query<{
    title: string; reference: string; employer_signer_role: string | null; employee_name: string | null; job_title: string | null;
    display_name: string | null; logo_url: string | null; city: string | null;
  }>(
    `SELECT c.title,c.reference,c.employer_signer_role,e.full_name AS employee_name,e.job_title,
            o.display_name,settings.logo_url,o.city
       FROM contracts c
       JOIN organizations o ON o.id=c.organization_id
       LEFT JOIN organization_settings settings ON settings.organization_id=o.id
       LEFT JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id
      WHERE c.organization_id=$1 AND c.id=$2`,
    [organizationId, contractId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Contract not found");
  const companyName = row.display_name?.trim() || "Entreprise";
  return {
    title: row.title,
    reference: row.reference,
    companyName,
    logoUrl: row.logo_url,
    parties: {
      employerName: companyName,
      employerRole: row.employer_signer_role,
      employeeName: row.employee_name,
      employeeTitle: row.job_title,
      city: row.city,
    },
  };
}
function signedFieldsOf(fields: WorkspaceFieldRow[]): SignedField[] {
  return fields.map((field) => ({
    signerRole: field.signer_role === "employer" ? "employer" : "employee",
    status: field.status,
    signedName: field.signed_name,
    signatureData: field.signature_data,
    signedAt: field.signed_at,
    method: field.signature_method,
  }));
}
/** Latest signature date: printed in « Fait à …, le … » on the final copy. */
function lastSignatureDate(fields: WorkspaceFieldRow[]) {
  const dates = fields.filter((field) => field.status === "signed" && field.signed_at).map((field) => String(field.signed_at));
  return dates.length && dates.length === fields.length ? dates.sort().at(-1)!.slice(0, 10) : null;
}

/**
 * Renders a contract version.  A template version is laid out again from its
 * frozen blocks (identical text, current layout); an uploaded PDF receives a
 * signature sheet at the end.  Signed fields are stamped when requested.
 */
async function renderContractVersion(
  client: PoolClient,
  organizationId: string,
  version: WorkspaceVersionRow,
  fields: WorkspaceFieldRow[],
  options: { mode?: "electronic" | "paper"; withSignatures?: boolean; versionLabel?: string; documentHash?: string | null },
): Promise<Buffer> {
  const ctx = await renderContextFor(client, organizationId, version.contract_id);
  const plan = signatureRequirements(fields);
  const fullySigned = fields.length > 0 && fields.every((field) => field.status === "signed");
  const layoutOptions = {
    title: ctx.title,
    reference: ctx.reference,
    companyName: ctx.companyName,
    logoUrl: ctx.logoUrl,
    signaturePlan: plan,
    parties: ctx.parties,
    mode: options.mode ?? "electronic",
    signedOn: options.withSignatures && fullySigned ? lastSignatureDate(fields) : null,
    security: { versionLabel: options.versionLabel ?? `V${version.version_number}`, documentHash: options.documentHash ?? null },
  };
  const blocks = version.rendered_content?.blocks ?? [];
  let bytes: Buffer;
  let slots: SignatureSlots;
  if (blocks.length) {
    ({ bytes, slots } = await layoutContractPdf(blocks, layoutOptions));
  } else {
    // Uploaded PDF: keep it untouched and append the standard signature sheet.
    const sourceId = version.source_document_id ?? version.rendered_document_id;
    const source = await client.query<{ storage_path: string }>(`SELECT storage_path FROM documents WHERE organization_id=$1 AND id=$2`, [organizationId, sourceId]);
    if (!source.rows[0]) throw new NotFoundError("Contract PDF not found");
    const pdf = await PDFDocument.load(await readPrivateDocument(source.rows[0].storage_path));
    const offset = pdf.getPageCount();
    const sheet = await layoutContractPdf([{ type: "heading", text: "Signatures des parties" }, { type: "paragraph", text: `Les parties signent le contrat « ${ctx.title} » (réf. ${ctx.reference}) qui précède, composé de ${offset} page(s).` }], layoutOptions);
    const sheetPdf = await PDFDocument.load(sheet.bytes);
    for (const copied of await pdf.copyPages(sheetPdf, sheetPdf.getPageIndices())) pdf.addPage(copied);
    bytes = Buffer.from(await pdf.save());
    slots = {
      employee: sheet.slots.employee.map((slot) => ({ ...slot, pageNumber: slot.pageNumber + offset })),
      employer: sheet.slots.employer.map((slot) => ({ ...slot, pageNumber: slot.pageNumber + offset })),
    };
  }
  return options.withSignatures && fields.some((field) => field.status === "signed")
    ? stampSignatures(bytes, slots, signedFieldsOf(fields))
    : bytes;
}

function signatureRequirements<T extends { signerRole?: SignatureRole; signer_role?: SignatureRole }>(fields: T[]): SignatureRequirements {
  const counts: SignatureRequirements = { employee: 0, employer: 0 };
  for (const field of fields) {
    const role = field.signerRole ?? field.signer_role;
    if (role === "employee" || role === "employer") counts[role] += 1;
  }
  return counts;
}
async function employeeDetails(client: PoolClient, organizationId: string, employeeId: string | null) {
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

/** Rebuilds a preview from the frozen version.  It never updates the stored
 * document; it only keeps previews on the current layout. */
async function renderWorkspacePdf(
  client: PoolClient,
  context: ContractsContext,
  version: WorkspaceVersionRow,
): Promise<{ buffer: Buffer; hasCompletedSignature: boolean } | null> {
  const fields = await fieldsFor(client, context.organizationId, version.id);
  if (!version.rendered_content?.blocks?.length && !version.source_document_id) return null;
  return {
    hasCompletedSignature: fields.some((field) => field.status === "signed"),
    buffer: await renderContractVersion(client, context.organizationId, version, fields, {
      withSignatures: true,
      documentHash: version.document_hash_sha256,
    }),
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
    const paper=await renderContextFor(client,context.organizationId,contractId);
    return { document:{companyName:paper.companyName,title:paper.title,reference:paper.reference,...paper.parties}, contract:mapForContext(contract, context), versions:versions.rows.map((row)=>({id:row.id,number:row.version_number,status:row.status,templateId:row.template_id,sourceDocumentId:row.source_document_id,renderedDocumentId:row.rendered_document_id,finalDocumentId:row.final_document_id,hash:row.document_hash_sha256,frozenAt:row.frozen_at,createdAt:row.created_at})), currentVersion:current ? {id:current.id,number:current.version_number,status:current.status,blocks:(current.rendered_content?.blocks ?? []) as WorkspaceBlock[],fields:currentFields.map(workspaceField),signedOn:lastSignatureDate(currentFields)} : null, events:events.rows.map((event)=>({id:event.id,type:event.event_type,detail:event.detail,createdAt:event.created_at,actorName:event.actor_name})) };
  });
}
export async function generateContractDocumentVersion(context: ContractsContext, contractId: string, input: import("./contracts.validation").GenerateContractVersionInput) {
  return withTenantContext(context, async (client) => {
    const contract=await select(client,context,contractId); await assertEditable(client,context,contract.province_id);
    let body=input.body ?? null; let templateId=input.templateId ?? null; let sourceDocumentId=input.sourceDocumentId ?? null;
    if (templateId) { const found=await client.query<TemplateRow>(`SELECT id,code,name,contract_type,language,body,is_active,created_at::text,updated_at::text FROM contract_templates WHERE organization_id=$1 AND id=$2 AND is_active`,[context.organizationId,templateId]); if (!found.rows[0]) throw new BadRequestError("Choose an active template in this company",{field:"templateId"}); if (found.rows[0].contract_type!==contract.contract_type) throw new BadRequestError("Choose a template that matches the contract type",{field:"templateId"}); body={ blocks: found.rows[0].body.blocks ?? [] }; }
    const employee=await employeeDetails(client,context.organizationId,contract.employee_id);
    const organization=await client.query<{display_name:string|null;address_line1:string|null;address_line2:string|null;city:string|null;region:string|null;postal_code:string|null}>("SELECT o.display_name,o.address_line1,o.address_line2,o.city,o.region,o.postal_code FROM organizations o WHERE o.id=$1",[context.organizationId]);
    const organizationRow=organization.rows[0];
    const companyName=organizationRow?.display_name?.trim() || "Entreprise";
    const companyAddress=[organizationRow?.address_line1,organizationRow?.address_line2,organizationRow?.city,organizationRow?.region,organizationRow?.postal_code].filter((part): part is string => Boolean(part && part.trim())).join(", ");
    let rendered: { blocks: WorkspaceBlock[] };
    if (sourceDocumentId) {
      const source=await client.query<{id:string;mime_type:string}>(`SELECT id,mime_type FROM documents WHERE organization_id=$1 AND id=$2`,[context.organizationId,sourceDocumentId]);
      if (!source.rows[0]) throw new BadRequestError("Choose an uploaded PDF from this company",{field:"sourceDocumentId"});
      if (source.rows[0].mime_type!=="application/pdf") throw new BadRequestError("Upload or choose a PDF contract document for electronic signature",{field:"sourceDocumentId"});
      rendered={blocks:[]};
    } else {
      if (!body?.blocks?.length) throw new BadRequestError("Add contract content before generating a document",{field:"body"});
      // A misspelt merge field ({{malaba}}) would print as raw text in a legal
      // document: stop and name it instead.
      const unknown=unknownMergeFields(body.blocks);
      if (unknown.length) throw new BadRequestError(`Champs inconnus dans le modèle : ${unknown.join(", ")}. Corrigez le modèle (champs possibles : ${Object.keys(MERGE_LABELS).map((key)=>`{{${key}}}`).join(", ")}).`,{field:"body"});
      rendered={blocks:renderBlocks(body.blocks,contractMergeValues(contract,employee,{name:companyName,address:companyAddress}))};
    }
    // A new version replaces the previous one only while nobody has signed it.
    const previous=await client.query<{id:string;status:string;signed:number}>(`SELECT v.id,v.status,(SELECT count(*)::int FROM contract_signature_fields f WHERE f.organization_id=v.organization_id AND f.version_id=v.id AND f.status='signed') AS signed FROM contract_document_versions v WHERE v.organization_id=$1 AND v.contract_id=$2 ORDER BY v.version_number DESC LIMIT 1`,[context.organizationId,contractId]);
    const last=previous.rows[0];
    if (last && (last.signed>0 || ["signed","active"].includes(last.status))) throw new BadRequestError("Cette version est déjà signée (au moins une signature). Pour changer le contrat, créez un avenant ou un nouveau contrat.",{field:"body"});
    if (last && last.status!=="draft" && last.status!=="cancelled") {
      await client.query(`UPDATE contract_document_versions SET status='cancelled' WHERE organization_id=$1 AND id=$2`,[context.organizationId,last.id]);
      if (["awaiting_employee_signature","awaiting_employer_signature","ready_for_signature","pending_signature"].includes(contract.status)) await client.query(`UPDATE contracts SET status='draft' WHERE organization_id=$1 AND id=$2`,[context.organizationId,contractId]);
    }
    const numberResult=await client.query<{number:number}>(`SELECT COALESCE(MAX(version_number),0)+1 AS number FROM contract_document_versions WHERE organization_id=$1 AND contract_id=$2`,[context.organizationId,contractId]);
    const versionNumber=numberResult.rows[0]!.number;
    // Draft rows first: the layout below needs the version (blocks, number).
    const placeholderDocument = sourceDocumentId ?? null;
    const version=await client.query<{id:string}>(`INSERT INTO contract_document_versions (organization_id,contract_id,version_number,template_id,source_document_id,rendered_document_id,status,rendered_content,created_by) VALUES ($1,$2,$3,$4,$5,$5,'draft',$6::jsonb,$7) RETURNING id`,[context.organizationId,contractId,versionNumber,templateId,placeholderDocument,JSON.stringify(rendered),context.userId]);
    const versionRow=await versionFor(client,context.organizationId,contractId,version.rows[0]!.id);
    // Field rows carry the role, label and order; positions come from the layout.
    const ordered=(["employee","employer"] as const).flatMap((role)=>input.signatureFields.filter((field)=>field.signerRole===role).map((field,index)=>({...field,fieldOrder:index+1})));
    const placeholderFields=ordered.map((field)=>({signer_role:field.signerRole,status:"pending"} as WorkspaceFieldRow));
    const draft=await renderContractVersion(client,context.organizationId,versionRow,placeholderFields,{versionLabel:"BROUILLON"});
    if (!sourceDocumentId) {
      const stored=await storePrivateDocument({organizationId:context.organizationId,originalName:`${contract.reference}-v${versionNumber}.pdf`,mimeType:"application/pdf",buffer:draft});
      const doc=await client.query<{id:string}>(`INSERT INTO documents (organization_id,title,description,category,storage_path,file_name,mime_type,size_bytes,checksum_sha256,subject_table,subject_id,province_id,is_confidential,uploaded_by) VALUES ($1,$2,$3,'contract',$4,$5,'application/pdf',$6,$7,'contracts',$8,$9,true,$10) RETURNING id`,[context.organizationId,`${contract.title} · brouillon`,"Version générée depuis le modèle de la société",stored.storagePath,`${contract.reference}-v${versionNumber}.pdf`,stored.bytes,stored.checksumSha256,contractId,contract.province_id,context.userId]);
      await client.query(`UPDATE contract_document_versions SET rendered_document_id=$3 WHERE organization_id=$1 AND id=$2`,[context.organizationId,version.rows[0]!.id,doc.rows[0]!.id]);
      versionRow.rendered_document_id=doc.rows[0]!.id;
    }
    const positions=await signaturePositions(client,context.organizationId,versionRow,placeholderFields);
    for (const field of ordered) {
      const slot=positions[field.signerRole][field.fieldOrder-1];
      await client.query(`INSERT INTO contract_signature_fields (organization_id,version_id,signer_role,label,page_number,x,y,width,height,field_order,is_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[context.organizationId,version.rows[0]!.id,field.signerRole,field.label,slot?.pageNumber ?? 1,Math.max(0,slot?.x ?? 0),Math.max(0,slot?.y ?? 0),slot?.width ?? 200,slot?.height ?? 60,field.fieldOrder,field.isRequired]);
    }
    await addWorkspaceEvent(client,context,contractId,version.rows[0]!.id,null,"version_generated",{templateId,versionNumber}); return contractWorkspace(context,contractId);
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

/** Signature-box positions of a version (stored on its fields for reference). */
async function signaturePositions(client: PoolClient, organizationId: string, version: WorkspaceVersionRow, fields: WorkspaceFieldRow[]): Promise<SignatureSlots> {
  const ctx = await renderContextFor(client, organizationId, version.contract_id);
  const options = { title: ctx.title, reference: ctx.reference, companyName: ctx.companyName, logoUrl: null, signaturePlan: signatureRequirements(fields), parties: ctx.parties };
  const blocks = version.rendered_content?.blocks ?? [];
  if (blocks.length) return (await layoutContractPdf(blocks, options)).slots;
  const sourceId = version.source_document_id ?? version.rendered_document_id;
  const source = await client.query<{ storage_path: string }>(`SELECT storage_path FROM documents WHERE organization_id=$1 AND id=$2`, [organizationId, sourceId]);
  const offset = source.rows[0] ? (await PDFDocument.load(await readPrivateDocument(source.rows[0].storage_path))).getPageCount() : 0;
  const sheet = await layoutContractPdf([{ type: "heading", text: "Signatures des parties" }], options);
  return {
    employee: sheet.slots.employee.map((slot) => ({ ...slot, pageNumber: slot.pageNumber + offset })),
    employer: sheet.slots.employer.map((slot) => ({ ...slot, pageNumber: slot.pageNumber + offset })),
  };
}

async function rebuildSignedContract(client: PoolClient, context: ContractsContext, contract: ContractRow, version: WorkspaceVersionRow) {
  const fields = await fieldsFor(client, context.organizationId, version.id);
  // Laid out again from the frozen content, then the signatures are stamped.
  // The hash is computed from these very bytes, so it cannot be inside them.
  const bytes = await renderContractVersion(client, context.organizationId, version, fields, { withSignatures: true, documentHash: null });
  const stored = await storePrivateDocument({ organizationId: context.organizationId, originalName: `${contract.reference}-signed.pdf`, mimeType: "application/pdf", buffer: bytes });
  const doc = await client.query<{ id: string }>(`INSERT INTO documents (organization_id,title,description,category,storage_path,file_name,mime_type,size_bytes,checksum_sha256,subject_table,subject_id,province_id,is_confidential,uploaded_by) VALUES ($1,$2,$3,'contract',$4,$5,'application/pdf',$6,$7,'contracts',$8,$9,true,$10) RETURNING id`, [context.organizationId, `${contract.title} · signé`, "Exemplaire final figé avec signatures électroniques", stored.storagePath, `${contract.reference}-signed.pdf`, stored.bytes, stored.checksumSha256, contract.id, contract.province_id, context.userId]);
  await client.query(`UPDATE contract_document_versions SET final_document_id=$3,document_hash_sha256=$4,status='signed',frozen_at=COALESCE(frozen_at,now()) WHERE organization_id=$1 AND id=$2`, [context.organizationId, version.id, doc.rows[0]!.id, stored.checksumSha256]);
  await client.query(`UPDATE contracts SET document_id=$3,status='active',signed_on=COALESCE(signed_on,CURRENT_DATE) WHERE organization_id=$1 AND id=$2`, [context.organizationId, contract.id, doc.rows[0]!.id]);
  return { documentId: doc.rows[0]!.id, hash: stored.checksumSha256 };
}

/* ------------------------------------------------------------------ */
/* Handwritten (paper) signature                                        */
/* ------------------------------------------------------------------ */

/** The copy to print: no draft mark, initials boxes on every page. */
export async function paperContractCopy(context: ContractsContext, contractId: string) {
  return withTenantContext(context, async (client) => {
    const contract = await select(client, context, contractId);
    await assertEditable(client, context, contract.province_id);
    const version = await versionFor(client, context.organizationId, contractId);
    if (version.status === "signed") throw new BadRequestError("Ce contrat est déjà signé : téléchargez l’exemplaire signé.");
    const fields = await fieldsFor(client, context.organizationId, version.id);
    const buffer = await renderContractVersion(client, context.organizationId, version, fields, { mode: "paper", versionLabel: `V${version.version_number}` });
    await addWorkspaceEvent(client, context, contractId, version.id, null, "printed_for_paper_signature", {});
    return { fileName: `${contract.reference}-a-signer.pdf`, buffer };
  });
}

/** Records a contract signed by hand: the scanned copy becomes the original. */
export async function recordPaperSignature(
  context: ContractsContext,
  contractId: string,
  input: { signedOn: string; employerSignerName: string; note?: string | null },
  file: Express.Multer.File,
) {
  return withTenantContext(context, async (client) => {
    const contract = await select(client, context, contractId);
    await assertEditable(client, context, contract.province_id);
    if (contract.contract_type === "employment" && !(await mayCountersignForEmployer(client, context)))
      throw new ForbiddenError("Seul le propriétaire ou un General Manager peut enregistrer un contrat de travail signé.");
    const version = await versionFor(client, context.organizationId, contractId);
    if (version.status === "signed") throw new BadRequestError("Ce contrat est déjà signé.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.signedOn) || input.signedOn > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))
      throw new BadRequestError("Indiquez une date de signature valide (pas dans le futur).", { field: "signedOn" });
    const stored = await storePrivateDocument({ organizationId: context.organizationId, originalName: file.originalname || `${contract.reference}-signe-papier.pdf`, mimeType: file.mimetype, buffer: file.buffer });
    const extension = file.mimetype === "application/pdf" ? "pdf" : file.mimetype === "image/png" ? "png" : "jpg";
    const doc = await client.query<{ id: string }>(
      `INSERT INTO documents (organization_id,title,description,category,storage_path,file_name,mime_type,size_bytes,checksum_sha256,subject_table,subject_id,province_id,is_confidential,uploaded_by)
       VALUES ($1,$2,$3,'contract',$4,$5,$6,$7,$8,'contracts',$9,$10,true,$11) RETURNING id`,
      [context.organizationId, `${contract.title} · signé sur papier`, input.note?.trim() || "Exemplaire signé à la main, scanné et enregistré dans LiteHubs", stored.storagePath, `${contract.reference}-signe-papier.${extension}`, file.mimetype, stored.bytes, stored.checksumSha256, contractId, contract.province_id, context.userId],
    );
    const employeeName = (await employeeDetails(client, context.organizationId, contract.employee_id))?.full_name ?? contract.employee_name ?? contract.counterparty_name ?? "Autre partie";
    await client.query(
      `UPDATE contract_signature_fields
          SET status='signed',signed_by_member_id=$3,signature_method='paper',signed_at=$4::date + time '12:00',
              signed_name=CASE WHEN signer_role='employer' THEN $5 ELSE $6 END,
              consent_text='Signature manuscrite sur papier — exemplaire scanné enregistré'
        WHERE organization_id=$1 AND version_id=$2 AND status<>'signed'`,
      [context.organizationId, version.id, context.memberId, input.signedOn, input.employerSignerName.trim(), employeeName],
    );
    await client.query(
      `UPDATE contract_document_versions SET final_document_id=$3,document_hash_sha256=$4,status='signed',frozen_at=COALESCE(frozen_at,now()) WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, version.id, doc.rows[0]!.id, stored.checksumSha256],
    );
    await client.query(
      `UPDATE contracts SET document_id=$3,status='active',signed_on=$4::date WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, contractId, doc.rows[0]!.id, input.signedOn],
    );
    await addWorkspaceEvent(client, context, contractId, version.id, null, "paper_signature_recorded", { signedOn: input.signedOn, employerSignerName: input.employerSignerName.trim(), hash: stored.checksumSha256 });
    return contractWorkspace(context, contractId);
  });
}
export async function signContractSignatureField(context: ContractsContext, contractId: string, fieldId: string, input: import("./contracts.validation").SignContractFieldInput, signer: "employee" | "employer") {
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
    const employeeId=await ownEmployeeId(client,context); const contract=await selectOwnEmploymentContract(client,context,contractId,employeeId); const version=await versionFor(client,context.organizationId,contractId); const fields=await fieldsFor(client,context.organizationId,version.id); const paper=await renderContextFor(client,context.organizationId,contractId); const employer=fields.filter((field)=>field.signer_role==="employer").map(workspaceField); return { document:{companyName:paper.companyName,title:paper.title,reference:paper.reference,...paper.parties}, employerFields:employer.map((field)=>({id:field.id,label:field.label,status:field.status,signedName:field.signedName,signedAt:field.signedAt,method:field.method})), contract:map(contract), version:{signedOn:lastSignatureDate(fields),id:version.id,number:version.version_number,status:version.status,documentId:version.final_document_id ?? version.rendered_document_id,hash:version.document_hash_sha256,blocks:version.rendered_content?.blocks ?? [],fields:fields.filter((field)=>field.signer_role==="employee").map(workspaceField)}, employeeCanSign:version.status==="awaiting_employee_signature" };
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
      ? await renderWorkspacePdf(client, context, version)
      : null;
    return {
      document: { id: row.rows[0].id, title: row.rows[0].title, fileName: row.rows[0].file_name, mimeType: row.rows[0].mime_type },
      buffer: regenerated?.buffer ?? await readPrivateDocument(row.rows[0].storage_path),
    };
  });
}