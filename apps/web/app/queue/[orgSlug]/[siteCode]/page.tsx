import type { Metadata } from "next";
import { PublicQueuePage } from "@/components/appointments/public-appointment-pages";

export const metadata: Metadata = {
  title: "Queue display",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ orgSlug: string; siteCode: string }> }) {
  const { orgSlug, siteCode } = await params;
  return <PublicQueuePage orgSlug={orgSlug} siteCode={siteCode} />;
}