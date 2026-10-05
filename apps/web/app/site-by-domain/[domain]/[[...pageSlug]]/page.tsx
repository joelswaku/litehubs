import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicWebsiteDomainPage } from "@/components/website/public-website-domain-page";
import { PublicWebsiteRenderer } from "@/components/website/public-website-renderer";
import { publicWebsiteRendererData } from "@/components/website/public-website-data";
import { PublicCustomerAccount } from "@/components/website/public-customer-account";
import {
  CONGO_OMEGA_PUBLIC_ICONS,
  INDEXABLE,
  isCongoOmegaHost,
  publicOriginForHost,
  publicWebsiteImage,
  publicWebsiteMetadata,
  publicWebsiteMetadataResult,
  publicWebsiteStructuredData,
  serializeJsonLd,
} from "@/lib/seo";

function pageSeo(detail: NonNullable<Awaited<ReturnType<typeof publicWebsiteMetadata>>>) {
  const title =
    detail.page?.seoTitleFr ||
    detail.page?.titleFr ||
    detail.website?.displayName ||
    "Site";
  const description =
    detail.page?.seoDescriptionFr || detail.page?.descriptionFr || detail.website?.tagline || "";
  return { title, description };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string; pageSlug?: string[] }>;
}): Promise<Metadata> {
  const { domain, pageSlug } = await params;
  const slug = pageSlug?.[0];
  const isCongoOmega = isCongoOmegaHost(domain);
  if (slug === "account") {
    return {
      title: "Votre espace client",
      robots: { index: false, follow: false },
      ...(isCongoOmega ? CONGO_OMEGA_PUBLIC_ICONS : {}),
    };
  }
  const detail = await publicWebsiteMetadata(domain, slug);
  if (!detail?.page || !detail.website)
    return { title: "Site indisponible", robots: { index: false, follow: false } };
  const { title, description } = pageSeo(detail);
  const origin = publicOriginForHost(domain);
  const canonical = `${origin}${slug ? `/${encodeURIComponent(slug)}` : ""}`;
  const image = publicWebsiteImage(detail, origin);
  const brand = isCongoOmega ? "Congo Omega" : detail.website.displayName ?? "Entreprise";
  const publicTitle = isCongoOmega && !title.toLowerCase().includes(brand.toLowerCase())
    ? `${title} | ${brand}`
    : title;
  return {
    title: isCongoOmega ? { absolute: publicTitle } : title,
    description,
    keywords: [brand, "agriculture locale", "élevage", "production responsable"],
    authors: [{ name: brand }],
    creator: brand,
    publisher: brand,
    alternates: { canonical },
    robots: INDEXABLE,
    openGraph: {
      type: "website",
      locale: "fr_FR",
      siteName: brand,
      url: canonical,
      title: publicTitle,
      description,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: publicTitle,
      description,
      ...(image ? { images: [image] } : {}),
    },
    ...(isCongoOmega ? CONGO_OMEGA_PUBLIC_ICONS : {}),
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ domain: string; pageSlug?: string[] }>;
}) {
  const { domain, pageSlug } = await params;
  if (pageSlug?.[0] === "account") {
    return <PublicCustomerAccount domain={domain} />;
  }
  const slug = pageSlug?.[0];
  const result = await publicWebsiteMetadataResult(domain, slug);
  if (slug && result.status === 404) notFound();
  const detail = result.detail;
  if (!detail?.website || !detail.page) {
    return <PublicWebsiteDomainPage domain={domain} pageSlug={slug} />;
  }
  const origin = publicOriginForHost(domain);
  const canonical = `${origin}${slug ? `/${encodeURIComponent(slug)}` : ""}`;
  const { title, description } = pageSeo(detail);
  const structuredData = publicWebsiteStructuredData({
    detail,
    origin,
    canonical,
    title,
    description,
  });
  const rendered = publicWebsiteRendererData(detail);
  return <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
    />
    <PublicWebsiteRenderer
      website={rendered.website}
      page={rendered.page}
      pathPrefix=""
      contactDomain={domain}
    />
  </>;
}
