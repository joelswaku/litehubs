import type { Metadata } from "next";
import { PublicCareerJobPage } from "@/components/careers/public-careers-pages";
import { publicCareerMetadata, publicUrl } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string; jobCode: string }> }): Promise<Metadata> {
  const { orgSlug, jobCode } = await params;
  const detail = await publicCareerMetadata(orgSlug, jobCode);
  const job = detail?.job;
  if (!job) return { title: "Poste indisponible", robots: { index: false, follow: false } };
  const organizationName = detail?.organizationName ?? "LiteHubs";
  const title = `${job.title} · ${organizationName}`;
  const description = `${job.shortSummary} Poste basé à ${job.site.name}, ${job.province.name}.`;
  const path = `/careers/${encodeURIComponent(orgSlug)}/${encodeURIComponent(jobCode)}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: publicUrl(path), title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ orgSlug: string; jobCode: string }> }) {
  const { orgSlug, jobCode } = await params;
  return <PublicCareerJobPage orgSlug={orgSlug} jobCode={jobCode} />;
}