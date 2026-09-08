import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const idSchema = z.string().uuid("Enter a valid identifier");
const textSchema = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalTextSchema = (maximum: number) => textSchema(maximum).optional();

const employmentStatusSchema = z.enum([
  "active",
  "probation",
  "on_leave",
  "suspended",
  "terminated",
]);
const employmentTypeSchema = z.enum([
  "permanent",
  "temporary",
  "contract",
  "casual",
  "intern",
]);
const nonEmptyUpdate = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });

export const organizationParams = z.object({
  orgSlug: organizationSlugSchema,
});

export const employeeParams = organizationParams.extend({
  employeeId: idSchema,
});

export const employeeCreationAllowanceParams = organizationParams.extend({
  memberId: idSchema,
});

export const employeeCreationAllowanceProvinceParams =
  employeeCreationAllowanceParams.extend({
    provinceId: idSchema,
  });

export const setEmployeeCreationAllowanceSchema = z.object({
  maxEmployees: z.number().int().min(1).max(100_000),
});

const updateFields = {
  memberId: idSchema.nullable().optional(),
  loginEmail: z.string().trim().toLowerCase().email("Enter a valid LiteHubs login email").max(320).optional(),
  fullName: textSchema(150).optional(),
  jobTitle: textSchema(150).optional(),
  provinceId: idSchema.nullable().optional(),
  siteId: idSchema.nullable().optional(),
  departmentId: idSchema.nullable().optional(),
  employmentStatus: employmentStatusSchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  startDate: z.string().date("Use YYYY-MM-DD").nullable().optional(),
  phone: optionalTextSchema(32).nullable(),
  emergencyContactName: optionalTextSchema(150).nullable(),
  emergencyContactPhone: optionalTextSchema(32).nullable(),
  notes: optionalTextSchema(2_000).nullable(),
};

export const createEmployeeSchema = z.object({
  memberId: idSchema.optional(),
  fullName: textSchema(150),
  jobTitle: textSchema(150),
  provinceId: idSchema.optional(),
  siteId: idSchema.optional(),
  departmentId: idSchema.optional(),
  employmentStatus: employmentStatusSchema.default("active"),
  employmentType: employmentTypeSchema.default("permanent"),
  startDate: z.string().date("Use YYYY-MM-DD").optional(),
  phone: optionalTextSchema(32),
  emergencyContactName: optionalTextSchema(150),
  emergencyContactPhone: optionalTextSchema(32),
  notes: optionalTextSchema(2_000),
});

export const updateEmployeeSchema = nonEmptyUpdate(updateFields);

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
