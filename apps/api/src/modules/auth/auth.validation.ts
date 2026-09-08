import { z } from "zod";
import {
  organizationDetailsSchema,
  organizationSlugSchema,
} from "../organization/organization.validation";

/**
 * Rules for a new password. Deliberately not applied to the *login* password
 * field — an old account may predate the policy and must still be able to sign
 * in (and then be told to change it).
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((value) => /[a-z]/.test(value), "Password needs a lowercase letter")
  .refine((value) => /[A-Z]/.test(value), "Password needs an uppercase letter")
  .refine((value) => /[0-9]/.test(value), "Password needs a digit");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .email("Enter a valid email address");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});

/**
 * Signup takes the person and their company together, because one without the
 * other is not a usable state — see `register()` on why they commit as one.
 */
export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(150),
  email: emailSchema,
  password: passwordSchema,
  organization: organizationDetailsSchema,
});

export const refreshSchema = z.object({
  // Browsers send this as a cookie; other clients may post it.
  refreshToken: z.string().min(1).optional(),
  // Keeps the reissued access token pointed at the workspace in view.
  organizationSlug: organizationSlugSchema.optional(),
});

export const switchOrganizationSchema = z.object({
  organizationSlug: organizationSlugSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current one",
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20, "Access activation token is required"),
  fullName: z.string().trim().min(2, "Enter your full name").max(150),
  email: emailSchema,
  password: passwordSchema,
});
export const acceptExistingInvitationSchema = z.object({
  token: z.string().min(20, "Access activation token is required"),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type AcceptExistingInvitationInput = z.infer<typeof acceptExistingInvitationSchema>;
