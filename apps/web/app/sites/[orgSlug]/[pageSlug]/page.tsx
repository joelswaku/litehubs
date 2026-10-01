import type { Metadata } from "next";
import { PublicWebsitePage } from "@/components/website/public-website-page";
import { publicUrl, publicWebsiteMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string; pageSlug: string }> }): Promise<Metadata> {
  const { orgSlug, pageSlug } = await params;
  const detail = await publicWebsiteMetadata(orgSlug, pageSlug);
  if (!detail?.page || !detail.website) return { title: "Page indisponible", robots: { index: false, follow: false } };
  const title = detail.page.seoTitleFr || detail.page.titleFr || detail.website.displayName || "Site de l’entreprise";
  const description = detail.page.seoDescriptionFr || detail.page.descriptionFr || "";
  const path = `/sites/${encodeURIComponent(orgSlug)}/${encodeURIComponent(pageSlug)}`;
  return { title, description, alternates: { canonical: path }, robots: { index: true, follow: true }, openGraph: { type: "website", url: publicUrl(path), title, description } };
}

export default async function Page({
  params,
}: {
  params: Promise<{ orgSlug: string; pageSlug: string }>;
}) {
  const { orgSlug, pageSlug } = await params;
  return <PublicWebsitePage organizationSlug={orgSlug} pageSlug={pageSlug} />;
}
