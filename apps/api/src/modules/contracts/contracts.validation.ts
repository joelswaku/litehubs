import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const date = z.string().date("Use YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => text(max).nullable().optional();

export const contractTypes = ["supply", "sales", "employment", "service", "lease", "loan", "insurance", "nda", "other"] as const;
export const contractStatuses = ["draft", "pending_signature", "ready_for_signature", "awaiting_employee_signature", "awaiting_employer_signature", "signed", "active", "rejected", "expired", "terminated", "renewed", "cancelled"] as const;

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const contractParams = organizationParams.extend({ contractId: id });
const reference = z.preprocess((value) => value === null || (typeof value === "string" && value.trim() === "") ? undefined : value, z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$/, "Use letters, numbers, underscores, hyphens or slashes").optional());
const amount = z.coerce.number().finite().min(0).max(99999999999999.99);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency such as CDF");

const fields = z.object({
  reference: reference.optional(),
  title: text(220).optional(),
  contractType: z.enum(contractTypes).optional(),
  supplierId: id.nullable().optional(),
  customerId: id.nullable().optional(),
  employeeId: id.nullable().optional(),
  counterpartyName: nullableText(220),
  startsOn: date.optional(),
  endsOn: date.nullable().optional(),
  autoRenews: z.boolean().optional(),
  renewalNoticeDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  currency: currency.nullable().optional(),
  contractValue: amount.nullable().optional(),
  paymentTerms: nullableText(2000),
  employerSignerRole: nullableText(120),
  status: z.enum(contractStatuses).optional(),
  documentId: id.nullable().optional(),
  provinceId: id.nullable().optional(),
  signedOn: date.nullable().optional(),
  terminatedOn: date.nullable().optional(),
  terminationReason: nullableText(2000),
  notes: nullableText(4000),
});

function counterpartyComplete(value: {
  supplierId?: string | null; customerId?: string | null; employeeId?: string | null; counterpartyName?: string | null;
}) {
  return [value.supplierId, value.customerId, value.employeeId].filter(Boolean).length <= 1 && Boolean(value.supplierId || value.customerId || value.employeeId || value.counterpartyName);
}

export const createContractSchema = fields.extend({
  title: text(220), contractType: z.enum(contractTypes), startsOn: date,
}).superRefine((value, ctx) => {
  if (!counterpartyComplete(value)) ctx.addIssue({ code: "custom", path: ["counterpartyName"], message: "Choose one counterparty or provide its name" });
  if (value.contractType === "employment" && !value.employeeId) ctx.addIssue({ code: "custom", path: ["employeeId"], message: "An employment contract needs an employee" });
  if (value.endsOn && value.endsOn < value.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date cannot be before start date" });
  if (value.contractValue !== null && value.contractValue !== undefined && !value.currency) ctx.addIssue({ code: "custom", path: ["currency"], message: "Choose a currency for the contract value" });
  if (value.status === "terminated" && !value.terminatedOn) ctx.addIssue({ code: "custom", path: ["terminatedOn"], message: "Termination date is required" });
});

export const updateContractSchema = fields.superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) ctx.addIssue({ code: "custom", message: "Provide at least one value to change" });
  if (value.endsOn && value.startsOn && value.endsOn < value.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date cannot be before start date" });
  if (value.contractValue !== null && value.contractValue !== undefined && value.currency === null) ctx.addIssue({ code: "custom", path: ["currency"], message: "A value requires a currency" });
});

export const signEmploymentContractSchema = z.object({
  acknowledged: z.boolean().refine((value) => value, {
    message: "Read and confirm the contract before signing",
  }),
});
export type SignEmploymentContractInput = z.infer<typeof signEmploymentContractSchema>;
export const contractQuery = z.object({
  status: z.enum(contractStatuses).optional(),
  contractType: z.enum(contractTypes).optional(),
  provinceId: id.optional(),
  employeeId: id.optional(),
  expiringOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
export type ContractQuery = z.infer<typeof contractQuery>;
const signatureRole = z.enum(["employee", "employer"]);
const signatureMethod = z.enum(["typed", "drawn", "uploaded"]);
const block = z.object({
  type: z.enum(["heading", "paragraph", "table", "page_break"]).default("paragraph"),
  text: z.string().trim().max(12000).optional(),
  rows: z.array(z.array(z.string().max(1000))).max(100).optional(),
}).strict();
export const contractTemplateSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/, "Use lowercase letters, numbers, hyphens or underscores"),
  name: text(220),
  contractType: z.enum(contractTypes),
  language: z.enum(["fr", "en"]).default("fr"),
  body: z.object({ blocks: z.array(block).max(500) }),
  isActive: z.boolean().optional(),
});
export const contractTemplateParams = organizationParams.extend({ templateId: id });
export const workspaceSignatureFieldSchema = z.object({
  signerRole: signatureRole,
  label: text(160),
  pageNumber: z.coerce.number().int().min(1).max(100),
  x: z.coerce.number().min(0).max(595),
  y: z.coerce.number().min(0).max(842),
  width: z.coerce.number().positive().max(595).default(180),
  height: z.coerce.number().positive().max(842).default(48),
  fieldOrder: z.coerce.number().int().min(1).max(1000).default(1),
  isRequired: z.boolean().default(true),
});
export const generateContractVersionSchema = z.object({
  templateId: id.nullable().optional(),
  body: z.object({ blocks: z.array(block).min(1).max(500) }).nullable().optional(),
  sourceDocumentId: id.nullable().optional(),
  signatureFields: z.array(workspaceSignatureFieldSchema).min(1).max(30),
}).superRefine((value, ctx) => {
  if (!value.templateId && !value.body && !value.sourceDocumentId) ctx.addIssue({ code: "custom", path: ["templateId"], message: "Choose a template, an uploaded PDF, or document content" });
});
export const sendForSignatureSchema = z.object({ versionId: id });
export const signatureFieldParams = contractParams.extend({ fieldId: id });
export const signContractFieldSchema = z.object({
  legalName: text(220),
  method: signatureMethod.default("typed"),
  signatureData: z.string().trim().max(800000).nullable().optional(),
  acknowledged: z.boolean().refine((value) => value, { message: "Electronic-signature consent is required" }),
});
export type ContractTemplateInput = z.infer<typeof contractTemplateSchema>;
export type GenerateContractVersionInput = z.infer<typeof generateContractVersionSchema>;
export type SendForSignatureInput = z.infer<typeof sendForSignatureSchema>;
export type SignContractFieldInput = z.infer<typeof signContractFieldSchema>;