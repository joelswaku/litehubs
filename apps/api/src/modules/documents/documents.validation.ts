import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const blankToNull = (value: unknown) =>
  typeof value === "string" && !value.trim() ? null : value;
const optionalText = (maximum: number) =>
  z.preprocess(blankToNull, text(maximum).nullable().optional());
const optionalId = z.preprocess(blankToNull, id.nullable().optional());
const optionalDate = z.preprocess(
  blankToNull,
  z.string().date("Use YYYY-MM-DD").nullable().optional(),
);

export const documentCategories = [
  "general",
  "contract",
  "permit",
  "licence",
  "insurance",
  "certificate",
  "invoice",
  "receipt",
  "report",
  "policy",
  "employee",
  "legal",
  "statement",
] as const;
export const documentSubjectTables = [
  "incidents",
  "employees",
  "sites",
  "projects",
] as const;

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const documentParams = organizationParams.extend({ documentId: id });
const fields = z.object({
  title: text(300).optional(),
  description: optionalText(4000),
  category: z.enum(documentCategories).optional(),
  provinceId: optionalId,
  siteId: optionalId,
  expiresOn: optionalDate,
  isConfidential: z
    .preprocess((value) => value === true || value === "true", z.boolean())
    .optional(),
  subjectTable: z.enum(documentSubjectTables).nullable().optional(),
  subjectId: optionalId,
});
const pairedSubject = (value: {
  subjectTable?: string | null;
  subjectId?: string | null;
}) => Boolean(value.subjectTable) === Boolean(value.subjectId);
export const uploadDocumentSchema = fields
  .extend({ title: text(300) })
  .refine(pairedSubject, {
    path: ["subjectId"],
    message: "Choose both the linked record type and record, or neither",
  });
export const updateDocumentSchema = fields
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one value to update",
  )
  .refine(pairedSubject, {
    path: ["subjectId"],
    message: "Choose both the linked record type and record, or neither",
  });
export const documentQuery = z.object({
  category: z.enum(documentCategories).optional(),
  provinceId: id.optional(),
  siteId: id.optional(),
  subjectTable: z.enum(documentSubjectTables).optional(),
  subjectId: id.optional(),
  expiringOnly: z.coerce.boolean().optional(),
});
export type DocumentUploadInput = z.infer<typeof uploadDocumentSchema>;
export type DocumentUpdateInput = z.infer<typeof updateDocumentSchema>;
export type DocumentQuery = z.infer<typeof documentQuery>;
