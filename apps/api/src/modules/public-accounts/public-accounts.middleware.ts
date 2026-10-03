import type { RequestHandler } from "express";
import { UnauthorizedError } from "../../utils/errors";
import {
  getPublicCustomer,
  resolvePublicWebsiteAccountContext,
  verifyPublicCustomerAccessToken,
} from "./public-accounts.service";
import { PUBLIC_CUSTOMER_ACCESS_COOKIE } from "./public-accounts.cookies";

function extractToken(authorization: string | undefined, cookieToken: unknown): string | undefined {
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }
  return typeof cookieToken === "string" && cookieToken ? cookieToken : undefined;
}

/** A separate guard for a public customer account. It never accepts a LiteHubs
 * workforce token and it re-proves the public website's organization on every request. */
export const authenticatePublicCustomer: RequestHandler = async (req, _res, next) => {
  try {
    const domain = String(req.params.domain ?? "");
    const token = extractToken(req.get("authorization"), req.cookies?.[PUBLIC_CUSTOMER_ACCESS_COOKIE]);
    if (!token) throw new UnauthorizedError("La connexion à votre espace client est requise");
    const claims = verifyPublicCustomerAccessToken(token);
    const website = await resolvePublicWebsiteAccountContext(domain);
    if (claims.organizationId !== website.organizationId || claims.domain !== website.canonicalDomain) {
      throw new UnauthorizedError("La session de votre espace client est invalide");
    }
    req.publicCustomer = await getPublicCustomer(website, claims.accountId);
    req.publicCustomerWebsite = website;
    next();
  } catch (error) {
    next(error);
  }
};
