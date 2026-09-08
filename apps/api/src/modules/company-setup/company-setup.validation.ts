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
});

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
