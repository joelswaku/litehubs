import { z } from "zod";

/**
 * A workspace address as it appears in URLs: /congo-omega/dashboard.
 *
 * Defined here rather than in auth.validation because this module owns the
 * concept; auth imports it for the refresh and switch payloads. Keeping the
 * dependency one-way avoids a cycle between the two modules' schemas.
 */
export const organizationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,62}$/,
    "A workspace address is 2-63 characters of lowercase letters, digits and hyphens",
  );

/** A line of a postal address. Blank is refused; absent is how you say "none". */
const addressLine = (max: number) => z.string().trim().min(1).max(max);

/**
 * Where the company is. Every part is optional — a company that has not got its
 * paperwork to hand should still be able to finish signing up, and this can be
 * completed later from workspace settings.
 *
 * `region` covers province / state / county: one neutral name, rather than one
 * that is wrong in most countries.
 */
export const organizationAddressSchema = z.object({
  addressLine1: addressLine(200).optional(),
  addressLine2: addressLine(200).optional(),
  city: addressLine(120).optional(),
  region: addressLine(120).optional(),
  postalCode: addressLine(20).optional(),
});

/**
 * What describes a company at creation time. Shared by the two ways one gets
 * created — signup (`POST /auth/register`) and an existing user adding another
 * workspace (`POST /organizations`) — so the two cannot drift apart.
 */
export const organizationDetailsSchema = z.object({
  slug: organizationSlugSchema,
  legalName: z
    .string()
    .trim()
    .min(2, "Enter the registered name of the business")
    .max(200),
  /** What staff see in the sidebar; defaults to the legal name. */
  displayName: z.string().trim().min(2).max(120).optional(),
  industryCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_-]*$/)
    .max(50)
    .optional(),
  /** ISO 3166-1 alpha-2. The country half of the address. */
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a two-letter country code, e.g. CD")
    .optional(),
  /** Street, city, province, postcode. Nested so the form maps to one object. */
  address: organizationAddressSchema.optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  /** ISO 4217. */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, e.g. CDF")
    .optional(),
});

export const createOrganizationSchema = organizationDetailsSchema;

export const organizationSlugParams = z.object({
  orgSlug: organizationSlugSchema,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Owner-only organization profile update. Address properties are nullable so an
 * owner can intentionally clear an obsolete line without weakening validation. */
export const updateOrganizationProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(200).optional(),
  displayName: z.string().trim().min(2).max(120).optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code, e.g. CD").nullable().optional(),
  address: z.object({
    addressLine1: addressLine(200).nullable().optional(),
    addressLine2: addressLine(200).nullable().optional(),
    city: addressLine(120).nullable().optional(),
    region: addressLine(120).nullable().optional(),
    postalCode: addressLine(20).nullable().optional(),
  }).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency such as CDF").optional(),
}).superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) ctx.addIssue({ code: "custom", message: "Provide at least one company detail to update" });
});
export type UpdateOrganizationProfileInput = z.infer<typeof updateOrganizationProfileSchema>;
export const operationalServiceCodes = ["poultry", "pigs", "agriculture", "projects", "procurement"] as const;
export const operationalServicesSchema = z.object({
  services: z.array(z.enum(operationalServiceCodes)).min(1, "Choose at least one operational service").max(operationalServiceCodes.length).refine((value) => new Set(value).size === value.length, "Choose each service once"),
});
export type OperationalServicesInput = z.infer<typeof operationalServicesSchema>;