import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { env } from "../../config/env";

/** Personal Espace candidat links stay valid for the length of a normal
 * recruitment.  A candidate can request a fresh link at any time. */
export const CANDIDATE_PORTAL_LINK_DAYS = 60;

/** Organisations that publish their careers portal on a dedicated host. */
const DEDICATED_CAREERS_HOSTS: Record<string, { host: string; frontend: RegExp }> = {
  "congo-omega": {
    host: "https://carrieres.congoomega.com",
    frontend: /(^|\.)congoomega\.com$/i,
  },
};

export function hashCandidatePortalToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function frontendHost() {
  try {
    return new URL(env.frontendUrl).hostname;
  } catch {
    return "";
  }
}

export function candidatePortalBaseUrl(orgSlug: string) {
  const dedicated = DEDICATED_CAREERS_HOSTS[orgSlug];
  // Production links always use the company careers host, even when the
  // application itself is served from the LiteHubs domain.  Local and
  // preview environments keep their own host so links stay testable.
  const host = frontendHost();
  const local = !host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
  if (dedicated && (!local || dedicated.frontend.test(host))) return dedicated.host;
  return `${env.frontendUrl.replace(/\/$/, "")}/careers/${encodeURIComponent(orgSlug)}`;
}

export function candidatePortalUrl(orgSlug: string, token: string) {
  return `${candidatePortalBaseUrl(orgSlug)}/suivi/${encodeURIComponent(token)}`;
}

/** Issues a new personal link. Only the hash is stored; the raw token exists
 * only long enough to be placed in the candidate's e-mail or SMS. */
export async function issueCandidatePortalLink(
  client: PoolClient,
  organizationId: string,
  organizationSlug: string,
  applicationId: string,
) {
  const token = randomBytes(32).toString("base64url");
  await client.query(
    `INSERT INTO career_application_access_tokens(organization_id,application_id,token_hash,purpose,expires_at)
     VALUES($1,$2,$3,'tracking',now() + make_interval(days => $4))`,
    [organizationId, applicationId, hashCandidatePortalToken(token), CANDIDATE_PORTAL_LINK_DAYS],
  );
  return candidatePortalUrl(organizationSlug, token);
}
