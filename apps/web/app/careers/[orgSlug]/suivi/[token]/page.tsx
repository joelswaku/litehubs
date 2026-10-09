import type { Metadata } from "next";
import { CandidatePortalPage } from "@/components/careers/candidate-portal-page";

export const metadata: Metadata = {
  title: "Espace candidat",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page({
  params,
}: {
  params: Promise<{ orgSlug: string; token: string }>;
}) {
  const { orgSlug, token } = await params;
  return <CandidatePortalPage orgSlug={orgSlug} token={token} />;
}
