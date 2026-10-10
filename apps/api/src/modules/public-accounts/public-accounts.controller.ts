import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { ordersForCustomer } from "../shop/shop.service";
import { env } from "../../config/env";
import { UnauthorizedError } from "../../utils/errors";
import type {
  PublicCustomerLoginInput,
  PublicCustomerProfileInput,
  PublicCustomerRegisterInput,
  PublicCustomerResendVerificationInput,
  PublicCustomerVerificationCodeInput,
} from "./public-accounts.validation";
import * as service from "./public-accounts.service";
import {
  PUBLIC_CUSTOMER_ACCESS_COOKIE,
  PUBLIC_CUSTOMER_REFRESH_COOKIE,
} from "./public-accounts.cookies";

export { PUBLIC_CUSTOMER_ACCESS_COOKIE, PUBLIC_CUSTOMER_REFRESH_COOKIE };

function cookieBase(): CookieOptions {
  return { httpOnly: true, secure: env.isProduction, sameSite: "lax" };
}

function cookiePath(domain: string): string {
  return `/api/v1/public/websites/domains/${encodeURIComponent(domain.toLowerCase().replace(/^www\./, ""))}/account`;
}

function setCookies(
  res: Response,
  domain: string,
  tokens: service.PublicCustomerTokens,
): void {
  const path = cookiePath(domain);
  res.cookie(PUBLIC_CUSTOMER_ACCESS_COOKIE, tokens.accessToken, {
    ...cookieBase(), path, maxAge: (tokens.accessExpiresAt.getTime() - Date.now()),
  });
  res.cookie(PUBLIC_CUSTOMER_REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieBase(), path, maxAge: (tokens.refreshExpiresAt.getTime() - Date.now()),
  });
}

function clearCookies(res: Response, domain: string): void {
  const path = cookiePath(domain);
  res.clearCookie(PUBLIC_CUSTOMER_ACCESS_COOKIE, { ...cookieBase(), path });
  res.clearCookie(PUBLIC_CUSTOMER_REFRESH_COOKIE, { ...cookieBase(), path });
}

function requestContext(req: Request): service.PublicCustomerRequestContext {
  return { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function domain(req: Request): string {
  return String(req.params.domain ?? "");
}

export const register: RequestHandler = async (req, res) => {
  const result = await service.registerPublicCustomer(domain(req), req.body as PublicCustomerRegisterInput, requestContext(req));
  res.status(result.sent ? 201 : 202).json({
    verification: result,
    message: result.sent
      ? "Un code de confirmation vient d’être envoyé."
      : "Le code n’a pas pu être livré. Vérifiez votre contact ou essayez un autre canal.",
  });
};

export const resendVerification: RequestHandler = async (req, res) => {
  const verification = await service.resendPublicCustomerVerification(
    domain(req),
    req.body as PublicCustomerResendVerificationInput,
    requestContext(req),
  );
  res.status(202).json({
    verification,
    message: verification?.sent
      ? "Si ce compte doit être confirmé, un code de confirmation vient d’être envoyé."
      : "Si ce compte doit être confirmé, vérifiez le contact saisi ou essayez un autre canal.",
  });
};

export const verifyCode: RequestHandler = async (req, res) => {
  const account = await service.verifyPublicCustomerCode(
    domain(req),
    req.body as PublicCustomerVerificationCodeInput,
    requestContext(req),
  );
  // Verification and sign-in are intentionally separate.  A stolen code
  // cannot silently create a long-lived browser session.
  res.json({ account, message: "Votre contact est confirmé. Vous pouvez maintenant vous connecter." });
};

export const verifyEmail: RequestHandler = async (req, res) => {
  const result = await service.verifyPublicCustomerEmail(domain(req), String(req.body.token), requestContext(req));
  res.json({ account: result, message: "Votre adresse e-mail est confirmée. Vous pouvez maintenant vous connecter." });
};

export const login: RequestHandler = async (req, res) => {
  const result = await service.loginPublicCustomer(domain(req), req.body as PublicCustomerLoginInput, requestContext(req));
  setCookies(res, domain(req), result.tokens);
  res.json({ account: result.account, expiresAt: result.tokens.accessExpiresAt.toISOString() });
};

export const refresh: RequestHandler = async (req, res) => {
  const raw = req.cookies?.[PUBLIC_CUSTOMER_REFRESH_COOKIE] as string | undefined;
  if (!raw) throw new UnauthorizedError("La connexion à votre espace client est requise");
  const result = await service.refreshPublicCustomer(domain(req), raw, requestContext(req));
  setCookies(res, domain(req), result.tokens);
  res.json({ account: result.account, expiresAt: result.tokens.accessExpiresAt.toISOString() });
};

export const logout: RequestHandler = async (req, res) => {
  const raw = req.cookies?.[PUBLIC_CUSTOMER_REFRESH_COOKIE] as string | undefined;
  await service.revokePublicCustomerSession(domain(req), raw);
  clearCookies(res, domain(req));
  res.status(204).send();
};

export const me: RequestHandler = (_req, res) => {
  res.json({ account: _req.publicCustomer });
};

export const activities: RequestHandler = async (req, res) => {
  res.json({
    activities: await service.listPublicCustomerActivities(
      req.publicCustomerWebsite!,
      req.publicCustomer!,
    ),
  });
};

export const orders: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    orders: await ordersForCustomer(req.publicCustomerWebsite!.organizationId, req.publicCustomer!.customerId ?? null),
  });
};

export const updateProfile: RequestHandler = async (req, res) => {
  const account = await service.updatePublicCustomer(
    req.publicCustomerWebsite!,
    req.publicCustomer!.id,
    req.body as PublicCustomerProfileInput,
  );
  res.json({ account });
};

export const forgotPassword: RequestHandler = async (req, res) => {
  await service.requestPublicCustomerPasswordReset(domain(req), String(req.body.email), requestContext(req));
  res.status(202).json({ message: "Si cet e-mail correspond à un compte client, un lien sécurisé a été envoyé." });
};

export const resetPassword: RequestHandler = async (req, res) => {
  await service.resetPublicCustomerPassword(domain(req), String(req.body.token), String(req.body.password));
  clearCookies(res, domain(req));
  res.json({ message: "Mot de passe mis à jour. Connectez-vous à nouveau." });
};

export const changePassword: RequestHandler = async (req, res) => {
  await service.changePublicCustomerPassword(
    req.publicCustomerWebsite!,
    req.publicCustomer!.id,
    String(req.body.currentPassword),
    String(req.body.newPassword),
  );
  clearCookies(res, domain(req));
  res.json({ message: "Mot de passe mis à jour. Connectez-vous à nouveau." });
};
