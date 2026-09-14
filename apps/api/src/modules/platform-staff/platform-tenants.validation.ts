import { z } from "zod";

export const tenantSlugParams = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Not a valid workspace address"),
});

export const listTenantsQuery = z.object({
  status: z.enum(["provisioning", "active", "suspended", "archived"]).optional(),
  industryCode: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]*$/).max(50).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const setTenantStatusBody = z.object({
  status: z.enum(["active", "suspended"]),
});

/** Re-authentication and exact legal-name confirmation for irreversible work. */
export const confirmTenantDeletionBody = z.object({
  confirmationName: z.string().trim().min(1).max(180),
  currentPassword: z.string().min(1).max(500),
});