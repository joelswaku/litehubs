import type { Metadata } from "next";
import { headers } from "next/headers";
import { PublicCareerJobPage } from "@/components/careers/public-careers-pages";
import {
  CONGO_OMEGA_PUBLIC_ICONS,
  INDEXABLE,
  isCongoOmegaHost,
  normalizePublicHost,
  publicCareerMetadata,
  publicOriginForHost,
  publicUrl,
  serializeJsonLd,
} from "@/lib/seo";

async function careersPublicContext() {
  const requestHeaders = await headers();
  const host = normalizePublicHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const congoOmega = isCongoOmegaHost(host);
  return {
    congoOmega,
    origin: congoOmega ? publicOriginForHost(host) : publicUrl("").replace(/\/$/, ""),
  };
}

function employmentType(value: string): string {
  return {
    permanent: "FULL_TIME",
    temporary: "TEMPORARY",
    contract: "CONTRACTOR",
    casual: "PART_TIME",
    internship: "INTERN",
  }[value] ?? "OTHER";
}

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string; jobCode: string }> }): Promise<Metadata> {
  const { orgSlug, jobCode } = await params;
  const detail = await publicCareerMetadata(orgSlug, jobCode);
  const job = detail?.job;
  if (!job) return { title: "Poste indisponible", robots: { index: false, follow: false } };
  const organizationName = ["congo-omega", "kins"].includes(orgSlug.toLowerCase())
    ? "Congo Omega"
    : detail?.organizationName ?? "Entreprise";
  const title = `${job.title} · ${organizationName}`;
  const description = `${job.shortSummary} Poste basé à ${job.site.name}, ${job.province.name}.`;
  const path = `/careers/${encodeURIComponent(orgSlug)}/${encodeURIComponent(jobCode)}`;
  const { origin, congoOmega } = await careersPublicContext();
  const canonical = `${origin}${path}`;
  return {
    // A job opening is a Congo Omega public record, not a LiteHubs product
    // page, even though both use the same Next.js deployment.
    title: congoOmega ? { absolute: title } : title,
    description,
    keywords: [organizationName, job.title, "emploi", "recrutement"],
    authors: [{ name: organizationName }],
    creator: organizationName,
    publisher: organizationName,
    alternates: { canonical },
    robots: INDEXABLE,
    openGraph: {
      type: "website",
      locale: "fr_FR",
      siteName: organizationName,
      url: canonical,
      title,
      description,
    },
    twitter: { card: "summary", title, description },
    ...(congoOmega ? CONGO_OMEGA_PUBLIC_ICONS : {}),
  };
}

export default async function Page({ params }: { params: Promise<{ orgSlug: string; jobCode: string }> }) {
  const { orgSlug, jobCode } = await params;
  const detail = await publicCareerMetadata(orgSlug, jobCode);
  const job = detail?.job;
  if (!job) return <PublicCareerJobPage orgSlug={orgSlug} jobCode={jobCode} />;
  const organizationName = ["congo-omega", "kins"].includes(orgSlug.toLowerCase())
    ? "Congo Omega"
    : detail?.organizationName ?? "Entreprise";
  const { origin } = await careersPublicContext();
  const path = `/careers/${encodeURIComponent(orgSlug)}/${encodeURIComponent(jobCode)}`;
  const canonical = `${origin}${path}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description || job.shortSummary,
    datePosted: job.publishedAt ?? undefined,
    ...(job.applicationDeadline
      ? { validThrough: `${job.applicationDeadline}T23:59:59+01:00` }
      : {}),
    employmentType: employmentType(job.employmentType),
    hiringOrganization: {
      "@type": "Organization",
      name: organizationName,
      sameAs: origin,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.site.name,
        addressRegion: job.province.name,
        addressCountry: "CD",
      },
    },
    url: canonical,
    directApply: true,
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
    <PublicCareerJobPage orgSlug={orgSlug} jobCode={jobCode} />
  </>;
}
