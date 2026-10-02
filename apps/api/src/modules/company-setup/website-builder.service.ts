import { query } from "../../config/database";
import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "../../utils/errors";
import { logger } from "../../config/logger";
import { sendMail } from "../../services/notification.service";
import {
  deleteStoredImage,
  storeImage,
} from "../../services/file-storage.service";
import { withTenantContext, withUserContext } from "../../utils/tenant-query";
import type {
  WebsitePageCreateInput,
  WebsitePageUpdateInput,
  WebsiteSectionsInput,
  WebsiteSettingsInput,
  PublicWebsiteContactInput,
} from "./company-setup.validation";
import type { SetupContext } from "./company-setup.service";

type WebsiteStatus = "draft" | "published" | "paused";
type PageStatus = "draft" | "published" | "archived";
type SectionType = WebsiteSectionsInput["sections"][number]["type"];

interface WebsiteSettingsRow {
  id: string;
  organization_id: string;
  display_name: string;
  tagline: string | null;
  default_locale: "fr" | "en";
  publication_status: WebsiteStatus;
  theme_preset: "verdant" | "cobalt" | "sunrise" | "earth";
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address_text: string | null;
  footer_text: string | null;
  custom_domain: string | null;
  created_at: Date;
  updated_at: Date;
}

interface WebsitePageRow {
  id: string;
  organization_id: string;
  website_id: string;
  slug: string;
  navigation_label_fr: string;
  navigation_label_en: string;
  title_fr: string;
  title_en: string;
  description_fr: string | null;
  description_en: string | null;
  seo_title_fr: string | null;
  seo_title_en: string | null;
  seo_description_fr: string | null;
  seo_description_en: string | null;
  template_code:
    | "blank"
    | "company"
    | "operations"
    | "project"
    | "impact"
    | "contact"
    | "careers";
  status: PageStatus;
  is_home: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

interface WebsiteSectionRow {
  id: string;
  page_id: string;
  section_type: SectionType;
  section_order: number;
  is_visible: boolean;
  content: Record<string, unknown>;
}

interface WebsiteMediaRow {
  id: string;
  organization_id: string;
  website_id: string;
  title: string;
  original_name: string;
  provider: "cloudinary";
  storage_key: string;
  public_id: string | null;
  public_url: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: Date;
}

interface OrganizationWebsiteSeed {
  display_name: string;
  slug: string;
}

const asIso = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : value;

function mapSettings(row: WebsiteSettingsRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    tagline: row.tagline,
    defaultLocale: row.default_locale,
    publicationStatus: row.publication_status,
    themePreset: row.theme_preset,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    logoUrl: row.logo_url,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    addressText: row.address_text,
    footerText: row.footer_text,
    customDomain: row.custom_domain,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function mapPage(row: WebsitePageRow, sections: WebsiteSectionRow[] = []) {
  return {
    id: row.id,
    slug: row.slug,
    navigationLabelFr: row.navigation_label_fr,
    navigationLabelEn: row.navigation_label_en,
    titleFr: row.title_fr,
    titleEn: row.title_en,
    descriptionFr: row.description_fr,
    descriptionEn: row.description_en,
    seoTitleFr: row.seo_title_fr,
    seoTitleEn: row.seo_title_en,
    seoDescriptionFr: row.seo_description_fr,
    seoDescriptionEn: row.seo_description_en,
    templateCode: row.template_code,
    status: row.status,
    isHome: row.is_home,
    sortOrder: row.sort_order,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    sections: sections.map((section) => ({
      id: section.id,
      type: section.section_type,
      isVisible: section.is_visible,
      content: section.content ?? {},
    })),
  };
}

function mapMedia(row: WebsiteMediaRow) {
  return {
    id: row.id,
    title: row.title,
    originalName: row.original_name,
    url: row.public_url,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    createdAt: asIso(row.created_at),
  };
}

const defaultSections = (
  template: WebsitePageCreateInput["templateCode"],
): Array<{ type: SectionType; content: Record<string, unknown> }> => {
  const hero = {
    type: "hero" as const,
    content: {
      kickerFr: "BIENVENUE",
      kickerEn: "WELCOME",
      titleFr:
        "Une entreprise proche du terrain, guidée par des résultats réels.",
      titleEn: "A business close to the field and guided by real results.",
      bodyFr:
        "Présentez votre activité, vos équipes et l’impact que vous souhaitez créer.",
      bodyEn:
        "Introduce your activity, your teams and the impact you want to create.",
      primaryLabelFr: "Nous contacter",
      primaryLabelEn: "Contact us",
      primaryHref: "/contact",
      secondaryLabelFr: "Découvrir nos activités",
      secondaryLabelEn: "Discover our work",
      secondaryHref: "#activities",
      imageUrl: "/website/congo-omega-hero.png",
      secondaryImageUrl: "/website/congo-omega-market.png",
      tertiaryImageUrl: "/website/congo-omega-team.png",
    },
  };
  const contact = {
    type: "contact" as const,
    content: {
      titleFr: "Parlons de votre besoin",
      titleEn: "Let’s discuss your need",
      bodyFr:
        "Utilisez nos coordonnées ou prenez rendez-vous avec l’équipe concernée.",
      bodyEn: "Use our details or book a meeting with the appropriate team.",
      buttonLabelFr: "Prendre rendez-vous",
      buttonLabelEn: "Book an appointment",
      buttonHref: "/rendezvous",
    },
  };

  switch (template) {
    case "company":
      return [
        {
          ...hero,
          content: {
            ...hero.content,
            kickerFr: "CONGO OMEGA · DEPUIS LE TERRAIN",
            kickerEn: "CONGO OMEGA · FROM THE GROUND UP",
            titleFr: "Nourrir demain, ici même.",
            titleEn: "Nourishing tomorrow, right here.",
            bodyFr:
              "Congo Omega développe une agriculture, un élevage et des équipes capables de produire localement avec rigueur, respect et ambition.",
            bodyEn:
              "Congo Omega develops agriculture, livestock and teams able to produce locally with rigor, care and ambition.",
            primaryLabelFr: "Découvrir Congo Omega",
            primaryLabelEn: "Discover Congo Omega",
            primaryHref: "/notre-entreprise",
            secondaryLabelFr: "Voir nos activités",
            secondaryLabelEn: "Explore our work",
            secondaryHref: "/activites",
          },
        },
        {
          type: "feature_grid",
          content: {
            kickerFr: "CE QUE NOUS FAISONS",
            kickerEn: "WHAT WE DO",
            anchor: "activities",
            titleFr: "Une même chaîne, du sol jusqu’aux familles.",
            titleEn: "One chain, from soil to families.",
            bodyFr:
              "Nous relions les ressources, les savoir-faire et la production pour bâtir une offre locale fiable.",
            bodyEn:
              "We connect resources, expertise and production to build a reliable local supply.",
            items: [
              {
                titleFr: "Cultiver",
                titleEn: "Cultivate",
                bodyFr:
                  "Des champs et des récoltes pensés avec le rythme des saisons et des besoins réels.",
                bodyEn:
                  "Fields and harvests planned around seasons and real needs.",
                icon: "sprout",
              },
              {
                titleFr: "Élever",
                titleEn: "Raise",
                bodyFr:
                  "Des élevages suivis chaque jour avec exigence, santé et respect du vivant.",
                bodyEn:
                  "Livestock followed every day with rigor, health and care for life.",
                icon: "users",
              },
              {
                titleFr: "Transformer",
                titleEn: "Transform",
                bodyFr:
                  "Des intrants maîtrisés pour créer une alimentation traçable et utile.",
                bodyEn: "Controlled inputs to create traceable, useful feed.",
                icon: "chart",
              },
            ],
          },
        },
        {
          type: "metrics",
          content: {
            kickerFr: "NOTRE MÉTHODE",
            kickerEn: "OUR APPROACH",
            titleFr: "Faire simple. Faire juste. Mesurer l’impact.",
            titleEn: "Keep it simple. Do it right. Measure the impact.",
            bodyFr:
              "Notre travail avance avec des objectifs clairs, des équipes responsables et des résultats visibles.",
            bodyEn:
              "Our work advances through clear goals, accountable teams and visible outcomes.",
            items: [
              {
                value: "01",
                labelFr: "Vision locale",
                labelEn: "Local vision",
              },
              {
                value: "02",
                labelFr: "Équipes formées",
                labelEn: "Trained teams",
              },
              {
                value: "03",
                labelFr: "Ressources suivies",
                labelEn: "Tracked resources",
              },
              {
                value: "04",
                labelFr: "Impact durable",
                labelEn: "Lasting impact",
              },
            ],
          },
        },
        {
          type: "image_callout",
          content: {
            kickerFr: "NOTRE ENGAGEMENT",
            kickerEn: "OUR COMMITMENT",
            titleFr: "Produire près de chez vous. Grandir avec vous.",
            titleEn: "Produce close to you. Grow with you.",
            bodyFr:
              "Chaque activité est menée avec la même exigence : des équipes responsables, des ressources maîtrisées et une valeur qui reste dans les communautés.",
            bodyEn:
              "Every activity follows the same standard: accountable teams, controlled resources and value that remains in communities.",
            buttonLabelFr: "Explorer nos activités",
            buttonLabelEn: "Explore our work",
            buttonHref: "/activites",
            imageUrl: "/website/congo-omega-operations.png",
          },
        },
        {
          type: "gallery",
          content: {
            kickerFr: "NOS VISAGES, NOS LIEUX",
            kickerEn: "OUR PEOPLE, OUR PLACES",
            titleFr: "Une ambition qui se voit sur le terrain.",
            titleEn: "An ambition you can see on the ground.",
            bodyFr:
              "Découvrez les lieux, les équipes et les gestes qui donnent vie à Congo Omega.",
            bodyEn:
              "Discover the places, teams and actions that bring Congo Omega to life.",
            items: [
              {
                imageUrl: "/website/congo-omega-hero.png",
                captionFr: "Une production proche du terrain",
                captionEn: "Production close to the ground",
              },
              {
                imageUrl: "/website/congo-omega-market.png",
                captionFr: "Une valeur locale qui circule",
                captionEn: "Local value in motion",
              },
              {
                imageUrl: "/website/congo-omega-team.png",
                captionFr: "Des équipes qui avancent ensemble",
                captionEn: "Teams moving forward together",
              },
              {
                imageUrl: "/website/congo-omega-impact.png",
                captionFr: "Un impact construit dans la durée",
                captionEn: "Impact built to last",
              },
            ],
          },
        },
        {
          type: "cta",
          content: {
            kickerFr: "ÉCRIVONS LA SUITE",
            kickerEn: "LET’S WRITE THE NEXT CHAPTER",
            titleFr: "Une idée, un besoin, une collaboration ?",
            titleEn: "An idea, a need, a collaboration?",
            bodyFr:
              "Échangeons sur ce que nous pouvons construire ensemble pour une agriculture locale plus forte.",
            bodyEn:
              "Let’s talk about what we can build together for stronger local agriculture.",
            buttonLabelFr: "Parlons-en",
            buttonLabelEn: "Let’s talk",
            buttonHref: "/contact",
          },
        },
        contact,
      ];
    case "operations":
      return [
        {
          ...hero,
          content: {
            ...hero.content,
            kickerFr: "NOS OPÉRATIONS",
            kickerEn: "OUR OPERATIONS",
            titleFr: "Une production contrôlée, de la ressource au client.",
            titleEn: "Controlled production, from resource to customer.",
            bodyFr:
              "Nous développons une agriculture locale exigeante, où chaque ressource est suivie du champ jusqu’au client.",
            bodyEn:
              "We develop rigorous local agriculture, where every resource is followed from field to customer.",
            imageUrl: "/website/congo-omega-operations.png",
          },
        },
        {
          type: "feature_grid",
          content: {
            titleFr: "Ce que nous développons",
            titleEn: "What we develop",
            items: [
              {
                titleFr: "Aviculture",
                titleEn: "Poultry",
                bodyFr: "Élevage, santé et production responsable.",
                bodyEn: "Responsible rearing, health and production.",
                icon: "bird",
              },
              {
                titleFr: "Agriculture",
                titleEn: "Agriculture",
                bodyFr:
                  "Des cultures planifiées pour nourrir et développer l’exploitation.",
                bodyEn: "Planned crops that nourish and develop the operation.",
                icon: "leaf",
              },
              {
                titleFr: "Provenderie",
                titleEn: "Feed mill",
                bodyFr:
                  "Des aliments traçables fabriqués avec les bons intrants.",
                bodyEn: "Traceable feed made with the right ingredients.",
                icon: "factory",
              },
            ],
          },
        },
        {
          type: "metrics",
          content: {
            titleFr: "Une chaîne maîtrisée de bout en bout",
            titleEn: "A controlled chain from end to end",
            items: [
              { value: "01", labelFr: "Planifier", labelEn: "Plan" },
              { value: "02", labelFr: "Produire", labelEn: "Produce" },
              { value: "03", labelFr: "Contrôler", labelEn: "Control" },
              { value: "04", labelFr: "Servir", labelEn: "Serve" },
            ],
          },
        },
        {
          type: "rich_text",
          content: {
            titleFr: "Des opérations qui avancent ensemble",
            titleEn: "Operations that move forward together",
            bodyFr:
              "L’agriculture, l’élevage, les stocks et la transformation sont pilotés comme une seule chaîne responsable, sans perdre le lien avec le terrain.",
            bodyEn:
              "Agriculture, livestock, stock and transformation are managed as one accountable chain, without losing touch with the field.",
          },
        },
        {
          type: "cta",
          content: {
            titleFr: "Découvrez nos projets en action",
            titleEn: "Discover our projects in action",
            bodyFr:
              "Chaque investissement est suivi jusqu’à son résultat attendu.",
            bodyEn:
              "Every investment is followed through to its expected result.",
            buttonLabelFr: "Voir les projets",
            buttonLabelEn: "See projects",
            buttonHref: "/projets",
          },
        },
        contact,
      ];
    case "project":
      return [
        {
          ...hero,
          content: {
            ...hero.content,
            kickerFr: "PROJET & IMPACT",
            kickerEn: "PROJECT & IMPACT",
            titleFr:
              "Un projet se mesure par son résultat, pas seulement par son lancement.",
            titleEn:
              "A project is measured by its outcome, not only its launch.",
            bodyFr:
              "Nous transformons les idées en investissements utiles, pilotés avec des objectifs, des équipes et des résultats mesurables.",
            bodyEn:
              "We turn ideas into useful investments, guided by clear goals, accountable teams and measurable outcomes.",
            imageUrl: "/website/congo-omega-projects.png",
          },
        },
        {
          type: "metrics",
          content: {
            titleFr: "Notre engagement",
            titleEn: "Our commitment",
            items: [
              {
                value: "01",
                labelFr: "Objectif clair",
                labelEn: "Clear objective",
              },
              {
                value: "02",
                labelFr: "Équipe responsable",
                labelEn: "Accountable team",
              },
              {
                value: "03",
                labelFr: "Résultat mesuré",
                labelEn: "Measured result",
              },
            ],
          },
        },
        {
          type: "rich_text",
          content: {
            titleFr: "Des projets guidés par un résultat concret",
            titleEn: "Projects guided by a tangible outcome",
            bodyFr:
              "Un projet démarre avec un objectif clair, une équipe responsable et un suivi continu. Il ne s’arrête pas à l’achat : il doit produire le résultat attendu.",
            bodyEn:
              "A project starts with a clear objective, an accountable team and continuous follow-up. It does not stop at purchase: it must deliver the expected outcome.",
          },
        },
        {
          type: "feature_grid",
          content: {
            titleFr: "Notre manière de faire avancer un projet",
            titleEn: "How we move a project forward",
            items: [
              {
                titleFr: "Objectif",
                titleEn: "Objective",
                bodyFr: "Un résultat mesurable avant le premier engagement.",
                bodyEn: "A measurable outcome before the first commitment.",
              },
              {
                titleFr: "Exécution",
                titleEn: "Execution",
                bodyFr:
                  "Des étapes, des responsabilités et des preuves claires.",
                bodyEn: "Clear stages, responsibilities and evidence.",
              },
              {
                titleFr: "Résultat",
                titleEn: "Outcome",
                bodyFr:
                  "Le suivi continue jusqu’à la mise en service et au bénéfice attendu.",
                bodyEn:
                  "Follow-up continues through commissioning and expected benefit.",
              },
            ],
          },
        },
        {
          type: "cta",
          content: {
            titleFr: "Vous souhaitez collaborer ?",
            titleEn: "Would you like to collaborate?",
            bodyFr:
              "Échangeons sur les projets qui peuvent créer un impact durable.",
            bodyEn: "Let’s discuss projects that can create lasting impact.",
            buttonLabelFr: "Nous contacter",
            buttonLabelEn: "Contact us",
            buttonHref: "/contact",
          },
        },
        contact,
      ];
    case "impact":
      return [
        {
          ...hero,
          content: {
            ...hero.content,
            kickerFr: "NOTRE IMPACT",
            kickerEn: "OUR IMPACT",
            titleFr: "Produire localement. Grandir durablement.",
            titleEn: "Produce locally. Grow sustainably.",
            bodyFr:
              "Notre ambition est de faire progresser une production locale utile, responsable et créatrice d’opportunités.",
            bodyEn:
              "Our ambition is to advance local production that is useful, responsible and creates opportunity.",
            primaryLabelFr: "Découvrir nos activités",
            primaryLabelEn: "Discover our activities",
            primaryHref: "/activites",
            secondaryLabelFr: "Nous rejoindre",
            secondaryLabelEn: "Join us",
            secondaryHref: "/carrieres",
            imageUrl: "/website/congo-omega-impact.png",
          },
        },
        {
          type: "feature_grid",
          content: {
            titleFr: "Une croissance qui reste proche du terrain",
            titleEn: "Growth that stays close to the ground",
            bodyFr:
              "Nous relions production, environnement et développement des compétences dans une même démarche durable.",
            bodyEn:
              "We connect production, environment and skills development in one sustainable approach.",
            items: [
              {
                titleFr: "Produire localement",
                titleEn: "Produce locally",
                bodyFr:
                  "Créer une offre agricole fiable et adaptée aux besoins locaux.",
                bodyEn:
                  "Build a reliable agricultural supply suited to local needs.",
                icon: "sprout",
              },
              {
                titleFr: "Préserver les ressources",
                titleEn: "Protect resources",
                bodyFr:
                  "Piloter l’eau, les intrants et l’énergie avec rigueur.",
                bodyEn: "Manage water, inputs and energy with care.",
                icon: "leaf",
              },
              {
                titleFr: "Faire grandir les équipes",
                titleEn: "Grow teams",
                bodyFr:
                  "Donner aux personnes les méthodes et compétences pour réussir.",
                bodyEn: "Give people the methods and skills to succeed.",
                icon: "users",
              },
            ],
          },
        },
        {
          type: "image_callout",
          content: {
            titleFr: "Du champ jusqu’aux familles",
            titleEn: "From field to families",
            bodyFr:
              "Une production bien conduite crée des produits accessibles, un travail de qualité et une valeur qui reste dans les communautés.",
            bodyEn:
              "Well-run production creates accessible products, quality work and value that stays in communities.",
            buttonLabelFr: "Parlons de collaboration",
            buttonLabelEn: "Discuss collaboration",
            buttonHref: "/contact",
            imageUrl: "/website/congo-omega-market.png",
          },
        },
        {
          type: "cta",
          content: {
            titleFr: "Construisons une agriculture forte et responsable",
            titleEn: "Let’s build strong, responsible agriculture",
            bodyFr:
              "Découvrez nos activités, nos projets ou les opportunités de rejoindre nos équipes.",
            bodyEn:
              "Discover our activities, projects or opportunities to join our teams.",
            buttonLabelFr: "Nous contacter",
            buttonLabelEn: "Contact us",
            buttonHref: "/contact",
          },
        },
        contact,
      ];
    case "careers":
      return [
        {
          ...hero,
          content: {
            ...hero.content,
            kickerFr: "CARRIÈRES",
            kickerEn: "CAREERS",
            titleFr:
              "Rejoignez une équipe qui fait grandir l’agriculture locale.",
            titleEn: "Join a team growing local agriculture.",
            bodyFr:
              "Chez Congo Omega, les métiers du terrain, de la technique et du management construisent ensemble une production durable.",
            bodyEn:
              "At Congo Omega, field, technical and management roles build sustainable production together.",
            imageUrl: "/website/congo-omega-team.png",
          },
        },
        {
          type: "careers",
          content: {
            titleFr: "Postes ouverts",
            titleEn: "Open positions",
            bodyFr:
              "Consultez les offres disponibles et postulez en toute sécurité.",
            bodyEn: "Browse available roles and apply securely.",
            buttonLabelFr: "Voir les offres",
            buttonLabelEn: "See opportunities",
          },
        },
        {
          type: "rich_text",
          content: {
            titleFr: "Grandir avec une mission utile",
            titleEn: "Grow with meaningful work",
            bodyFr:
              "Nous cherchons des personnes rigoureuses, curieuses et proches du terrain pour faire avancer une agriculture locale et responsable.",
            bodyEn:
              "We seek rigorous, curious people who stay close to the field to advance local, responsible agriculture.",
          },
        },
        contact,
      ];
    case "contact":
      return [
        {
          ...hero,
          content: {
            ...hero.content,
            kickerFr: "CONTACT",
            kickerEn: "CONTACT",
            titleFr: "Nous sommes à votre écoute.",
            titleEn: "We are here to listen.",
            bodyFr:
              "Une question, une collaboration ou une opportunité ? Échangeons dans le bon contexte.",
            bodyEn:
              "A question, collaboration or opportunity? Let’s speak in the right context.",
            imageUrl: "/website/congo-omega-hero.png",
          },
        },
        {
          type: "rich_text",
          content: {
            titleFr: "Parlons simplement",
            titleEn: "Let’s talk simply",
            bodyFr:
              "Choisissez le canal le plus pratique : téléphone, e-mail ou rendez-vous. Notre équipe vous répondra dans le bon contexte.",
            bodyEn:
              "Choose the channel that works for you: phone, email or appointment. Our team will reply in the right context.",
          },
        },
        contact,
      ];
    case "blank":
    default:
      return [];
  }
};

/** A real website needs a coherent journey, not one empty page at a time.
 * These are intentionally drafts: an owner still chooses what is true and what
 * may be published for their organisation. */
const starterPageDefinitions: Array<{
  slug: string;
  navigationLabelFr: string;
  navigationLabelEn: string;
  titleFr: string;
  titleEn: string;
  descriptionFr: string;
  descriptionEn: string;
  templateCode: WebsitePageCreateInput["templateCode"];
  isHome: boolean;
}> = [
  {
    slug: "accueil",
    navigationLabelFr: "Accueil",
    navigationLabelEn: "Home",
    titleFr: "Accueil",
    titleEn: "Home",
    descriptionFr: "Découvrez notre entreprise, nos activités et nos projets.",
    descriptionEn: "Discover our company, our activities and our projects.",
    templateCode: "company",
    isHome: true,
  },
  {
    slug: "notre-entreprise",
    navigationLabelFr: "Notre entreprise",
    navigationLabelEn: "Our company",
    titleFr: "Notre entreprise",
    titleEn: "Our company",
    descriptionFr: "Notre vision, notre méthode et notre engagement.",
    descriptionEn: "Our vision, our approach and our commitment.",
    templateCode: "company",
    isHome: false,
  },
  {
    slug: "activites",
    navigationLabelFr: "Activités",
    navigationLabelEn: "Activities",
    titleFr: "Nos activités",
    titleEn: "Our activities",
    descriptionFr: "Production, agriculture, élevage et transformation.",
    descriptionEn: "Production, agriculture, livestock and transformation.",
    templateCode: "operations",
    isHome: false,
  },
  {
    slug: "projets",
    navigationLabelFr: "Projets",
    navigationLabelEn: "Projects",
    titleFr: "Nos projets",
    titleEn: "Our projects",
    descriptionFr: "Des investissements suivis jusqu’à leurs résultats.",
    descriptionEn: "Investments followed through to their results.",
    templateCode: "project",
    isHome: false,
  },
  {
    slug: "impact",
    navigationLabelFr: "Impact",
    navigationLabelEn: "Impact",
    titleFr: "Notre impact",
    titleEn: "Our impact",
    descriptionFr: "Une production locale responsable, utile et durable.",
    descriptionEn: "Responsible, useful and sustainable local production.",
    templateCode: "impact",
    isHome: false,
  },
  {
    slug: "carrieres",
    navigationLabelFr: "Carrières",
    navigationLabelEn: "Careers",
    titleFr: "Carrières",
    titleEn: "Careers",
    descriptionFr: "Rejoignez une équipe qui agit sur le terrain.",
    descriptionEn: "Join a team that makes a difference on the ground.",
    templateCode: "careers",
    isHome: false,
  },
  {
    slug: "contact",
    navigationLabelFr: "Contact",
    navigationLabelEn: "Contact",
    titleFr: "Contact",
    titleEn: "Contact",
    descriptionFr: "Échangeons sur votre besoin ou votre projet.",
    descriptionEn: "Let’s discuss your need or project.",
    templateCode: "contact",
    isHome: false,
  },
];

/** Older websites could contain the initial empty block shells. They are safe
 * to replace during the one-click completion because they carry no text,
 * image, link or item entered by an owner. */
function sectionsNeedStarterContent(sections: WebsiteSectionRow[]) {
  if (sections.length === 0) return true;
  return !sections.some((section) => {
    const values = Object.values(section.content ?? {});
    return values.some((value) => {
      if (typeof value === "string") return value.trim().length > 0;
      if (typeof value === "number" || typeof value === "boolean") return true;
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && typeof value === "object";
    });
  });
}

async function addMissingStarterPages(
  client: PoolClient,
  organizationId: string,
  websiteId: string,
  memberId: string,
) {
  const existing = await client.query<{ slug: string }>(
    `SELECT slug FROM organization_website_pages
       WHERE organization_id=$1 AND website_id=$2`,
    [organizationId, websiteId],
  );
  const present = new Set(existing.rows.map((page) => page.slug));
  const added: WebsitePageRow[] = [];
  let order = existing.rows.length;
  for (const definition of starterPageDefinitions) {
    if (present.has(definition.slug)) continue;
    const page = await client.query<WebsitePageRow>(
      `INSERT INTO organization_website_pages (
        organization_id,website_id,slug,navigation_label_fr,navigation_label_en,
        title_fr,title_en,description_fr,description_en,template_code,is_home,
        status,sort_order,created_by_member_id,updated_by_member_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13,$13)
      RETURNING *`,
      [
        organizationId,
        websiteId,
        definition.slug,
        definition.navigationLabelFr,
        definition.navigationLabelEn,
        definition.titleFr,
        definition.titleEn,
        definition.descriptionFr,
        definition.descriptionEn,
        definition.templateCode,
        definition.isHome,
        order++,
        memberId,
      ],
    );
    const inserted = page.rows[0]!;
    await insertSections(
      client,
      organizationId,
      inserted.id,
      defaultSections(definition.templateCode).map((section) => ({
        ...section,
        isVisible: true,
      })),
    );
    added.push(inserted);
  }
  return added;
}

async function activeWebsite(client: PoolClient, organizationId: string) {
  const result = await client.query<WebsiteSettingsRow>(
    `SELECT * FROM organization_website_settings
      WHERE organization_id=$1
      LIMIT 1`,
    [organizationId],
  );
  return result.rows[0] ?? null;
}

async function builderData(client: PoolClient, organizationId: string) {
  const [seed, settings] = await Promise.all([
    client.query<OrganizationWebsiteSeed>(
      `SELECT display_name,slug FROM organizations WHERE id=$1`,
      [organizationId],
    ),
    activeWebsite(client, organizationId),
  ]);
  if (!settings) {
    return {
      organization: {
        displayName: seed.rows[0]?.display_name ?? "",
        slug: seed.rows[0]?.slug ?? "",
      },
      website: null,
      pages: [],
    };
  }
  const [pages, sections] = await Promise.all([
    client.query<WebsitePageRow>(
      `SELECT * FROM organization_website_pages
        WHERE organization_id=$1 AND website_id=$2
        ORDER BY is_home DESC,sort_order,slug`,
      [organizationId, settings.id],
    ),
    client.query<WebsiteSectionRow>(
      `SELECT * FROM organization_website_sections
        WHERE organization_id=$1
        ORDER BY page_id,section_order`,
      [organizationId],
    ),
  ]);
  const byPage = new Map<string, WebsiteSectionRow[]>();
  for (const section of sections.rows) {
    const list = byPage.get(section.page_id) ?? [];
    list.push(section);
    byPage.set(section.page_id, list);
  }
  return {
    organization: {
      displayName: seed.rows[0]?.display_name ?? settings.display_name,
      slug: seed.rows[0]?.slug ?? "",
    },
    website: mapSettings(settings),
    pages: pages.rows.map((page) => mapPage(page, byPage.get(page.id) ?? [])),
  };
}

export async function getWebsiteBuilder(context: SetupContext) {
  return withTenantContext(context, (client) =>
    builderData(client, context.organizationId),
  );
}

/** The website's public image catalogue. It is intentionally separate from
 * LiteHubs Documents: images here are selected only for pages that may be
 * published to visitors. */
export async function listWebsiteMedia(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const website = await requireWebsite(client, context.organizationId);
    const result = await client.query<WebsiteMediaRow>(
      `SELECT * FROM organization_website_media
        WHERE organization_id=$1 AND website_id=$2
        ORDER BY created_at DESC, id DESC`,
      [context.organizationId, website.id],
    );
    return result.rows.map(mapMedia);
  });
}

function mediaTitle(originalName: string) {
  const title = originalName
    .replace(/\.[a-zA-Z0-9]{1,12}$/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return title || "Image du site";
}

/** Store up to 30 public website images in their own Cloudinary namespace.
 * The browser never receives storage credentials; the file signature is
 * verified by storeImage before it can enter the library. */
export async function uploadWebsiteMedia(
  context: SetupContext,
  files: Express.Multer.File[],
) {
  const stored: Array<{ provider: string; publicId: string | null }> = [];
  try {
    return await withTenantContext(context, async (client) => {
      const website = await requireWebsite(client, context.organizationId);
      const uploaded: ReturnType<typeof mapMedia>[] = [];
      for (const file of files) {
        const image = await storeImage({
          organizationId: context.organizationId,
          module: "public-website",
          resource: "media-library",
          originalName: file.originalname,
          mimeType: file.mimetype,
          buffer: file.buffer,
        });
        stored.push({ provider: image.provider, publicId: image.publicId });
        try {
          const result = await client.query<WebsiteMediaRow>(
            `INSERT INTO organization_website_media (
              organization_id,website_id,title,original_name,provider,storage_key,
              public_id,public_url,mime_type,size_bytes,width,height,created_by_member_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            RETURNING *`,
            [
              context.organizationId,
              website.id,
              mediaTitle(file.originalname),
              file.originalname.slice(0, 255),
              image.provider,
              image.storageKey,
              image.publicId,
              image.url,
              image.mimeType,
              image.bytes,
              image.width,
              image.height,
              context.memberId,
            ],
          );
          uploaded.push(mapMedia(result.rows[0]!));
        } catch (error) {
          await deleteStoredImage({
            provider: image.provider,
            publicId: image.publicId,
          }).catch(() => undefined);
          stored.pop();
          throw error;
        }
      }
      return uploaded;
    });
  } catch (error) {
    // A database transaction can roll back after one or more Cloudinary
    // uploads. Clean those up so the site media library never leaves orphans.
    await Promise.all(
      stored.map((image) => deleteStoredImage(image).catch(() => undefined)),
    );
    throw error;
  }
}

export async function deleteWebsiteMedia(
  context: SetupContext,
  mediaId: string,
) {
  return withTenantContext(context, async (client) => {
    const media = await client.query<WebsiteMediaRow>(
      `SELECT * FROM organization_website_media
        WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, mediaId],
    );
    const row = media.rows[0];
    if (!row) throw new NotFoundError("Website image not found");
    const inUse = await client.query<{ used: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM organization_website_sections
         WHERE organization_id=$1 AND content::text LIKE '%' || $2 || '%'
      ) AS used`,
      [context.organizationId, row.public_url],
    );
    if (inUse.rows[0]?.used)
      throw new ConflictError(
        "This image is used on a website page. Choose another image there before deleting it.",
      );
    // Delete storage first: if the provider is unavailable, the reference is
    // kept and the owner can retry instead of ending with a broken page image.
    await deleteStoredImage({
      provider: row.provider,
      publicId: row.public_id,
    });
    await client.query(
      `DELETE FROM organization_website_media WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, mediaId],
    );
  });
}

export async function saveWebsiteSettings(
  context: SetupContext,
  input: WebsiteSettingsInput,
) {
  return withTenantContext(context, async (client) => {
    // www is an alias of the same public site, never a second tenant domain.
    // Normalising here keeps direct API clients consistent with the owner UI.
    const customDomain = input.customDomain?.replace(/^www\./i, "") ?? null;
    await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      context.organizationId,
    ]);
    let saved: WebsiteSettingsRow;
    try {
      const result = await client.query<WebsiteSettingsRow>(
        `INSERT INTO organization_website_settings (
          organization_id,display_name,tagline,default_locale,theme_preset,
          primary_color,accent_color,logo_url,contact_email,contact_phone,
          address_text,footer_text,custom_domain,created_by_member_id,updated_by_member_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
        ON CONFLICT (organization_id) DO UPDATE SET
          display_name=EXCLUDED.display_name,tagline=EXCLUDED.tagline,
          default_locale=EXCLUDED.default_locale,theme_preset=EXCLUDED.theme_preset,
          primary_color=EXCLUDED.primary_color,accent_color=EXCLUDED.accent_color,
          logo_url=EXCLUDED.logo_url,contact_email=EXCLUDED.contact_email,
          contact_phone=EXCLUDED.contact_phone,address_text=EXCLUDED.address_text,
          footer_text=EXCLUDED.footer_text,custom_domain=EXCLUDED.custom_domain,
          updated_by_member_id=EXCLUDED.updated_by_member_id
        RETURNING *`,
        [
          context.organizationId,
          input.displayName,
          input.tagline ?? null,
          input.defaultLocale,
          input.themePreset,
          input.primaryColor,
          input.accentColor,
          input.logoUrl || null,
          input.contactEmail ?? null,
          input.contactPhone ?? null,
          input.addressText ?? null,
          input.footerText ?? null,
          customDomain,
          context.memberId,
        ],
      );
      saved = result.rows[0]!;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ConflictError(
          "This public domain is already linked to another website",
        );
      throw error;
    }

    await addMissingStarterPages(
      client,
      context.organizationId,
      saved.id,
      context.memberId,
    );
    return mapSettings(saved);
  });
}

export async function addWebsiteStarterPages(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const website = await requireWebsite(client, context.organizationId);
    const added = await addMissingStarterPages(
      client,
      context.organizationId,
      website.id,
      context.memberId,
    );
    return added.map((page) => mapPage(page));
  });
}

/** Finish only the standard public journey. Custom draft pages are never
 * published by this shortcut: an owner must publish those individually. */
export async function completeWebsiteStarterPages(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const website = await requireWebsite(client, context.organizationId);
    const created = await addMissingStarterPages(
      client,
      context.organizationId,
      website.id,
      context.memberId,
    );
    const starterSlugs = starterPageDefinitions.map((page) => page.slug);
    const pages = await client.query<WebsitePageRow>(
      `SELECT * FROM organization_website_pages
        WHERE organization_id=$1 AND website_id=$2
          AND slug = ANY($3::text[]) AND status <> 'archived'
        ORDER BY sort_order, slug
        FOR UPDATE`,
      [context.organizationId, website.id, starterSlugs],
    );

    let prepared = 0;
    let published = 0;
    for (const page of pages.rows) {
      const sections = await client.query<WebsiteSectionRow>(
        `SELECT * FROM organization_website_sections
          WHERE organization_id=$1 AND page_id=$2
          ORDER BY section_order
          FOR UPDATE`,
        [context.organizationId, page.id],
      );
      if (sectionsNeedStarterContent(sections.rows)) {
        await client.query(
          `DELETE FROM organization_website_sections
            WHERE organization_id=$1 AND page_id=$2`,
          [context.organizationId, page.id],
        );
        await insertSections(
          client,
          context.organizationId,
          page.id,
          defaultSections(page.template_code).map((section) => ({
            ...section,
            isVisible: true,
          })),
        );
        prepared += 1;
      }
      if (page.status !== "published") {
        await client.query(
          `UPDATE organization_website_pages
              SET status='published',updated_by_member_id=$3
            WHERE organization_id=$1 AND id=$2`,
          [context.organizationId, page.id, context.memberId],
        );
        published += 1;
      }
    }
    await client.query(
      `UPDATE organization_website_settings
          SET publication_status='published',updated_by_member_id=$2
        WHERE organization_id=$1`,
      [context.organizationId, context.memberId],
    );
    return {
      created: created.length,
      prepared,
      published,
      total: pages.rows.length,
    };
  });
}

function visualCallout(template: WebsitePageRow["template_code"]) {
  if (template === "operations") {
    return {
      type: "image_callout" as const,
      content: {
        titleFr: "La qualité commence par des intrants maîtrisés",
        titleEn: "Quality starts with controlled inputs",
        bodyFr:
          "De la récolte à l’aliment fini, nos équipes suivent les ressources avec rigueur et traçabilité.",
        bodyEn:
          "From harvest to finished feed, our teams follow resources with rigor and traceability.",
        buttonLabelFr: "Voir nos projets",
        buttonLabelEn: "See our projects",
        buttonHref: "/projets",
        imageUrl: "/website/congo-omega-operations.png",
      },
    };
  }
  if (template === "project") {
    return {
      type: "image_callout" as const,
      content: {
        titleFr: "Des investissements qui deviennent des résultats",
        titleEn: "Investments that become results",
        bodyFr:
          "Nos projets réunissent les bonnes personnes, les ressources utiles et une méthode de suivi claire.",
        bodyEn:
          "Our projects bring together the right people, useful resources and a clear follow-up method.",
        buttonLabelFr: "Nous contacter",
        buttonLabelEn: "Contact us",
        buttonHref: "/contact",
        imageUrl: "/website/congo-omega-projects.png",
      },
    };
  }
  if (template === "careers") {
    return {
      type: "image_callout" as const,
      content: {
        titleFr: "Des métiers utiles, une équipe qui avance",
        titleEn: "Meaningful roles, a team moving forward",
        bodyFr:
          "Nous recherchons des personnes fiables, curieuses et prêtes à construire avec nous une agriculture locale forte.",
        bodyEn:
          "We seek reliable, curious people ready to build strong local agriculture with us.",
        buttonLabelFr: "Voir les postes ouverts",
        buttonLabelEn: "See open positions",
        buttonHref: "/carrieres",
        imageUrl: "/website/congo-omega-team.png",
      },
    };
  }
  return {
    type: "image_callout" as const,
    content: {
      titleFr: "Une vision qui prend racine sur le terrain",
      titleEn: "A vision rooted in the field",
      bodyFr:
        "Congo Omega construit une production locale responsable avec des équipes engagées et des résultats suivis.",
      bodyEn:
        "Congo Omega builds responsible local production with committed teams and tracked results.",
      buttonLabelFr: "Découvrir nos activités",
      buttonLabelEn: "Discover our activities",
      buttonHref: "/activites",
      imageUrl: "/website/congo-omega-hero.png",
    },
  };
}

/** Add a visual block without replacing any text, draft or published content.
 * This lets an owner enhance an earlier website safely and undo it in the
 * regular page editor if wanted. */
export async function addWebsiteVisualHighlights(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const website = await requireWebsite(client, context.organizationId);
    await addMissingStarterPages(
      client,
      context.organizationId,
      website.id,
      context.memberId,
    );
    const pages = await client.query<WebsitePageRow>(
      `SELECT * FROM organization_website_pages
        WHERE organization_id=$1 AND website_id=$2 AND status='draft'
        ORDER BY sort_order, slug`,
      [context.organizationId, website.id],
    );
    let added = 0;
    for (const page of pages.rows) {
      if (page.template_code === "blank") continue;
      const sections = await client.query<WebsiteSectionRow>(
        `SELECT * FROM organization_website_sections
          WHERE organization_id=$1 AND page_id=$2
          ORDER BY section_order
          FOR UPDATE`,
        [context.organizationId, page.id],
      );
      const hero = sections.rows.find(
        (section) => section.section_type === "hero",
      );
      if (hero) {
        const current = hero.content ?? {};
        const hasPrimary =
          typeof (current.imageUrl ?? current.image) === "string" &&
          String(current.imageUrl ?? current.image).trim().length > 0;
        const hasSecondary =
          typeof current.secondaryImageUrl === "string" &&
          current.secondaryImageUrl.trim().length > 0;
        const hasTertiary =
          typeof current.tertiaryImageUrl === "string" &&
          current.tertiaryImageUrl.trim().length > 0;

        // Keep every word and owner-selected image unchanged. We only add the
        // two optional supporting visual slots that make the new hero richer.
        if (hasPrimary && (!hasSecondary || !hasTertiary)) {
          await client.query(
            `UPDATE organization_website_sections
                SET content=$3::jsonb, updated_at=now()
              WHERE organization_id=$1 AND id=$2`,
            [
              context.organizationId,
              hero.id,
              JSON.stringify({
                ...current,
                ...(hasSecondary
                  ? {}
                  : {
                      secondaryImageUrl: "/website/congo-omega-market.png",
                    }),
                ...(hasTertiary
                  ? {}
                  : { tertiaryImageUrl: "/website/congo-omega-team.png" }),
              }),
            ],
          );
          added += 1;
        }
      }
      const hasImage = sections.rows.some((section) => {
        const source = section.content?.imageUrl ?? section.content?.image;
        return typeof source === "string" && source.trim().length > 0;
      });
      if (hasImage) continue;
      const visual = visualCallout(page.template_code);
      await client.query(
        `INSERT INTO organization_website_sections (
          organization_id,page_id,section_type,section_order,is_visible,content
        ) VALUES ($1,$2,$3,$4,true,$5::jsonb)`,
        [
          context.organizationId,
          page.id,
          visual.type,
          sections.rows.length,
          JSON.stringify(visual.content),
        ],
      );
      added += 1;
    }
    return { added };
  });
}

async function requireWebsite(client: PoolClient, organizationId: string) {
  const website = await activeWebsite(client, organizationId);
  if (!website)
    throw new BadRequestError(
      "Create the website identity before adding pages",
    );
  return website;
}

async function pageForUpdate(
  client: PoolClient,
  organizationId: string,
  pageId: string,
) {
  const result = await client.query<WebsitePageRow>(
    `SELECT * FROM organization_website_pages
      WHERE organization_id=$1 AND id=$2
      FOR UPDATE`,
    [organizationId, pageId],
  );
  if (!result.rowCount) throw new NotFoundError("Website page not found");
  return result.rows[0]!;
}

export async function createWebsitePage(
  context: SetupContext,
  input: WebsitePageCreateInput,
) {
  return withTenantContext(context, async (client) => {
    const website = await requireWebsite(client, context.organizationId);
    if (input.isHome)
      await client.query(
        `UPDATE organization_website_pages SET is_home=false
          WHERE organization_id=$1 AND website_id=$2 AND is_home`,
        [context.organizationId, website.id],
      );
    const nextOrder = await client.query<{ sort_order: number }>(
      `SELECT COALESCE(max(sort_order),-1)+1 AS sort_order
         FROM organization_website_pages
        WHERE organization_id=$1 AND website_id=$2`,
      [context.organizationId, website.id],
    );
    try {
      const created = await client.query<WebsitePageRow>(
        `INSERT INTO organization_website_pages (
          organization_id,website_id,slug,navigation_label_fr,navigation_label_en,
          title_fr,title_en,description_fr,description_en,seo_title_fr,seo_title_en,
          seo_description_fr,seo_description_en,template_code,is_home,sort_order,
          created_by_member_id,updated_by_member_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
        RETURNING *`,
        [
          context.organizationId,
          website.id,
          input.slug,
          input.navigationLabelFr,
          input.navigationLabelEn,
          input.titleFr,
          input.titleEn,
          input.descriptionFr ?? null,
          input.descriptionEn ?? null,
          input.seoTitleFr ?? null,
          input.seoTitleEn ?? null,
          input.seoDescriptionFr ?? null,
          input.seoDescriptionEn ?? null,
          input.templateCode,
          input.isHome,
          nextOrder.rows[0]?.sort_order ?? 0,
          context.memberId,
        ],
      );
      const page = created.rows[0]!;
      const sections = defaultSections(input.templateCode).map((section) => ({
        ...section,
        isVisible: true,
      }));
      await insertSections(client, context.organizationId, page.id, sections);
      return mapPage(
        page,
        sections.map((section, index) => ({
          id: `new-${index}`,
          page_id: page.id,
          section_type: section.type,
          section_order: index,
          is_visible: true,
          content: section.content,
        })),
      );
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ConflictError(
          "This page address is already used in this website",
        );
      throw error;
    }
  });
}

export async function updateWebsitePage(
  context: SetupContext,
  pageId: string,
  input: WebsitePageUpdateInput,
) {
  return withTenantContext(context, async (client) => {
    const current = await pageForUpdate(client, context.organizationId, pageId);
    if (input.isHome && !current.is_home)
      await client.query(
        `UPDATE organization_website_pages SET is_home=false
          WHERE organization_id=$1 AND website_id=$2 AND is_home`,
        [context.organizationId, current.website_id],
      );
    try {
      const updated = await client.query<WebsitePageRow>(
        `UPDATE organization_website_pages SET
          slug=$3,navigation_label_fr=$4,navigation_label_en=$5,title_fr=$6,title_en=$7,
          description_fr=$8,description_en=$9,seo_title_fr=$10,seo_title_en=$11,
          seo_description_fr=$12,seo_description_en=$13,template_code=$14,is_home=$15,
          updated_by_member_id=$16
        WHERE organization_id=$1 AND id=$2
        RETURNING *`,
        [
          context.organizationId,
          pageId,
          input.slug,
          input.navigationLabelFr,
          input.navigationLabelEn,
          input.titleFr,
          input.titleEn,
          input.descriptionFr ?? null,
          input.descriptionEn ?? null,
          input.seoTitleFr ?? null,
          input.seoTitleEn ?? null,
          input.seoDescriptionFr ?? null,
          input.seoDescriptionEn ?? null,
          input.templateCode,
          input.isHome,
          context.memberId,
        ],
      );
      const sections = await client.query<WebsiteSectionRow>(
        `SELECT * FROM organization_website_sections
          WHERE organization_id=$1 AND page_id=$2
          ORDER BY section_order`,
        [context.organizationId, pageId],
      );
      return mapPage(updated.rows[0]!, sections.rows);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ConflictError(
          "This page address is already used in this website",
        );
      throw error;
    }
  });
}

async function insertSections(
  client: PoolClient,
  organizationId: string,
  pageId: string,
  sections: WebsiteSectionsInput["sections"],
) {
  for (const [index, section] of sections.entries()) {
    await client.query(
      `INSERT INTO organization_website_sections (
        organization_id,page_id,section_type,section_order,is_visible,content
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        organizationId,
        pageId,
        section.type,
        index,
        section.isVisible,
        JSON.stringify(section.content ?? {}),
      ],
    );
  }
}

export async function replaceWebsiteSections(
  context: SetupContext,
  pageId: string,
  input: WebsiteSectionsInput,
) {
  return withTenantContext(context, async (client) => {
    const page = await pageForUpdate(client, context.organizationId, pageId);
    await client.query(
      `DELETE FROM organization_website_sections
        WHERE organization_id=$1 AND page_id=$2`,
      [context.organizationId, pageId],
    );
    await insertSections(
      client,
      context.organizationId,
      pageId,
      input.sections,
    );
    const inserted = await client.query<WebsiteSectionRow>(
      `SELECT * FROM organization_website_sections
        WHERE organization_id=$1 AND page_id=$2
        ORDER BY section_order`,
      [context.organizationId, pageId],
    );
    return mapPage(page, inserted.rows);
  });
}

export async function publishWebsitePage(
  context: SetupContext,
  pageId: string,
) {
  return withTenantContext(context, async (client) => {
    const page = await pageForUpdate(client, context.organizationId, pageId);
    let sections = await client.query<WebsiteSectionRow>(
      `SELECT * FROM organization_website_sections
        WHERE organization_id=$1 AND page_id=$2
        ORDER BY section_order
        FOR UPDATE`,
      [context.organizationId, pageId],
    );
    const isStandardPage = starterPageDefinitions.some(
      (definition) => definition.slug === page.slug,
    );
    // Old starter pages can contain only blank visual shells. Publishing one
    // of them completes it first, rather than exposing an empty public page.
    if (isStandardPage && sectionsNeedStarterContent(sections.rows)) {
      await client.query(
        `DELETE FROM organization_website_sections
          WHERE organization_id=$1 AND page_id=$2`,
        [context.organizationId, pageId],
      );
      await insertSections(
        client,
        context.organizationId,
        pageId,
        defaultSections(page.template_code).map((section) => ({
          ...section,
          isVisible: true,
        })),
      );
      sections = await client.query<WebsiteSectionRow>(
        `SELECT * FROM organization_website_sections
          WHERE organization_id=$1 AND page_id=$2
          ORDER BY section_order`,
        [context.organizationId, pageId],
      );
    }
    if (!sections.rows.some((section) => section.is_visible))
      throw new BadRequestError(
        "Add at least one visible block before publishing this page",
      );
    const result = await client.query<WebsitePageRow>(
      `UPDATE organization_website_pages
          SET status='published',updated_by_member_id=$3
        WHERE organization_id=$1 AND id=$2
        RETURNING *`,
      [context.organizationId, page.id, context.memberId],
    );
    return mapPage(result.rows[0]!, sections.rows);
  });
}

export async function archiveWebsitePage(
  context: SetupContext,
  pageId: string,
) {
  return withTenantContext(context, async (client) => {
    const page = await pageForUpdate(client, context.organizationId, pageId);
    if (page.is_home)
      throw new BadRequestError(
        "The home page cannot be archived. Choose another home page first.",
      );
    await client.query(
      `UPDATE organization_website_pages
          SET status='archived',updated_by_member_id=$3
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, pageId, context.memberId],
    );
  });
}

export async function setWebsitePublication(
  context: SetupContext,
  status: Extract<WebsiteStatus, "published" | "draft" | "paused">,
) {
  return withTenantContext(context, async (client) => {
    const website = await requireWebsite(client, context.organizationId);
    if (status === "published") {
      const pages = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM organization_website_pages
          WHERE organization_id=$1 AND website_id=$2 AND status='published'`,
        [context.organizationId, website.id],
      );
      if (Number(pages.rows[0]?.count ?? 0) === 0)
        throw new BadRequestError(
          "Publish at least one page before publishing the website",
        );
    }
    const result = await client.query<WebsiteSettingsRow>(
      `UPDATE organization_website_settings
          SET publication_status=$2,updated_by_member_id=$3
        WHERE organization_id=$1
        RETURNING *`,
      [context.organizationId, status, context.memberId],
    );
    return mapSettings(result.rows[0]!);
  });
}

export async function publicWebsitePage(orgSlug: string, pageSlug?: string) {
  const result = await query<{ payload: unknown }>(
    `SELECT public_organization_website_page($1,$2) AS payload`,
    [orgSlug, pageSlug ?? null],
  );
  const payload = result.rows[0]?.payload;
  if (!payload) throw new NotFoundError("This public page is not available");
  return payload;
}

function canonicalPublicDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}

function escapePublicEmail(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

/** The visitor confirmation is sent by LiteHubs rather than by a mailbox
 * autoresponder. It therefore works consistently for form submissions and
 * keeps the branded reply independent of Hostinger mailbox limitations. */
function publicContactConfirmationHtml(fullName: string): string {
  const safeName = escapePublicEmail(fullName);
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Congo Omega — Message bien reçu</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f2f4f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f2f4f7;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td align="center" style="background-color:#0b2545;padding:28px 24px;"><span style="font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:.5px;">CONGO OMEGA</span></td></tr>
          <tr><td style="background-color:#c9a227;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
          <tr><td style="padding:40px 40px 24px;color:#344054;">
            <p style="margin:0 0 18px;font-size:19px;font-weight:bold;color:#0b2545;text-align:center;">Bonjour ${safeName},</p>
            <p style="margin:0 0 16px;font-size:15px;line-height:24px;text-align:center;">Merci d’avoir contacté <strong>Congo Omega</strong>.</p>
            <p style="margin:0 0 16px;font-size:15px;line-height:24px;text-align:center;">Votre message a bien été reçu par notre équipe. Nous l’examinerons et vous répondrons dès que possible selon votre demande&nbsp;: information, partenariat, projet, recrutement ou autre besoin.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border-left:3px solid #c9a227;border-radius:6px;margin:24px 0;"><tr><td style="padding:16px 20px;font-size:14px;line-height:22px;color:#475467;">Pour toute information complémentaire, vous pouvez répondre directement à cet e-mail.</td></tr></table>
            <p style="margin:24px 0 0;font-size:15px;line-height:24px;text-align:center;">Cordialement,<br /><strong style="color:#0b2545;">L’équipe Congo Omega</strong></p>
          </td></tr>
          <tr><td style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #eaecf0;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
          <tr><td align="center" style="padding:24px 40px 32px;font-size:12px;color:#98a2b3;"><p style="margin:0 0 6px;font-size:13px;"><a href="mailto:contact@congoomega.com" style="color:#0b2545;text-decoration:none;font-weight:bold;">contact@congoomega.com</a></p><p style="margin:0;">Ceci est une réponse automatique — merci de ne pas y répondre pour les urgences.</p></td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function publicContactConfirmationText(fullName: string): string {
  return [
    `Bonjour ${fullName},`,
    "",
    "Merci d’avoir contacté Congo Omega.",
    "Votre message a bien été reçu par notre équipe. Nous l’examinerons et vous répondrons dès que possible selon votre demande : information, partenariat, projet, recrutement ou autre besoin.",
    "",
    "Pour toute information complémentaire, vous pouvez répondre directement à cet e-mail.",
    "",
    "Cordialement,",
    "L’équipe Congo Omega",
  ].join("\n");
}

/** Sends a visitor message to the mailbox configured for a published domain.
 * `congoomega.com` is also available during the safe public-site fallback,
 * before the internal organization record is restored in production. */
export async function sendPublicWebsiteContact(
  domain: string,
  input: PublicWebsiteContactInput,
): Promise<void> {
  const canonicalDomain = canonicalPublicDomain(domain);
  let recipient: string | null =
    canonicalDomain === "congoomega.com" ? "contact@congoomega.com" : null;

  if (!recipient) {
    const result = await query<{ contact_email: string | null }>(
      `SELECT contact_email
         FROM organization_website_settings
        WHERE publication_status='published'
          AND regexp_replace(lower(custom_domain), '^www\\.', '')=$1
        LIMIT 1`,
      [canonicalDomain],
    );
    recipient = result.rows[0]?.contact_email?.trim().toLowerCase() ?? null;
  }

  if (!recipient)
    throw new NotFoundError("This website is not configured to receive messages");

  // `contact@congoomega.com` is the public reply address, while `omega@…` is
  // its primary Hostinger mailbox. Deliver directly to the mailbox so a
  // website inquiry never depends on alias forwarding; replies still go to
  // the public contact address below.
  const deliveryMailbox =
    canonicalDomain === "congoomega.com"
      ? "omega@congoomega.com"
      : recipient;

  const details = [
    `Site : ${canonicalDomain}`,
    `Nom : ${input.fullName}`,
    `E-mail : ${input.email}`,
    input.phone ? `Téléphone : ${input.phone}` : null,
    "",
    input.message,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const safeMessage = escapePublicEmail(input.message).replace(/\n/g, "<br />");
  const delivery = await sendMail({
    to: deliveryMailbox,
    replyTo: input.email,
    subject: `[Site ${canonicalDomain}] ${input.subject}`,
    text: details,
    html: `<div style="max-width:640px;margin:0 auto;padding:28px;font-family:Arial,sans-serif;color:#101828;line-height:1.6"><p style="margin:0 0 18px;font-size:20px;font-weight:700">Nouveau message depuis ${escapePublicEmail(canonicalDomain)}</p><p><strong>Nom :</strong> ${escapePublicEmail(input.fullName)}<br /><strong>E-mail :</strong> ${escapePublicEmail(input.email)}${input.phone ? `<br /><strong>Téléphone :</strong> ${escapePublicEmail(input.phone)}` : ""}</p><p><strong>Objet :</strong> ${escapePublicEmail(input.subject)}</p><div style="padding:16px;border-radius:12px;background:#f4f7f5">${safeMessage}</div></div>`,
  });
  if (!delivery.sent)
    throw new ServiceUnavailableError(
      "We could not send your message. Please try again shortly.",
    );

  // The acknowledgement is deliberately best-effort. The visitor’s inquiry
  // has already reached the company inbox, so an SMTP issue here must not make
  // the browser claim that the form failed and cause a duplicate submission.
  const confirmation = await sendMail({
    to: input.email,
    replyTo: recipient,
    subject: "Congo Omega — votre message est bien reçu",
    text: publicContactConfirmationText(input.fullName),
    html: publicContactConfirmationHtml(input.fullName),
  });
  if (!confirmation.sent) {
    logger.warn(
      { domain: canonicalDomain, reason: confirmation.reason },
      "Public website contact acknowledgement was not sent",
    );
  }
}

export async function listPlatformWebsites(staffUserId: string) {
  return withUserContext(staffUserId, async (client) => {
    const result = await client.query<{
      organization_slug: string;
      organization_name: string;
      website_id: string;
      publication_status: WebsiteStatus;
      custom_domain: string | null;
      updated_at: Date;
      page_count: string;
      published_page_count: string;
    }>(
      `SELECT o.slug AS organization_slug,o.display_name AS organization_name,
              ws.id AS website_id,ws.publication_status,ws.custom_domain,ws.updated_at,
              count(p.id)::text AS page_count,
              count(p.id) FILTER (WHERE p.status='published')::text AS published_page_count
         FROM organization_website_settings ws
         JOIN organizations o ON o.id=ws.organization_id
         LEFT JOIN organization_website_pages p
           ON p.organization_id=ws.organization_id AND p.website_id=ws.id
        GROUP BY o.slug,o.display_name,ws.id,ws.publication_status,ws.custom_domain,ws.updated_at
        ORDER BY ws.updated_at DESC`,
    );
    return result.rows.map((row) => ({
      organizationSlug: row.organization_slug,
      organizationName: row.organization_name,
      websiteId: row.website_id,
      publicationStatus: row.publication_status,
      customDomain: row.custom_domain,
      updatedAt: asIso(row.updated_at),
      pageCount: Number(row.page_count),
      publishedPageCount: Number(row.published_page_count),
    }));
  });
}
