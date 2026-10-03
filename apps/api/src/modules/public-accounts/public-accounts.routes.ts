import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./public-accounts.controller";
import { authenticatePublicCustomer } from "./public-accounts.middleware";
import {
  publicCustomerChangePasswordSchema,
  publicCustomerEmailSchema,
  publicCustomerLoginSchema,
  publicCustomerProfileSchema,
  publicCustomerRegisterSchema,
  publicCustomerResendVerificationSchema,
  publicCustomerResetPasswordSchema,
  publicCustomerTokenSchema,
  publicCustomerVerificationCodeSchema,
  publicWebsiteDomainParams,
} from "./public-accounts.validation";

export const publicAccountRoutes = Router();

const attempts = (limit: number) =>
  rateLimit({
    windowMs: 60 * 60 * 1_000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      error: {
        code: "TOO_MANY_PUBLIC_ACCOUNT_ATTEMPTS",
        message: "Trop de tentatives. Réessayez un peu plus tard.",
      },
    },
  });

const base = "/public/websites/domains/:domain/account";

publicAccountRoutes.post(`${base}/register`, attempts(8), validate({ params: publicWebsiteDomainParams, body: publicCustomerRegisterSchema }), controller.register);
publicAccountRoutes.post(`${base}/resend-verification`, attempts(5), validate({ params: publicWebsiteDomainParams, body: publicCustomerResendVerificationSchema }), controller.resendVerification);
publicAccountRoutes.post(`${base}/verify-email`, attempts(8), validate({ params: publicWebsiteDomainParams, body: publicCustomerTokenSchema }), controller.verifyEmail);
publicAccountRoutes.post(`${base}/verify-code`, attempts(8), validate({ params: publicWebsiteDomainParams, body: publicCustomerVerificationCodeSchema }), controller.verifyCode);
publicAccountRoutes.post(`${base}/login`, attempts(10), validate({ params: publicWebsiteDomainParams, body: publicCustomerLoginSchema }), controller.login);
publicAccountRoutes.post(`${base}/refresh`, attempts(20), validate({ params: publicWebsiteDomainParams }), controller.refresh);
publicAccountRoutes.post(`${base}/logout`, validate({ params: publicWebsiteDomainParams }), controller.logout);
publicAccountRoutes.post(`${base}/forgot-password`, attempts(5), validate({ params: publicWebsiteDomainParams, body: publicCustomerEmailSchema }), controller.forgotPassword);
publicAccountRoutes.post(`${base}/reset-password`, attempts(8), validate({ params: publicWebsiteDomainParams, body: publicCustomerResetPasswordSchema }), controller.resetPassword);
publicAccountRoutes.get(`${base}/me`, authenticatePublicCustomer, controller.me);
publicAccountRoutes.get(`${base}/activities`, authenticatePublicCustomer, controller.activities);
publicAccountRoutes.patch(`${base}/me`, authenticatePublicCustomer, validate({ body: publicCustomerProfileSchema }), controller.updateProfile);
publicAccountRoutes.post(`${base}/change-password`, authenticatePublicCustomer, validate({ body: publicCustomerChangePasswordSchema }), controller.changePassword);
