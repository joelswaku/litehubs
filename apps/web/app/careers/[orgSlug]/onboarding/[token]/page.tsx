import type { Metadata } from "next";
import { PublicOnboardingPage } from "@/components/careers/public-onboarding-page";

export const metadata: Metadata = {
  title: "Fiche d’intégration sécurisée",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ orgSlug: string; token: string }>;
}) {
  const { orgSlug, token } = await params;
  return <PublicOnboardingPage orgSlug={orgSlug} token={token} />;
}
