import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  );
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
    .optional();

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const jobParams = organizationParams.extend({ jobId: id });
export const applicationParams = organizationParams.extend({
  applicationId: id,
});
export const publicJobParams = z.object({
  orgSlug: organizationSlugSchema,
  jobCode: code,
});

export const careerSiteSettingsInput = z.object({
  siteId: id,
  publicCareersEnabled: z.boolean().default(false),
  careersIntro: optionalText(2000),
});

export const jobPostInput = z.object({
  siteId: id,
  code,
  title: requiredText(180),
  departmentName: optionalText(160),
  employmentType: z
    .enum(["permanent", "temporary", "contract", "casual", "internship"])
    .default("permanent"),
  experienceLevel: z
    .enum(["entry", "junior", "mid", "senior", "lead", "not_specified"])
    .default("not_specified"),
  positionsOpen: z.coerce.number().int().min(1).max(999).default(1),
  shortSummary: requiredText(600),
  description: requiredText(12_000),
  responsibilities: optionalText(12_000),
  requirements: optionalText(12_000),
  benefits: optionalText(8_000),
  salarySummary: optionalText(600),
  applicationDeadline: z.string().date().nullable().optional(),
  status: z
    .enum(["draft", "published", "paused", "closed", "archived"])
    .default("draft"),
});

export const jobQuery = z.object({
  status: z
    .enum(["draft", "published", "paused", "closed", "archived"])
    .optional(),
  siteId: id.optional(),
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const applicationQuery = z.object({
  jobId: id.optional(),
  siteId: id.optional(),
  status: z
    .enum([
      "received",
      "reviewing",
      "shortlisted",
      "interview",
      "offered",
      "hired",
      "rejected",
      "withdrawn",
    ])
    .optional(),
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const applicationUpdateInput = z.object({
  status: z.enum([
    "received",
    "reviewing",
    "shortlisted",
    "interview",
    "offered",
    "hired",
    "rejected",
    "withdrawn",
  ]),
  internalNotes: optionalText(4000),
});

/** Multipart form-data submitted by an unauthenticated candidate. */
export const publicApplicationInput = z.object({
  fullName: requiredText(180),
  email: z.string().trim().email("Use a valid email address").max(255),
  phone: requiredText(80),
  city: optionalText(160),
  coverLetter: optionalText(8000),
  yearsExperience: z.coerce.number().min(0).max(80).nullable().optional(),
  availability: optionalText(500),
  preferredLanguage: z.enum(["fr", "en"]).optional().default("fr"),
  consent: z.enum(["true", "1", "on"], {
    message: "Consent is required to submit an application",
  }),
});

export type CareerSiteSettingsInput = z.infer<typeof careerSiteSettingsInput>;
export type JobPostInput = z.infer<typeof jobPostInput>;
export type JobQuery = z.infer<typeof jobQuery>;
export type ApplicationQuery = z.infer<typeof applicationQuery>;
export type ApplicationUpdateInput = z.infer<typeof applicationUpdateInput>;
export type PublicApplicationInput = z.infer<typeof publicApplicationInput>;
