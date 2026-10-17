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

/** Keeps only the newest personal link of an application working: called
 * once a new link has actually reached the candidate, so an older link that
 * was forwarded or quoted somewhere stops opening the space. */
export async function revokeOlderPortalLinks(client: PoolClient, organizationId: string, applicationId: string) {
  await client.query(
    `UPDATE career_application_access_tokens SET expires_at=now()
      WHERE organization_id=$1 AND application_id=$2 AND purpose='tracking' AND expires_at > now()
        AND id <> (SELECT id FROM career_application_access_tokens
                    WHERE organization_id=$1 AND application_id=$2 AND purpose='tracking'
                    ORDER BY created_at DESC LIMIT 1)`,
    [organizationId, applicationId],
  );
}

/* ------------------------------------------------------------------ */
/* Masking personal links that come back in e-mails                    */
/* ------------------------------------------------------------------ */

/** A personal Espace candidat address (…/suivi/<token>), on any host. */
const PORTAL_LINK_SOURCE = String.raw`https?:\/\/[^\s"'<>()]+\/suivi\/[A-Za-z0-9_-]{40,100}[^\s"'<>()]*`;
export const MASKED_PORTAL_LINK = "[lien personnel du candidat masqué]";

export function isCandidatePortalLink(value: string | undefined | null): boolean {
  return Boolean(value) && new RegExp(`^${PORTAL_LINK_SOURCE}$`, "i").test(String(value).trim());
}

/** How many personal candidate links a text contains. */
export function countCandidatePortalLinks(value: string | undefined | null): number {
  return (String(value ?? "").match(new RegExp(PORTAL_LINK_SOURCE, "gi")) ?? []).length;
}

/**
 * A candidate who replies to one of our e-mails usually quotes it, with the
 * personal link to their Espace candidat. Whoever opens that reply in the
 * team mailbox (or receives it forwarded) would enter the candidate's space
 * as the candidate. The link is replaced wherever the team reads or quotes it.
 */
export function maskCandidatePortalLinks(value: string): string {
  return value.replace(new RegExp(PORTAL_LINK_SOURCE, "gi"), MASKED_PORTAL_LINK);
}

/** Our candidate e-mails, recognisable once quoted in a candidate's reply. */
const PORTAL_MAIL_MARKERS = /Espace candidat|candidate space|Suivez votre candidature|Follow your application/i;
/** Click-tracking redirects added by the e-mail relay (Brevo / Sendinblue):
 * in a quoted candidate e-mail they lead to the personal link too. */
const TRACKER_HOST = /(^|\.)(sendib[a-z]*\d*\.com|sendibt\d*\.com|brevo\.com|brevosend\.com|sendinblue\.com|mailin\.fr|safelinks\.protection\.outlook\.com)$|\.r\.[a-z0-9-]+\.d\./i;
const ANY_URL = String.raw`https?:\/\/[^\s"'<>()]+`;

export function quotesCandidatePortalMail(value: string | undefined | null): boolean {
  return PORTAL_MAIL_MARKERS.test(String(value ?? ""));
}

function isTrackerLink(value: string): boolean {
  try {
    return TRACKER_HOST.test(new URL(value.trim()).hostname);
  } catch {
    return false;
  }
}

/** Whether a link must not stay clickable: a personal portal link, or (in a
 * quoted candidate e-mail) the relay's tracking redirect that leads to it. */
export function isMaskedCandidateLink(href: string | undefined | null, portalMail: boolean): boolean {
  if (!href) return false;
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // keep the raw value
  }
  // Wrapped links (Outlook Safe Links, Google redirects…) carry the personal
  // address inside their query string.
  const wrapsPortalLink = /\/suivi\/[A-Za-z0-9_-]{40,100}/.test(decoded);
  return isCandidatePortalLink(href) || wrapsPortalLink || (portalMail && isTrackerLink(href));
}

/** Text version: personal links, and tracking redirects in quoted candidate e-mails. */
export function maskCandidateLinksInText(value: string, portalMail = quotesCandidatePortalMail(value)): string {
  const masked = maskCandidatePortalLinks(value);
  return portalMail
    ? masked.replace(new RegExp(ANY_URL, "gi"), (url) => (isTrackerLink(url) ? MASKED_PORTAL_LINK : url))
    : masked;
}
