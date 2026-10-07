import type {
  PublicWebsite,
  PublicWebsitePage,
} from "./public-website-renderer";

/** Public data returned by the deliberately narrow website endpoint. This file
 * stays server-safe so the page can be rendered as HTML for visitors and
 * crawlers before client-side interactions begin. */
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
    design?: Record<string, unknown>;
    pages: Array<{ slug: string; labelFr: string; labelEn: string; inMenu?: boolean }>;
  };
  page: {
    settings?: Record<string, unknown>;
    slug: string;
    titleFr: string;
    titleEn: string;
    descriptionFr: string | null;
    descriptionEn: string | null;
    sections: Array<{
      id: string;
      type: PublicWebsitePage["sections"][number]["section_type"];
      content: Record<string, unknown>;
    }>;
  };
};

/** Metadata fetches only the public fields they need. The renderer accepts
 * that narrower shape too, while the visible page endpoint supplies every
 * field below. Safe fallbacks keep a partial public record from ever exposing
 * a private value just to complete a visual default. */
type PublicWebsiteRendererSource = {
  website?: {
    organizationSlug?: string;
    displayName?: string;
    tagline?: string | null;
    defaultLocale?: "fr" | "en";
    themePreset?: string;
    primaryColor?: string;
    accentColor?: string;
    logoUrl?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    addressText?: string | null;
    footerText?: string | null;
    design?: Record<string, unknown>;
    pages?: Array<{
      slug?: string;
      labelFr?: string;
      labelEn?: string;
      inMenu?: boolean;
    }>;
  };
  page?: {
    settings?: Record<string, unknown>;
    slug?: string;
    titleFr?: string;
    titleEn?: string;
    descriptionFr?: string | null;
    descriptionEn?: string | null;
    sections?: Array<{
      id?: string;
      type?: string;
      content?: Record<string, unknown>;
    }>;
  };
};

const sectionTypes = new Set<PublicWebsitePage["sections"][number]["section_type"]>([
  "hero",
  "rich_text",
  "container",
  "feature_grid",
  "metrics",
  "image_callout",
  "gallery",
  "faq",
  "cta",
  "careers",
  "contact",
]);

export function publicWebsiteRendererData(data: PublicWebsiteRendererSource): {
  website: PublicWebsite;
  page: PublicWebsitePage;
} {
  const website = data.website;
  const page = data.page;
  return {
    website: {
      organization_slug: website?.organizationSlug ?? "",
      display_name: website?.displayName ?? "Entreprise",
      tagline: website?.tagline ?? null,
      default_locale: website?.defaultLocale ?? "fr",
      theme_preset: website?.themePreset ?? "verdant",
      primary_color: website?.primaryColor ?? "#075c4d",
      accent_color: website?.accentColor ?? "#e9a43a",
      logo_url: website?.logoUrl ?? null,
      contact_email: website?.contactEmail ?? null,
      contact_phone: website?.contactPhone ?? null,
      address: website?.addressText ?? null,
      footer_text: website?.footerText ?? null,
      design:
        website?.design && typeof website.design === "object" && !Array.isArray(website.design)
          ? website.design
          : undefined,
      navigation: (website?.pages ?? []).map((navigation, index) => ({
        slug: navigation.slug ?? `page-${index + 1}`,
        label_fr: navigation.labelFr ?? navigation.slug ?? "Page",
        label_en: navigation.labelEn ?? navigation.slug ?? "Page",
        in_menu: navigation.inMenu !== false,
      })),
    },
    page: {
      settings:
        page?.settings && typeof page.settings === "object" ? page.settings : undefined,
      slug: page?.slug ?? "accueil",
      title_fr: page?.titleFr ?? "Accueil",
      title_en: page?.titleEn ?? "Home",
      description_fr: page?.descriptionFr ?? null,
      description_en: page?.descriptionEn ?? null,
      sections: (page?.sections ?? []).map((section, index) => ({
        id: section.id ?? `public-section-${index}`,
        section_type: sectionTypes.has(
          section.type as PublicWebsitePage["sections"][number]["section_type"],
        )
          ? (section.type as PublicWebsitePage["sections"][number]["section_type"])
          : "rich_text",
        content: section.content ?? {},
        sort_order: index,
      })),
    },
  };
}
