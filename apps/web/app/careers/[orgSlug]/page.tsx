import type { Metadata } from "next";
import { PublicCareersPage } from "@/components/careers/public-careers-pages";
import { publicCareerMetadata, publicUrl } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  const catalog = await publicCareerMetadata(orgSlug);
  const organizationName = catalog?.organizationName;
  const openRoles = catalog?.jobs?.length ?? 0;
  const indexable = Boolean(organizationName && openRoles);
  const title = organizationName ? `Carrières · ${organizationName}` : "Carrières";
  const description = organizationName
    ? `${openRoles} poste(s) ouvert(s) chez ${organizationName}. Découvrez les opportunités et postulez en ligne.`
    : "Découvrez les opportunités professionnelles disponibles sur LiteHubs.";
  const path = `/careers/${encodeURIComponent(orgSlug)}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: publicUrl(path), title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return <PublicCareersPage orgSlug={orgSlug} />;
}