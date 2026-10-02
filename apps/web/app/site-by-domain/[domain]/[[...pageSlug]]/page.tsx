import type { Metadata } from "next";
import { PublicWebsiteDomainPage } from "@/components/website/public-website-domain-page";
import { publicWebsiteMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string; pageSlug?: string[] }>;
}): Promise<Metadata> {
  const { domain, pageSlug } = await params;
  const slug = pageSlug?.[0];
  const detail = await publicWebsiteMetadata(domain, slug);
  const isCongoOmega = domain.toLowerCase().replace(/^www\./, "") === "congoomega.com";
  if (!detail?.page || !detail.website)
    return { title: "Site indisponible", robots: { index: false, follow: false } };
  const title = detail.page.seoTitleFr || detail.page.titleFr || detail.website.displayName || "Site";
  const description = detail.page.seoDescriptionFr || detail.page.descriptionFr || "";
  const canonical = `https://${domain}${slug ? `/${encodeURIComponent(slug)}` : ""}`;
  return {
    title: isCongoOmega ? { absolute: title } : title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: canonical, title, description },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ domain: string; pageSlug?: string[] }>;
}) {
  const { domain, pageSlug } = await params;
  return <PublicWebsiteDomainPage domain={domain} pageSlug={pageSlug?.[0]} />;
}
