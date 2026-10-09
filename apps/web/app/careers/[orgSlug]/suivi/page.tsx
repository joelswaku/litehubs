import type { Metadata } from "next";
import { CandidatePortalRecoverPage } from "@/components/careers/candidate-portal-page";

export const metadata: Metadata = {
  title: "Retrouver ma candidature",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  return <CandidatePortalRecoverPage orgSlug={orgSlug} />;
}
