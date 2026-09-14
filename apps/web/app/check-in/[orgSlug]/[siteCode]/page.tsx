import type { Metadata } from "next";
import { PublicCheckInPage } from "@/components/appointments/public-appointment-pages";

export const metadata: Metadata = {
  title: "Check in",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ orgSlug: string; siteCode: string }> }) {
  const { orgSlug, siteCode } = await params;
  return <PublicCheckInPage orgSlug={orgSlug} siteCode={siteCode} />;
}