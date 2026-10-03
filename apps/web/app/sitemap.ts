import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import {
  isCongoOmegaHost,
  normalizePublicHost,
  publicCareerMetadata,
  publicOriginForHost,
  publicUrl,
  publicWebsiteMetadata,
} from "@/lib/seo";

/** A sitemap must describe the host that requested it. Customer domains share
 * this deployment with LiteHubs, but their published pages must never be
 * mixed into LiteHubs' index. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const requestHeaders = await headers();
  const host = normalizePublicHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  if (isCongoOmegaHost(host)) {
    const origin = publicOriginForHost(host);
    const website = await publicWebsiteMetadata(host);
    const pages = website?.website?.pages ?? [];
    const entries: MetadataRoute.Sitemap = pages.flatMap((page) => {
      if (!page.slug && !page.isHome) return [];
      return [{
        url: `${origin}${page.isHome ? "" : `/${encodeURIComponent(page.slug ?? "")}`}`,
        lastModified: now,
        changeFrequency: page.isHome ? "weekly" : "monthly",
        priority: page.isHome ? 1 : 0.8,
      }];
    });
    // Recruitment is a public service attached to Congo Omega. Individual
    // active roles are also listed when the catalogue is available.
    const careersOrgSlug = website?.website?.organizationSlug;
    const careers = careersOrgSlug
      ? await publicCareerMetadata(careersOrgSlug)
      : null;
    if (careers?.jobs?.length) {
      entries.push({
        url: `${origin}/careers/${encodeURIComponent(careersOrgSlug!)}`,
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.8,
      });
      for (const job of careers.jobs) {
        entries.push({
          url: `${origin}/careers/${encodeURIComponent(careersOrgSlug!)}/${encodeURIComponent(job.code)}`,
          lastModified: now,
          changeFrequency: "daily",
          priority: 0.7,
        });
      }
    }
    return entries;
  }

  // Only LiteHubs-owned public marketing pages are listed here. Customer
  // workspaces and private operational routes are intentionally excluded.
  return [
    { url: publicUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: publicUrl("/contact"), lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: publicUrl("/rendezvous"), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];
}
