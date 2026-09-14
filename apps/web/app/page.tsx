import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { INDEXABLE, publicUrl } from "@/lib/seo";
import { LandingPage } from "./landing-page";

const TAGLINE = "Logiciel de gestion avicole, porcine et agricole";

export const metadata: Metadata = {
  /**
   * Absolute, and it leads with the brand.
   *
   * `title.template` in the root layout does not apply here: Next only applies
   * a template to *child* segments, and `app/page.tsx` shares the root segment
   * with `app/layout.tsx`. So a plain string on this one page produces a
   * `<title>` with no "LiteHubs" in it — on the page that most needs to rank
   * for the query "litehubs", against several unrelated "LiteHub" companies
   * and a USB hub product line. `absolute` states the full title outright
   * rather than relying on a template that will not fire.
   */
  title: { absolute: `${APP_NAME} — ${TAGLINE}` },
  description:
    "LiteHubs est un logiciel de gestion pour élevages avicoles et porcins, fermes agricoles, équipes, stocks, santé animale, récoltes et décisions opérationnelles.",
  keywords: [
    "logiciel gestion avicole",
    "poultry farm management software",
    "logiciel élevage porcin",
    "pig farm management software",
    "logiciel gestion agricole",
    "farm management software",
    "gestion ferme Congo",
    "LiteHubs",
  ],
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: publicUrl("/"),
    siteName: APP_NAME,
    title: `${APP_NAME} — ${TAGLINE}`,
    description:
      "Pilotez vos élevages, cultures, équipes et opérations depuis une seule plateforme sécurisée.",
  },
  alternates: { canonical: "/" },
  robots: INDEXABLE,
};

/**
 * One `@graph` rather than three loose scripts, so the nodes can reference each
 * other by `@id` and Google reads them as one entity instead of three unrelated
 * claims.
 *
 * `Organization` is the part that matters for the bare query "litehubs".
 * `SoftwareApplication` alone describes a product; it does not assert that a
 * company by this name exists, and without that assertion the brand term stays
 * ambiguous against the other "LiteHub" businesses already ranking for it.
 */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": publicUrl("/#organization"),
      name: APP_NAME,
      alternateName: "Lite Hubs",
      url: publicUrl("/"),
      logo: {
        "@type": "ImageObject",
        url: publicUrl("/web-app-manifest-512x512.png"),
        width: 512,
        height: 512,
      },
      image: publicUrl("/opengraph-image"),
      description:
        "Éditeur du logiciel de gestion avicole, porcine et agricole LiteHubs.",
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        url: publicUrl("/contact"),
        availableLanguage: ["fr", "en"],
      },
    },
    {
      "@type": "WebSite",
      "@id": publicUrl("/#website"),
      name: APP_NAME,
      url: publicUrl("/"),
      inLanguage: "fr",
      publisher: { "@id": publicUrl("/#organization") },
    },
    {
      "@type": "SoftwareApplication",
      "@id": publicUrl("/#software"),
      name: APP_NAME,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: publicUrl("/"),
      publisher: { "@id": publicUrl("/#organization") },
      description:
        "Logiciel de gestion avicole, porcine et agricole pour les opérations, équipes, santé, stocks, récoltes et décisions.",
      featureList: [
        "Poultry farm management",
        "Pig farm management",
        "Agriculture management",
        "Workforce, inventory and operations management",
      ],
    },
  ],
};

export default function RootPage() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <LandingPage />
  </>;
}