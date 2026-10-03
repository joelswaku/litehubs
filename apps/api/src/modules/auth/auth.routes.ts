import { Router } from "express";
import {
  authOnboardingRateLimiter,
  authRateLimiter,
  authRecoveryRateLimiter,
} from "../../config/security";
import { authenticate } from "../../middleware/auth.middleware";
import { resolveOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./auth.controller";
import {
  acceptInvitationSchema,
  acceptExistingInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  switchOrganizationSchema,
} from "./auth.validation";

export const authRoutes = Router();

// Credential endpoints get strict, independent counters. A failed sign-in
// must never prevent password recovery or an invitation from being completed.
authRoutes.post(
  "/register",
  authOnboardingRateLimiter,
  validate({ body: registerSchema }),
  controller.register,
);

authRoutes.post(
  "/accept-invitation",
  authOnboardingRateLimiter,
  validate({ body: acceptInvitationSchema }),
  controller.acceptInvitation,
);

authRoutes.post(
  "/accept-existing-invitation",
  authenticate,
  validate({ body: acceptExistingInvitationSchema }),
  controller.acceptExistingInvitation,
);

authRoutes.post(
  "/login",
  authRateLimiter,
  validate({ body: loginSchema }),
  controller.login,
);

authRoutes.post(
  "/staff-login",
  authRateLimiter,
  validate({ body: loginSchema }),
  controller.staffLogin,
);

authRoutes.post(
  "/refresh",
  validate({ body: refreshSchema }),
  controller.refresh,
);

authRoutes.post("/logout", controller.logout);

authRoutes.post(
  "/forgot-password",
  authRecoveryRateLimiter,
  validate({ body: forgotPasswordSchema }),
  controller.forgotPassword,
);

authRoutes.post(
  "/reset-password",
  authRecoveryRateLimiter,
  validate({ body: resetPasswordSchema }),
  controller.resetPassword,
);

// ---------------------------------------------------- authenticated ----
// resolveOrganization, not requireOrganization: /me must answer for a caller
// who has no workspace yet, and still report the right permissions for one who
// names a workspace by header.
authRoutes.get("/me", authenticate, resolveOrganization, controller.me);

authRoutes.post("/logout-all", authenticate, controller.logoutEverywhere);

// Changes which workspace the session is acting on.
authRoutes.post(
  "/switch-organization",
  authenticate,
  validate({ body: switchOrganizationSchema }),
  controller.switchOrganization,
);

authRoutes.post(
  "/change-password",
  authenticate,
  validate({ body: changePasswordSchema }),
  controller.changePassword,
);
