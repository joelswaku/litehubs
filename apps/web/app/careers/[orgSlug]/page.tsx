import type { Metadata } from "next";
import { headers } from "next/headers";
import { PublicCareersPage } from "@/components/careers/public-careers-pages";
import {
  CONGO_OMEGA_PUBLIC_ICONS,
  INDEXABLE,
  isCongoOmegaHost,
  normalizePublicHost,
  publicCareerMetadata,
  publicOriginForHost,
  publicUrl,
  serializeJsonLd,
} from "@/lib/seo";

async function careersPublicContext() {
  const requestHeaders = await headers();
  const host = normalizePublicHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const congoOmega = isCongoOmegaHost(host);
  return {
    congoOmega,
    origin: congoOmega ? publicOriginForHost(host) : publicUrl("").replace(/\/$/, ""),
  };
}

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  const catalog = await publicCareerMetadata(orgSlug);
  const organizationName = ["congo-omega", "kins"].includes(orgSlug.toLowerCase())
    ? "Congo Omega"
    : catalog?.organizationName;
  const openRoles = catalog?.jobs?.length ?? 0;
  const indexable = Boolean(organizationName && openRoles);
  const title = organizationName ? `Carrières · ${organizationName}` : "Carrières";
  const description = organizationName
    ? `${openRoles} poste(s) ouvert(s) chez ${organizationName}. Découvrez les opportunités et postulez en ligne.`
    : "Découvrez les opportunités professionnelles disponibles au sein de l’entreprise.";
  const path = `/careers/${encodeURIComponent(orgSlug)}`;
  const { origin, congoOmega } = await careersPublicContext();
  const canonical = `${origin}${path}`;
  return {
    title,
    description,
    keywords: [organizationName ?? "Carrières", "recrutement", "emploi", "opportunités professionnelles"],
    authors: organizationName ? [{ name: organizationName }] : undefined,
    creator: organizationName,
    publisher: organizationName,
    alternates: { canonical },
    robots: indexable ? INDEXABLE : { index: false, follow: false },
    openGraph: {
      type: "website",
      locale: "fr_FR",
      siteName: organizationName,
      url: canonical,
      title,
      description,
    },
    twitter: { card: "summary", title, description },
    ...(congoOmega ? CONGO_OMEGA_PUBLIC_ICONS : {}),
  };
}

export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const catalog = await publicCareerMetadata(orgSlug);
  const organizationName = ["congo-omega", "kins"].includes(orgSlug.toLowerCase())
    ? "Congo Omega"
    : catalog?.organizationName ?? "Entreprise";
  const { origin } = await careersPublicContext();
  const path = `/careers/${encodeURIComponent(orgSlug)}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Carrières · ${organizationName}`,
    url: `${origin}${path}`,
    inLanguage: "fr",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: (catalog?.jobs ?? []).map((job, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${origin}${path}/${encodeURIComponent(job.code)}`,
        name: job.title,
      })),
    },
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
    <PublicCareersPage orgSlug={orgSlug} />
  </>;
}
