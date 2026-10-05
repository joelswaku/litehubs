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
  description?: string;
  requirements?: string | null;
  applicationDeadline?: string | null;
  publishedAt?: string | null;
  salarySummary?: string | null;
  site: { name: string };
  province: { name: string };
};

type CareerDetail = { organizationName?: string; job?: PublicCareerJob; jobs?: PublicCareerJob[] };
export type PublicWebsiteSeo = {
  website?: {
    organizationSlug?: string;
    displayName?: string;
    tagline?: string | null;
    logoUrl?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    addressText?: string | null;
    pages?: Array<{
      slug?: string;
      labelFr?: string;
      labelEn?: string;
      isHome?: boolean;
    }>;
  };
  page?: {
    slug?: string;
    titleFr?: string;
    descriptionFr?: string | null;
    seoTitleFr?: string | null;
    seoDescriptionFr?: string | null;
    isHome?: boolean;
    sections?: Array<{
      type?: string;
      content?: Record<string, unknown>;
    }>;
  };
};

/** The customer-facing Congo Omega site has its own brand assets. Keeping
 * this metadata separate from LiteHubs avoids the internal product icon being
 * shown in browser tabs, saved links, and search results for Congo Omega. */
export const CONGO_OMEGA_PUBLIC_ICONS = {
  manifest: "/website/icon/site.webmanifest",
  icons: {
    icon: [
      { url: "/website/icon/favicon.ico" },
      { url: "/website/icon/favicon.svg", type: "image/svg+xml" },
      { url: "/website/icon/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: [
      { url: "/website/icon/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
} satisfies Pick<Metadata, "manifest" | "icons">;

export function normalizePublicHost(value: string | null | undefined): string {
  return String(value ?? "")
    .split(",")[0]!
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

export function publicOriginForHost(host: string | null | undefined): string {
  const normalized = normalizePublicHost(host);
  return normalized ? `https://${normalized}` : siteOrigin;
}

export function isCongoOmegaHost(host: string | null | undefined): boolean {
  return normalizePublicHost(host) === "congoomega.com";
}

function absoluteWebsiteUrl(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = value.trim();
  if (/^https:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return null;
  return `${origin}${url}`;
}

/** Prefer the first owner-selected image from a visible public section. It is
 * used for social previews as well as search results, never for a private
 * document or a dashboard image. */
export function publicWebsiteImage(
  detail: PublicWebsiteSeo | null,
  origin: string,
): string | null {
  const sections = detail?.page?.sections ?? [];
  for (const section of sections) {
    const content = section.content ?? {};
    for (const key of ["imageUrl", "secondaryImageUrl", "tertiaryImageUrl"]) {
      const image = absoluteWebsiteUrl(content[key], origin);
      if (image) return image;
    }
  }
  return absoluteWebsiteUrl(detail?.website?.logoUrl, origin);
}

/** Escaped JSON-LD avoids a title or owner-entered paragraph ever terminating
 * the script tag. It is reusable for the product site and customer domains. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function publicWebsiteStructuredData({
  detail,
  origin,
  canonical,
  title,
  description,
}: {
  detail: PublicWebsiteSeo;
  origin: string;
  canonical: string;
  title: string;
  description: string;
}) {
  const website = detail.website;
  // Congo Omega's display name was created before the public brand guide and
  // may still be stored as "Congoomega". Structured data must use the
  // official spaced brand consistently across Google, Bing, and social cards.
  const brandName = isCongoOmegaHost(origin)
    ? "Congo Omega"
    : website?.displayName ?? "Entreprise";
  const image = publicWebsiteImage(detail, origin);
  const logo = absoluteWebsiteUrl(website?.logoUrl, origin);
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const nodes: Array<Record<string, unknown>> = [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: brandName,
      url: origin,
      ...(website?.tagline ? { description: website.tagline } : {}),
      ...(image ? { image } : {}),
      ...(logo
        ? { logo: { "@type": "ImageObject", url: logo } }
        : {}),
      ...(website?.contactEmail ? { email: website.contactEmail } : {}),
      ...(website?.contactPhone ? { telephone: website.contactPhone } : {}),
      ...(website?.addressText
        ? { address: { "@type": "PostalAddress", streetAddress: website.addressText } }
        : {}),
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      name: brandName,
      url: origin,
      inLanguage: "fr",
      publisher: { "@id": organizationId },
    },
    {
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      isPartOf: { "@id": websiteId },
      about: { "@id": organizationId },
      inLanguage: "fr",
      ...(image ? { primaryImageOfPage: image } : {}),
    },
  ];
  const pageSlug = detail.page?.slug;
  const isHome = detail.page?.isHome || website?.pages?.some((page) => page.slug === pageSlug && page.isHome);
  if (pageSlug && !isHome) {
    const pageLabel = website?.pages?.find((page) => page.slug === pageSlug)?.labelFr ?? title;
    nodes.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: origin },
        { "@type": "ListItem", position: 2, name: pageLabel, item: canonical },
      ],
    });
  }
  const faqEntries = (detail.page?.sections ?? []).flatMap((section) => {
    if (section.type !== "faq" || !Array.isArray(section.content?.items)) return [];
    return section.content.items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const values = item as Record<string, unknown>;
      const question = nonEmptyString(values.questionFr);
      const answer = nonEmptyString(values.answerFr);
      return question && answer ? [{ question, answer }] : [];
    });
  });
  if (faqEntries.length) {
    nodes.push({
      "@type": "FAQPage",
      mainEntity: faqEntries.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": nodes };
}

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

/** Public metadata for the owner-published website plane. It deliberately uses
 * the same restricted endpoint as the visible page, never a workspace API. */
export async function publicWebsiteMetadata(
  orgSlug: string,
  pageSlug?: string,
): Promise<PublicWebsiteSeo | null> {
  return (await publicWebsiteMetadataResult(orgSlug, pageSlug)).detail;
}

/** Preserves the HTTP status so public website routes can return a genuine
 * 404 for a missing page while treating a temporary API interruption
 * separately. */
export async function publicWebsiteMetadataResult(
  orgSlug: string,
  pageSlug?: string,
): Promise<{ detail: PublicWebsiteSeo | null; status: number | null }> {
  const domainRequest = orgSlug.includes(".");
  const base = domainRequest
    ? `/api/v1/public/websites/domains/${encodeURIComponent(orgSlug)}`
    : `/api/v1/public/organizations/${encodeURIComponent(orgSlug)}/website`;
  const path = pageSlug ? `${base}/pages/${encodeURIComponent(pageSlug)}` : base;
  try {
    const response = await fetch(`${apiOrigin}${path}`, { cache: "no-store" });
    if (!response.ok) return { detail: null, status: response.status };
    return { detail: (await response.json()) as PublicWebsiteSeo, status: response.status };
  } catch {
    return { detail: null, status: null };
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
