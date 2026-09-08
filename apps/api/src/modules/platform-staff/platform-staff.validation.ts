import { z } from "zod";
import { passwordSchema } from "../auth/auth.validation";

const platformRoleCode = z.enum([
  "platform_super_admin",
  "platform_admin",
  "platform_support",
  "platform_billing",
]);

const email = z.string().trim().toLowerCase().email().max(255);

export const staffUserParams = z.object({
  userId: z.string().uuid(),
});

export const createStaffUserBody = z.object({
  fullName: z.string().trim().min(2).max(150),
  email,
  password: passwordSchema,
  roles: z.array(platformRoleCode).min(1).max(4),
});

export const updateStaffRolesBody = z.object({
  roles: z.array(platformRoleCode).min(1).max(4),
});

export const updateStaffStatusBody = z.object({
  status: z.enum(["active", "suspended", "disabled"]),
});

export type CreateStaffUserInput = z.infer<typeof createStaffUserBody>;
export type UpdateStaffRolesInput = z.infer<typeof updateStaffRolesBody>;
export type UpdateStaffStatusInput = z.infer<typeof updateStaffStatusBody>;
