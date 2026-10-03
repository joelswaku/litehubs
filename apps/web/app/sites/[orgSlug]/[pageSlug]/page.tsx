import type { Metadata } from "next";
import { PublicCustomerAccount } from "@/components/website/public-customer-account";
import { PublicWebsitePage } from "@/components/website/public-website-page";
import { publicUrl, publicWebsiteMetadata } from "@/lib/seo";

function previewCustomerAccountDomain(orgSlug: string, pageSlug: string): string | null {
  if (pageSlug !== "account") return null;
  // The private builder preview is deliberately limited to Congo Omega's
  // customer-account experience. It is useful for local QA without exposing
  // this customer journey under every organisation's builder URL.
  return ["congo-omega", "kins"].includes(orgSlug.toLowerCase())
    ? "congoomega.com"
    : null;
}

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string; pageSlug: string }> }): Promise<Metadata> {
  const { orgSlug, pageSlug } = await params;
  if (previewCustomerAccountDomain(orgSlug, pageSlug)) {
    return { title: "Votre espace client", robots: { index: false, follow: false } };
  }
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
  const domain = previewCustomerAccountDomain(orgSlug, pageSlug);
  if (domain) return <PublicCustomerAccount domain={domain} homeHref={`/sites/${encodeURIComponent(orgSlug)}`} />;
  return <PublicWebsitePage organizationSlug={orgSlug} pageSlug={pageSlug} />;
}
