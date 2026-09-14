import type { Metadata } from "next";

const siteOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://litehubs.com").replace(/\/$/, "");
const apiOrigin = (process.env.API_ORIGIN ?? "http://localhost:5000").replace(/\/$/, "");

export function publicUrl(path = "/"): string {
  return `${siteOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Bare hostname, no scheme and no trailing slash. The robots.txt `Host`
 * directive is defined as a hostname, so `https://litehubs.com/` — what
 * `publicUrl()` returns — is not a valid value for it. */
export const siteHost = siteOrigin.replace(/^https?:\/\//, "");

type PublicCareerJob = {
  code: string;
  title: string;
  shortSummary: string;
  employmentType: string;
  site: { name: string };
  province: { name: string };
};

type CareerDetail = { organizationName?: string; job?: PublicCareerJob; jobs?: PublicCareerJob[] };

/** Public-only query used for SEO metadata. No cookies or tenant identifiers. */
export async function publicCareerMetadata(orgSlug: string, jobCode?: string): Promise<CareerDetail | null> {
  const path = jobCode
    ? `/api/v1/public/organizations/${encodeURIComponent(orgSlug)}/careers/jobs/${encodeURIComponent(jobCode)}`
    : `/api/v1/public/organizations/${encodeURIComponent(orgSlug)}/careers/jobs`;
  try {
    const response = await fetch(`${apiOrigin}${path}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json() as CareerDetail;
  } catch {
    // SEO metadata must never make the public page unavailable when the API is
    // restarting. The client page continues to display its retry state.
    return null;
  }
}

export function noIndexMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}

/**
 * The opt back in for the handful of LiteHubs-owned public pages. The root
 * layout defaults the whole app to noindex — correct, because everything under
 * a tenant slug is private — which means a public page that omits this is
 * silently invisible to search.
 *
 * The `googleBot` limits are not redundant with `index: true`. Left unset,
 * Google applies its own snippet length cap and will not use a large image
 * preview, so the result renders as a bare blue link.
 */
export const INDEXABLE: NonNullable<Metadata["robots"]> = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    "max-snippet": -1,
    "max-image-preview": "large",
    "max-video-preview": -1,
  },
};
