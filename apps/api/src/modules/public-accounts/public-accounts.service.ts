import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { PoolClient } from "pg";
import { env } from "../../config/env";
import { query } from "../../config/database";
import { logger } from "../../config/logger";
import { sendMail, sendSms } from "../../services/notification.service";
import { isValidPhone, normalizePhone } from "../../utils/phone";
import { withTenantContext } from "../../utils/tenant-query";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/errors";
import { hashPassword } from "../auth/auth.service";
import { listPublicCustomerActivities as listSharedCustomerActivities } from "../company-setup/customer-activities.service";
import type {
  PublicCustomerLoginInput,
  PublicCustomerProfileInput,
  PublicCustomerRegisterInput,
  PublicCustomerResendVerificationInput,
  PublicCustomerVerificationCodeInput,
} from "./public-accounts.validation";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACTION_TOKEN_TTL_SECONDS = 60 * 60;
const VERIFICATION_CODE_TTL_SECONDS = 10 * 60;
const MAX_VERIFICATION_CODE_ATTEMPTS = 6;
const MAX_FAILED_LOGINS = env.auth.maxFailedLogins;
const LOCK_DURATION = `${env.auth.lockDurationSeconds} seconds`;
const TOKEN_ISSUER = "litehubs";
const TOKEN_AUDIENCE = "litehubs-public-customer";
const DUMMY_HASH = bcrypt.hashSync("public-customer-timing-parity", 10);

export type PublicCustomerRequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

export type PublicWebsiteAccountContext = {
  organizationId: string;
  canonicalDomain: string;
  displayName: string;
  contactEmail: string | null;
};

type AccountStatus =
  | "pending_email_verification"
  | "active"
  | "suspended"
  | "closed";

type PublicCustomerAccountRow = {
  id: string;
  organization_id: string;
  customer_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  status: AccountStatus;
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  verification_channel: "email" | "sms";
  newsletter_opt_in: boolean;
  newsletter_opted_in_at: Date | null;
  newsletter_opted_out_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
};

export type PublicCustomer = {
  id: string;
  customerId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  newsletterOptIn: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  verificationChannel: "email" | "sms";
  lastLoginAt: string | null;
};

export type PublicCustomerTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

export type PublicCustomerLoginResult = {
  account: PublicCustomer;
  tokens: PublicCustomerTokens;
};

export type PublicCustomerVerificationDelivery = {
  channel: "email" | "sms";
  destination: string;
};

export type PublicCustomerActivity = {
  id: string;
  title: string;
  summary: string;
  body: string | null;
  imageUrl: string | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
  audience: "all" | "invited";
  status: "draft" | "published" | "archived";
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  recipientCount: number;
  sentCount: number;
};

type PublicCustomerVerificationCodeRow = {
  id: string;
  account_id: string;
  delivery_channel: "email" | "sms";
  code_hash: string;
  expires_at: Date;
  used_at: Date | null;
  attempt_count: number;
};

function canonicalDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

function fingerprint(rawToken: string): string {
  return crypto
    .createHmac("sha256", env.refreshTokenSecret)
    .update(rawToken)
    .digest("hex");
}

function verificationCodeFingerprint(code: string): string {
  return fingerprint(`public-customer-verification:${code}`);
}

function makeVerificationCode(): string {
  return crypto.randomInt(100_000, 1_000_000).toString();
}

function opaqueToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function publicAccount(account: PublicCustomerAccountRow): PublicCustomer {
  return {
    id: account.id,
    customerId: account.customer_id,
    fullName: account.full_name,
    email: account.email,
    phone: account.phone,
    newsletterOptIn: account.newsletter_opt_in,
    emailVerified: account.email_verified_at !== null,
    phoneVerified: account.phone_verified_at !== null,
    verificationChannel: account.verification_channel,
    lastLoginAt: account.last_login_at?.toISOString() ?? null,
  };
}

function isAccountVerified(account: PublicCustomerAccountRow): boolean {
  return account.email_verified_at !== null || account.phone_verified_at !== null;
}

function normalizeAccountIdentifier(identifier: string): {
  email: string | null;
  phone: string | null;
} {
  const value = identifier.trim();
  if (value.includes("@")) return { email: value.toLowerCase(), phone: null };
  const phone = normalizePhone(value);
  if (!isValidPhone(phone)) {
    throw new BadRequestError("Saisissez un e-mail ou un numéro de téléphone valide");
  }
  return { email: null, phone };
}

function destinationFor(
  account: PublicCustomerAccountRow,
  channel: "email" | "sms",
): string {
  const value = channel === "email" ? account.email : account.phone;
  if (!value) {
    throw new BadRequestError(
      channel === "email"
        ? "Ajoutez un e-mail pour recevoir un code par e-mail"
        : "Ajoutez un numéro de téléphone pour recevoir un code par SMS",
    );
  }
  return value;
}

function issueAccessToken(
  account: PublicCustomerAccountRow,
  website: PublicWebsiteAccountContext,
): { token: string; expiresAt: Date } {
  const token = jwt.sign(
    {
      org: website.organizationId,
      domain: website.canonicalDomain,
      kind: "public_customer",
    },
    env.jwtSecret,
    {
      subject: account.id,
      expiresIn: ACCESS_TTL_SECONDS,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    },
  );
  return {
    token,
    expiresAt: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000),
  };
}

export function verifyPublicCustomerAccessToken(token: string): {
  accountId: string;
  organizationId: string;
  domain: string;
} {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    if (typeof payload === "string" || !payload.sub) {
      throw new UnauthorizedError("Le jeton de votre espace client est invalide");
    }
    const claims = payload as { org?: unknown; domain?: unknown; kind?: unknown };
    if (
      claims.kind !== "public_customer" ||
      typeof claims.org !== "string" ||
      typeof claims.domain !== "string"
    ) {
      throw new UnauthorizedError("Le jeton de votre espace client est invalide");
    }
    return {
      accountId: payload.sub,
      organizationId: claims.org,
      domain: canonicalDomain(claims.domain),
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Votre session client a expiré", {
        reason: "token_expired",
      });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError("Le jeton de votre espace client est invalide");
    }
    throw error;
  }
}

export async function resolvePublicWebsiteAccountContext(
  domain: string,
): Promise<PublicWebsiteAccountContext> {
  const canonical = canonicalDomain(domain);
  const result = await query<{
    organization_id: string;
    canonical_domain: string;
    display_name: string;
    contact_email: string | null;
  }>(
    `SELECT organization_id, canonical_domain, display_name, contact_email
       FROM public_website_account_context($1)`,
    [canonical],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Ce site public n’est pas disponible");
  return {
    organizationId: row.organization_id,
    canonicalDomain: canonical,
    displayName: row.display_name,
    contactEmail: row.contact_email,
  };
}

async function findAccountById(
  client: PoolClient,
  organizationId: string,
  accountId: string,
): Promise<PublicCustomerAccountRow | null> {
  const result = await client.query<PublicCustomerAccountRow>(
    `SELECT id,organization_id,customer_id,full_name,email::text AS email,phone,
            password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
            newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
            locked_until,last_login_at
       FROM public_customer_accounts
      WHERE organization_id=$1 AND id=$2
      LIMIT 1`,
    [organizationId, accountId],
  );
  return result.rows[0] ?? null;
}

async function createSession(
  website: PublicWebsiteAccountContext,
  account: PublicCustomerAccountRow,
  context: PublicCustomerRequestContext,
): Promise<PublicCustomerTokens> {
  const access = issueAccessToken(account, website);
  const refreshToken = opaqueToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      await client.query(
        `INSERT INTO public_customer_refresh_tokens
           (organization_id,account_id,token_hash,expires_at,user_agent,ip_address)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          website.organizationId,
          account.id,
          fingerprint(refreshToken),
          refreshExpiresAt,
          context.userAgent,
          context.ipAddress,
        ],
      );
    },
  );
  return {
    accessToken: access.token,
    refreshToken,
    accessExpiresAt: access.expiresAt,
    refreshExpiresAt,
  };
}

function customerCode(): string {
  return `WEB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function actionUrl(
  website: PublicWebsiteAccountContext,
  parameter: "verify" | "reset",
  token: string,
): string {
  const query = `${parameter}=${encodeURIComponent(token)}`;
  // A locally opened builder preview still needs a working confirmation link.
  // Production links always stay on the branded public domain, never LiteHubs.
  if (!env.isProduction) {
    return `${env.frontendUrl.replace(/\/$/, "")}/sites/congo-omega/account?${query}`;
  }
  return `https://${website.canonicalDomain}/account?${query}`;
}

function publicAccountUrl(website: PublicWebsiteAccountContext): string {
  if (!env.isProduction) {
    return `${env.frontendUrl.replace(/\/$/, "")}/sites/congo-omega/account`;
  }
  return `https://${website.canonicalDomain}/account`;
}

function accountEmailHtml(
  website: PublicWebsiteAccountContext,
  name: string,
  title: string,
  body: string,
  actionLabel: string,
  url: string,
  footer = "Ce lien sécurisé expire dans une heure. Si vous n’avez pas demandé cette action, vous pouvez ignorer ce message.",
): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f3f6f3;font-family:Arial,Helvetica,sans-serif;color:#17221d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="padding:25px 32px;background:#075c4d;color:#fff;font-weight:800;font-size:22px">${escapeHtml(website.displayName)}</td></tr><tr><td style="padding:36px 32px"><p style="margin:0 0 14px;font-size:17px">Bonjour ${escapeHtml(name)},</p><h1 style="margin:0 0 17px;font-size:25px;color:#0f172a">${escapeHtml(title)}</h1><p style="margin:0;color:#475569;font-size:15px;line-height:1.65">${escapeHtml(body)}</p><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;border-radius:9px;background:#075c4d;color:#fff;padding:13px 19px;font-weight:700;text-decoration:none">${escapeHtml(actionLabel)}</a></p><p style="margin:0;color:#64748b;font-size:12px;line-height:1.55">${escapeHtml(footer)}</p></td></tr></table></td></tr></table></body></html>`;
}

function verificationCodeEmailHtml(
  website: PublicWebsiteAccountContext,
  name: string,
  code: string,
): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Code de confirmation</title></head><body style="margin:0;background:#f3f6f3;font-family:Arial,Helvetica,sans-serif;color:#17221d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="padding:25px 32px;background:#075c4d;color:#fff;font-weight:800;font-size:22px">${escapeHtml(website.displayName)}</td></tr><tr><td style="padding:36px 32px"><p style="margin:0 0 14px;font-size:17px">Bonjour ${escapeHtml(name)},</p><h1 style="margin:0 0 17px;font-size:25px;color:#0f172a">Confirmez votre contact</h1><p style="margin:0;color:#475569;font-size:15px;line-height:1.65">Saisissez ce code dans votre espace client pour finaliser votre inscription.</p><p style="margin:28px 0;border-radius:12px;background:#edf7f0;padding:18px;text-align:center;color:#075c4d;font-size:30px;font-weight:800;letter-spacing:8px">${escapeHtml(code)}</p><p style="margin:0;color:#64748b;font-size:12px;line-height:1.55">Ce code expire dans 10 minutes. Ne le communiquez à personne, y compris à Congo Omega.</p></td></tr></table></td></tr></table></body></html>`;
}

async function deliverVerificationCode(
  website: PublicWebsiteAccountContext,
  account: PublicCustomerAccountRow,
  requestedChannel: "email" | "sms",
  code: string,
): Promise<PublicCustomerVerificationDelivery & { sent: boolean }> {
  const deliverByEmail = async () => {
    const destination = destinationFor(account, "email");
    const sent = await sendMail({
      to: destination,
      replyTo: website.contactEmail ?? undefined,
      subject: `${website.displayName} — votre code de confirmation`,
      text: `Bonjour ${account.full_name},\n\nVotre code de confirmation ${website.displayName} est : ${code}\n\nIl expire dans 10 minutes. Ne le communiquez à personne.`,
      html: verificationCodeEmailHtml(website, account.full_name, code),
    });
    return { channel: "email" as const, destination, sent: sent.sent };
  };

  if (requestedChannel === "email") return deliverByEmail();

  const destination = destinationFor(account, "sms");
  const sent = await sendSms({
    to: destination,
    sender: website.displayName.slice(0, 20),
    content: `${website.displayName} : votre code de confirmation est ${code}. Il expire dans 10 min. Ne le partagez avec personne.`,
  });
  if (sent.sent) return { channel: "sms", destination, sent: true };

  // A phone-first customer is not left without recourse when a carrier rejects
  // an SMS.  If they also provided email, the *same* short-lived code falls
  // back there and the screen states the actual channel used.
  if (account.email) return deliverByEmail();
  logger.warn(
    { accountId: account.id, reason: sent.reason },
    "Public customer verification SMS was not delivered",
  );
  return { channel: "sms", destination, sent: false };
}

async function createVerificationCode(
  client: PoolClient,
  website: PublicWebsiteAccountContext,
  accountId: string,
  channel: "email" | "sms",
  context: PublicCustomerRequestContext,
): Promise<string> {
  const code = makeVerificationCode();
  await client.query(
    `UPDATE public_customer_account_verification_codes
        SET used_at=now()
      WHERE organization_id=$1 AND account_id=$2 AND used_at IS NULL`,
    [website.organizationId, accountId],
  );
  await client.query(
    `INSERT INTO public_customer_account_verification_codes
       (organization_id,account_id,delivery_channel,code_hash,expires_at,requested_ip)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      website.organizationId,
      accountId,
      channel,
      verificationCodeFingerprint(code),
      new Date(Date.now() + VERIFICATION_CODE_TTL_SECONDS * 1000),
      context.ipAddress,
    ],
  );
  return code;
}

async function sendActionEmail(
  website: PublicWebsiteAccountContext,
  account: PublicCustomerAccountRow,
  purpose: "verify_email" | "reset_password",
  rawToken: string,
): Promise<void> {
  if (!account.email) {
    logger.warn({ accountId: account.id, purpose }, "Public customer email action skipped without email");
    return;
  }
  const verify = purpose === "verify_email";
  const title = verify ? "Confirmez votre compte" : "Réinitialisez votre mot de passe";
  const url = actionUrl(website, verify ? "verify" : "reset", rawToken);
  const body = verify
    ? `Confirmez votre adresse e-mail pour activer votre compte client ${website.displayName}.`
    : `Utilisez ce lien pour choisir un nouveau mot de passe pour votre compte client ${website.displayName}.`;
  const sent = await sendMail({
    to: account.email,
    replyTo: website.contactEmail ?? undefined,
    subject: `${website.displayName} — ${title}`,
    text: `Bonjour ${account.full_name},\n\n${body}\n\n${url}\n\nCe lien expire dans une heure.`,
    html: accountEmailHtml(
      website,
      account.full_name,
      title,
      body,
      verify ? "Confirmer mon compte" : "Réinitialiser mon mot de passe",
      url,
    ),
  });
  if (!sent.sent) {
    logger.warn(
      { accountId: account.id, purpose, reason: sent.reason },
      "Public customer action email was not delivered",
    );
  }
}

async function sendWelcomeMessage(
  website: PublicWebsiteAccountContext,
  account: PublicCustomerAccountRow,
): Promise<void> {
  const accountUrl = publicAccountUrl(website);
  const body = `Votre compte est maintenant confirmé. Vous pouvez vous connecter à votre espace personnel pour retrouver vos communications et les services mis à votre disposition.`;
  try {
    if (account.email) {
      const sent = await sendMail({
        to: account.email,
        replyTo: website.contactEmail ?? undefined,
        subject: `${website.displayName} — bienvenue dans votre espace client`,
        text: `Bonjour ${account.full_name},\n\n${body}\n\nAccéder à mon compte : ${accountUrl}\n\nCordialement,\n${website.displayName}`,
        html: accountEmailHtml(
          website,
          account.full_name,
          "Bienvenue dans votre espace client",
          body,
          "Accéder à mon compte",
          accountUrl,
          "Conservez vos identifiants de connexion en lieu sûr. Notre équipe ne vous demandera jamais votre mot de passe.",
        ),
      });
      if (!sent.sent) {
        logger.warn({ accountId: account.id, reason: sent.reason }, "Public customer welcome email was not delivered");
      }
      return;
    }
    if (account.phone) {
      const sent = await sendSms({
        to: account.phone,
        sender: website.displayName.slice(0, 20),
        content: `${website.displayName} : bienvenue. Votre compte est confirmé. Vous pouvez maintenant vous connecter à votre espace client.`,
      });
      if (!sent.sent) {
        logger.warn({ accountId: account.id, reason: sent.reason }, "Public customer welcome SMS was not delivered");
      }
    }
  } catch (error) {
    // Account activation is already complete.  A notification failure must
    // never force a person to repeat confirmation or expose delivery details.
    logger.warn({ err: error, accountId: account.id }, "Public customer welcome notification failed");
  }
}

async function createActionToken(
  client: PoolClient,
  website: PublicWebsiteAccountContext,
  accountId: string,
  purpose: "verify_email" | "reset_password",
  context: PublicCustomerRequestContext,
): Promise<string> {
  const rawToken = opaqueToken();
  await client.query(
    `UPDATE public_customer_account_tokens
        SET used_at=now()
      WHERE organization_id=$1 AND account_id=$2 AND purpose=$3 AND used_at IS NULL`,
    [website.organizationId, accountId, purpose],
  );
  await client.query(
    `INSERT INTO public_customer_account_tokens
       (organization_id,account_id,purpose,token_hash,expires_at,requested_ip)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      website.organizationId,
      accountId,
      purpose,
      fingerprint(rawToken),
      new Date(Date.now() + ACTION_TOKEN_TTL_SECONDS * 1000),
      context.ipAddress,
    ],
  );
  return rawToken;
}

export async function registerPublicCustomer(
  domain: string,
  input: PublicCustomerRegisterInput,
  context: PublicCustomerRequestContext,
): Promise<PublicCustomerVerificationDelivery & { sent: boolean }> {
  const website = await resolvePublicWebsiteAccountContext(domain);
  const passwordHash = await hashPassword(input.password);
  const registered = await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM public_customer_accounts
          WHERE organization_id=$1
            AND (($2::citext IS NOT NULL AND email=$2::citext)
              OR ($3::text IS NOT NULL AND phone=$3))
          LIMIT 1`,
        [website.organizationId, input.email, input.phone],
      );
      if (existing.rowCount) {
        throw new ConflictError(
          "Un espace client existe déjà pour cet e-mail ou ce numéro. Connectez-vous ou réinitialisez le mot de passe.",
        );
      }
      let customerId: string | null = null;
      const linkedCustomer = await client.query<{ id: string }>(
        `SELECT id FROM customers
          WHERE organization_id=$1
            AND (email=$2::citext OR ($3::text IS NOT NULL AND phone=$3))
          ORDER BY created_at ASC LIMIT 1`,
        [website.organizationId, input.email, input.phone],
      );
      customerId = linkedCustomer.rows[0]?.id ?? null;
      if (!customerId) {
        const createdCustomer = await client.query<{ id: string }>(
          `INSERT INTO customers
             (organization_id,code,name,customer_type,contact_name,phone,email,is_active)
           VALUES ($1,$2,$3,'individual',$3,$4,$5::citext,true)
           RETURNING id`,
          [
            website.organizationId,
            customerCode(),
            input.fullName,
            input.phone,
            input.email,
          ],
        );
        customerId = createdCustomer.rows[0]!.id;
      }
      const created = await client.query<PublicCustomerAccountRow>(
        `INSERT INTO public_customer_accounts
           (organization_id,customer_id,full_name,email,phone,password_hash,
            verification_channel,newsletter_opt_in,newsletter_opted_in_at)
         VALUES ($1,$2,$3,$4::citext,$5,$6,$7,$8,
           CASE WHEN $8 THEN now() ELSE NULL END)
         RETURNING id,organization_id,customer_id,full_name,email::text AS email,phone,
           password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
           newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
           locked_until,last_login_at`,
        [
          website.organizationId,
          customerId,
          input.fullName,
          input.email,
          input.phone,
          passwordHash,
          input.verificationChannel,
          input.newsletterOptIn,
        ],
      );
      const account = created.rows[0]!;
      const code = await createVerificationCode(
        client,
        website,
        account.id,
        input.verificationChannel,
        context,
      );
      return { account, code };
    },
  );
  return deliverVerificationCode(
    website,
    registered.account,
    input.verificationChannel,
    registered.code,
  );
}

export async function resendPublicCustomerVerification(
  domain: string,
  input: PublicCustomerResendVerificationInput,
  context: PublicCustomerRequestContext,
): Promise<(PublicCustomerVerificationDelivery & { sent: boolean }) | null> {
  const website = await resolvePublicWebsiteAccountContext(domain);
  const identifier = normalizeAccountIdentifier(input.identifier);
  const payload = await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const result = await client.query<PublicCustomerAccountRow>(
        `SELECT id,organization_id,customer_id,full_name,email::text AS email,phone,
                password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
                newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
                locked_until,last_login_at
           FROM public_customer_accounts
          WHERE organization_id=$1
            AND (($2::citext IS NOT NULL AND email=$2::citext)
              OR ($3::text IS NOT NULL AND phone=$3))
            AND status='pending_email_verification'
          LIMIT 1`,
        [website.organizationId, identifier.email, identifier.phone],
      );
      const account = result.rows[0];
      if (!account || isAccountVerified(account)) return null;
      destinationFor(account, input.channel);
      await client.query(
        `UPDATE public_customer_accounts SET verification_channel=$3
          WHERE organization_id=$1 AND id=$2`,
        [website.organizationId, account.id, input.channel],
      );
      account.verification_channel = input.channel;
      const code = await createVerificationCode(
        client,
        website,
        account.id,
        input.channel,
        context,
      );
      return { account, code };
    },
  );
  if (!payload) return null;
  return deliverVerificationCode(website, payload.account, input.channel, payload.code);
}

export async function verifyPublicCustomerCode(
  domain: string,
  input: PublicCustomerVerificationCodeInput,
  _context: PublicCustomerRequestContext,
): Promise<PublicCustomer> {
  const website = await resolvePublicWebsiteAccountContext(domain);
  const identifier = normalizeAccountIdentifier(input.identifier);
  const account = await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const found = await client.query<PublicCustomerAccountRow>(
        `SELECT id,organization_id,customer_id,full_name,email::text AS email,phone,
                password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
                newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
                locked_until,last_login_at
           FROM public_customer_accounts
          WHERE organization_id=$1
            AND (($2::citext IS NOT NULL AND email=$2::citext)
              OR ($3::text IS NOT NULL AND phone=$3))
          LIMIT 1
          FOR UPDATE`,
        [website.organizationId, identifier.email, identifier.phone],
      );
      const account = found.rows[0];
      if (!account || account.status !== "pending_email_verification") {
        throw new UnauthorizedError("Ce code est invalide ou a expiré");
      }
      const code = await client.query<PublicCustomerVerificationCodeRow>(
        `SELECT id,account_id,delivery_channel,code_hash,expires_at,used_at,attempt_count
           FROM public_customer_account_verification_codes
          WHERE organization_id=$1 AND account_id=$2 AND delivery_channel=$3
            AND used_at IS NULL AND expires_at>now()
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [website.organizationId, account.id, input.channel],
      );
      const challenge = code.rows[0];
      if (!challenge || challenge.attempt_count >= MAX_VERIFICATION_CODE_ATTEMPTS) {
        throw new UnauthorizedError("Ce code est invalide ou a expiré");
      }
      if (challenge.code_hash !== verificationCodeFingerprint(input.code)) {
        await client.query(
          `UPDATE public_customer_account_verification_codes
              SET attempt_count=attempt_count+1
            WHERE id=$1 AND organization_id=$2`,
          [challenge.id, website.organizationId],
        );
        throw new UnauthorizedError("Ce code est invalide ou a expiré");
      }
      const activated = await client.query<PublicCustomerAccountRow>(
        `UPDATE public_customer_accounts
            SET status='active',verification_channel=$3,
                email_verified_at=CASE WHEN $3='email' THEN COALESCE(email_verified_at,now()) ELSE email_verified_at END,
                phone_verified_at=CASE WHEN $3='sms' THEN COALESCE(phone_verified_at,now()) ELSE phone_verified_at END,
                failed_login_attempts=0,locked_until=NULL
          WHERE organization_id=$1 AND id=$2
          RETURNING id,organization_id,customer_id,full_name,email::text AS email,phone,
            password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
            newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
            locked_until,last_login_at`,
        [website.organizationId, account.id, input.channel],
      );
      await client.query(
        `UPDATE public_customer_account_verification_codes SET used_at=now()
          WHERE id=$1 AND organization_id=$2`,
        [challenge.id, website.organizationId],
      );
      return activated.rows[0]!;
    },
  );
  await sendWelcomeMessage(website, account);
  return publicAccount(account);
}

export async function verifyPublicCustomerEmail(
  domain: string,
  rawToken: string,
  _context: PublicCustomerRequestContext,
): Promise<PublicCustomer> {
  const website = await resolvePublicWebsiteAccountContext(domain);
  const account = await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const token = await client.query<{ id: string; account_id: string }>(
        `SELECT id,account_id FROM public_customer_account_tokens
          WHERE organization_id=$1 AND purpose='verify_email' AND token_hash=$2
            AND used_at IS NULL AND expires_at>now()
          FOR UPDATE`,
        [website.organizationId, fingerprint(rawToken)],
      );
      if (!token.rowCount) throw new UnauthorizedError("Ce lien de confirmation est invalide ou a expiré");
      const activated = await client.query<PublicCustomerAccountRow>(
        `UPDATE public_customer_accounts
            SET status='active',email_verified_at=COALESCE(email_verified_at,now()),
                failed_login_attempts=0,locked_until=NULL
          WHERE organization_id=$1 AND id=$2 AND status IN ('pending_email_verification','active')
          RETURNING id,organization_id,customer_id,full_name,email::text AS email,phone,
            password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
            newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
            locked_until,last_login_at`,
        [website.organizationId, token.rows[0]!.account_id],
      );
      if (!activated.rowCount) throw new ForbiddenError("Cet espace client ne peut pas être activé");
      await client.query(
        `UPDATE public_customer_account_tokens SET used_at=now() WHERE id=$1`,
        [token.rows[0]!.id],
      );
      return activated.rows[0]!;
    },
  );
  // Email-link confirmation is retained only for links issued before the
  // six-digit-code flow.  Confirmation never creates a browser session.
  await sendWelcomeMessage(website, account);
  return publicAccount(account);
}

export async function loginPublicCustomer(
  domain: string,
  input: PublicCustomerLoginInput,
  context: PublicCustomerRequestContext,
): Promise<PublicCustomerLoginResult> {
  const website = await resolvePublicWebsiteAccountContext(domain);
  const identifier = normalizeAccountIdentifier(input.identifier);
  const account = await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const result = await client.query<PublicCustomerAccountRow>(
        `SELECT id,organization_id,customer_id,full_name,email::text AS email,phone,
                password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
                newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
                locked_until,last_login_at
           FROM public_customer_accounts
          WHERE organization_id=$1
            AND (email=$2::citext OR phone=$3)
          LIMIT 1`,
        [website.organizationId, identifier.email, identifier.phone],
      );
      const candidate = result.rows[0];
      if (!candidate) {
        await bcrypt.compare(input.password, DUMMY_HASH);
        throw new UnauthorizedError("Identifiant ou mot de passe incorrect");
      }
      if (candidate.locked_until && candidate.locked_until > new Date()) {
        throw new ForbiddenError("Trop de tentatives échouées. Réessayez dans quelques instants.", {
          lockedUntil: candidate.locked_until.toISOString(),
        });
      }
      const matches = await bcrypt.compare(input.password, candidate.password_hash);
      if (!matches) {
        await client.query(
          `UPDATE public_customer_accounts
              SET failed_login_attempts=failed_login_attempts+1,
                  locked_until=CASE WHEN failed_login_attempts+1 >= $3 THEN now()+$4::interval ELSE NULL END
            WHERE organization_id=$1 AND id=$2`,
          [website.organizationId, candidate.id, MAX_FAILED_LOGINS, LOCK_DURATION],
        );
        throw new UnauthorizedError("Identifiant ou mot de passe incorrect");
      }
      if (candidate.status === "pending_email_verification" || !isAccountVerified(candidate)) {
        throw new ForbiddenError("Confirmez votre e-mail ou votre numéro avant de vous connecter.", {
          reason: "contact_not_verified",
        });
      }
      if (candidate.status !== "active") {
        throw new ForbiddenError("Cet espace client n’est pas disponible");
      }
      const updated = await client.query<PublicCustomerAccountRow>(
        `UPDATE public_customer_accounts
            SET failed_login_attempts=0,locked_until=NULL,last_login_at=now()
          WHERE organization_id=$1 AND id=$2
          RETURNING id,organization_id,customer_id,full_name,email::text AS email,phone,
            password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
            newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
            locked_until,last_login_at`,
        [website.organizationId, candidate.id],
      );
      return updated.rows[0]!;
    },
  );
  const tokens = await createSession(website, account, context);
  return { account: publicAccount(account), tokens };
}

export async function refreshPublicCustomer(
  domain: string,
  rawToken: string,
  context: PublicCustomerRequestContext,
): Promise<PublicCustomerLoginResult> {
  const website = await resolvePublicWebsiteAccountContext(domain);
  const nextRefresh = opaqueToken();
  const nextRefreshExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  const account = await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const found = await client.query<{ id: string; account_id: string; revoked_at: Date | null; expires_at: Date }>(
        `SELECT id,account_id,revoked_at,expires_at
           FROM public_customer_refresh_tokens
          WHERE organization_id=$1 AND token_hash=$2
          FOR UPDATE`,
        [website.organizationId, fingerprint(rawToken)],
      );
      const session = found.rows[0];
      if (!session || session.expires_at <= new Date()) {
        throw new UnauthorizedError("Votre session client a expiré");
      }
      if (session.revoked_at) {
        await client.query(
          `UPDATE public_customer_refresh_tokens SET revoked_at=now()
            WHERE organization_id=$1 AND account_id=$2 AND revoked_at IS NULL`,
          [website.organizationId, session.account_id],
        );
        throw new UnauthorizedError("Votre session client a expiré");
      }
      const next = await client.query<{ id: string }>(
        `INSERT INTO public_customer_refresh_tokens
           (organization_id,account_id,token_hash,expires_at,user_agent,ip_address)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [website.organizationId, session.account_id, fingerprint(nextRefresh), nextRefreshExpiresAt, context.userAgent, context.ipAddress],
      );
      await client.query(
        `UPDATE public_customer_refresh_tokens
            SET revoked_at=now(),replaced_by_id=$3
          WHERE id=$1 AND organization_id=$2`,
        [session.id, website.organizationId, next.rows[0]!.id],
      );
      const account = await findAccountById(client, website.organizationId, session.account_id);
      if (!account || account.status !== "active" || !isAccountVerified(account)) {
        throw new UnauthorizedError("Votre session client n’est plus disponible");
      }
      return account;
    },
  );
  const access = issueAccessToken(account, website);
  return {
    account: publicAccount(account),
    tokens: {
      accessToken: access.token,
      refreshToken: nextRefresh,
      accessExpiresAt: access.expiresAt,
      refreshExpiresAt: nextRefreshExpiresAt,
    },
  };
}

export async function revokePublicCustomerSession(
  domain: string,
  rawToken: string | undefined,
): Promise<void> {
  if (!rawToken) return;
  const website = await resolvePublicWebsiteAccountContext(domain);
  await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      await client.query(
        `UPDATE public_customer_refresh_tokens SET revoked_at=now()
          WHERE organization_id=$1 AND token_hash=$2 AND revoked_at IS NULL`,
        [website.organizationId, fingerprint(rawToken)],
      );
    },
  );
}

export async function getPublicCustomer(
  website: PublicWebsiteAccountContext,
  accountId: string,
): Promise<PublicCustomer> {
  const account = await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    (client) => findAccountById(client, website.organizationId, accountId),
  );
  if (!account || account.status !== "active" || !isAccountVerified(account)) {
    throw new UnauthorizedError("Votre session client n’est plus disponible");
  }
  return publicAccount(account);
}

/** Returns only published communications for this customer's public account.
 * Recruitment, employee and workspace data never enter this response. */
export async function listPublicCustomerActivities(
  website: PublicWebsiteAccountContext,
  account: PublicCustomer,
): Promise<PublicCustomerActivity[]> {
  return listSharedCustomerActivities(website.organizationId, account.email);
}

export async function updatePublicCustomer(
  website: PublicWebsiteAccountContext,
  accountId: string,
  input: PublicCustomerProfileInput,
): Promise<PublicCustomer> {
  const account = await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const result = await client.query<PublicCustomerAccountRow>(
        `UPDATE public_customer_accounts
            SET full_name=$3,phone=$4,newsletter_opt_in=$5,
                newsletter_opted_in_at=CASE WHEN $5 AND newsletter_opt_in=false THEN now() ELSE newsletter_opted_in_at END,
                newsletter_opted_out_at=CASE WHEN NOT $5 AND newsletter_opt_in=true THEN now() ELSE newsletter_opted_out_at END
          WHERE organization_id=$1 AND id=$2 AND status='active'
          RETURNING id,organization_id,customer_id,full_name,email::text AS email,phone,
            password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
            newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
            locked_until,last_login_at`,
        [website.organizationId, accountId, input.fullName, input.phone, input.newsletterOptIn],
      ).catch((error: unknown) => {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError("Ce numéro de téléphone est déjà utilisé par un autre compte");
        }
        throw error;
      });
      if (!result.rowCount) throw new UnauthorizedError("Votre session client n’est plus disponible");
      return result.rows[0]!;
    },
  );
  return publicAccount(account);
}

export async function requestPublicCustomerPasswordReset(
  domain: string,
  email: string,
  context: PublicCustomerRequestContext,
): Promise<void> {
  const website = await resolvePublicWebsiteAccountContext(domain);
  const payload = await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const result = await client.query<PublicCustomerAccountRow>(
        `SELECT id,organization_id,customer_id,full_name,email::text AS email,phone,
                password_hash,status,email_verified_at,phone_verified_at,verification_channel,newsletter_opt_in,
                newsletter_opted_in_at,newsletter_opted_out_at,failed_login_attempts,
                locked_until,last_login_at
           FROM public_customer_accounts
          WHERE organization_id=$1 AND email=$2::citext
            AND status='active' AND email_verified_at IS NOT NULL LIMIT 1`,
        [website.organizationId, email],
      );
      const account = result.rows[0];
      if (!account) return null;
      const token = await createActionToken(
        client,
        website,
        account.id,
        "reset_password",
        context,
      );
      return { account, token };
    },
  );
  if (payload) await sendActionEmail(website, payload.account, "reset_password", payload.token);
}

export async function resetPublicCustomerPassword(
  domain: string,
  rawToken: string,
  newPassword: string,
): Promise<void> {
  const website = await resolvePublicWebsiteAccountContext(domain);
  const passwordHash = await hashPassword(newPassword);
  await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const token = await client.query<{ id: string; account_id: string }>(
        `SELECT id,account_id FROM public_customer_account_tokens
          WHERE organization_id=$1 AND purpose='reset_password' AND token_hash=$2
            AND used_at IS NULL AND expires_at>now()
          FOR UPDATE`,
        [website.organizationId, fingerprint(rawToken)],
      );
      if (!token.rowCount) throw new UnauthorizedError("Ce lien de réinitialisation est invalide ou a expiré");
      await client.query(
        `UPDATE public_customer_accounts
            SET password_hash=$3,failed_login_attempts=0,locked_until=NULL
          WHERE organization_id=$1 AND id=$2`,
        [website.organizationId, token.rows[0]!.account_id, passwordHash],
      );
      await client.query(
        `UPDATE public_customer_account_tokens SET used_at=now() WHERE id=$1`,
        [token.rows[0]!.id],
      );
      await client.query(
        `UPDATE public_customer_refresh_tokens SET revoked_at=now()
          WHERE organization_id=$1 AND account_id=$2 AND revoked_at IS NULL`,
        [website.organizationId, token.rows[0]!.account_id],
      );
    },
  );
}

export async function changePublicCustomerPassword(
  website: PublicWebsiteAccountContext,
  accountId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const newHash = await hashPassword(newPassword);
  await withTenantContext(
    { organizationId: website.organizationId, userId: null },
    async (client) => {
      const account = await findAccountById(client, website.organizationId, accountId);
      if (!account || account.status !== "active") throw new UnauthorizedError("Votre session client n’est plus disponible");
      if (!(await bcrypt.compare(currentPassword, account.password_hash))) {
        throw new UnauthorizedError("Le mot de passe actuel est incorrect");
      }
      await client.query(
        `UPDATE public_customer_accounts SET password_hash=$3 WHERE organization_id=$1 AND id=$2`,
        [website.organizationId, accountId, newHash],
      );
      await client.query(
        `UPDATE public_customer_refresh_tokens SET revoked_at=now()
          WHERE organization_id=$1 AND account_id=$2 AND revoked_at IS NULL`,
        [website.organizationId, accountId],
      );
    },
  );
}
