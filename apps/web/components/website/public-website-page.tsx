"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import {
  PublicWebsiteRenderer,
  type PublicWebsite,
  type PublicWebsitePage,
} from "./public-website-renderer";

export type PublicWebsiteResponse = {
  website: {
    organizationSlug: string;
    displayName: string;
    tagline: string | null;
    defaultLocale: "fr" | "en";
    themePreset: string;
    primaryColor: string;
    accentColor: string;
    logoUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    addressText: string | null;
    footerText: string | null;
    pages: Array<{ slug: string; labelFr: string; labelEn: string }>;
  };
  page: {
    slug: string;
    titleFr: string;
    titleEn: string;
    descriptionFr: string | null;
    descriptionEn: string | null;
    sections: Array<{ id: string; type: PublicWebsitePage["sections"][number]["section_type"]; content: Record<string, unknown> }>;
  };
};

export function publicWebsiteRendererData(data: PublicWebsiteResponse): {
  website: PublicWebsite;
  page: PublicWebsitePage;
} {
  return {
    website: {
      organization_slug: data.website.organizationSlug,
      display_name: data.website.displayName,
      tagline: data.website.tagline,
      default_locale: data.website.defaultLocale,
      theme_preset: data.website.themePreset,
      primary_color: data.website.primaryColor,
      accent_color: data.website.accentColor,
      logo_url: data.website.logoUrl,
      contact_email: data.website.contactEmail,
      contact_phone: data.website.contactPhone,
      address: data.website.addressText,
      footer_text: data.website.footerText,
      navigation: data.website.pages.map((page) => ({
        slug: page.slug,
        label_fr: page.labelFr,
        label_en: page.labelEn,
      })),
    },
    page: {
      slug: data.page.slug,
      title_fr: data.page.titleFr,
      title_en: data.page.titleEn,
      description_fr: data.page.descriptionFr,
      description_en: data.page.descriptionEn,
      sections: data.page.sections.map((section, index) => ({
        id: section.id,
        section_type: section.type,
        content: section.content,
        sort_order: index,
      })),
    },
  };
}

export function PublicWebsitePage({
  organizationSlug,
  pageSlug,
}: {
  organizationSlug: string;
  pageSlug?: string;
}) {
  const path = pageSlug
    ? `/public/organizations/${organizationSlug}/website/pages/${pageSlug}`
    : `/public/organizations/${organizationSlug}/website`;
  const query = useQuery({
    queryKey: ["public-website", organizationSlug, pageSlug ?? "home"],
    queryFn: () => get<PublicWebsiteResponse>(path),
    retry: false,
  });

  if (query.isLoading) return <SkeletonCard rows={8} />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="This page is not available"
        description="It may still be a private draft, or the website has not been published yet."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rendered = publicWebsiteRendererData(query.data);
  return <PublicWebsiteRenderer website={rendered.website} page={rendered.page} />;
}
