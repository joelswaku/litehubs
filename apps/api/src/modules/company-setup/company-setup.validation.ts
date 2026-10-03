import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const idSchema = z.string().uuid("Enter a valid identifier");
const codeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  )
  .max(63);

const permissionCodeSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_.]{1,126}$/,
    "Use a permission code such as poultry.flocks.read",
  );

const scopeSchema = z.enum(["organization", "province", "self"]);

const nonEmptyUpdate = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });

export const organizationParams = z.object({
  orgSlug: organizationSlugSchema,
});

export const provinceParams = organizationParams.extend({
  provinceId: idSchema,
});

export const siteParams = organizationParams.extend({
  siteId: idSchema,
});

export const departmentParams = organizationParams.extend({
  departmentId: idSchema,
});

export const roleParams = organizationParams.extend({
  roleId: idSchema,
});

export const memberParams = organizationParams.extend({
  memberId: idSchema,
});

export const invitationParams = organizationParams.extend({
  invitationId: idSchema,
});

export const createProvinceSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(150),
});

export const updateProvinceSchema = nonEmptyUpdate({
  code: codeSchema.optional(),
  name: z.string().trim().min(2).max(150).optional(),
  isActive: z.boolean().optional(),
});

const siteTypeSchema = z.enum(["farm", "office", "warehouse", "other"]);

export const createSiteSchema = z.object({
  provinceId: idSchema,
  code: codeSchema,
  name: z.string().trim().min(2).max(150),
  siteType: siteTypeSchema.default("farm"),
  addressLine1: z.string().trim().min(1).max(200).optional(),
  addressLine2: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  postalCode: z.string().trim().min(1).max(32).optional(),
});

export const updateSiteSchema = nonEmptyUpdate({
  provinceId: idSchema.optional(),
  code: codeSchema.optional(),
  name: z.string().trim().min(2).max(150).optional(),
  siteType: siteTypeSchema.optional(),
  addressLine1: z.string().trim().min(1).max(200).nullable().optional(),
  addressLine2: z.string().trim().min(1).max(200).nullable().optional(),
  city: z.string().trim().min(1).max(120).nullable().optional(),
  postalCode: z.string().trim().min(1).max(32).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const createDepartmentSchema = z.object({
  siteId: idSchema.optional(),
  managerMemberId: idSchema.optional(),
  code: codeSchema,
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().min(1).max(2_000).optional(),
});

export const updateDepartmentSchema = nonEmptyUpdate({
  siteId: idSchema.nullable().optional(),
  managerMemberId: idSchema.nullable().optional(),
  code: codeSchema.optional(),
  name: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().min(1).max(2_000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const createRoleSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(1).max(1_000).optional(),
  level: z.number().int().min(1).max(999).default(100),
  dataScope: scopeSchema.default("organization"),
  permissionCodes: z.array(permissionCodeSchema).min(1).max(459),
});

export const updateRoleSchema = nonEmptyUpdate({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().min(1).max(1_000).nullable().optional(),
  level: z.number().int().min(1).max(999).optional(),
  dataScope: scopeSchema.optional(),
  permissionCodes: z.array(permissionCodeSchema).min(1).max(459).optional(),
});

export const replaceMemberRolesSchema = z.object({
  roleCodes: z.array(codeSchema).min(1).max(20),
});

export const replaceMemberProvincesSchema = z.object({
  provinceIds: z.array(idSchema).max(100),
});

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  roleCodes: z.array(codeSchema).min(1).max(20),
  provinceIds: z.array(idSchema).max(100).default([]),
  jobTitle: z.string().trim().min(1).max(150).optional(),
  employeeId: idSchema.optional(),
  // An account still uses its email address to sign in.  The Owner can choose
  // which secure channel receives the one-time activation link.
  deliveryMethod: z.enum(["email", "sms", "both"]).default("email"),
});

export const companyRulesInputSchema = z.object({
  title: z.string().trim().min(4).max(180),
  content: z.string().trim().min(80).max(100_000),
  changeNote: z.string().trim().min(3).max(600).optional(),
});

/* ----------------------------------------------------------- public site -- */

const websiteSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase words separated with hyphens",
  )
  .min(1)
  .max(80);
const websiteColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit colour such as #166534");
const websiteUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine(
    (value) =>
      value === "" ||
      value.startsWith("/") ||
      /^https:\/\//i.test(value),
    "Use a secure https link or a link within this website",
  );
const optionalWebsiteUrlSchema = websiteUrlSchema.optional().nullable();
const websiteText = (max: number) => z.string().trim().max(max);
const websiteOptionalText = (max: number) => websiteText(max).optional().nullable();

export const websiteSettingsInputSchema = z
  .object({
    displayName: websiteText(160).min(2),
    tagline: websiteOptionalText(360),
    defaultLocale: z.enum(["fr", "en"]).default("fr"),
    themePreset: z.enum(["verdant", "cobalt", "sunrise", "earth"]),
    primaryColor: websiteColorSchema,
    accentColor: websiteColorSchema,
    logoUrl: optionalWebsiteUrlSchema,
    contactEmail: z.string().trim().email().max(255).optional().nullable(),
    contactPhone: websiteOptionalText(80),
    addressText: websiteOptionalText(600),
    footerText: websiteOptionalText(1_000),
    customDomain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
        "Enter a domain such as example.com",
      )
      .optional()
      .nullable(),
  })
  .strict();

const websiteTemplateSchema = z.enum([
  "blank",
  "company",
  "operations",
  "project",
  "impact",
  "contact",
  "careers",
]);

const websitePageFields = {
  slug: websiteSlugSchema,
  navigationLabelFr: websiteText(100).min(1),
  navigationLabelEn: websiteText(100).min(1),
  titleFr: websiteText(180).min(2),
  titleEn: websiteText(180).min(2),
  descriptionFr: websiteOptionalText(500),
  descriptionEn: websiteOptionalText(500),
  seoTitleFr: websiteOptionalText(180),
  seoTitleEn: websiteOptionalText(180),
  seoDescriptionFr: websiteOptionalText(320),
  seoDescriptionEn: websiteOptionalText(320),
  templateCode: websiteTemplateSchema.default("blank"),
  isHome: z.boolean().default(false),
};

export const websitePageCreateSchema = z.object(websitePageFields).strict();
export const websitePageUpdateSchema = z.object(websitePageFields).strict();
export const websitePageOrderSchema = z
  .object({
    pageIds: z
      .array(idSchema)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Each page can appear only once in the order",
      }),
  })
  .strict();
export const websiteMediaParams = organizationParams.extend({ mediaId: idSchema });

const websiteSectionTypeSchema = z.enum([
  "hero",
  "rich_text",
  "feature_grid",
  "metrics",
  "image_callout",
  "gallery",
  "faq",
  "cta",
  "careers",
  "contact",
]);

const websiteSectionContentSchema = z
  .record(z.string().max(100), z.unknown())
  .superRefine((value, ctx) => {
    try {
      if (JSON.stringify(value).length > 24_000)
        ctx.addIssue({
          code: "custom",
          message: "A block is too large. Use shorter text or fewer cards.",
        });
    } catch {
      ctx.addIssue({ code: "custom", message: "Block content is invalid" });
    }
  });

export const websiteSectionsInputSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            type: websiteSectionTypeSchema,
            isVisible: z.boolean().default(true),
            content: websiteSectionContentSchema.default({}),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();

export const websitePageParams = organizationParams.extend({ pageId: idSchema });
export const publicWebsitePageParams = z.object({
  orgSlug: organizationSlugSchema,
  pageSlug: websiteSlugSchema,
});
/** Public visitors may choose either a phone number or an email address. The
 * company receives both when provided, but at least one way to reply is
 * required. */
export const publicWebsiteDomainParams = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
      "Enter a domain such as example.com",
    ),
  pageSlug: websiteSlugSchema.optional(),
});

/** A message submitted through a published company website. The recipient is
 * resolved only on the server from the verified domain — never from browser
 * input — so this endpoint cannot be used as an open email relay. */
export const publicWebsiteContactInputSchema = z
  .object({
    fullName: z.string().trim().min(2).max(150),
    email: z.string().trim().toLowerCase().email().max(255),
    phone: websiteOptionalText(40),
    subject: z.string().trim().min(3).max(180),
    // A short but meaningful message such as "Bonjour" must be accepted on a
    // public contact page. Rate limiting and the honeypot field provide the
    // anti-spam protection; a 20-character minimum only rejects real visitors.
    message: z.string().trim().min(5).max(4_000),
    website: z.string().max(0).optional(),
  })
  .strict();
export const websitePublicationInputSchema = z
  .object({ status: z.enum(["draft", "published", "paused"]) })
  .strict();

export type WebsiteSettingsInput = z.infer<typeof websiteSettingsInputSchema>;
export type WebsitePageCreateInput = z.infer<typeof websitePageCreateSchema>;
export type WebsitePageUpdateInput = z.infer<typeof websitePageUpdateSchema>;
export type WebsitePageOrderInput = z.infer<typeof websitePageOrderSchema>;
export type WebsiteSectionsInput = z.infer<typeof websiteSectionsInputSchema>;
export type PublicWebsiteContactInput = z.infer<
  typeof publicWebsiteContactInputSchema
>;

export type CreateProvinceInput = z.infer<typeof createProvinceSchema>;
export type UpdateProvinceInput = z.infer<typeof updateProvinceSchema>;
export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type ReplaceMemberRolesInput = z.infer<typeof replaceMemberRolesSchema>;
export type ReplaceMemberProvincesInput = z.infer<
  typeof replaceMemberProvincesSchema
>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type CompanyRulesInput = z.infer<typeof companyRulesInputSchema>;
