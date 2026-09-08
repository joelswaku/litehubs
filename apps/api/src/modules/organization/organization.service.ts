import { logger } from "../../config/logger";
import { query } from "../../config/database";
import { withTenantContext } from "../../utils/tenant-query";
import { storeImage } from "../../services/file-storage.service";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import {
  provisionOrganization,
  type OrganizationAddress,
} from "../../platform/provisioning/provisioning.service";
import * as authService from "../auth/auth.service";
import type { AuthenticatedUser, Membership } from "../auth/auth.types";
import * as repository from "./organization.repository";
import type { UpdateOrganizationProfileInput } from "./organization.validation";

/** How many workspaces one person may create. A guard against runaway signups. */
const MAX_OWNED_WORKSPACES = 5;

export interface Industry {
  code: string;
  name: string;
  description: string | null;
}

/** The choices offered at the "what kind of business is this?" step. */
export async function listIndustries(): Promise<Industry[]> {
  const result = await query<Industry>(
    `SELECT code, name, description
       FROM industries
      WHERE is_active
      ORDER BY sort_order, name`,
  );
  return result.rows;
}

export function listMine(user: AuthenticatedUser): Membership[] {
  // Already loaded by `authenticate` — no second read.
  return user.memberships;
}

export interface CreateWorkspaceInput {
  slug: string;
  legalName: string;
  displayName?: string;
  industryCode?: string | null;
  country?: string | null;
  address?: OrganizationAddress | undefined;
  timezone?: string;
  currency?: string;
}

/**
 * Self-serve onboarding: the signed-in user creates a workspace and becomes its
 * owner.
 *
 * Delegates to the same provisioning service the CLI uses, so the product path
 * and the operator path cannot drift — and both are exercised against RLS as
 * the ordinary app role.
 */
export async function createWorkspace(
  user: AuthenticatedUser,
  input: CreateWorkspaceInput,
): Promise<{ membership: Membership; accessToken: string; expiresAt: Date }> {
  const owned = user.memberships.filter((m) => m.isOwner).length;
  if (owned >= MAX_OWNED_WORKSPACES) {
    throw new BadRequestError(
      `You already own ${owned} workspaces, which is the limit. Contact support to raise it.`,
    );
  }

  // The industry code is validated inside provisioning, so every path that
  // creates a company — CLI, this one, and signup — agrees on what is offered.
  const result = await provisionOrganization({
    ...input,
    ownerUserId: user.id,
  });

  logger.info(
    {
      userId: user.id,
      organizationId: result.organizationId,
      slug: result.slug,
    },
    "Workspace created through onboarding",
  );

  // The caller's memberships were loaded before this workspace existed, so they
  // are reloaded here — otherwise the switch below would not find the new slug.
  const switched = await authService.switchOrganization(user.id, result.slug);
  const membership = switched.user.activeMembership!;

  return {
    membership,
    accessToken: switched.accessToken,
    expiresAt: switched.accessTokenExpiresAt,
  };
}

export async function getProfile(
  userId: string,
  organizationId: string,
): Promise<repository.OrganizationProfile> {
  const profile = await repository.findProfile(userId, organizationId);
  if (!profile) throw new NotFoundError("Workspace not found");
  return profile;
}

/** Owner-only, tenant-scoped company profile update. Every column is selected
 * from a fixed allow-list; no browser-provided property can become SQL. */
export async function updateProfile(
  userId: string,
  organizationId: string,
  input: UpdateOrganizationProfileInput,
): Promise<repository.OrganizationProfile> {
  return withTenantContext({ userId, organizationId }, async (client) => {
    const assignments: string[] = [];
    const values: unknown[] = [organizationId];
    const set = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column}=$${values.length}`);
    };
    if (input.legalName !== undefined) set("legal_name", input.legalName);
    if (input.displayName !== undefined) set("display_name", input.displayName);
    if (input.country !== undefined) set("country", input.country);
    if (input.timezone !== undefined) set("timezone", input.timezone);
    if (input.currency !== undefined) set("currency", input.currency);
    if (input.address) {
      if (input.address.addressLine1 !== undefined) set("address_line1", input.address.addressLine1);
      if (input.address.addressLine2 !== undefined) set("address_line2", input.address.addressLine2);
      if (input.address.city !== undefined) set("city", input.address.city);
      if (input.address.region !== undefined) set("region", input.address.region);
      if (input.address.postalCode !== undefined) set("postal_code", input.address.postalCode);
    }
    if (!assignments.length) throw new BadRequestError("Provide at least one company detail to update");
    const result = await client.query(
      `UPDATE organizations SET ${assignments.join(", ")}, updated_at=now() WHERE id=$1`,
      values,
    );
    if (!result.rowCount) throw new NotFoundError("Workspace not found");
    const profile = await repository.findProfile(userId, organizationId);
    if (!profile) throw new NotFoundError("Workspace not found");
    return profile;
  });
}
/** Owner-only company mark. PNG/JPEG is stored in the existing Cloudinary image
 * service and only its URL is retained as a non-sensitive brand asset. */
export async function uploadCompanyLogo(
  userId: string,
  organizationId: string,
  file: Express.Multer.File,
): Promise<repository.OrganizationProfile> {
  const stored = await storeImage({
    organizationId,
    module: "organization",
    resource: "official-logo",
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  return withTenantContext({ userId, organizationId }, async (client) => {
    await client.query(
      `INSERT INTO organization_settings (organization_id,logo_url)
         VALUES ($1,$2)
       ON CONFLICT (organization_id)
       DO UPDATE SET logo_url=EXCLUDED.logo_url,updated_at=now()`,
      [organizationId, stored.url],
    );
    const profile = await repository.findProfile(userId, organizationId);
    if (!profile) throw new NotFoundError("Workspace not found");
    return profile;
  });
}
export async function operationalServices(userId: string, organizationId: string) {
  return withTenantContext({ userId, organizationId }, async (client) => {
    const result=await client.query<{ preferences: Record<string, unknown> | null }>("SELECT preferences FROM organization_settings WHERE organization_id=$1",[organizationId]);
    const raw=result.rows[0]?.preferences?.operationalServices;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : null;
  });
}
export async function updateOperationalServices(userId: string, organizationId: string, services: string[]) {
  return withTenantContext({ userId, organizationId }, async (client) => {
    await client.query(`INSERT INTO organization_settings (organization_id,preferences) VALUES ($1,jsonb_build_object('operationalServices',$2::jsonb,'operationalServicesConfiguredAt',to_jsonb(now()))) ON CONFLICT (organization_id) DO UPDATE SET preferences=COALESCE(organization_settings.preferences,'{}'::jsonb) || jsonb_build_object('operationalServices',$2::jsonb,'operationalServicesConfiguredAt',to_jsonb(now()))`,[organizationId,JSON.stringify(services)]);
    return services;
  });
}