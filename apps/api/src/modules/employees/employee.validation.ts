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

export const employeeDossierDocumentSchema = z
  .object({
    documentId: idSchema,
    documentKind: z.enum([
      "identity",
      "driving_licence",
      "contract",
      "payroll",
      "training_certificate",
      "medical_clearance",
      "disciplinary",
      "other",
    ]),
    credentialNumber: optionalTextSchema(160).nullable(),
    issuedOn: z.string().date("Use YYYY-MM-DD").nullable().optional(),
    expiresOn: z.string().date("Use YYYY-MM-DD").nullable().optional(),
    notes: optionalTextSchema(2_000).nullable(),
  })
  .superRefine((document, context) => {
    if (
      document.issuedOn &&
      document.expiresOn &&
      document.expiresOn < document.issuedOn
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresOn"],
        message: "Expiry cannot be before the issue date",
      });
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
  loginEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid LiteHubs login email")
    .max(320)
    .optional(),
  fullName: textSchema(150).optional(),
  lastName: optionalTextSchema(80).nullable(),
  postName: optionalTextSchema(80).nullable(),
  firstName: optionalTextSchema(80).nullable(),
  jobTitle: textSchema(150).optional(),
  provinceId: idSchema.nullable().optional(),
  siteId: idSchema.nullable().optional(),
  departmentId: idSchema.nullable().optional(),
  employmentStatus: employmentStatusSchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  startDate: z.string().date("Use YYYY-MM-DD").nullable().optional(),
  phone: optionalTextSchema(32).nullable(),
  addressLine1: optionalTextSchema(180).nullable(),
  addressLine2: optionalTextSchema(180).nullable(),
  addressCity: optionalTextSchema(100).nullable(),
  addressRegion: optionalTextSchema(100).nullable(),
  addressPostalCode: optionalTextSchema(32).nullable(),
  addressCountry: optionalTextSchema(100).nullable(),
  emergencyContactName: optionalTextSchema(150).nullable(),
  emergencyContactPhone: optionalTextSchema(32).nullable(),
  notes: optionalTextSchema(2_000).nullable(),
};

export const createEmployeeSchema = z
  .object({
    memberId: idSchema.optional(),
    // Older integrations still submit fullName. The HR form submits the three
    // structured identity fields and the service derives this display name.
    fullName: textSchema(150).optional(),
    lastName: optionalTextSchema(80),
    postName: optionalTextSchema(80),
    firstName: optionalTextSchema(80),
    jobTitle: textSchema(150),
    provinceId: idSchema.optional(),
    siteId: idSchema.optional(),
    departmentId: idSchema.optional(),
    employmentStatus: employmentStatusSchema.default("active"),
    employmentType: employmentTypeSchema.default("permanent"),
    startDate: z.string().date("Use YYYY-MM-DD").optional(),
    phone: optionalTextSchema(32),
    addressLine1: optionalTextSchema(180),
    addressLine2: optionalTextSchema(180),
    addressCity: optionalTextSchema(100),
    addressRegion: optionalTextSchema(100),
    addressPostalCode: optionalTextSchema(32),
    addressCountry: optionalTextSchema(100),
    emergencyContactName: optionalTextSchema(150),
    emergencyContactPhone: optionalTextSchema(32),
    notes: optionalTextSchema(2_000),
  })
  .superRefine((value, context) => {
    if (value.fullName || (value.lastName && value.firstName)) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lastName"],
      message: "Enter the employee's last name and first name",
    });
  });

export const updateEmployeeSchema = nonEmptyUpdate(updateFields);

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type EmployeeDossierDocumentInput = z.infer<
  typeof employeeDossierDocumentSchema
>;
