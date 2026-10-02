"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import { PublicWebsiteRenderer } from "./public-website-renderer";
import {
  publicWebsiteRendererData,
  type PublicWebsiteResponse,
} from "./public-website-page";
import type { PublicWebsite, PublicWebsitePage, WebsiteSection } from "./public-website-renderer";

const congoOmegaDomains = new Set(["congoomega.com", "www.congoomega.com"]);

/**
 * The production database can be brought online before the organisation's
 * internal LiteHubs records are restored.  Congo Omega's public domain must
 * still never fall back to the LiteHubs product landing in that short window.
 * This deliberately contains only approved public copy and bundled imagery;
 * as soon as the API returns the owner's builder data, that data takes over.
 */
const congoOmegaWebsite: PublicWebsite = {
  organization_slug: "congo-omega",
  // The public site remains available during recovery, while operations and
  // published vacancies live in the established production workspace.
  portal_organization_slug: "kins",
  display_name: "Congo Omega",
  tagline: "Une agriculture locale, responsable et utile.",
  default_locale: "fr",
  theme_preset: "verdant",
  primary_color: "#075c4d",
  accent_color: "#e9a43a",
  logo_url: null,
  contact_email: "contact@congoomega.com",
  contact_phone: null,
  address: "République démocratique du Congo",
  footer_text:
    "Une entreprise proche du terrain, engagée pour une production locale solide et durable.",
  navigation: [
    { slug: "accueil", label_fr: "Accueil", label_en: "Home" },
    { slug: "notre-entreprise", label_fr: "Notre entreprise", label_en: "Our company" },
    { slug: "activites", label_fr: "Activités", label_en: "Activities" },
    { slug: "projets", label_fr: "Projets", label_en: "Projects" },
    { slug: "carrieres", label_fr: "Carrières", label_en: "Careers" },
    { slug: "contact", label_fr: "Contact", label_en: "Contact" },
    { slug: "impact", label_fr: "Impact", label_en: "Impact" },
  ],
};

const publicPage = (
  slug: string,
  titleFr: string,
  titleEn: string,
  sections: WebsiteSection[] = [],
): PublicWebsitePage => ({
  slug,
  title_fr: titleFr,
  title_en: titleEn,
  description_fr: null,
  description_en: null,
  sections,
});

function congoOmegaFallbackPage(pageSlug?: string): PublicWebsitePage {
  const slug = pageSlug ?? "accueil";
  const simpleHero = (
    kickerFr: string,
    kickerEn: string,
    titleFr: string,
    titleEn: string,
    bodyFr: string,
    bodyEn: string,
    imageUrl: string,
  ): WebsiteSection => ({
    id: `congo-omega-${slug}-hero`,
    section_type: "hero",
    sort_order: 0,
    content: {
      kickerFr,
      kickerEn,
      titleFr,
      titleEn,
      bodyFr,
      bodyEn,
      imageUrl,
      buttonLabelFr: "Nous contacter",
      buttonLabelEn: "Contact us",
      buttonHref: "/contact",
    },
  });

  switch (slug) {
    case "notre-entreprise":
      return publicPage(slug, "Notre entreprise", "Our company", [
        simpleHero(
          "NOTRE ENTREPRISE", "OUR COMPANY", "Grandir avec le terrain.", "Growing with the ground.",
          "Congo Omega construit une production locale fiable avec des équipes formées, des ressources suivies et une ambition durable.",
          "Congo Omega builds reliable local production with trained teams, tracked resources and lasting ambition.",
          "/website/congo-omega-team.png",
        ),
      ]);
    case "activites":
      return publicPage(slug, "Nos activités", "Our activities", [
        simpleHero(
          "NOS ACTIVITÉS", "OUR ACTIVITIES", "Du champ à l’élevage, une chaîne maîtrisée.", "From field to livestock, one controlled chain.",
          "Agriculture, aviculture, élevage et transformation avancent ensemble pour créer une valeur locale durable.",
          "Agriculture, poultry, livestock and transformation move together to create lasting local value.",
          "/website/congo-omega-operations.png",
        ),
      ]);
    case "projets":
      return publicPage(slug, "Nos projets", "Our projects", [
        simpleHero(
          "NOS PROJETS", "OUR PROJECTS", "Des investissements transformés en résultats.", "Investments turned into results.",
          "Nos projets sont pensés pour devenir des opérations utiles, mesurables et proches des communautés.",
          "Our projects are designed to become useful, measurable operations close to communities.",
          "/website/congo-omega-projects.png",
        ),
      ]);
    case "carrieres":
      return publicPage(slug, "Carrières", "Careers", [
        {
          id: "congo-omega-careers",
          section_type: "careers",
          sort_order: 0,
          content: {
            kickerFr: "CARRIÈRES",
            kickerEn: "CAREERS",
            titleFr: "Construisons une agriculture locale forte.",
            titleEn: "Let’s build stronger local agriculture.",
            bodyFr: "Découvrez les opportunités ouvertes et rejoignez des équipes qui agissent concrètement sur le terrain.",
            bodyEn: "Discover open opportunities and join teams taking real action in the field.",
            buttonLabelFr: "Voir les postes ouverts",
            buttonLabelEn: "See open roles",
          },
        },
      ]);
    case "contact":
      return publicPage(slug, "Contact", "Contact", [
        {
          id: "congo-omega-contact",
          section_type: "contact",
          sort_order: 0,
          content: {
            kickerFr: "CONTACT",
            kickerEn: "CONTACT",
            titleFr: "Parlons de votre besoin.",
            titleEn: "Let’s discuss your needs.",
            bodyFr: "Notre équipe vous répondra dans le bon contexte : partenariat, projet, service ou recrutement.",
            bodyEn: "Our team will respond in the right context: partnership, project, service or recruitment.",
            // Do not route a visitor into the empty booking directory until
            // Congo Omega explicitly opens an appointment service.
            buttonLabelFr: "Nous écrire",
            buttonLabelEn: "Send us a message",
            buttonHref: "/contact#contact",
          },
        },
      ]);
    case "impact":
      return publicPage(slug, "Notre impact", "Our impact", [
        simpleHero(
          "NOTRE IMPACT", "OUR IMPACT", "Une valeur qui reste proche des communautés.", "Value that stays close to communities.",
          "Nous mesurons l’impact dans les équipes, les ressources, la production locale et les résultats obtenus dans la durée.",
          "We measure impact through teams, resources, local production and long-term results.",
          "/website/congo-omega-impact.png",
        ),
      ]);
    default:
      // No selected image here is intentional: the renderer substitutes its
      // full, media-rich Congo Omega home landing for this public home page.
      return publicPage("accueil", "Accueil", "Home");
  }
}

/** Rendered after the proxy maps a verified custom host to this private route.
 * The API checks the exact stored custom domain before sending any content. */
export function PublicWebsiteDomainPage({
  domain,
  pageSlug,
}: {
  domain: string;
  pageSlug?: string;
}) {
  const path = pageSlug
    ? `/public/websites/domains/${encodeURIComponent(domain)}/pages/${encodeURIComponent(pageSlug)}`
    : `/public/websites/domains/${encodeURIComponent(domain)}`;
  const query = useQuery({
    queryKey: ["public-website-domain", domain, pageSlug ?? "home"],
    queryFn: () => get<PublicWebsiteResponse>(path),
    retry: false,
  });
  // The preview is private; the custom domain must only show the exact
  // published builder record. A bundled fallback after an API error made a
  // paused site look live and hid changes such as a newly selected logo.
  if (query.isLoading) return <SkeletonCard rows={8} />;
  // Only a genuine network interruption uses the small public recovery shell.
  // A 404 deliberately means draft or paused, so it must never display stale
  // branding as if the owner had published it.
  if (
    query.isError &&
    query.error instanceof ApiError &&
    query.error.status === 0 &&
    congoOmegaDomains.has(domain.toLowerCase())
  ) {
    return (
      <PublicWebsiteRenderer
        website={congoOmegaWebsite}
        page={congoOmegaFallbackPage(pageSlug)}
        pathPrefix=""
        contactDomain={domain}
      />
    );
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="Ce site n’est pas disponible publiquement"
        description="Il est peut-être en pause, encore en brouillon, ou le domaine n’est pas encore vérifié. L’aperçu LiteHubs reste privé et ne représente pas toujours le site publié."
        onRetry={() => void query.refetch()}
      />
    );
  }
  const rendered = publicWebsiteRendererData(query.data);
  return (
    <PublicWebsiteRenderer
      website={rendered.website}
      page={rendered.page}
      pathPrefix=""
      contactDomain={domain}
    />
  );
}
