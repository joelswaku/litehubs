import type { Metadata } from "next";
import { TenantDetail } from "../../platform-dashboard";
export const metadata: Metadata = { title: "Entreprise LiteHubs" };
export default async function PlatformOrganizationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <TenantDetail slug={slug} />;
}
