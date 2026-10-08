"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Archive,
  Bold,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  ExternalLink,
  FilePlus2,
  Globe2,
  GripVertical,
  Heading2,
  ImagePlus,
  GalleryHorizontal,
  Images,
  Italic,
  Link2,
  LayoutPanelTop,
  Mail,
  Maximize2,
  Minimize2,
  Monitor,
  Megaphone,
  MousePointerClick,
  MoveVertical,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Eye,
  EyeOff,
  PanelTop,
  PanelBottom,
  Paintbrush,
  History,
  Pin,
  Play,
  Plus,
  Gem,
  Menu,
  Languages,
  Share2,
  Phone,
  Copyright,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  Smartphone,
  Tablet,
  TextIcon,
  Trash2,
  Undo2,
  Redo2,
  Unlink2,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { confirmDialog, confirmText as ask } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { del, get, orgUrl, patch, post, put } from "@/lib/api";
import { WEBSITE_FONTS, type Breakpoint } from "@/components/website/website-element-style";
import { useLanguage } from "@/providers/language-provider";
import {
  PublicWebsiteRenderer,
  congoOmegaLandingSections,
  readExtraElements,
  MAX_CONTAINER_DEPTH,
  type WebsiteExtraElement,
  type PublicWebsite,
  type PublicWebsitePage,
  type WebsiteSection,
} from "@/components/website/public-website-renderer";
import {
  BuilderCanvasOverlay,
  dragState,
  type BuilderDrag,
  type DropTarget,
  type ElementInfo,
} from "@/components/website/builder-overlay";
import {
  DEFAULT_TEMPLATES,
  SITE_THEMES,
  SOCIAL_NETWORK_KEYS,
  ZONE_ELEMENT_TYPES,
  ZONE_NAMES,
  ZONE_TEMPLATES,
  ZONE_LOOKS,
  LINK_STYLES,
  zoneLookOf,
  applyZoneTemplate,
  buildZone,
  readDesign,
  zoneElement,
  type SiteDesign,
  type SiteFacts,
  type ZoneData,
  type ZoneName,
} from "@/components/website/website-zones";
import {
  BLOCK_VARIANTS,
  SITE_TEMPLATES,
  isBlockType,
} from "@/components/website/website-templates";

type BuilderPage = {
  id: string;
  slug: string;
  navigationLabelFr: string;
  navigationLabelEn: string;
  titleFr: string;
  titleEn: string;
  descriptionFr: string | null;
  descriptionEn: string | null;
  seoTitleFr: string | null;
  seoTitleEn: string | null;
  seoDescriptionFr: string | null;
  seoDescriptionEn: string | null;
  templateCode: TemplateCode;
  status: "draft" | "published" | "archived";
  isHome: boolean;
  sortOrder: number;
  settings?: Record<string, unknown>;
  sections: Array<{
    id: string;
    type: SectionType;
    isVisible: boolean;
    content: Record<string, unknown>;
  }>;
};
type BuilderWebsite = {
  id: string;
  displayName: string;
  tagline: string | null;
  defaultLocale: "fr" | "en";
  publicationStatus: "draft" | "published" | "paused";
  themePreset: "verdant" | "cobalt" | "sunrise" | "earth";
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressText: string | null;
  footerText: string | null;
  customDomain: string | null;
  /** Site design (theme + global zones): the draft being edited, the
   * version visitors see, and the dates of earlier published versions. */
  designDraft?: Record<string, unknown>;
  designPublished?: Record<string, unknown>;
  designHistory?: Array<{ savedAt: string; original?: boolean }>;
};
type BuilderData = {
  organization: { displayName: string; slug: string };
  website: BuilderWebsite | null;
  pages: BuilderPage[];
};
type SectionType = WebsiteSection["section_type"];
type TemplateCode =
  | "blank"
  | "company"
  | "operations"
  | "project"
  | "impact"
  | "contact"
  | "careers";
type Tab = "pages" | "media" | "activities" | "appearance" | "preview";
type WebsiteMedia = {
  id: string;
  title: string;
  originalName: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
};
type CustomerActivity = {
  id: string;
  title: string;
  summary: string;
  body: string | null;
  imageUrl: string | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
  audience: "all" | "invited";
  status: "draft" | "published" | "archived";
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  recipientCount: number;
  sentCount: number;
};

const sectionLabels: Record<SectionType, [string, string]> = {
  hero: ["En-tête", "Hero"],
  rich_text: ["Texte", "Text"],
  feature_grid: ["Cartes", "Feature cards"],
  metrics: ["Chiffres clés", "Metrics"],
  image_callout: ["Image + texte", "Image + text"],
  gallery: ["Galerie", "Gallery"],
  faq: ["Questions", "Questions"],
  cta: ["Appel à l’action", "Call to action"],
  careers: ["Carrières", "Careers"],
  contact: ["Contact", "Contact"],
  container: ["Div", "Div"],
};
const sectionHints: Record<SectionType, [string, string]> = {
  hero: ["Grande image, titre et boutons en haut de page.", "Large image, title and buttons at the top."],
  rich_text: ["Un titre et un paragraphe.", "A title and a paragraph."],
  feature_grid: ["Plusieurs cartes côte à côte (grille ou carrousel).", "Several cards side by side (grid or carousel)."],
  metrics: ["Des chiffres clés mis en avant.", "Highlighted key figures."],
  image_callout: ["Une image à côté d’un texte et d’un bouton.", "An image next to a text and a button."],
  gallery: ["Plusieurs photos.", "Several photos."],
  faq: ["Questions et réponses dépliables.", "Expandable questions and answers."],
  cta: ["Un message fort avec un bouton.", "A strong message with a button."],
  careers: ["Lien vers les offres d’emploi.", "Link to job openings."],
  contact: ["Coordonnées et formulaire de contact.", "Contact details and form."],
  container: ["Un div vide : réglez son fond, sa taille, sa bordure… puis ajoutez dedans textes, images, boutons, carrousels ou d’autres divs.", "An empty div: set its background, size, border… then add texts, images, buttons, carousels or other divs inside."],
};

/** A short hint of what a block contains, to tell similar blocks apart. */
function blockSummary(block: WebsiteSection): string {
  const content = block.content;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = content[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const title = pick("title_fr", "titleFr", "title");
  if (title) return title;
  const findText = (items: WebsiteExtraElement[]): string => {
    for (const item of items) {
      if ((item.type === "heading" || item.type === "text" || item.type === "button") && item.textFr?.trim())
        return item.textFr.trim();
      const nested = findText(item.children ?? []);
      if (nested) return nested;
    }
    return "";
  };
  const extras = readExtraElements(content);
  if (extras.some((item) => item.type === "slider") && block.section_type === "container")
    return "Carrousel";
  return findText(extras);
}
const templates: Array<{
  value: TemplateCode;
  fr: string;
  en: string;
  hintFr: string;
  hintEn: string;
}> = [
  {
    value: "company",
    fr: "Entreprise",
    en: "Company",
    hintFr: "Présentation, activités et contact",
    hintEn: "Presentation, activities and contact",
  },
  {
    value: "operations",
    fr: "Activités",
    en: "Operations",
    hintFr: "Agriculture, élevage et production",
    hintEn: "Agriculture, livestock and production",
  },
  {
    value: "project",
    fr: "Projet",
    en: "Project",
    hintFr: "Impact, résultats et indicateurs",
    hintEn: "Impact, outcomes and metrics",
  },
  {
    value: "impact",
    fr: "Impact",
    en: "Impact",
    hintFr: "Engagement local et développement durable",
    hintEn: "Local commitment and sustainable development",
  },
  {
    value: "careers",
    fr: "Carrières",
    en: "Careers",
    hintFr: "Recrutement et postes publiés",
    hintEn: "Recruitment and published roles",
  },
  {
    value: "contact",
    fr: "Contact",
    en: "Contact",
    hintFr: "Coordonnées et prise de contact",
    hintEn: "Contact details and outreach",
  },
  {
    value: "blank",
    fr: "Page vide",
    en: "Blank page",
    hintFr: "Construire librement",
    hintEn: "Build freely",
  },
];

const tr = (fr: boolean, french: string, english: string) =>
  fr ? french : english;
const toOptional = (value: string | null | undefined) => value?.trim() || null;

function sectionSeed(type: SectionType): WebsiteSection {
  const common = { id: `local-${Date.now()}-${type}`, sort_order: 0 };
  switch (type) {
    case "container":
      // One single div: its own style (canvas) is the box itself, with no
      // band or inner zone around it. Children are added explicitly.
      return {
        ...common,
        section_type: type,
        content: { divMode: true, extras: [], elementStyles: { canvas: { ...DEFAULT_DIV_STYLE } } },
      };
    case "hero":
      return {
        ...common,
        section_type: type,
        content: {
          kickerFr: "BIENVENUE",
          kickerEn: "WELCOME",
          titleFr: "Votre titre principal",
          titleEn: "Your main title",
          bodyFr: "Présentez clairement votre activité.",
          bodyEn: "Clearly introduce your activity.",
          primaryLabelFr: "Nous contacter",
          primaryLabelEn: "Contact us",
          primaryHref: "#contact",
        },
      };
    case "feature_grid":
      return {
        ...common,
        section_type: type,
        content: {
          titleFr: "Ce que nous faisons",
          titleEn: "What we do",
          bodyFr: "Présentez les points importants.",
          bodyEn: "Present the important points.",
          items: [
            {
              titleFr: "Premier point",
              titleEn: "First point",
              bodyFr: "Une explication courte.",
              bodyEn: "A short explanation.",
            },
          ],
        },
      };
    case "metrics":
      return {
        ...common,
        section_type: type,
        content: {
          titleFr: "Nos chiffres",
          titleEn: "Our figures",
          items: [{ value: "01", labelFr: "Indicateur", labelEn: "Metric" }],
        },
      };
    case "faq":
      return {
        ...common,
        section_type: type,
        content: {
          titleFr: "Questions fréquentes",
          titleEn: "Frequently asked questions",
          items: [
            {
              questionFr: "Votre question",
              questionEn: "Your question",
              answerFr: "Votre réponse.",
              answerEn: "Your answer.",
            },
          ],
        },
      };
    case "gallery":
      return {
        ...common,
        section_type: type,
        content: { titleFr: "En images", titleEn: "In pictures", items: [] },
      };
    case "cta":
      return {
        ...common,
        section_type: type,
        content: {
          titleFr: "Prêt à échanger ?",
          titleEn: "Ready to connect?",
          bodyFr: "Contactez-nous pour en savoir plus.",
          bodyEn: "Contact us to learn more.",
          buttonLabelFr: "Nous contacter",
          buttonLabelEn: "Contact us",
          buttonHref: "#contact",
        },
      };
    case "careers":
      return {
        ...common,
        section_type: type,
        content: {
          titleFr: "Rejoignez notre équipe",
          titleEn: "Join our team",
          bodyFr: "Découvrez les postes ouverts.",
          bodyEn: "Discover open roles.",
          buttonLabelFr: "Voir les postes",
          buttonLabelEn: "View roles",
        },
      };
    case "contact":
      return {
        ...common,
        section_type: type,
        content: {
          titleFr: "Nous contacter",
          titleEn: "Contact us",
          bodyFr: "Écrivez-nous ou appelez-nous.",
          bodyEn: "Write or call us.",
        },
      };
    case "image_callout":
      return {
        ...common,
        section_type: type,
        content: {
          titleFr: "Une histoire à partager",
          titleEn: "A story to share",
          bodyFr: "Ajoutez une image et un message clair.",
          bodyEn: "Add an image and a clear message.",
        },
      };
    default:
      return {
        ...common,
        section_type: "rich_text",
        content: {
          titleFr: "Un titre",
          titleEn: "A title",
          bodyFr: "Votre texte.",
          bodyEn: "Your text.",
        },
      };
  }
}

export function WebsiteArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>("pages");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["website-builder", orgSlug],
    queryFn: () => get<BuilderData>(orgUrl(orgSlug, "website")),
  });
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ["website-builder", orgSlug] });
  const pages = query.data?.pages ?? [];
  const selected =
    pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null;
  useEffect(() => {
    if (!selectedPageId && pages[0]) setSelectedPageId(pages[0].id);
  }, [pages, selectedPageId]);

  const saveSettings = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      put(orgUrl(orgSlug, "website"), payload),
    onSuccess: () => {
      refresh();
      toast.success(
        tr(fr, "Identité du site enregistrée", "Website identity saved"),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const createPage = useMutation({
    // "__sections" (from a page template) are saved right after the page.
    mutationFn: async (input: Record<string, unknown>) => {
      const { __sections: sections, ...payload } = input as Record<string, unknown> & {
        __sections?: WebsiteSection[];
      };
      const page = await post<{ page: BuilderPage }>(orgUrl(orgSlug, "website/pages"), payload).then(
        (response) => response.page,
      );
      if (sections?.length)
        await put(orgUrl(orgSlug, `website/pages/${page.id}/sections`), {
          sections: sections.map(({ section_type, content }) => ({ type: section_type, content, isVisible: true })),
        });
      return page;
    },
    onSuccess: (page) => {
      refresh();
      setSelectedPageId(page.id);
      setTab("preview");
      toast.success(tr(fr, "Page créée", "Page created"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const installStarterPages = useMutation({
    mutationFn: () =>
      post<{ pages: BuilderPage[] }>(orgUrl(orgSlug, "website/starter-pages")),
    onSuccess: (response) => {
      refresh();
      const home =
        response.pages.find((page) => page.isHome) ?? response.pages[0];
      if (home) setSelectedPageId(home.id);
      toast.success(
        tr(fr, "Collection de pages ajoutée", "Page collection added"),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const savePage = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => patch(orgUrl(orgSlug, `website/pages/${id}`), payload),
    onSuccess: () => {
      refresh();
      toast.success(tr(fr, "Page enregistrée", "Page saved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const saveSections = useMutation({
    mutationFn: ({
      id,
      sections,
    }: {
      id: string;
      sections: WebsiteSection[];
    }) =>
      put(orgUrl(orgSlug, `website/pages/${id}/sections`), {
        sections: sections.map(({ section_type, content }) => ({
          type: section_type,
          content,
          isVisible: true,
        })),
      }),
    onSuccess: () => {
      refresh();
      toast.success(tr(fr, "Blocs enregistrés", "Blocks saved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const publishPage = useMutation({
    mutationFn: (id: string) =>
      post(orgUrl(orgSlug, `website/pages/${id}/publish`)),
    onSuccess: () => {
      refresh();
      toast.success(tr(fr, "Page publiée", "Page published"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const archivePage = useMutation({
    mutationFn: (id: string) => del(orgUrl(orgSlug, `website/pages/${id}`)),
    onSuccess: () => {
      setSelectedPageId(null);
      refresh();
      toast.success(tr(fr, "Page archivée", "Page archived"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const reorderPages = useMutation({
    mutationFn: (pageIds: string[]) =>
      put(orgUrl(orgSlug, "website/pages/order"), { pageIds }),
    onSuccess: () => {
      refresh();
      toast.success(
        tr(fr, "Ordre du menu enregistré", "Menu order saved"),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const publication = useMutation({
    mutationFn: (status: "draft" | "published" | "paused") =>
      post(orgUrl(orgSlug, "website/publication"), { status }),
    onSuccess: () => {
      refresh();
      toast.success(tr(fr, "Publication mise à jour", "Publication updated"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading)
    return (
      <main className="p-6">
        <SkeletonCard rows={10} />
      </main>
    );
  if (query.isError || !query.data)
    return (
      <main className="p-6">
        <ErrorState
          title={tr(
            fr,
            "Impossible de charger le site web",
            "Could not load website",
          )}
          description={(query.error as Error | undefined)?.message}
          onRetry={() => void query.refetch()}
        />
      </main>
    );
  const builder = query.data;
  const activePages = pages.filter((page) => page.status !== "archived");
  const publishedCount = pages.filter((page) => page.status === "published").length;
  const siteHref = builder.website?.customDomain
    ? `https://${builder.website.customDomain}`
    : `/sites/${orgSlug}`;
  const isPublished = builder.website?.publicationStatus === "published";
  return (
    <main className="mx-auto max-w-[1540px] space-y-4 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {tr(fr, "Site web", "Website")}
          </h1>
          {builder.website ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-secondary">
              <span>{builder.website.customDomain ?? `/sites/${orgSlug}`}</span>
              <span aria-hidden="true">·</span>
              <Badge variant={isPublished ? "good" : "warning"}>
                {statusLabel(builder.website.publicationStatus, fr)}
              </Badge>
              <span aria-hidden="true">·</span>
              <span>
                {publishedCount}/{activePages.length} {tr(fr, "pages publiées", "pages published")}
              </span>
            </p>
          ) : null}
        </div>
        {builder.website ? (
          <div className="flex flex-wrap gap-2">
            <a href={siteHref} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">
                <ExternalLink />
                {tr(fr, "Voir le site", "View site")}
              </Button>
            </a>
            <Button
              size="sm"
              variant={isPublished ? "secondary" : "primary"}
              loading={publication.isPending}
              onClick={() => publication.mutate(isPublished ? "paused" : "published")}
            >
              <Globe2 />
              {isPublished ? tr(fr, "Mettre en pause", "Pause site") : tr(fr, "Publier le site", "Publish website")}
            </Button>
          </div>
        ) : null}
      </header>

      {builder.website && !isPublished ? (
        <p className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
          {tr(
            fr,
            "Le site public est en pause : vos visiteurs ne voient rien tant que vous n’avez pas cliqué sur « Publier le site ».",
            "The public website is paused: visitors see nothing until you choose “Publish website”.",
          )}
        </p>
      ) : null}

      {!builder.website ? (
        <WebsiteIdentityForm
          orgSlug={orgSlug}
          organization={builder.organization}
          initial={null}
          saving={saveSettings.isPending}
          onSave={(payload) => saveSettings.mutate(payload)}
          fr={fr}
        />
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-1 p-1">
            <TabButton
              active={tab === "pages"}
              onClick={() => setTab("pages")}
              icon={FilePlus2}
              label={tr(fr, "Pages", "Pages")}
            />
            <TabButton
              active={tab === "preview"}
              onClick={() => setTab("preview")}
              icon={PencilLine}
              label={tr(fr, "Éditeur visuel", "Visual editor")}
            />
            <TabButton
              active={tab === "media"}
              onClick={() => setTab("media")}
              icon={Images}
              label={tr(fr, "Médias", "Media")}
            />
            <TabButton
              active={tab === "activities"}
              onClick={() => setTab("activities")}
              icon={Megaphone}
              label={tr(fr, "Activités clients", "Customer activities")}
            />
            <TabButton
              active={tab === "appearance"}
              onClick={() => setTab("appearance")}
              icon={Palette}
              label={tr(fr, "Apparence & domaine", "Appearance & domain")}
            />
          </div>
          {tab === "pages" ? (
            <PagesTab
              pages={pages}
              onOpen={(id) => {
                setSelectedPageId(id);
                setTab("preview");
              }}
              onInstall={() => installStarterPages.mutate()}
              installing={installStarterPages.isPending}
              onPublish={(page) => publishPage.mutate(page.id)}
              publishing={publishPage.isPending}
              onArchive={(page) => archivePage.mutate(page.id)}
              onReorder={(pageIds) => reorderPages.mutate(pageIds)}
              reordering={reorderPages.isPending}
              onCreate={(payload) => createPage.mutateAsync(payload).then(() => undefined)}
              creating={createPage.isPending}
              fr={fr}
            />
          ) : null}
          {tab === "media" ? (
            <WebsiteMediaLibrary orgSlug={orgSlug} fr={fr} />
          ) : null}
          {tab === "activities" ? (
            <CustomerActivitiesTab orgSlug={orgSlug} fr={fr} />
          ) : null}
          {tab === "appearance" ? (
            <WebsiteIdentityForm
              orgSlug={orgSlug}
              organization={builder.organization}
              initial={builder.website}
              saving={saveSettings.isPending}
              onSave={(payload) => saveSettings.mutate(payload)}
              fr={fr}
            />
          ) : null}
          {tab === "preview" ? (
            <VisualBuilderTab
              orgSlug={orgSlug}
              website={builder.website}
              pages={pages}
              page={selected}
              onSelectPage={setSelectedPageId}
              onSaveSections={(sections) =>
                selected
                  ? saveSections.mutateAsync({ id: selected.id, sections })
                  : Promise.resolve()
              }
              onSavePage={(payload) =>
                selected
                  ? savePage.mutateAsync({ id: selected.id, payload })
                  : Promise.resolve()
              }
              onPublish={() =>
                selected ? publishPage.mutateAsync(selected.id) : Promise.resolve()
              }
              savingSections={saveSections.isPending}
              savingPage={savePage.isPending}
              publishing={publishPage.isPending}
              onCreatePage={(payload) => createPage.mutateAsync(payload)}
              creatingPage={createPage.isPending}
              fr={fr}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof FilePlus2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium ${active ? "bg-brand text-brand-ink" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"}`}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
function statusLabel(status: string, fr: boolean) {
  return status === "published"
    ? tr(fr, "Publié", "Published")
    : status === "paused"
      ? tr(fr, "En pause", "Paused")
      : tr(fr, "Brouillon", "Draft");
}

/** The list of pages: open one in the visual editor, publish, reorder,
 * archive, or create a new one. Archived pages are hidden unless asked. */
function PagesTab({
  pages,
  onOpen,
  onInstall,
  installing,
  onPublish,
  publishing,
  onArchive,
  onReorder,
  reordering,
  onCreate,
  creating,
  fr,
}: {
  pages: BuilderPage[];
  onOpen: (id: string) => void;
  onInstall: () => void;
  installing: boolean;
  onPublish: (page: BuilderPage) => void;
  publishing: boolean;
  onArchive: (page: BuilderPage) => void;
  onReorder: (pageIds: string[]) => void;
  reordering: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
  creating: boolean;
  fr: boolean;
}) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [orderedPageIds, setOrderedPageIds] = useState<string[]>([]);
  useEffect(() => {
    setOrderedPageIds(pages.map((page) => page.id));
  }, [pages]);
  const orderedPages = useMemo(() => {
    const byId = new Map(pages.map((page) => [page.id, page]));
    const known = orderedPageIds
      .map((id) => byId.get(id))
      .filter((page): page is BuilderPage => Boolean(page));
    const knownIds = new Set(known.map((page) => page.id));
    return [...known, ...pages.filter((page) => !knownIds.has(page.id))];
  }, [orderedPageIds, pages]);
  const orderChanged = orderedPages.some((page, index) => page.id !== pages[index]?.id);
  const archivedCount = pages.filter((page) => page.status === "archived").length;
  const visible = orderedPages.filter((page) => showArchived || page.status !== "archived");
  const move = (pageId: string, direction: -1 | 1) => {
    const list = [...orderedPages];
    const index = list.findIndex((page) => page.id === pageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    if (list[index]!.isHome || list[target]!.isHome) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
    setOrderedPageIds(list.map((page) => page.id));
  };

  if (!pages.length)
    return (
      <EmptyState
        title={tr(fr, "Aucune page", "No pages")}
        description={tr(
          fr,
          "Installez les pages standard (Accueil, Entreprise, Activités, Projets, Impact, Carrières, Contact) ou créez votre première page.",
          "Install the standard pages or create your first page.",
        )}
        action={{
          label: tr(fr, "Installer les pages standard", "Install standard pages"),
          onClick: onInstall,
        }}
      />
    );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{tr(fr, "Pages du site", "Website pages")}</CardTitle>
          <CardDescription>
            {tr(fr, "Cliquez sur une page pour la construire dans l’éditeur visuel.", "Click a page to build it in the visual editor.")}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {orderChanged ? (
            <Button
              size="sm"
              variant="secondary"
              loading={reordering}
              onClick={() => onReorder(orderedPages.map((page) => page.id))}
            >
              <Save />
              {tr(fr, "Enregistrer l’ordre du menu", "Save menu order")}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setCreatingNew((value) => !value)}>
            {creatingNew ? <X /> : <Plus />}
            {creatingNew ? tr(fr, "Fermer", "Close") : tr(fr, "Nouvelle page", "New page")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {creatingNew ? (
          <div className="max-w-md">
            <NewPageForm
              pages={pages}
              saving={creating || installing}
              onCancel={() => setCreatingNew(false)}
              onCreate={async (payload) => {
                await onCreate(payload);
                setCreatingNew(false);
              }}
              fr={fr}
            />
          </div>
        ) : null}
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visible.map((page) => {
            const position = orderedPages.indexOf(page);
            return (
              <li key={page.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 hover:bg-surface-2/60">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpen(page.id)}
                  title={tr(fr, "Ouvrir dans l’éditeur visuel", "Open in the visual editor")}
                >
                  <span className="font-medium text-ink">{page.navigationLabelFr || page.titleFr}</span>
                  <span className="ml-2 text-xs text-ink-muted">/{page.slug}</span>
                  {page.isHome ? (
                    <span className="ml-2 text-xs text-ink-muted">· {tr(fr, "page d’accueil", "home page")}</span>
                  ) : null}
                  {!page.isHome && page.settings?.hideFromMenu === true ? (
                    <span className="ml-2 text-xs text-ink-muted">· {tr(fr, "hors menu", "not in menu")}</span>
                  ) : null}
                </button>
                <Badge
                  variant={page.status === "published" ? "good" : page.status === "archived" ? "serious" : "warning"}
                >
                  {statusLabel(page.status, fr)}
                </Badge>
                {page.status === "draft" ? (
                  <Button size="sm" variant="secondary" loading={publishing} onClick={() => onPublish(page)}>
                    <Send />
                    {tr(fr, "Publier", "Publish")}
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => onOpen(page.id)}>
                  <PencilLine />
                  {tr(fr, "Éditer", "Edit")}
                </Button>
                {page.status !== "archived" ? (
                  <div className="flex">
                    <Button size="icon-sm" variant="ghost" disabled={page.isHome || position <= 1} onClick={() => move(page.id, -1)} aria-label={tr(fr, "Monter dans le menu", "Move up in menu")}>
                      <ChevronUp />
                    </Button>
                    <Button size="icon-sm" variant="ghost" disabled={page.isHome || position >= orderedPages.length - 1} onClick={() => move(page.id, 1)} aria-label={tr(fr, "Descendre dans le menu", "Move down in menu")}>
                      <ChevronDown />
                    </Button>
                    {!page.isHome ? (
                      <Button size="icon-sm" variant="ghost" onClick={() => onArchive(page)} aria-label={tr(fr, "Archiver la page", "Archive page")}>
                        <Archive />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {archivedCount ? (
          <button
            type="button"
            className="text-xs text-ink-muted hover:text-ink"
            onClick={() => setShowArchived((value) => !value)}
          >
            {showArchived
              ? tr(fr, "Masquer les pages archivées", "Hide archived pages")
              : tr(fr, `Afficher les pages archivées (${archivedCount})`, `Show archived pages (${archivedCount})`)}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PageForm({
  initial,
  title,
  submit,
  saving,
  onCancel,
  onSave,
  fr,
}: {
  initial: Omit<BuilderPage, "id" | "sections" | "sortOrder"> | BuilderPage;
  title: string;
  submit: string;
  saving: boolean;
  onCancel?: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  fr: boolean;
}) {
  const [form, setForm] = useState(initial);
  const update = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => setForm(initial), [initial]);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {tr(
              fr,
              "Les deux langues peuvent être adaptées à votre rythme.",
              "Both languages can be adapted at your pace.",
            )}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tr(fr, "Nom dans le menu (français)", "Menu label (French)")}
            required
          >
            <Input
              value={form.navigationLabelFr}
              onChange={(event) =>
                update("navigationLabelFr", event.target.value)
              }
            />
          </Field>
          <Field
            label={tr(fr, "Nom dans le menu (anglais)", "Menu label (English)")}
            required
          >
            <Input
              value={form.navigationLabelEn}
              onChange={(event) =>
                update("navigationLabelEn", event.target.value)
              }
            />
          </Field>
          <Field
            label={tr(fr, "Adresse de la page", "Page address")}
            required
            hint={tr(fr, "Exemple : activites", "Example: activities")}
          >
            <Input
              value={form.slug}
              onChange={(event) =>
                update(
                  "slug",
                  event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                )
              }
            />
          </Field>
          <Field label={tr(fr, "Modèle", "Template")}>
            <select
              value={form.templateCode}
              onChange={(event) =>
                update("templateCode", event.target.value as TemplateCode)
              }
              className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            >
              {templates.map((template) => (
                <option key={template.value} value={template.value}>
                  {fr ? template.fr : template.en}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr(fr, "Titre français", "French title")} required>
            <Input
              value={form.titleFr}
              onChange={(event) => update("titleFr", event.target.value)}
            />
          </Field>
          <Field label={tr(fr, "Titre anglais", "English title")} required>
            <Input
              value={form.titleEn}
              onChange={(event) => update("titleEn", event.target.value)}
            />
          </Field>
          <Field
            className="sm:col-span-2"
            label={tr(fr, "Résumé français", "French summary")}
          >
            <Textarea
              value={form.descriptionFr ?? ""}
              onChange={(event) => update("descriptionFr", event.target.value)}
            />
          </Field>
          <Field
            className="sm:col-span-2"
            label={tr(fr, "Résumé anglais", "English summary")}
          >
            <Textarea
              value={form.descriptionEn ?? ""}
              onChange={(event) => update("descriptionEn", event.target.value)}
            />
          </Field>
        </div>
        <div className="mt-6 border-t border-border pt-5">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {tr(fr, "Référencement", "Search visibility")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {tr(
                fr,
                "Ces informations apparaissent dans Google, Bing et les aperçus de partage. Si vous les laissez vides, LiteHubs reprend le titre et le résumé de la page.",
                "These details appear in Google, Bing, and social sharing previews. If left blank, LiteHubs uses the page title and summary.",
              )}
            </p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label={tr(fr, "Titre SEO français", "French SEO title")}
              hint={tr(fr, "Idéalement 50 à 60 caractères.", "Ideally 50 to 60 characters.")}
            >
              <Input
                value={form.seoTitleFr ?? ""}
                maxLength={180}
                onChange={(event) => update("seoTitleFr", event.target.value)}
              />
            </Field>
            <Field
              label={tr(fr, "Titre SEO anglais", "English SEO title")}
              hint={tr(fr, "Facultatif si la page est seulement en français.", "Optional for a French-only page.")}
            >
              <Input
                value={form.seoTitleEn ?? ""}
                maxLength={180}
                onChange={(event) => update("seoTitleEn", event.target.value)}
              />
            </Field>
            <Field
              className="sm:col-span-2"
              label={tr(fr, "Description SEO française", "French SEO description")}
              hint={tr(fr, "Expliquez clairement la page en 140 à 160 caractères.", "Describe the page clearly in 140 to 160 characters.")}
            >
              <Textarea
                value={form.seoDescriptionFr ?? ""}
                maxLength={320}
                onChange={(event) => update("seoDescriptionFr", event.target.value)}
              />
            </Field>
            <Field
              className="sm:col-span-2"
              label={tr(fr, "Description SEO anglaise", "English SEO description")}
              hint={tr(fr, "Facultatif si la page est seulement en français.", "Optional for a French-only page.")}
            >
              <Textarea
                value={form.seoDescriptionEn ?? ""}
                maxLength={320}
                onChange={(event) => update("seoDescriptionEn", event.target.value)}
              />
            </Field>
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.isHome}
            onChange={(event) => update("isHome", event.target.checked)}
          />
          {tr(fr, "Utiliser comme page d’accueil", "Use as home page")}
        </label>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            loading={saving}
            onClick={() =>
              onSave({
                slug: form.slug,
                navigationLabelFr: form.navigationLabelFr,
                navigationLabelEn: form.navigationLabelEn,
                titleFr: form.titleFr,
                titleEn: form.titleEn,
                descriptionFr: toOptional(form.descriptionFr),
                descriptionEn: toOptional(form.descriptionEn),
                seoTitleFr: toOptional(form.seoTitleFr),
                seoTitleEn: toOptional(form.seoTitleEn),
                seoDescriptionFr: toOptional(form.seoDescriptionFr),
                seoDescriptionEn: toOptional(form.seoDescriptionEn),
                templateCode: form.templateCode,
                isHome: form.isHome,
              })
            }
          >
            <Save />
            {submit}
          </Button>
          {onCancel ? (
            <Button variant="secondary" onClick={onCancel}>
              {tr(fr, "Annuler", "Cancel")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function BlockEditor({
  orgSlug,
  block,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging,
  isDropTarget,
  fr,
  embedded = false,
  onReplay,
  linkPages = [],
  areaStyle,
}: {
  orgSlug: string;
  block: WebsiteSection;
  index: number;
  count: number;
  onChange: (block: WebsiteSection) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  isDragging: boolean;
  isDropTarget: boolean;
  fr: boolean;
  /** Inside the visual builder the panel already names the block. */
  embedded?: boolean;
  onReplay?: () => void;
  linkPages?: LinkPage[];
  /** Full style of the block's div, shown right in the Style tab. */
  areaStyle?: ReactNode;
}) {
  const [open, setOpen] = useState(embedded || index === 0);
  // The visual builder shows one group at a time and one language at a time,
  // instead of a long list. The classic editor keeps showing everything.
  const hasImages = ["hero", "image_callout", "gallery"].includes(block.section_type);
  const hasButton = ["hero", "cta", "image_callout", "careers"].includes(block.section_type);
  const hasItems = ["feature_grid", "metrics", "faq", "gallery"].includes(block.section_type);
  const groups = [
    { key: "text", label: tr(fr, "Texte", "Text"), on: block.section_type !== "container" },
    { key: "images", label: tr(fr, "Images", "Images"), on: hasImages },
    { key: "button", label: tr(fr, "Bouton", "Button"), on: hasButton },
    { key: "items", label: tr(fr, "Éléments", "Items"), on: hasItems },
    { key: "style", label: tr(fr, "Style", "Style"), on: true },
    { key: "link", label: tr(fr, "Lien", "Link"), on: embedded },
  ].filter((group) => group.on);
  const [group, setGroup] = useState(
    block.section_type === "container" ? "style" : "text",
  );
  const [lang, setLang] = useState<"fr" | "en">(fr ? "fr" : "en");
  const show = (key: string) => !embedded || group === key;
  const showLang = (value: "fr" | "en") => !embedded || lang === value;
  const content = block.content;
  const set = (key: string, value: unknown) =>
    onChange({ ...block, content: { ...content, [key]: value } });
  const read = (key: string) => String(content[key] ?? "");
  const items = Array.isArray(content.items)
    ? content.items.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object",
      )
    : [];
  const setItems = (next: Record<string, unknown>[]) => set("items", next);
  return (
    <article
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={embedded ? "" : `rounded-xl border bg-surface-1 transition-all ${
        isDragging
          ? "border-brand/30 opacity-45"
          : isDropTarget
            ? "border-brand bg-brand/[.055] ring-2 ring-brand/20"
            : "border-border"
      }`}
    >
      <div className={embedded ? "hidden" : "flex items-center gap-2 p-3"}>
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="grid size-9 shrink-0 cursor-grab place-items-center rounded-lg text-ink-muted transition hover:bg-surface-2 hover:text-brand active:cursor-grabbing"
          aria-label={tr(fr, "Glisser pour réorganiser ce bloc", "Drag to reorder this block")}
          title={tr(fr, "Glisser pour réorganiser", "Drag to reorder")}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen(!open)}
        >
          <p className="text-sm font-semibold text-ink">
            {blockLabel(block, fr)}
          </p>
          <p className="text-xs text-ink-muted">
            {tr(fr, "Bloc", "Block")} {index + 1}
          </p>
        </button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
          aria-label={tr(fr, "Monter", "Move up")}
        >
          <ChevronUp />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={index === count - 1}
          onClick={() => onMove(index, 1)}
          aria-label={tr(fr, "Descendre", "Move down")}
        >
          <ChevronDown />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onRemove(index)}
          aria-label={tr(fr, "Supprimer", "Remove")}
        >
          <Trash2 />
        </Button>
      </div>
      {open ? (
        <div className={embedded ? "space-y-4" : "space-y-3 border-t border-border p-3"}>
          {embedded ? (
            <div className="sticky top-0 z-10 -mx-3 -mt-3 space-y-2 border-b border-border bg-surface-1 px-3 pb-2 pt-3">
              <div className="flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1">
                {groups.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setGroup(item.key)}
                    className={`flex-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                      group === item.key
                        ? "bg-surface-1 text-brand shadow-sm"
                        : "text-ink-secondary hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {group === "text" || group === "button" ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-muted">
                    {tr(fr, "Langue modifiée", "Editing language")}
                  </span>
                  <div className="flex rounded-md border border-border p-0.5">
                    {(["fr", "en"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setLang(value)}
                        className={`rounded px-2.5 py-0.5 text-xs font-bold uppercase transition ${
                          lang === value ? "bg-brand text-brand-ink" : "text-ink-secondary"
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {show("text") ? (
            <>
              <div className={embedded ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
                {showLang("fr") ? (
                  <Field label={tr(fr, "Titre français", "French title")}>
                    <Input
                      value={read("titleFr")}
                      onChange={(event) => set("titleFr", event.target.value)}
                    />
                  </Field>
                ) : null}
                {showLang("en") ? (
                  <Field label={tr(fr, "Titre anglais", "English title")}>
                    <Input
                      value={read("titleEn")}
                      onChange={(event) => set("titleEn", event.target.value)}
                    />
                  </Field>
                ) : null}
              </div>
              {showLang("fr") ? (
                <Field label={tr(fr, "Texte français", "French text")}>
                  <Textarea
                    rows={embedded ? 6 : undefined}
                    value={read("bodyFr")}
                    onChange={(event) => set("bodyFr", event.target.value)}
                  />
                </Field>
              ) : null}
              {showLang("en") ? (
                <Field label={tr(fr, "Texte anglais", "English text")}>
                  <Textarea
                    rows={embedded ? 6 : undefined}
                    value={read("bodyEn")}
                    onChange={(event) => set("bodyEn", event.target.value)}
                  />
                </Field>
              ) : null}
            </>
          ) : null}
          {block.section_type === "gallery" && show("images") ? (
            <GalleryImagesField
              orgSlug={orgSlug}
              items={readItems(block)}
              onChange={(items) => set("items", items)}
              strayImage={read("imageUrl")}
              onAdoptStray={() =>
                onChange({
                  ...block,
                  content: {
                    ...block.content,
                    imageUrl: "",
                    items: [...readItems(block), { imageUrl: read("imageUrl"), captionFr: "", captionEn: "" }],
                  },
                })
              }
              fr={fr}
            />
          ) : hasImages && show("images") ? (
            <div
              className={
                block.section_type === "hero"
                  ? embedded
                    ? "space-y-4"
                    : "grid gap-3 xl:grid-cols-3"
                  : undefined
              }
            >
              <WebsiteImagePicker
                orgSlug={orgSlug}
                value={read("imageUrl")}
                onChange={(url) => set("imageUrl", url)}
                fr={fr}
                label={
                  block.section_type === "hero"
                    ? tr(fr, "Image principale", "Main image")
                    : undefined
                }
              />
              {block.section_type === "hero" ? (
                <>
                  <WebsiteImagePicker
                    orgSlug={orgSlug}
                    value={read("secondaryImageUrl")}
                    onChange={(url) => set("secondaryImageUrl", url)}
                    fr={fr}
                    label={tr(fr, "Image complémentaire", "Supporting image")}
                  />
                  <WebsiteImagePicker
                    orgSlug={orgSlug}
                    value={read("tertiaryImageUrl")}
                    onChange={(url) => set("tertiaryImageUrl", url)}
                    fr={fr}
                    label={tr(fr, "Image détail", "Detail image")}
                  />
                </>
              ) : null}
            </div>
          ) : null}
          {hasButton && show("button") ? (
            <div className={embedded ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
              {showLang("fr") ? (
              <Field label={tr(fr, "Bouton français", "French button")}>
                <Input
                  value={read("buttonLabelFr") || read("primaryLabelFr")}
                  onChange={(event) =>
                    set(
                      block.section_type === "hero"
                        ? "primaryLabelFr"
                        : "buttonLabelFr",
                      event.target.value,
                    )
                  }
                />
              </Field>
              ) : null}
              {showLang("en") ? (
              <Field label={tr(fr, "Bouton anglais", "English button")}>
                <Input
                  value={read("buttonLabelEn") || read("primaryLabelEn")}
                  onChange={(event) =>
                    set(
                      block.section_type === "hero"
                        ? "primaryLabelEn"
                        : "buttonLabelEn",
                      event.target.value,
                    )
                  }
                />
              </Field>
              ) : null}
              <Field
                className="sm:col-span-2"
                label={tr(fr, "Lien du bouton", "Button link")}
              >
                <Input
                  placeholder="#contact ou /contact"
                  value={read("buttonHref") || read("primaryHref")}
                  onChange={(event) =>
                    set(
                      block.section_type === "hero"
                        ? "primaryHref"
                        : "buttonHref",
                      event.target.value,
                    )
                  }
                />
              </Field>
            </div>
          ) : null}
          {hasItems && show("items") ? (
            <EditableItems
              orgSlug={orgSlug}
              type={block.section_type}
              items={items}
              setItems={setItems}
              fr={fr}
            />
          ) : null}
          {embedded && show("link") ? (
            <LinkFields
              value={content.blockLink}
              onChange={(next) => set("blockLink", next)}
              pages={linkPages}
              orgSlug={orgSlug}
              subject={tr(fr, "ce bloc", "this block")}
              fr={fr}
            />
          ) : null}
          {show("style") ? (
            <>
              {areaStyle ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                  {tr(fr, "1. La bande du bloc (toute la largeur)", "1. The block band (full width)")}
                </p>
              ) : null}
              <BlockStyleFields
                orgSlug={orgSlug}
                content={content}
                set={set}
                fr={fr}
                onReplay={onReplay}
              />
              {areaStyle ? (
                <div className="space-y-2 border-t-2 border-violet-300 pt-3 dark:border-violet-400/40">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                    {tr(fr, "2. Le div du bloc (zone de contenu) — tout le style", "2. The block div (content area) — full style")}
                  </p>
                  <p className="text-[11px] leading-4 text-ink-muted">
                    {tr(
                      fr,
                      "Disposition (Flexbox, grille), taille, marges, fond, bordure, arrondi, ombre, animations et états de la zone qui contient les éléments.",
                      "Layout (Flexbox, grid), size, spacing, background, border, radius, shadow, animations and states of the area holding the elements.",
                    )}
                  </p>
                  {areaStyle}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function EditableItems({
  orgSlug,
  type,
  items,
  setItems,
  fr,
}: {
  orgSlug: string;
  type: SectionType;
  items: Record<string, unknown>[];
  setItems: (items: Record<string, unknown>[]) => void;
  fr: boolean;
}) {
  const update = (index: number, key: string, value: string) =>
    setItems(
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  const add = () =>
    setItems([
      ...items,
      type === "metrics"
        ? { value: "0", labelFr: "Indicateur", labelEn: "Metric" }
        : type === "faq"
          ? {
              questionFr: "Question",
              questionEn: "Question",
              answerFr: "Réponse",
              answerEn: "Answer",
            }
          : type === "gallery"
            ? { imageUrl: "", captionFr: "", captionEn: "" }
            : {
                titleFr: "Titre",
                titleEn: "Title",
                bodyFr: "Description",
                bodyEn: "Description",
              },
    ]);
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink">
          {tr(fr, "Éléments", "Items")}
        </p>
        <Button size="sm" variant="secondary" onClick={add}>
          <Plus />
          {tr(fr, "Ajouter", "Add")}
        </Button>
      </div>
      {items.map((item, index) => (
        <div
          className="grid gap-2 rounded-lg border border-border bg-surface-1 p-3 sm:grid-cols-2"
          key={index}
        >
          {type === "metrics" ? (
            <>
              <Field label={tr(fr, "Valeur", "Value")}>
                <Input
                  value={String(item.value ?? "")}
                  onChange={(event) =>
                    update(index, "value", event.target.value)
                  }
                />
              </Field>
              <Field label={tr(fr, "Libellé français", "French label")}>
                <Input
                  value={String(item.labelFr ?? "")}
                  onChange={(event) =>
                    update(index, "labelFr", event.target.value)
                  }
                />
              </Field>
              <Field label={tr(fr, "Libellé anglais", "English label")}>
                <Input
                  value={String(item.labelEn ?? "")}
                  onChange={(event) =>
                    update(index, "labelEn", event.target.value)
                  }
                />
              </Field>
            </>
          ) : type === "faq" ? (
            <>
              <Field label={tr(fr, "Question française", "French question")}>
                <Input
                  value={String(item.questionFr ?? "")}
                  onChange={(event) =>
                    update(index, "questionFr", event.target.value)
                  }
                />
              </Field>
              <Field label={tr(fr, "Question anglaise", "English question")}>
                <Input
                  value={String(item.questionEn ?? "")}
                  onChange={(event) =>
                    update(index, "questionEn", event.target.value)
                  }
                />
              </Field>
              <Field label={tr(fr, "Réponse française", "French answer")}>
                <Textarea
                  value={String(item.answerFr ?? "")}
                  onChange={(event) =>
                    update(index, "answerFr", event.target.value)
                  }
                />
              </Field>
              <Field label={tr(fr, "Réponse anglaise", "English answer")}>
                <Textarea
                  value={String(item.answerEn ?? "")}
                  onChange={(event) =>
                    update(index, "answerEn", event.target.value)
                  }
                />
              </Field>
            </>
          ) : type === "gallery" ? (
            <>
              <div className="sm:col-span-2">
                <WebsiteImagePicker
                  orgSlug={orgSlug}
                  value={String(item.imageUrl ?? item.image ?? "")}
                  onChange={(url) => update(index, typeof item.image === "string" ? "image" : "imageUrl", url)}
                  fr={fr}
                />
              </div>
              <Field label={tr(fr, "Légende française", "French caption")}>
                <Input
                  value={String(item.captionFr ?? "")}
                  onChange={(event) =>
                    update(index, "captionFr", event.target.value)
                  }
                />
              </Field>
              <Field label={tr(fr, "Légende anglaise", "English caption")}>
                <Input
                  value={String(item.captionEn ?? "")}
                  onChange={(event) =>
                    update(index, "captionEn", event.target.value)
                  }
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={tr(fr, "Titre français", "French title")}>
                <Input
                  value={String(item.titleFr ?? "")}
                  onChange={(event) =>
                    update(index, "titleFr", event.target.value)
                  }
                />
              </Field>
              <Field label={tr(fr, "Titre anglais", "English title")}>
                <Input
                  value={String(item.titleEn ?? "")}
                  onChange={(event) =>
                    update(index, "titleEn", event.target.value)
                  }
                />
              </Field>
              <Field label={tr(fr, "Texte français", "French text")}>
                <Textarea
                  value={String(item.bodyFr ?? "")}
                  onChange={(event) =>
                    update(index, "bodyFr", event.target.value)
                  }
                />
              </Field>
              <Field label={tr(fr, "Texte anglais", "English text")}>
                <Textarea
                  value={String(item.bodyEn ?? "")}
                  onChange={(event) =>
                    update(index, "bodyEn", event.target.value)
                  }
                />
              </Field>
            </>
          )}
          <div className="sm:col-span-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setItems(
                  items.filter((_item, itemIndex) => itemIndex !== index),
                )
              }
            >
              <Trash2 />
              {tr(fr, "Retirer", "Remove")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

const publicImageInput =
  "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";
const imageBytes = (bytes: number) =>
  bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1_000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;

async function uploadWebsiteImages(orgSlug: string, files: File[]) {
  const body = new FormData();
  files.slice(0, 30).forEach((file) => body.append("files", file));
  return post<{ media: WebsiteMedia[] }>(
    orgUrl(orgSlug, "website/media"),
    body,
    {
      headers: { "Content-Type": "multipart/form-data" },
    },
  );
}

/** A WordPress-like chooser backed by the organisation's dedicated public
 * website media library. It never reads private LiteHubs Documents. */
function WebsiteImagePicker({
  orgSlug,
  value,
  onChange,
  onPickMany,
  fr,
  label,
}: {
  orgSlug: string;
  value: string;
  onChange: (url: string) => void;
  /** Gallery: every uploaded image is added at once. */
  onPickMany?: (urls: string[]) => void;
  fr: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const mediaQuery = useQuery({
    queryKey: ["website-media", orgSlug],
    queryFn: () =>
      get<{ media: WebsiteMedia[] }>(orgUrl(orgSlug, "website/media")),
    enabled: open,
  });
  const upload = useMutation({
    mutationFn: (files: File[]) => uploadWebsiteImages(orgSlug, files),
    onSuccess: (response) => {
      void client.invalidateQueries({ queryKey: ["website-media", orgSlug] });
      // An uploaded image is used right away (no second click needed).
      const urls = response.media.map((item) => item.url).filter(Boolean);
      if (urls.length) {
        if (onPickMany) onPickMany(urls);
        else onChange(urls[0]!);
        setOpen(false);
      }
      toast.success(
        tr(
          fr,
          `${response.media.length} image(s) ajoutée(s)`,
          `${response.media.length} image(s) added`,
        ),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const media = (mediaQuery.data?.media ?? []).filter((item) =>
    `${item.title} ${item.originalName}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="size-14 overflow-hidden rounded-lg bg-surface-3">
          {value ? (
            <img src={value} alt="" className="size-full object-cover" />
          ) : (
            <Images className="m-4 size-6 text-ink-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {label ?? tr(fr, "Image du bloc", "Block image")}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-secondary">
            {value
              ? tr(fr, "Image sélectionnée", "Image selected")
              : tr(fr, "Aucune image sélectionnée", "No image selected")}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Images />
          {tr(fr, "Bibliothèque média", "Media library")}
        </Button>
        {value ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={tr(fr, "Retirer l’image", "Remove image")}
            onClick={() => onChange("")}
          >
            <X />
          </Button>
        ) : null}
      </div>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={tr(fr, "Bibliothèque média", "Media library")}
          className="fixed inset-0 z-[100] flex items-end bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6"
        >
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl bg-surface-1 shadow-2xl sm:rounded-3xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
              <div>
                <p className="text-lg font-semibold text-ink">
                  {tr(
                    fr,
                    "Bibliothèque média du site",
                    "Website media library",
                  )}
                </p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {tr(
                    fr,
                    "Choisissez une image ou téléversez-en plusieurs. Ces images sont distinctes des documents privés LiteHubs.",
                    "Choose an image or upload several. These images are separate from private LiteHubs documents.",
                  )}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setOpen(false)}
                aria-label={tr(fr, "Fermer", "Close")}
              >
                <X />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2 p-4">
              <input
                ref={inputRef}
                className="hidden"
                type="file"
                accept={publicImageInput}
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length) upload.mutate(files);
                  event.currentTarget.value = "";
                }}
              />
              <Button
                loading={upload.isPending}
                onClick={() => inputRef.current?.click()}
              >
                <Upload />
                {tr(fr, "Téléverser des images", "Upload images")}
              </Button>
              <label className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-muted" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={tr(
                    fr,
                    "Rechercher dans la bibliothèque",
                    "Search the library",
                  )}
                />
              </label>
              <p className="text-xs text-ink-muted">
                {tr(
                  fr,
                  "JPG, PNG, WebP, GIF, HEIC · 8 Mo/image · 30 à la fois",
                  "JPG, PNG, WebP, GIF, HEIC · 8 MB/image · 30 at once",
                )}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {mediaQuery.isLoading ? (
                <SkeletonCard rows={4} />
              ) : media.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {media.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        onChange(item.url);
                        setOpen(false);
                      }}
                      className={`group overflow-hidden rounded-xl border text-left transition ${value === item.url ? "border-brand ring-2 ring-brand/30" : "border-border hover:border-brand"}`}
                    >
                      <img
                        src={item.url}
                        alt=""
                        className="aspect-[4/3] w-full bg-surface-2 object-cover"
                      />
                      <span className="block truncate px-3 pb-1 pt-2 text-sm font-medium text-ink">
                        {item.title}
                      </span>
                      <span className="block px-3 pb-3 text-xs text-ink-muted">
                        {imageBytes(item.sizeBytes)} ·{" "}
                        {tr(fr, "Choisir", "Choose")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={tr(fr, "Aucune image", "No images")}
                  description={tr(
                    fr,
                    "Téléversez vos premières images pour les utiliser partout sur ce site.",
                    "Upload your first images to use them anywhere on this website.",
                  )}
                  action={{
                    label: tr(fr, "Téléverser", "Upload"),
                    onClick: () => inputRef.current?.click(),
                  }}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const blankCustomerActivity = () => ({
  title: "",
  summary: "",
  body: "",
  imageUrl: "",
  buttonLabel: "",
  buttonUrl: "",
  audience: "all" as CustomerActivity["audience"],
  status: "draft" as "draft" | "published",
});

function CustomerActivitiesTab({
  orgSlug,
  fr,
}: {
  orgSlug: string;
  fr: boolean;
}) {
  const [form, setForm] = useState(blankCustomerActivity);
  const [editing, setEditing] = useState<CustomerActivity | null>(null);
  const [recipientText, setRecipientText] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [shareActivityId, setShareActivityId] = useState("");
  const activitiesQuery = useQuery({
    queryKey: ["website-customer-activities", orgSlug],
    queryFn: () =>
      get<{ activities: CustomerActivity[] }>(
        orgUrl(orgSlug, "website/customer-activities"),
      ),
  });
  const refresh = () => void activitiesQuery.refetch();
  const reset = () => {
    setEditing(null);
    setForm(blankCustomerActivity());
  };
  const save = useMutation({
    mutationFn: (payload: typeof form) => {
      const body = {
        ...payload,
        body: toOptional(payload.body),
        imageUrl: toOptional(payload.imageUrl),
        buttonLabel: toOptional(payload.buttonLabel),
        buttonUrl: toOptional(payload.buttonUrl),
      };
      return editing
        ? patch<{ activity: CustomerActivity }>(
            orgUrl(orgSlug, `website/customer-activities/${editing.id}`),
            body,
          )
        : post<{ activity: CustomerActivity }>(
            orgUrl(orgSlug, "website/customer-activities"),
            body,
          );
    },
    onSuccess: () => {
      refresh();
      reset();
      toast.success(
        editing
          ? tr(fr, "Activité mise à jour", "Activity updated")
          : tr(fr, "Activité créée", "Activity created"),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const archive = useMutation({
    mutationFn: (activityId: string) =>
      del(orgUrl(orgSlug, `website/customer-activities/${activityId}`)),
    onSuccess: () => {
      refresh();
      if (editing) reset();
      toast.success(tr(fr, "Activité archivée", "Activity archived"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const share = useMutation({
    mutationFn: ({ activityId, recipients }: { activityId: string; recipients: string[] }) =>
      post<{ requested: number; sent: number }>(
        orgUrl(orgSlug, `website/customer-activities/${activityId}/share`),
        { recipients, consentConfirmed: true },
      ),
    onSuccess: (response) => {
      refresh();
      setRecipientText("");
      setConsentConfirmed(false);
      toast.success(
        response.sent
          ? tr(fr, `${response.sent} invitation(s) envoyée(s)`, `${response.sent} invitation(s) sent`)
          : tr(fr, "Aucun e-mail n’a pu être envoyé. Vérifiez l’envoi e-mail.", "No email could be sent. Check email delivery."),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const activities = activitiesQuery.data?.activities ?? [];
  const publishedActivities = activities.filter(
    (activity) => activity.status === "published",
  );
  const sharedActivity =
    publishedActivities.find((activity) => activity.id === shareActivityId) ??
    publishedActivities[0] ??
    null;
  const recipients = Array.from(
    new Set(
      recipientText
        .split(/[\n,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const set = <Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const beginEdit = (activity: CustomerActivity) => {
    setEditing(activity);
    setForm({
      title: activity.title,
      summary: activity.summary,
      body: activity.body ?? "",
      imageUrl: activity.imageUrl ?? "",
      buttonLabel: activity.buttonLabel ?? "",
      buttonUrl: activity.buttonUrl ?? "",
      audience: activity.audience,
      status: activity.status === "published" ? "published" : "draft",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(fr ? "fr-CD" : "en", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(new Date(value))
      : tr(fr, "Non publiée", "Not published");

  return (
    <section className="space-y-5">
      <Card className="overflow-hidden border-brand/20">
        <CardHeader className="bg-[radial-gradient(circle_at_93%_0%,rgba(34,197,94,.18),transparent_31%),linear-gradient(120deg,rgba(6,78,59,.98),rgba(15,118,110,.94))] text-white">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 text-xs font-bold tracking-[.15em] text-emerald-100"><Megaphone className="size-4" /> {tr(fr, "ESPACE CLIENT PUBLIC", "PUBLIC CUSTOMER AREA")}</p>
            <CardTitle className="mt-3 text-2xl text-white">{tr(fr, "Activités à partager", "Activities to share")}</CardTitle>
            <CardDescription className="mt-2 max-w-2xl text-emerald-50/90">{tr(fr, "Créez des cartes visuelles pour les personnes qui possèdent un compte public Congo Omega. Un lien e-mail leur demandera de créer ce compte ou de s’y connecter — jamais d’accéder à LiteHubs, aux candidatures ou aux dossiers RH.", "Create visual cards for people with a public customer account. An email link asks them to create or sign in to that account — never to access LiteHubs, applications, or HR files.")}</CardDescription>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_390px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{editing ? tr(fr, "Modifier l’activité", "Edit activity") : tr(fr, "Nouvelle activité", "New activity")}</CardTitle>
              <CardDescription>{tr(fr, "Une carte courte et claire, visible seulement après connexion au compte public.", "A concise card visible only after public-account sign-in.")}</CardDescription>
            </div>
            {editing ? <Button size="sm" variant="ghost" onClick={reset}><X />{tr(fr, "Annuler", "Cancel")}</Button> : null}
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate(form);
              }}
            >
              <Field label={tr(fr, "Titre", "Title")} required><Input value={form.title} maxLength={160} onChange={(event) => set("title", event.target.value)} /></Field>
              <Field label={tr(fr, "Résumé", "Summary")} required><Textarea value={form.summary} maxLength={500} onChange={(event) => set("summary", event.target.value)} /></Field>
              <Field label={tr(fr, "Détails (facultatif)", "Details (optional)")}><Textarea value={form.body} maxLength={5000} onChange={(event) => set("body", event.target.value)} /></Field>
              <WebsiteImagePicker orgSlug={orgSlug} value={form.imageUrl} onChange={(url) => set("imageUrl", url)} fr={fr} label={tr(fr, "Image de la carte", "Card image")} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={tr(fr, "Bouton (facultatif)", "Button (optional)")}><Input value={form.buttonLabel} maxLength={80} placeholder={tr(fr, "Ex. Découvrir", "E.g. Discover")} onChange={(event) => set("buttonLabel", event.target.value)} /></Field>
                <Field label={tr(fr, "Lien du bouton (facultatif)", "Button link (optional)")}><Input value={form.buttonUrl} placeholder="/activites" onChange={(event) => set("buttonUrl", event.target.value)} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={tr(fr, "Audience", "Audience")}><select className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink" value={form.audience} onChange={(event) => set("audience", event.target.value as CustomerActivity["audience"])}><option value="all">{tr(fr, "Tous les comptes publics", "All public accounts")}</option><option value="invited">{tr(fr, "Uniquement les invités par e-mail", "Only email invitees")}</option></select></Field>
                <Field label={tr(fr, "État", "Status")}><select className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink" value={form.status} onChange={(event) => set("status", event.target.value as "draft" | "published")}><option value="draft">{tr(fr, "Brouillon", "Draft")}</option><option value="published">{tr(fr, "Publié", "Published")}</option></select></Field>
              </div>
              <div className="flex flex-wrap gap-3 border-t border-border pt-5"><Button type="submit" loading={save.isPending}><Save />{editing ? tr(fr, "Enregistrer l’activité", "Save activity") : tr(fr, "Créer l’activité", "Create activity")}</Button>{editing ? <Button type="button" variant="secondary" onClick={reset}>{tr(fr, "Nouvelle carte", "New card")}</Button> : null}</div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><div><CardTitle>{tr(fr, "Partager par e-mail", "Share by email")}</CardTitle><CardDescription>{tr(fr, "Le destinataire reçoit une invitation vers son compte public sécurisé.", "Each recipient receives an invitation to their secure public account.")}</CardDescription></div></CardHeader>
            <CardContent className="grid gap-4">
              <Field label={tr(fr, "Activité publiée", "Published activity")}><select className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink" value={sharedActivity?.id ?? ""} onChange={(event) => setShareActivityId(event.target.value)} disabled={!publishedActivities.length}><option value="">{sharedActivity ? sharedActivity.title : tr(fr, "Aucune activité publiée", "No published activity")}</option>{publishedActivities.filter((activity) => activity.id !== sharedActivity?.id).map((activity) => <option key={activity.id} value={activity.id}>{activity.title}</option>)}</select></Field>
              <Field label={tr(fr, "Adresses e-mail", "Email addresses")} hint={tr(fr, "Une adresse par ligne, ou séparées par des virgules.", "One address per line, or separated by commas.")}><Textarea value={recipientText} placeholder="contact@example.com\npartenaire@example.com" onChange={(event) => setRecipientText(event.target.value)} /></Field>
              <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950"><input type="checkbox" className="mt-0.5 size-4 accent-emerald-800" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} />{tr(fr, "Je confirme que chaque personne a accepté de recevoir cette activité. Une candidature sert seulement au recrutement et ne doit jamais être utilisée automatiquement pour du marketing.", "I confirm that each person agreed to receive this activity. An application is for recruitment only and must never be used automatically for marketing.")}</label>
              <Button disabled={!sharedActivity || !recipients.length || !consentConfirmed} loading={share.isPending} onClick={() => sharedActivity && share.mutate({ activityId: sharedActivity.id, recipients })}><Mail />{tr(fr, "Envoyer l’invitation", "Send invitation")}</Button>
              <p className="text-xs leading-5 text-ink-muted">{tr(fr, "Les invités sans compte devront d’abord créer et confirmer leur compte public. Leur candidature et leurs données de recrutement ne deviennent jamais visibles ici.", "Invitees without an account first create and confirm their public account. Their application and recruitment data never become visible here.")}</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-200 bg-emerald-50/60"><CardContent className="flex gap-3 p-5"><UsersRound className="mt-0.5 size-5 shrink-0 text-emerald-800" /><p className="text-sm leading-6 text-emerald-950">{tr(fr, "Chaque carte est indépendante des ventes et des achats. Elle sert uniquement à créer une relation et à partager les actualités de Congo Omega avec des personnes qui ont choisi de les recevoir.", "Each card is independent of sales and purchases. It is only for building a relationship and sharing Congo Omega news with people who chose to receive it.")}</p></CardContent></Card>
        </div>
      </div>

      <Card>
        <CardHeader><div><CardTitle>{tr(fr, "Cartes créées", "Created cards")}</CardTitle><CardDescription>{tr(fr, "Modifiez, publiez, partagez ou archivez une activité. Les destinataires ne voient que les cartes publiées qui leur sont destinées.", "Edit, publish, share, or archive an activity. Recipients see only published cards meant for them.")}</CardDescription></div></CardHeader>
        <CardContent>
          {activitiesQuery.isLoading ? <SkeletonCard rows={5} /> : activities.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{activities.map((activity) => <article key={activity.id} className="overflow-hidden rounded-2xl border border-border bg-surface-1"><div className="relative aspect-[16/9] bg-[linear-gradient(135deg,#0f766e,#134e4a)]">{activity.imageUrl ? <img src={activity.imageUrl} alt="" className="size-full object-cover" /> : <Megaphone className="absolute bottom-5 left-5 size-8 text-emerald-100" />}<div className="absolute left-3 top-3"><Badge variant={activity.status === "published" ? "good" : activity.status === "archived" ? "neutral" : "warning"}>{activity.status === "published" ? tr(fr, "Publié", "Published") : activity.status === "archived" ? tr(fr, "Archivé", "Archived") : tr(fr, "Brouillon", "Draft")}</Badge></div></div><div className="p-4"><p className="text-xs text-ink-muted">{date(activity.publishedAt)}</p><h3 className="mt-2 line-clamp-2 font-semibold text-ink">{activity.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-5 text-ink-secondary">{activity.summary}</p><div className="mt-4 flex flex-wrap gap-2 text-xs text-ink-muted"><span>{activity.audience === "all" ? tr(fr, "Tous les comptes", "All accounts") : tr(fr, "Sur invitation", "Invite only")}</span><span>·</span><span>{activity.sentCount}/{activity.recipientCount} {tr(fr, "envoyées", "sent")}</span></div><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => beginEdit(activity)} disabled={activity.status === "archived"}><PencilLine />{tr(fr, "Modifier", "Edit")}</Button>{activity.status !== "archived" ? <Button size="sm" variant="ghost" loading={archive.isPending && archive.variables === activity.id} onClick={() => archive.mutate(activity.id)}><Archive />{tr(fr, "Archiver", "Archive")}</Button> : null}</div></div></article>)}</div> : <EmptyState title={tr(fr, "Aucune activité", "No activities")} description={tr(fr, "Créez votre première carte pour la partager dans les comptes publics Congo Omega.", "Create your first card to share in Congo Omega public accounts.")} />}
        </CardContent>
      </Card>
    </section>
  );
}

function WebsiteMediaLibrary({
  orgSlug,
  fr,
}: {
  orgSlug: string;
  fr: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const client = useQueryClient();
  const mediaQuery = useQuery({
    queryKey: ["website-media", orgSlug],
    queryFn: () =>
      get<{ media: WebsiteMedia[] }>(orgUrl(orgSlug, "website/media")),
  });
  const upload = useMutation({
    mutationFn: (files: File[]) => uploadWebsiteImages(orgSlug, files),
    onSuccess: (response) => {
      void client.invalidateQueries({ queryKey: ["website-media", orgSlug] });
      toast.success(
        tr(
          fr,
          `${response.media.length} image(s) ajoutée(s)`,
          `${response.media.length} image(s) added`,
        ),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(orgUrl(orgSlug, `website/media/${id}`)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["website-media", orgSlug] });
      toast.success(tr(fr, "Image retirée", "Image removed"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const media = (mediaQuery.data?.media ?? []).filter((item) =>
    `${item.title} ${item.originalName}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <section className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>
              {tr(fr, "Bibliothèque média du site", "Website media library")}
            </CardTitle>
            <CardDescription>
              {tr(
                fr,
                "Un seul espace pour les images publiques de ce site. Les documents, preuves et dossiers internes LiteHubs restent séparés et privés.",
                "One place for this website’s public images. LiteHubs documents, evidence and internal folders remain separate and private.",
              )}
            </CardDescription>
          </div>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept={publicImageInput}
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) upload.mutate(files);
              event.currentTarget.value = "";
            }}
          />
          <Button
            loading={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload />
            {tr(fr, "Téléverser des images", "Upload images")}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-muted" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tr(fr, "Rechercher une image", "Search an image")}
              />
            </label>
            <p className="text-xs text-ink-muted">
              {tr(
                fr,
                "JPG, PNG, WebP, GIF, HEIC · 8 Mo/image · 30 à la fois",
                "JPG, PNG, WebP, GIF, HEIC · 8 MB/image · 30 at once",
              )}
            </p>
          </div>
          {mediaQuery.isLoading ? (
            <SkeletonCard rows={5} />
          ) : media.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {media.map((item) => (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-xl border border-border bg-surface-1"
                >
                  <img
                    src={item.url}
                    alt=""
                    className="aspect-[4/3] w-full bg-surface-2 object-cover"
                  />
                  <div className="p-3">
                    <p className="truncate text-sm font-semibold text-ink">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {imageBytes(item.sizeBytes)}
                      {item.width && item.height
                        ? ` · ${item.width} × ${item.height}`
                        : ""}
                    </p>
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      variant="ghost"
                      loading={remove.isPending && remove.variables === item.id}
                      onClick={() => remove.mutate(item.id)}
                    >
                      <Trash2 />
                      {tr(fr, "Retirer", "Remove")}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title={tr(fr, "La bibliothèque est vide", "The library is empty")}
              description={tr(
                fr,
                "Téléversez toutes vos photos ici une seule fois, puis choisissez-les dans les pages du site.",
                "Upload all your photos here once, then select them from your website pages.",
              )}
              action={{
                label: tr(fr, "Téléverser des images", "Upload images"),
                onClick: () => inputRef.current?.click(),
              }}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function WebsiteIdentityForm({
  orgSlug,
  organization,
  initial,
  saving,
  onSave,
  fr,
}: {
  orgSlug: string;
  organization: BuilderData["organization"];
  initial: BuilderWebsite | null;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  fr: boolean;
}) {
  const initialForm = useMemo(
    () => ({
      displayName: initial?.displayName ?? organization.displayName,
      tagline: initial?.tagline ?? "",
      defaultLocale: initial?.defaultLocale ?? "fr",
      themePreset: initial?.themePreset ?? "verdant",
      primaryColor: initial?.primaryColor ?? "#0f766e",
      accentColor: initial?.accentColor ?? "#f59e0b",
      logoUrl: initial?.logoUrl ?? "",
      contactEmail: initial?.contactEmail ?? "",
      contactPhone: initial?.contactPhone ?? "",
      addressText: initial?.addressText ?? "",
      footerText: initial?.footerText ?? "",
      customDomain: initial?.customDomain ?? "",
    }),
    [initial, organization.displayName],
  );
  const [form, setForm] = useState(initialForm);
  useEffect(() => setForm(initialForm), [initialForm]);
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>
              {initial
                ? tr(
                    fr,
                    "Apparence, coordonnées & domaine",
                    "Appearance, contact & domain",
                  )
                : tr(fr, "Créer l’identité du site", "Create website identity")}
            </CardTitle>
            <CardDescription>
              {tr(
                fr,
                "Ces informations sont publiques seulement après publication du site.",
                "These details become public only after the website is published.",
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr(fr, "Nom public", "Public name")} required>
              <Input
                value={form.displayName}
                onChange={(event) => set("displayName", event.target.value)}
              />
            </Field>
            <Field label={tr(fr, "Langue principale", "Primary language")}>
              <select
                value={form.defaultLocale}
                onChange={(event) => set("defaultLocale", event.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field
              className="sm:col-span-2"
              label={tr(fr, "Phrase de présentation", "Tagline")}
            >
              <Input
                value={form.tagline}
                onChange={(event) => set("tagline", event.target.value)}
              />
            </Field>
            <Field label={tr(fr, "Couleur principale", "Primary colour")}>
              <Input
                type="color"
                value={form.primaryColor}
                onChange={(event) => set("primaryColor", event.target.value)}
              />
            </Field>
            <Field label={tr(fr, "Couleur d’accent", "Accent colour")}>
              <Input
                type="color"
                value={form.accentColor}
                onChange={(event) => set("accentColor", event.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <WebsiteImagePicker
                orgSlug={orgSlug}
                value={form.logoUrl}
                onChange={(url) => set("logoUrl", url)}
                fr={fr}
                label={tr(fr, "Logo du site", "Website logo")}
              />
            </div>
            <Field label={tr(fr, "E-mail de contact", "Contact email")}>
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(event) => set("contactEmail", event.target.value)}
              />
            </Field>
            <Field label={tr(fr, "Téléphone", "Phone")}>
              <Input
                value={form.contactPhone}
                onChange={(event) => set("contactPhone", event.target.value)}
              />
            </Field>
            <Field
              className="sm:col-span-2"
              label={tr(fr, "Adresse", "Address")}
            >
              <Textarea
                value={form.addressText}
                onChange={(event) => set("addressText", event.target.value)}
              />
            </Field>
            <Field
              className="sm:col-span-2"
              label={tr(fr, "Texte de pied de page", "Footer text")}
            >
              <Input
                value={form.footerText}
                onChange={(event) => set("footerText", event.target.value)}
              />
            </Field>
          </div>
          <div className="mt-6 border-t border-border pt-5">
            <p className="text-sm font-semibold text-ink">
              {tr(fr, "Domaine personnalisé", "Custom domain")}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {tr(
                fr,
                "Enregistrez votre domaine ici. Le Super admin LiteHubs vérifie ensuite la connexion DNS avant qu’il puisse afficher ce site publiquement.",
                "Save your domain here. A LiteHubs Super admin then verifies DNS before it can show this website publicly.",
              )}
            </p>
            <div className="mt-3">
              <Field
                label={tr(fr, "Domaine", "Domain")}
                hint={tr(
                  fr,
                  "Exemple : congoomega.com — sans https:// ni www.",
                  "Example: congoomega.com — without https:// or www.",
                )}
              >
                <Input
                  placeholder="congoomega.com"
                  value={form.customDomain}
                  onChange={(event) =>
                    set(
                      "customDomain",
                      event.target.value
                        .toLowerCase()
                        .replace(/^https?:\/\//, "")
                        .replace(/^www\./, "")
                        .replace(/\/$/, ""),
                    )
                  }
                />
              </Field>
            </div>
          </div>
          <div className="mt-6">
            <Button
              loading={saving}
              onClick={() =>
                onSave({
                  displayName: form.displayName,
                  tagline: toOptional(form.tagline),
                  defaultLocale: form.defaultLocale,
                  themePreset: form.themePreset,
                  primaryColor: form.primaryColor,
                  accentColor: form.accentColor,
                  logoUrl: toOptional(form.logoUrl),
                  contactEmail: toOptional(form.contactEmail),
                  contactPhone: toOptional(form.contactPhone),
                  addressText: toOptional(form.addressText),
                  footerText: toOptional(form.footerText),
                  customDomain: toOptional(form.customDomain),
                })
              }
            >
              <Save />
              {initial
                ? tr(fr, "Enregistrer les changements", "Save changes")
                : tr(fr, "Créer le site", "Create website")}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <div>
            <CardTitle>
              {tr(fr, "Connexion du domaine", "Domain connection")}
            </CardTitle>
            <CardDescription>
              {tr(
                fr,
                "Protection avant publication",
                "Protection before publication",
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl bg-surface-2 p-4">
            <CheckCircle2 className="size-5 text-brand" />
            <p className="mt-2 text-sm font-medium text-ink">
              {tr(
                fr,
                "Aperçu LiteHubs disponible",
                "LiteHubs preview available",
              )}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              /sites/{organization.slug}
            </p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <p className="text-sm font-medium text-ink">
              {tr(fr, "Étapes suivantes", "Next steps")}
            </p>
            <ol className="mt-2 space-y-2 text-sm leading-6 text-ink-secondary">
              <li>
                1.{" "}
                {tr(
                  fr,
                  "Enregistrez le domaine souhaité.",
                  "Save the requested domain.",
                )}
              </li>
              <li>
                2.{" "}
                {tr(
                  fr,
                  "Le Super admin valide le domaine et prépare son hébergement.",
                  "The Super admin validates the domain and prepares hosting.",
                )}
              </li>
              <li>
                3.{" "}
                {tr(
                  fr,
                  "LiteHubs vous indique les enregistrements DNS exacts à placer.",
                  "LiteHubs gives the exact DNS records to add.",
                )}
              </li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/** Builds the same website object the public renderer receives. The private
 * builder includes drafts, in the same order as the page list. */
function builderPreviewWebsite(
  orgSlug: string,
  website: BuilderWebsite,
  pages: BuilderPage[],
  design?: SiteDesign,
): PublicWebsite {
  return {
    design: design as Record<string, unknown> | undefined,
    organization_slug: orgSlug,
    display_name: website.displayName,
    tagline: website.tagline,
    default_locale: website.defaultLocale,
    theme_preset: website.themePreset,
    primary_color: website.primaryColor,
    accent_color: website.accentColor,
    logo_url: website.logoUrl,
    contact_email: website.contactEmail,
    contact_phone: website.contactPhone,
    address: website.addressText,
    footer_text: website.footerText,
    // Same menus as visitors see: published pages not kept out of menus.
    navigation: pages
      .filter((candidate) => candidate.status !== "archived")
      .map((candidate) => ({
        slug: candidate.slug,
        label_fr: candidate.navigationLabelFr,
        label_en: candidate.navigationLabelEn,
        in_menu:
          candidate.isHome ||
          (candidate.status === "published" && candidate.settings?.hideFromMenu !== true),
      })),
  };
}

function blocksFromPage(page: BuilderPage | null): WebsiteSection[] {
  return (page?.sections ?? []).map((section, index) => ({
    id: section.id,
    section_type: section.type,
    content: section.content,
    sort_order: index,
  }));
}

type PreviewDevice = "desktop" | "tablet" | "mobile";
/** Real viewport widths. A wider device than the available space is drawn
 * at its true width and scaled down, so the desktop view keeps its desktop
 * layout even next to the editing panels. */
const previewDeviceWidth: Record<PreviewDevice, number> = {
  desktop: 1280,
  tablet: 820,
  mobile: 390,
};

/** Renders the live preview inside a same-origin iframe through a React
 * portal. The iframe has its own viewport, so the responsive mobile and tablet
 * layouts are the real ones, while edits still update instantly. */
function BuilderPreviewFrame({
  width,
  title,
  onFrameDocument,
  children,
}: {
  width: number;
  title: string;
  onFrameDocument?: (doc: Document | null) => void;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = box.width && width > box.width ? box.width / width : 1;
  const frameCallback = useRef(onFrameDocument);
  frameCallback.current = onFrameDocument;
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(
      '<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body></body></html>',
    );
    doc.close();
    const copyStyles = () => {
      doc.head
        .querySelectorAll("[data-builder-style]")
        .forEach((node) => node.remove());
      document
        .querySelectorAll('style, link[rel="stylesheet"]')
        .forEach((node) => {
          const clone = node.cloneNode(true) as HTMLElement;
          clone.setAttribute("data-builder-style", "");
          doc.head.appendChild(clone);
        });
      // Keep font variables, but never the workspace dark theme: the public
      // website always renders with its own light palette.
      doc.documentElement.className = document.documentElement.className
        .split(/\s+/)
        .filter((name) => name && name !== "dark")
        .join(" ");
      doc.body.className = document.body.className;
      doc.body.style.margin = "0";
    };
    copyStyles();
    // Development tools and route changes can inject new stylesheets.
    const observer = new MutationObserver(copyStyles);
    observer.observe(document.head, { childList: true });
    setMountNode(doc.body);
    frameCallback.current?.(doc);
    return () => {
      observer.disconnect();
      frameCallback.current?.(null);
    };
  }, []);
  return (
    <div ref={boxRef} className="relative h-full min-w-0 flex-1 overflow-hidden">
      <div
        className="absolute top-0"
        style={{
          width: width * scale,
          height: box.height,
          left: Math.max(0, (box.width - width * scale) / 2),
        }}
      >
        <iframe
          ref={frameRef}
          title={title}
          className="block origin-top-left border-0 bg-white shadow-[0_18px_50px_-24px_rgb(15_23_42_/_0.55)]"
          style={{
            width,
            height: scale ? box.height / scale : box.height,
            transform: scale !== 1 ? `scale(${scale})` : undefined,
          }}
        />
      </div>
      {scale < 1 ? (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-slate-900/75 px-2 py-0.5 text-[10px] font-medium text-white">
          {width}px · {Math.round(scale * 100)}%
        </span>
      ) : null}
      {mountNode ? createPortal(children, mountNode) : null}
    </div>
  );
}

function VisualBuilderTab({
  orgSlug,
  website,
  pages,
  page,
  onSelectPage,
  onSaveSections,
  onSavePage,
  onPublish,
  savingSections,
  savingPage,
  publishing,
  onCreatePage,
  creatingPage = false,
  fr,
}: {
  orgSlug: string;
  website: BuilderWebsite;
  pages: BuilderPage[];
  page: BuilderPage | null;
  onCreatePage?: (payload: Record<string, unknown>) => Promise<unknown>;
  creatingPage?: boolean;
  onSelectPage: (pageId: string) => void;
  onSaveSections: (sections: WebsiteSection[]) => Promise<unknown>;
  onSavePage: (payload: Record<string, unknown>) => Promise<unknown>;
  onPublish: () => Promise<unknown>;
  savingSections: boolean;
  savingPage: boolean;
  publishing: boolean;
  fr: boolean;
}) {
  const [blocks, setBlocks] = useState<WebsiteSection[]>(() =>
    blocksFromPage(page),
  );
  // Page design ("Réglages de la page"), previewed live before saving.
  const [pageSettings, setPageSettings] = useState<Record<string, unknown>>(
    () => page?.settings ?? {},
  );
  const savedPageSettings = JSON.stringify(page?.settings ?? {});
  const pageSettingsDirty = JSON.stringify(pageSettings) !== savedPageSettings;
  useEffect(() => {
    setPageSettings(JSON.parse(savedPageSettings) as Record<string, unknown>);
  }, [page?.id, savedPageSettings]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creatingNew, setCreatingNew] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(blocksFromPage(page)),
  );
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  // A "Div" block is one single box: selecting the block selects its div.
  const [rawSelectedElement, setSelectedElement] = useState<string | null>(null);
  // "États et interactions": the state shown in the preview while editing it.
  const [previewState, setPreviewState] = useState<string | null>(null);
  // The structure column can be folded to give the preview more room
  // (remembered on this computer).
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  useEffect(() => {
    try {
      setTreeCollapsed(window.localStorage.getItem("wb-tree-collapsed") === "1");
    } catch {
      // Storage unavailable: keep it open.
    }
  }, []);
  const toggleTree = (collapsed: boolean) => {
    setTreeCollapsed(collapsed);
    try {
      window.localStorage.setItem("wb-tree-collapsed", collapsed ? "1" : "0");
    } catch {
      // Not remembered, still works.
    }
  };
  useEffect(() => setPreviewState(null), [selectedId, rawSelectedElement]);
  const [replayKey, setReplayKey] = useState(0);
  const replayAnimations = () => setReplayKey((value) => value + 1);
  // Choosing another block (or none) always clears the element selection.
  const setSelectedId = (
    value: string | null | ((current: string | null) => string | null),
  ) => {
    setSelectedIdState(value);
    setSelectedElement(null);
  };
  const [panel, setPanel] = useState<"block" | "page" | "theme">("block");
  const [adding, setAdding] = useState(false);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [fullscreen, setFullscreen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const frameDocument = useRef<Document | null>(null);
  const dirty = JSON.stringify(blocks) !== savedSnapshot;
  // Undo / redo of every change to the page's blocks (Ctrl+Z, Ctrl+Shift+Z).
  // Quick successive edits (typing) count as one step.
  const history = useRef<{ past: string[]; future: string[]; last: string; at: number; skip: boolean }>({
    past: [],
    future: [],
    last: JSON.stringify(blocks),
    at: 0,
    skip: false,
  });
  const [, setHistoryVersion] = useState(0);
  useEffect(() => {
    const entry = history.current;
    const now = JSON.stringify(blocks);
    if (now === entry.last) return;
    if (entry.skip) {
      entry.skip = false;
      entry.last = now;
      setHistoryVersion((value) => value + 1);
      return;
    }
    const time = Date.now();
    if (time - entry.at > 600 || !entry.past.length) entry.past.push(entry.last);
    if (entry.past.length > 100) entry.past.shift();
    entry.future = [];
    entry.last = now;
    entry.at = time;
    setHistoryVersion((value) => value + 1);
  }, [blocks]);
  const restoreHistory = (direction: "undo" | "redo") => {
    const entry = history.current;
    const from = direction === "undo" ? entry.past : entry.future;
    const to = direction === "undo" ? entry.future : entry.past;
    const snapshot = from.pop();
    if (snapshot === undefined) return;
    to.push(entry.last);
    entry.skip = true;
    entry.at = 0;
    const restored = JSON.parse(snapshot) as WebsiteSection[];
    setBlocks(restored);
    // Keep the selection only if it still exists.
    const block = restored.find((candidate) => candidate.id === selectedId);
    if (!block) setSelectedId(null);
    else if (rawSelectedElement?.startsWith("x:") && !locateExtra(readExtraElements(block.content), rawSelectedElement))
      setSelectedElement(null);
    setHistoryVersion((value) => value + 1);
  };
  const undo = () => restoreHistory("undo");
  const redo = () => restoreHistory("redo");
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoRef.current.undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        undoRef.current.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const loadedPageId = useRef<string | null>(page?.id ?? null);
  const selectedIndexRef = useRef(-1);
  const openPageSettingsNext = useRef(false);

  // ── Site design: theme + global zones (top bar, header, footer) ──
  // Shared by every page; saved as a draft, then published separately.
  const queryClient = useQueryClient();
  // Stable (sorted-key) JSON: the database reorders object keys.
  const savedDesignJson = stableJson(readDesign(website.designDraft));
  const publishedDesignJson = stableJson(readDesign(website.designPublished));
  const [design, setDesign] = useState<SiteDesign>(() => readDesign(website.designDraft));
  const designDirty = stableJson(design) !== savedDesignJson;
  const designDirtyRef = useRef(designDirty);
  designDirtyRef.current = designDirty;
  const designUnpublished = savedDesignJson !== publishedDesignJson;
  useEffect(() => {
    if (!designDirtyRef.current) setDesign(JSON.parse(savedDesignJson) as SiteDesign);
  }, [savedDesignJson]);
  const refreshBuilder = () =>
    queryClient.invalidateQueries({ queryKey: ["website-builder", orgSlug] });
  const saveDesign = useMutation({
    mutationFn: (next: SiteDesign) => put(orgUrl(orgSlug, "website/design"), { design: next }),
    onSuccess: () => void refreshBuilder(),
    onError: (error: Error) => toast.error(error.message),
  });
  const publishDesign = useMutation({
    mutationFn: async () => {
      if (designDirtyRef.current) await put(orgUrl(orgSlug, "website/design"), { design });
      return post(orgUrl(orgSlug, "website/design/publish"));
    },
    onSuccess: async () => {
      designDirtyRef.current = false;
      await refreshBuilder();
      toast.success(tr(fr, "Design du site publié sur toutes les pages", "Site design published on every page"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const restoreDesign = useMutation({
    mutationFn: (index: number) => post(orgUrl(orgSlug, "website/design/restore"), { index }),
    onSuccess: async () => {
      designDirtyRef.current = false;
      await refreshBuilder();
      toast.success(
        tr(fr, "Design précédent rechargé en brouillon : vérifiez l’aperçu puis publiez.", "Previous design loaded as a draft: check the preview, then publish."),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const siteFacts: SiteFacts = {
    displayName: website.displayName,
    tagline: website.tagline,
    phone: website.contactPhone,
    email: website.contactEmail,
    address: website.addressText,
  };
  const setZone = (name: ZoneName, update: (zone: ZoneData) => ZoneData) =>
    setDesign((current) => {
      const zone = current.zones?.[name];
      if (!zone) return current;
      return { ...current, zones: { ...current.zones, [name]: update(zone) } };
    });
  const zonesActive = Boolean(design.zones && ZONE_NAMES.some((name) => design.zones?.[name]));
  const activateZones = () =>
    setDesign((current) => ({
      ...current,
      version: 1,
      zones: Object.fromEntries(
        ZONE_NAMES.map((name) => [name, current.zones?.[name] ?? buildZone(name, DEFAULT_TEMPLATES[name], siteFacts)]),
      ) as SiteDesign["zones"],
    }));
  /**
   * Chooses a site theme. Its zone templates can be applied too: the zones
   * then follow the theme's layouts and looks, keeping compatible content.
   */
  const applyTheme = async (key: string | undefined) => {
    const theme = key ? SITE_THEMES[key] : undefined;
    const withTemplates =
      theme &&
      (await confirmDialog({
        title: tr(fr, `Appliquer aussi la mise en page « ${theme.label[0]} » ?`, `Also apply the “${theme.label[1]}” layout?`),
        message: tr(
          fr,
          "« Tout le design » : la top bar, le header et le footer prennent aussi la disposition de ce thème (vos textes, liens et coordonnées compatibles sont gardés).\n« Seulement les couleurs » : couleurs, polices et styles uniquement.",
          "“Whole design”: the top bar, header and footer also take this theme’s layout (compatible texts, links and contact details are kept).\n“Colours only”: colours, fonts and styles only.",
        ),
        confirmLabel: tr(fr, "Tout le design", "Whole design"),
        cancelLabel: tr(fr, "Seulement les couleurs", "Colours only"),
      }));
    setDesign((current) => designWithTheme(current, key, Boolean(withTemplates)));
  };
  const designWithTheme = (current: SiteDesign, key: string | undefined, withTemplates: boolean): SiteDesign => {
    const theme = key ? SITE_THEMES[key] : undefined;
    const next: SiteDesign = { ...current, version: 1, theme: key };
    const zones = { ...(current.zones ?? {}) };
    for (const name of ZONE_NAMES) {
      const zone = zones[name];
      // The zones follow the new theme's looks unless the owner chose one.
      if (zone && withTemplates) zones[name] = { ...zone, look: undefined, links: undefined };
      if (!withTemplates || !theme) continue;
      const { zone: applied } = applyZoneTemplate(name, theme.templates[name], zones[name], siteFacts);
      zones[name] = {
        ...applied,
        look: undefined,
        links: undefined,
        hidden: name === "topbar" ? (theme.hideTopbar ? true : undefined) : applied.hidden,
      };
    }
    next.zones = zones;
    return next;
  };
  /** A complete site template: theme, zones and the design of every block. */
  const applySiteTemplate = async (key: string) => {
    // The design of the site in production before any template: original
    // header and footer, original colours, original block designs.
    if (key === ORIGIN_TEMPLATE) {
      if (
        !await ask(
          tr(
            fr,
            "Revenir au design d’origine du site (celui en production) ?\n\nLe header, le footer, les couleurs et le design des blocs d’origine reviennent. Vos pages, textes, images et liens sont gardés. Les réglages de top bar, header et footer faits ici seront retirés de ce brouillon.",
            "Go back to the site’s original design (the one in production)?\n\nThe original header, footer, colours and block designs come back. Your pages, texts, images and links are kept. Top bar, header and footer settings made here are removed from this draft.",
          ),
        )
      )
        return;
      setDesign({ version: 1 });
      return;
    }
    const template = SITE_TEMPLATES[key];
    if (!template) return;
    if (
      !await ask(
        tr(
          fr,
          `Appliquer le modèle de site « ${template.label[0]} » ?\n\nLe thème, la top bar, le header, le footer et le design des blocs de toutes les pages changent. Vos pages, textes, images et liens sont gardés. Rien n’est visible des visiteurs avant « Publier sur toutes les pages ».`,
          `Apply the “${template.label[1]}” site template?\n\nThe theme, top bar, header, footer and the design of every page’s blocks change. Your pages, texts, images and links are kept. Visitors see nothing until “Publish on every page”.`,
        ),
      )
    )
      return;
    setDesign((current) => ({
      ...designWithTheme(current, template.theme, true),
      template: key,
      blockVariants: { ...template.blockVariants },
    }));
  };
  // Edition (click selects) or Aperçu (links work, like on the site).
  const [previewMode, setPreviewMode] = useState(false);

  // Server data refreshes (after a save, or when the window regains focus)
  // must never wipe edits the owner has not saved yet.
  useEffect(() => {
    const pageChanged = (page?.id ?? null) !== loadedPageId.current;
    if (!pageChanged && dirtyRef.current) return;
    const next = blocksFromPage(page);
    loadedPageId.current = page?.id ?? null;
    if (pageChanged) history.current = { past: [], future: [], last: JSON.stringify(next), at: 0, skip: false };
    else history.current.skip = true;
    setBlocks(next);
    setSavedSnapshot(JSON.stringify(next));
    setAdding(false);
    if (pageChanged) {
      setSelectedId(null);
      // A page just created opens on its settings (texts, translation, SEO).
      setPanel(openPageSettingsNext.current ? "page" : "block");
      openPageSettingsNext.current = false;
    } else {
      // A save replaces block ids; keep the same block (and the element
      // inside it) selected by position.
      setSelectedIdState((current) =>
        current && next.some((block) => block.id === current)
          ? current
          : (next[selectedIndexRef.current]?.id ?? null),
      );
    }
  }, [page]);

  const selectedIndex = blocks.findIndex((block) => block.id === selectedId);
  selectedIndexRef.current = selectedIndex;
  // A global zone is edited like a free block ("zone-header"…).
  const selectedZone: ZoneName | null =
    selectedId && selectedId.startsWith("zone-") && ZONE_NAMES.includes(selectedId.slice(5) as ZoneName)
      ? (selectedId.slice(5) as ZoneName)
      : null;
  const zoneData = selectedZone ? (design.zones?.[selectedZone] ?? null) : null;
  const selectedBlock: WebsiteSection | null = selectedZone
    ? zoneData
      ? { id: `zone-${selectedZone}`, section_type: "container", content: zoneData.content, sort_order: 0 }
      : null
    : selectedIndex >= 0
      ? blocks[selectedIndex]!
      : null;
  const selectedElement = rawSelectedElement ?? (isDivBlock(selectedBlock) ? "canvas" : null);
  /** Writes the selected block, or the selected global zone. */
  const updateSelected = (block: WebsiteSection) => {
    if (selectedZone) setZone(selectedZone, (zone) => ({ ...zone, content: block.content }));
    else if (selectedIndex >= 0) changeBlockAt(selectedIndex, block);
  };
  const label = (block: WebsiteSection) => blockLabel(block, fr);
  const ordered = (next: WebsiteSection[]) =>
    next.map((block, sort_order) => ({ ...block, sort_order }));

  const scrollToBlock = (id: string) =>
    window.setTimeout(() => {
      frameDocument.current
        ?.querySelector(`[data-builder-section="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  // Set when a preview click landed on text that belongs to a container.
  const [clickedText, setClickedText] = useState<string | null>(null);
  const selectBlock = (id: string, scroll = false, element: string | null = null) => {
    setSelectedId(id);
    setSelectedElement(element);
    setPanel("block");
    if (scroll) scrollToBlock(id);
  };
  function changeBlockAt(index: number, block: WebsiteSection) {
    setBlocks((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? block : item)),
    );
  }
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setBlocks(ordered(next));
    scrollToBlock(next[target]!.id);
  };
  const remove = async (index: number) => {
    const block = blocks[index];
    if (!block) return;
    if (
      !await ask(
        tr(
          fr,
          `Retirer le bloc « ${label(block)} » ? Le changement sera définitif après l’enregistrement.`,
          `Remove the “${label(block)}” block? The change becomes permanent once saved.`,
        ),
      )
    )
      return;
    setBlocks(ordered(blocks.filter((_item, itemIndex) => itemIndex !== index)));
    setSelectedId(null);
  };
  const deleteSelectedElement = async () => {
    const block = selectedBlock;
    if (!block || !selectedElement) return;
    const isCard = /^item:\d+$/.test(selectedElement);
    const name = describeElement(block, selectedElement, fr);
    if (
      !await ask(
        isCard
          ? tr(fr, `Supprimer « ${name} » ?`, `Delete “${name}”?`)
          : tr(fr, `Supprimer « ${name} » de ce bloc ? Le reste du bloc est conservé.`, `Delete “${name}” from this block? The rest of the block is kept.`),
      )
    )
      return;
    const next = deleteElementFromBlock(block, selectedElement);
    if (!next) return;
    updateSelected(next);
    setSelectedElement(null);
  };
  const restoreElement = (element: string) => {
    const block = selectedBlock;
    if (!block) return;
    updateSelected({
      ...block,
      content: { ...block.content, hiddenElements: hiddenElementsOf(block).filter((name) => name !== element) },
    });
  };
  const duplicate = (index: number) => {
    const block = blocks[index];
    if (!block) return;
    const content = JSON.parse(JSON.stringify(block.content)) as Record<string, unknown>;
    // Anchors stay unique on the page: the copy gets its own (or none).
    if (typeof content.anchor === "string" && content.anchor) {
      const taken = new Set(blocks.map((candidate) => candidate.content.anchor));
      let number = 2;
      while (taken.has(`${content.anchor}-${number}`)) number += 1;
      content.anchor = `${String(content.anchor).slice(0, 55)}-${number}`;
    }
    const copy: WebsiteSection = { ...block, id: `local-${Date.now()}-copy`, content };
    const next = [...blocks];
    next.splice(index + 1, 0, copy);
    setBlocks(ordered(next));
    selectBlock(copy.id, true);
  };
  /** Drag and drop in the structure tree: move an element or add a new one. */
  const dropInTree = (blockId: string, drag: TreeDrag, target: DropTarget) => {
    const index = blocks.findIndex((candidate) => candidate.id === blockId);
    const block = blocks[index];
    if (!block) return;
    let next: WebsiteSection | null = null;
    let element: string | null = null;
    if (drag.move) {
      next = moveExtraInBlock(block, drag.move, target);
      element = drag.move;
    } else if (drag.add) {
      const addType = drag.add as WebsiteExtraElement["type"];
      const item = ZONE_ELEMENT_TYPES.includes(addType)
        ? (zoneElement(addType, siteFacts) as WebsiteExtraElement)
        : newExtraElement(addType);
      next = placeExtraInBlock(block, item, target);
      if (next) {
        const styles = newElementStyles(item);
        if (Object.keys(styles).length)
          next = {
            ...next,
            content: {
              ...next.content,
              elementStyles: { ...((next.content.elementStyles as Record<string, unknown> | undefined) ?? {}), ...styles },
            },
          };
      }
      element = `x:${item.id}`;
    }
    if (!next) {
      toast.info(
        tr(
          fr,
          `Impossible de placer cet élément ici (pas dans lui-même, et ${MAX_CONTAINER_DEPTH - 1} conteneurs imbriqués au maximum).`,
          `This element can’t go here (not inside itself, and at most ${MAX_CONTAINER_DEPTH - 1} nested containers).`,
        ),
      );
      return;
    }
    changeBlockAt(index, next);
    selectBlock(blockId, false, element);
  };
  // ── Tools drawn over the preview: toolbar, "+" buttons, drag and drop ──
  const blockById = (id: string) => blocks.find((candidate) => candidate.id === id) ?? null;
  const canvasCanDrop = (blockId: string, drag: BuilderDrag, target: DropTarget) => {
    const block = blockById(blockId);
    if (!block) return false;
    if (drag.move) return Boolean(moveExtraInBlock(block, drag.move, target));
    if (drag.add)
      return Boolean(placeExtraInBlock(block, { id: "probe", type: drag.add as WebsiteExtraElement["type"] }, target));
    return false;
  };
  const canvasDescribe = (blockId: string, element: string): ElementInfo | null => {
    const block = blockById(blockId);
    if (!block) return null;
    const divCanvas = element === "canvas" && isDivBlock(block);
    const found = locateExtra(readExtraElements(block.content), element)?.item;
    return {
      label: divCanvas ? "Div" : describeElement(block, element, fr),
      movable: Boolean(found),
      duplicable: divCanvas || Boolean(duplicateInBlock(block, element)),
      deletable: divCanvas || canDeleteElement(element),
      container: element === "canvas" || isContainerType(found?.type),
    };
  };
  /** Writing in the page: which stored text an element shows, per language. */
  const inlineTextOf = (block: WebsiteSection, element: string, language: "fr" | "en") => {
    const content = block.content;
    const found = locateExtra(readExtraElements(content), element)?.item;
    if (found) {
      if (!["heading", "text", "button"].includes(found.type)) return null;
      const value = language === "en" ? (found.textEn ?? found.textFr ?? "") : (found.textFr ?? "");
      return { value, multiline: found.type === "text", write: (text: string) => {
        const extras = mapExtra(readExtraElements(content), found.id, (item) => ({
          ...item,
          [language === "en" ? "textEn" : "textFr"]: text,
          tpl: undefined,
        }));
        return { ...block, content: { ...content, extras } };
      } };
    }
    const card = element.match(/^item:(\d+):(title|body|label)$/);
    if (card && Array.isArray(content.items)) {
      const index = Number(card[1]);
      const part = card[2]!;
      const item = (content.items as Record<string, unknown>[])[index];
      if (!item) return null;
      const key = `${part}_${language}`;
      const value = typeof item[key] === "string" ? (item[key] as string) : typeof item[part] === "string" ? (item[part] as string) : "";
      return { value, multiline: part === "body", write: (text: string) => {
        const items = [...(content.items as Record<string, unknown>[])];
        items[index] = { ...items[index], [key]: text };
        return { ...block, content: { ...content, items } };
      } };
    }
    if (!["eyebrow", "title", "body", "sideText", "primaryButton", "secondaryButton", "sideLink"].includes(element)) return null;
    const fields = elementFieldKeys(block.section_type, element);
    const keys = language === "en" ? fields.en : fields.fr;
    if (!keys) return null;
    const key = storedKey(content, keys);
    return {
      value: String(content[key] ?? ""),
      multiline: element === "body" || element === "sideText",
      write: (text: string) => ({ ...block, content: { ...content, [key]: text } }),
    };
  };
  const canvasDuplicate = (blockId: string, element: string) => {
    const index = blocks.findIndex((candidate) => candidate.id === blockId);
    const block = blocks[index];
    if (!block) return;
    if (element === "canvas" || element === "root") {
      duplicate(index);
      return;
    }
    const result = duplicateInBlock(block, element);
    if (!result) {
      toast.info(tr(fr, "Cet élément ne peut pas être dupliqué.", "This element can’t be duplicated."));
      return;
    }
    changeBlockAt(index, result.block);
    selectBlock(blockId, false, result.element);
  };
  const canvasDelete = async (blockId: string, element: string) => {
    const index = blocks.findIndex((candidate) => candidate.id === blockId);
    const block = blocks[index];
    if (!block) return;
    if (element === "canvas" && isDivBlock(block)) {
      await remove(index);
      return;
    }
    const name = describeElement(block, element, fr);
    if (!await ask(tr(fr, `Supprimer « ${name} » ? Le reste du bloc est conservé.`, `Delete “${name}”? The rest of the block is kept.`)))
      return;
    const next = deleteElementFromBlock(block, element);
    if (!next) return;
    changeBlockAt(index, next);
    selectBlock(blockId, false, null);
  };
  const addExtra = (type: WebsiteExtraElement["type"]) => {
    if (!selectedBlock) return;
    const extras = readExtraElements(selectedBlock.content);
    const location = selectedElement ? locateExtra(extras, selectedElement) : null;
    // Into a carousel, a new "slide" is a ready card unless a container is asked.
    const intoSlider =
      location?.item.type === "slider" && type !== "group" && type !== "slider";
    const item = intoSlider
      ? newSlideCard((location?.item.children?.length ?? 0) + 1)
      : ZONE_ELEMENT_TYPES.includes(type)
        ? (zoneElement(type, siteFacts) as WebsiteExtraElement)
        : newExtraElement(type);
    const extraStyles = newElementStyles(item);
    const withStyles = (content: Record<string, unknown>) =>
      Object.keys(extraStyles).length
        ? {
            ...content,
            elementStyles: {
              ...((content.elementStyles as Record<string, unknown> | undefined) ?? {}),
              ...extraStyles,
            },
          }
        : content;
    // Into a selected container, or next to a selected element inside one.
    let containerId = isContainerType(location?.item.type)
      ? location!.item.id
      : (location?.parentId ?? null);
    const targetDepth = isContainerType(location?.item.type)
      ? location!.depth + 1
      : (location?.depth ?? 1);
    if (isContainerType(type) && targetDepth >= MAX_CONTAINER_DEPTH) {
      toast.info(
        tr(
          fr,
          `Maximum ${MAX_CONTAINER_DEPTH - 1} conteneurs imbriqués : celui-ci est ajouté au niveau du bloc.`,
          `At most ${MAX_CONTAINER_DEPTH - 1} nested containers: this one is added at block level.`,
        ),
      );
      containerId = null;
    }
    if (containerId) {
      const next = mapExtra(extras, containerId, (group) => {
        const children = [...(group.children ?? [])];
        const after =
          location?.parentId === containerId ? location.index + 1 : children.length;
        children.splice(after, 0, item);
        return { ...group, children };
      });
      updateSelected({
        ...selectedBlock,
        content: withStyles({ ...selectedBlock.content, extras: next }),
      });
      setSelectedElement(`x:${item.id}`);
      return;
    }
    // At block level, place it after the selected element's top-level ancestor.
    const topLevelAncestor = (() => {
      if (!location) return selectedElement;
      const topId = extras.find(
        (candidate) =>
          candidate.id === location.item.id ||
          locateExtra(candidate.children ?? [], `x:${location.item.id}`),
      )?.id;
      return topId ? `x:${topId}` : selectedElement;
    })();
    const topLevelSelected = topLevelAncestor;
    const afterIndex = topLevelSelected?.startsWith("x:")
      ? extras.findIndex((candidate) => `x:${candidate.id}` === topLevelSelected)
      : -1;
    const next = [...extras];
    next.splice(afterIndex >= 0 ? afterIndex + 1 : next.length, 0, item);
    // Place the new element right after the selected one (or at the end).
    const order = elementOrderFor(selectedBlock);
    const anchor = topLevelSelected ? order.indexOf(movableElement(topLevelSelected)) : -1;
    const nextOrder = [...order];
    nextOrder.splice(anchor >= 0 ? anchor + 1 : nextOrder.length, 0, `x:${item.id}`);
    updateSelected({
      ...selectedBlock,
      content: withStyles({ ...selectedBlock.content, extras: next, elementOrder: nextOrder }),
    });
    setSelectedElement(`x:${item.id}`);
  };
  const addCarouselBlock = () => {
    const slider = newExtraElement("slider");
    const block: WebsiteSection = {
      id: `local-${Date.now()}-carousel`,
      section_type: "container",
      sort_order: 0,
      content: {
        extras: [slider],
        elementOrder: [`x:${slider.id}`],
        elementStyles: {
          ...slideCardStyles(slider),
          canvas: { width: "full" },
          [`x:${slider.id}`]: { width: "full" },
        },
      },
    };
    const next = [...blocks];
    next.splice(selectedIndex >= 0 ? selectedIndex + 1 : next.length, 0, block);
    setBlocks(ordered(next));
    setAdding(false);
    selectBlock(block.id, true, `x:${slider.id}`);
  };
  const add = (type: SectionType) => {
    const block = sectionSeed(type);
    const next = [...blocks];
    next.splice(selectedIndex >= 0 ? selectedIndex + 1 : next.length, 0, block);
    setBlocks(ordered(next));
    setAdding(false);
    selectBlock(block.id, true);
  };
  const dropOn = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const sourceIndex = blocks.findIndex((block) => block.id === draggedId);
    const moving = blocks[sourceIndex];
    if (!moving) return;
    const next = blocks.filter((block) => block.id !== draggedId);
    const targetIndex = next.findIndex((block) => block.id === targetId);
    if (targetIndex < 0) return;
    const after = blocks.findIndex((block) => block.id === targetId) > sourceIndex;
    next.splice(targetIndex + (after ? 1 : 0), 0, moving);
    setBlocks(ordered(next));
  };
  const save = async () => {
    if (!page) return;
    // The site design (zones, theme) is saved as a draft with the page.
    if (designDirtyRef.current) await saveDesign.mutateAsync(design);
    if (dirtyRef.current) {
      await onSaveSections(blocks);
      setSavedSnapshot(JSON.stringify(blocks));
    }
  };
  const saveAndPublish = async () => {
    try {
      if (dirty) await save();
      await onPublish();
    } catch {
      // The mutation already shows the error message.
    }
  };
  const discard = async () => {
    if (
      !await ask(
        tr(
          fr,
          "Annuler toutes les modifications non enregistrées de cette page ?",
          "Discard all unsaved changes on this page?",
        ),
      )
    )
      return;
    setBlocks(JSON.parse(savedSnapshot) as WebsiteSection[]);
    setDesign(JSON.parse(savedDesignJson) as SiteDesign);
    setSelectedId(null);
  };
  const switchPage = async (pageId: string) => {
    if (
      dirty &&
      !await ask(
        tr(
          fr,
          "Cette page contient des modifications non enregistrées. Changer de page quand même ?",
          "This page has unsaved changes. Switch page anyway?",
        ),
      )
    )
      return;
    dirtyRef.current = false;
    onSelectPage(pageId);
  };

  // Ctrl/Cmd + S saves, and leaving the browser tab warns about lost edits.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirtyRef.current || designDirtyRef.current) void saveRef.current().catch(() => undefined);
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !designDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    const frameDoc = frameDocument.current;
    frameDoc?.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
      frameDoc?.removeEventListener("keydown", onKeyDown);
    };
  }, [device]);

  if (!page)
    return (
      <EmptyState
        title={tr(fr, "Choisissez une page", "Choose a page")}
        description={tr(
          fr,
          "Ouvrez l’onglet Pages pour sélectionner ou créer une page.",
          "Open the Pages tab to select or create a page.",
        )}
      />
    );

  const previewWebsite = builderPreviewWebsite(orgSlug, website, pages, design);
  const anyDirty = dirty || designDirty;
  const previewPage: PublicWebsitePage = {
    slug: page.slug,
    title_fr: page.titleFr,
    title_en: page.titleEn,
    description_fr: page.descriptionFr,
    description_en: page.descriptionEn,
    settings: pageSettings,
    sections: blocks,
  };
  const visiblePages = pages.filter((candidate) => candidate.status !== "archived");
  const linkPages = visiblePages.map((candidate) => ({
    slug: candidate.slug,
    label: (fr ? candidate.navigationLabelFr : candidate.navigationLabelEn) || candidate.titleFr,
  }));
  // Pages visitors see in the menus: the starting links of a custom menu.
  const menuLinkPages = visiblePages
    .filter((candidate) => candidate.isHome || (candidate.status === "published" && candidate.settings?.hideFromMenu !== true))
    .map((candidate) => ({
      slug: candidate.slug,
      label: (fr ? candidate.navigationLabelFr : candidate.navigationLabelEn) || candidate.titleFr,
      labelFr: candidate.navigationLabelFr || candidate.titleFr,
      labelEn: candidate.navigationLabelEn || candidate.titleEn,
    }));
  // "Aller vers une section": each block can receive an anchor (#…).
  const pageSectionsValue = {
    sections: blocks.map((block, index) => ({
      label: `${index + 1}. ${label(block)}`,
      anchor: typeof block.content.anchor === "string" ? block.content.anchor : undefined,
    })),
    ensureAnchor: (index: number) => {
      const block = blocks[index];
      if (!block) return "";
      if (typeof block.content.anchor === "string" && /^[a-z0-9-]{1,60}$/.test(block.content.anchor))
        return block.content.anchor;
      const base = label(block)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "section";
      const anchor = `${base}-${index + 1}`;
      changeBlockAt(index, { ...block, content: { ...block.content, anchor } });
      return anchor;
    },
  };
  const savePageSettings = () =>
    void onSavePage({ ...pageFieldsPayload(page), settings: pageSettings }).catch(() => undefined);
  // Breadcrumb of the current selection: Page › Bloc › Conteneur… › Élément.
  const selectionPath = (() => {
    const path: Array<{ kind: "page" | "block" | "container" | "element"; label: string; onClick?: () => void }> = [
      {
        kind: "page",
        label: page.navigationLabelFr || page.titleFr,
        onClick: () => {
          setSelectedId(null);
          setPanel("page");
        },
      },
    ];
    if (panel === "page" || !selectedBlock) return path;
    if (selectedZone) path[0] = { kind: "page", label: tr(fr, "Site · toutes les pages", "Site · every page") };
    path.push({
      kind: "block",
      label: selectedZone ? zoneLabels[selectedZone][fr ? 0 : 1] : `${selectedIndex + 1}. ${label(selectedBlock)}`,
      onClick: () => setSelectedElement(null),
    });
    if (!selectedElement || (selectedElement === "canvas" && isDivBlock(selectedBlock))) return path;
    const chain = extraChain(readExtraElements(selectedBlock.content), selectedElement);
    if (chain.length) {
      chain.forEach((item, position) => {
        const last = position === chain.length - 1;
        const kind = isContainerType(item.type) ? "container" : "element";
        path.push({
          kind: last ? kind : "container",
          label: extraTypeLabels[item.type]?.[fr ? 0 : 1] ?? item.type,
          onClick: last ? undefined : () => setSelectedElement(`x:${item.id}`),
        });
      });
    } else {
      const itemMatch = selectedElement.match(/^item:(\d+)(?::([a-z]+))?$/);
      if (itemMatch?.[2]) {
        path.push({
          kind: "container",
          label: `${tr(fr, "Carte", "Card")} ${Number(itemMatch[1]) + 1}`,
          onClick: () => setSelectedElement(`item:${itemMatch[1]}`),
        });
      }
      const containerLike = ["canvas", "root", "panel", "items", "sideCard", "buttons"].includes(selectedElement) || (itemMatch && !itemMatch[2]);
      path.push({
        kind: containerLike ? "container" : "element",
        label: elementDisplayName(selectedElement, fr),
      });
    }
    return path;
  })();

  return (
    <section
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-surface-1"
          : "flex h-[calc(100dvh-7rem)] min-h-[640px] flex-col overflow-hidden rounded-2xl border border-border bg-surface-1"
      }
    >
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-1 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
          {tr(fr, "Page", "Page")}
        </span>
        <select
          className="h-9 max-w-[220px] rounded-lg border border-border bg-surface-2 px-2 text-sm font-medium text-ink"
          value={page.id}
          onChange={(event) => switchPage(event.target.value)}
          aria-label={tr(fr, "Page à modifier", "Page to edit")}
          title={tr(fr, "Choisir la page du site à modifier", "Choose the website page to edit")}
        >
          {visiblePages.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.navigationLabelFr || candidate.titleFr} ·{" "}
              {statusLabel(candidate.status, fr)}
            </option>
          ))}
        </select>
        <span className="hidden text-xs text-ink-muted md:inline">/{page.slug}</span>
        {anyDirty ? (
          <Badge variant="warning">
            {tr(fr, "Modifications non enregistrées", "Unsaved changes")}
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
            <CheckCircle2 className="size-3.5 text-emerald-500" />
            {tr(fr, "Tout est enregistré", "All changes saved")}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-lg border border-border bg-surface-2 p-0.5">
            {(
              [
                ["desktop", Monitor, tr(fr, "Ordinateur", "Desktop")],
                ["tablet", Tablet, tr(fr, "Tablette", "Tablet")],
                ["mobile", Smartphone, tr(fr, "Mobile", "Mobile")],
              ] as const
            ).map(([value, Icon, name]) => (
              <button
                key={value}
                type="button"
                title={name}
                aria-label={name}
                aria-pressed={device === value}
                onClick={() => setDevice(value)}
                className={`grid size-8 place-items-center rounded-md transition ${
                  device === value
                    ? "bg-surface-1 text-brand shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            title={tr(fr, "Plein écran", "Full screen")}
            aria-label={tr(fr, "Plein écran", "Full screen")}
            onClick={() => setFullscreen((value) => !value)}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <a
            href={page.isHome ? `/sites/${orgSlug}` : `/sites/${orgSlug}/${page.slug}`}
            target="_blank"
            rel="noreferrer"
            title={tr(fr, "Aperçu enregistré dans un nouvel onglet", "Saved preview in a new tab")}
          >
            <Button size="icon-sm" variant="ghost" aria-label={tr(fr, "Nouvel onglet", "New tab")}>
              <ExternalLink />
            </Button>
          </a>
          <div className="flex rounded-lg border border-border bg-surface-2 p-0.5" role="group" aria-label={tr(fr, "Mode", "Mode")}>
            {(
              [
                [false, PencilLine, tr(fr, "Édition", "Edit"), tr(fr, "Un clic sélectionne un élément", "A click selects an element")],
                [true, Eye, tr(fr, "Aperçu", "Preview"), tr(fr, "Les liens fonctionnent comme sur le site", "Links work as on the site")],
              ] as const
            ).map(([value, Icon, name, hint]) => (
              <button
                key={name}
                type="button"
                title={hint}
                aria-pressed={previewMode === value}
                onClick={() => setPreviewMode(value)}
                className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold transition ${
                  previewMode === value ? "bg-surface-1 text-brand shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                <Icon className="size-3.5" />
                {name}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={undo}
              disabled={!history.current.past.length}
              title={tr(fr, "Annuler la dernière action (Ctrl+Z)", "Undo last action (Ctrl+Z)")}
              aria-label={tr(fr, "Annuler la dernière action", "Undo last action")}
            >
              <Undo2 />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={redo}
              disabled={!history.current.future.length}
              title={tr(fr, "Rétablir (Ctrl+Maj+Z)", "Redo (Ctrl+Shift+Z)")}
              aria-label={tr(fr, "Rétablir", "Redo")}
            >
              <Redo2 />
            </Button>
          </div>
          {anyDirty ? (
            <Button size="sm" variant="ghost" onClick={discard}>
              <RotateCcw />
              {tr(fr, "Annuler", "Discard")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            loading={savingSections || saveDesign.isPending}
            disabled={!anyDirty}
            onClick={() => void save().catch(() => undefined)}
          >
            <Save />
            {tr(fr, "Enregistrer", "Save")}
          </Button>
          <Button
            size="sm"
            loading={publishing}
            onClick={() => void saveAndPublish()}
          >
            <Send />
            {dirty
              ? tr(fr, "Enregistrer et publier", "Save & publish")
              : tr(fr, "Publier la page", "Publish page")}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left: tree Page → Blocs → Conteneurs → Éléments (can be folded) */}
        {treeCollapsed ? (
          <aside className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-2 py-1.5 lg:w-11 lg:flex-col lg:border-b-0 lg:border-r lg:px-0 lg:py-2">
            <button
              type="button"
              onClick={() => toggleTree(false)}
              className="grid size-8 place-items-center rounded-md text-ink-secondary hover:bg-surface-2 hover:text-ink"
              title={tr(fr, "Afficher la structure", "Show the structure")}
              aria-label={tr(fr, "Afficher la structure", "Show the structure")}
              aria-expanded={false}
            >
              <PanelLeftOpen className="size-4" />
            </button>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted lg:[writing-mode:vertical-rl] lg:rotate-180">
              {tr(fr, "Structure", "Structure")}
            </span>
          </aside>
        ) : (
        <aside className="flex max-h-64 shrink-0 flex-col border-b border-border bg-surface-1 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
          <div className="space-y-2 border-b border-border px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                <button
                  type="button"
                  onClick={() => toggleTree(true)}
                  className="grid size-6 place-items-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink"
                  title={tr(fr, "Réduire la structure (plus de place pour l’aperçu)", "Fold the structure (more room for the preview)")}
                  aria-label={tr(fr, "Réduire la structure", "Fold the structure")}
                  aria-expanded
                >
                  <PanelLeftClose className="size-4" />
                </button>
                {tr(fr, "Structure", "Structure")}
              </p>
              {onCreatePage ? (
                <button
                  type="button"
                  onClick={() => setCreatingNew((value) => !value)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
                >
                  <FilePlus2 className="size-3.5" />
                  {tr(fr, "Nouvelle page", "New page")}
                </button>
              ) : null}
            </div>
            {creatingNew && onCreatePage ? (
              <NewPageForm
                pages={pages}
                saving={creatingPage}
                onCancel={() => setCreatingNew(false)}
                onCreate={async (payload) => {
                  if (dirtyRef.current && !await ask(tr(fr, "Cette page contient des modifications non enregistrées. Créer et ouvrir la nouvelle page quand même ?", "This page has unsaved changes. Create and open the new page anyway?")))
                    return;
                  dirtyRef.current = false;
                  openPageSettingsNext.current = true;
                  await onCreatePage(payload);
                  setCreatingNew(false);
                }}
                fr={fr}
              />
            ) : null}
            <Button
              size="sm"
              variant={adding ? "ghost" : "secondary"}
              className="w-full"
              onClick={() => setAdding((value) => !value)}
            >
              {adding ? <X /> : <Plus />}
              {adding ? tr(fr, "Fermer", "Close") : tr(fr, "Ajouter un bloc à cette page", "Add a block to this page")}
            </Button>
          </div>
          {adding ? (
            <div className="max-h-[55%] shrink-0 space-y-3 overflow-y-auto border-y border-border bg-surface-2 p-2">
              <p className="px-1 text-[11px] text-ink-muted">
                {selectedBlock
                  ? tr(fr, `Le nouveau bloc sera placé après « ${label(selectedBlock)} ».`, `The new block goes after “${label(selectedBlock)}”.`)
                  : tr(fr, "Le nouveau bloc sera placé à la fin de la page.", "The new block goes at the end of the page.")}
              </p>
              <div className="space-y-1">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                  {tr(fr, "Blocs prêts à remplir", "Ready-made blocks")}
                </p>
                {(Object.keys(sectionLabels) as SectionType[])
                  .filter((type) => type !== "container")
                  .map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="block w-full rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-left hover:border-brand"
                      onClick={() => add(type)}
                    >
                      <span className="block text-xs font-semibold text-ink">{sectionLabels[type][fr ? 0 : 1]}</span>
                      <span className="block text-[11px] leading-4 text-ink-muted">{sectionHints[type][fr ? 0 : 1]}</span>
                    </button>
                  ))}
              </div>
              <div className="space-y-1">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                  {tr(fr, "Blocs à construire vous-même", "Blocks you build yourself")}
                </p>
                <button
                  type="button"
                  className="block w-full rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-left hover:border-brand"
                  onClick={() => add("container")}
                >
                  <span className="block text-xs font-semibold text-ink">{sectionLabels.container[fr ? 0 : 1]}</span>
                  <span className="block text-[11px] leading-4 text-ink-muted">{sectionHints.container[fr ? 0 : 1]}</span>
                </button>
                <button
                  type="button"
                  className="block w-full rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-left hover:border-brand"
                  onClick={addCarouselBlock}
                >
                  <span className="block text-xs font-semibold text-ink">{tr(fr, "Carrousel / slider", "Carousel / slider")}</span>
                  <span className="block text-[11px] leading-4 text-ink-muted">
                    {tr(fr, "Des diapositives qui défilent (cartes, images, textes).", "Scrolling slides (cards, images, texts).")}
                  </span>
                </button>
              </div>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
            {/* Site-wide: theme and global zones, shown on every page */}
            <div className="mb-2 rounded-lg border border-violet-500/25 bg-violet-500/[.04] p-1.5">
              <p className="flex items-center justify-between px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                {tr(fr, "Site · toutes les pages", "Site · every page")}
                {designUnpublished || designDirty ? (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-700">
                    {tr(fr, "Brouillon", "Draft")}
                  </span>
                ) : null}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setPanel("theme");
                }}
                className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left transition ${
                  panel === "theme" ? "border-violet-500 bg-violet-500/10" : "border-transparent hover:bg-surface-2"
                }`}
              >
                <Paintbrush className="size-3.5 shrink-0 text-violet-600" />
                <span className="min-w-0 flex-1 truncate text-ink">{tr(fr, "Modèle et thème du site", "Site template and theme")}</span>
                <span className="truncate text-[10px] text-ink-muted">
                  {design.theme && SITE_THEMES[design.theme] ? SITE_THEMES[design.theme]!.label[fr ? 0 : 1] : tr(fr, "Actuel", "Current")}
                </span>
              </button>
              {zonesActive ? (
                ZONE_NAMES.map((name) => {
                  const zone = design.zones?.[name];
                  if (!zone) return null;
                  const id = `zone-${name}`;
                  const open = selectedId === id || expanded.has(id);
                  const children = blockTreeChildren(
                    { id, section_type: "container", content: zone.content, sort_order: 0 },
                    fr,
                  );
                  const Icon = name === "footer" ? PanelBottom : PanelTop;
                  return (
                    <div key={name}>
                      <div
                        className={`flex items-center gap-0.5 rounded-md border px-0.5 transition ${
                          selectedId === id && !selectedElement
                            ? "border-violet-500 bg-violet-500/10"
                            : selectedId === id
                              ? "border-violet-500/40"
                              : "border-transparent hover:bg-surface-2"
                        }`}
                      >
                        <button
                          type="button"
                          className="grid size-6 shrink-0 place-items-center rounded text-ink-muted hover:text-ink"
                          onClick={() =>
                            setExpanded((current) => {
                              const next = new Set(current);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                          aria-label={open ? tr(fr, "Replier", "Collapse") : tr(fr, "Déplier", "Expand")}
                        >
                          <ChevronDown className={`size-3.5 transition ${open ? "" : "-rotate-90"}`} />
                        </button>
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                          onClick={() => {
                            selectBlock(id, true);
                          }}
                        >
                          <Icon className="size-3.5 shrink-0 text-violet-600" />
                          <span className="truncate text-ink">{zoneLabels[name][fr ? 0 : 1]}</span>
                          {zone.hidden ? <EyeOff className="size-3 shrink-0 text-ink-muted" /> : null}
                          {name === "header" && zone.sticky !== false ? <Pin className="size-3 shrink-0 text-ink-muted" /> : null}
                        </button>
                      </div>
                      {open ? (
                        <TreeNodes
                          nodes={children}
                          selected={selectedId === id ? selectedElement : null}
                          onSelect={(element) => {
                            selectBlock(id, false, element);
                            window.setTimeout(() => {
                              frameDocument.current
                                ?.querySelector(`[data-builder-section="${CSS.escape(id)}"] [data-el="${CSS.escape(element)}"]`)
                                ?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }, 60);
                          }}
                          fr={fr}
                        />
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="space-y-1.5 px-1 py-1">
                  <p className="text-[11px] leading-4 text-ink-muted">
                    {tr(
                      fr,
                      "Top bar, en-tête et pied de page actuels : passez aux zones globales pour les modifier élément par élément.",
                      "Current top bar, header and footer: switch to global zones to edit them element by element.",
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      activateZones();
                      selectBlock("zone-header", true);
                    }}
                  >
                    <PanelTop />
                    {tr(fr, "Modifier top bar, header et footer", "Edit top bar, header and footer")}
                  </Button>
                </div>
              )}
            </div>
            {/* Page node */}
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setPanel("page");
              }}
              className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                panel === "page" ? "border-violet-500 bg-violet-500/10" : "border-transparent hover:bg-surface-2"
              }`}
              title={tr(fr, "Réglages de la page", "Page settings")}
            >
              <TreeKind kind="page" fr={fr} />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                {page.navigationLabelFr || page.titleFr}
              </span>
              <span className="truncate text-[10px] text-ink-muted">/{page.slug}</span>
              <Settings2 className="size-3.5 shrink-0 text-ink-muted" />
            </button>
            <ol className="ml-3 mt-1 list-none space-y-0.5 border-l border-border pl-2">
              {blocks.map((block, index) => {
                const open = expanded.has(block.id) || selectedId === block.id;
                const children = blockTreeChildren(block, fr);
                return (
                  <li
                    key={block.id}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropTargetId(block.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      // An element dropped on a Div block goes inside the div.
                      if (dragState.current && isDivBlock(block)) {
                        const drag = dragState.current;
                        dragState.current = null;
                        setDropTargetId(null);
                        dropInTree(block.id, drag, { element: "canvas", where: "inside" });
                        return;
                      }
                      dropOn(block.id);
                      setDraggedId(null);
                      setDropTargetId(null);
                    }}
                    className={draggedId === block.id ? "opacity-40" : ""}
                  >
                    <div
                      className={`group flex items-center gap-0.5 rounded-lg border px-0.5 py-0.5 transition ${
                        selectedId === block.id && (!selectedElement || (selectedElement === "canvas" && isDivBlock(block)))
                          ? "border-sky-500 bg-sky-500/10"
                          : selectedId === block.id
                            ? "border-sky-500/40"
                            : dropTargetId === block.id && draggedId !== block.id
                              ? "border-brand/60 bg-brand/[.04]"
                              : "border-transparent hover:bg-surface-2"
                      }`}
                    >
                      <button
                        type="button"
                        className="grid size-6 shrink-0 place-items-center rounded text-ink-muted hover:text-ink disabled:opacity-0"
                        disabled={!children.length}
                        onClick={() =>
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(block.id)) next.delete(block.id);
                            else next.add(block.id);
                            return next;
                          })
                        }
                        aria-label={open ? tr(fr, "Replier", "Collapse") : tr(fr, "Déplier", "Expand")}
                      >
                        <ChevronDown className={`size-3.5 transition ${open ? "" : "-rotate-90"}`} />
                      </button>
                      <span
                        draggable
                        onDragStart={() => setDraggedId(block.id)}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDropTargetId(null);
                        }}
                        className="grid size-6 shrink-0 cursor-grab place-items-center rounded text-ink-muted hover:text-brand active:cursor-grabbing"
                        title={tr(fr, "Glisser pour réorganiser", "Drag to reorder")}
                      >
                        <GripVertical className="size-3.5" />
                      </span>
                      <button
                        type="button"
                        className="min-w-0 flex-1 py-0.5 text-left"
                        onClick={() => selectBlock(block.id, true)}
                      >
                        <span className="flex items-center gap-1.5">
                          <TreeKind kind="block" fr={fr} />
                          <span className="truncate text-ink">
                            {index + 1}. {label(block)}
                          </span>
                        </span>
                        {blockSummary(block) ? (
                          <span className="block truncate pl-[3.1rem] text-[11px] text-ink-muted">{blockSummary(block)}</span>
                        ) : null}
                      </button>
                      <div className="flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          className="grid size-6 place-items-center rounded text-ink-muted hover:text-ink disabled:opacity-30"
                          aria-label={tr(fr, "Monter", "Move up")}
                        >
                          <ChevronUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={index === blocks.length - 1}
                          onClick={() => move(index, 1)}
                          className="grid size-6 place-items-center rounded text-ink-muted hover:text-ink disabled:opacity-30"
                          aria-label={tr(fr, "Descendre", "Move down")}
                        >
                          <ChevronDown className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    {open && children.length ? (
                      <TreeNodes
                        nodes={children}
                        onDrop={(drag, target) => dropInTree(block.id, drag, target)}
                        selected={selectedId === block.id ? selectedElement : null}
                        onSelect={(element) => {
                          selectBlock(block.id, false, element);
                          window.setTimeout(() => {
                            frameDocument.current
                              ?.querySelector(`[data-builder-section="${CSS.escape(block.id)}"] [data-el="${CSS.escape(element)}"]`)
                              ?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }, 60);
                        }}
                        fr={fr}
                      />
                    ) : null}
                  </li>
                );
              })}
              {blocks.length === 0 ? (
                <li className="px-2 py-6 text-center text-xs text-ink-muted">
                  {tr(fr, "Page vide : ajoutez un premier bloc.", "Empty page: add a first block.")}
                </li>
              ) : null}
            </ol>
          </div>
        </aside>
        )}

        {/* Center: the real website, updated live */}
        <div className="flex min-h-[420px] min-w-0 flex-1 justify-center overflow-hidden bg-[repeating-linear-gradient(45deg,rgb(148_163_184_/_0.08)_0_10px,transparent_10px_20px)] p-0 lg:p-3">
          <BuilderPreviewFrame
            key={device}
            width={previewDeviceWidth[device]}
            title={tr(fr, "Aperçu modifiable de la page", "Editable page preview")}
            onFrameDocument={(doc) => {
              frameDocument.current = doc;
            }}
          >
            <PublicWebsiteRenderer
              website={previewWebsite}
              page={previewPage}
              initialLanguage={fr ? "fr" : "en"}
              editor={{
                selectedSectionId: selectedId,
                selectedElement,
                replayKey,
                onSelectSection: (id, element, text) => {
                  setClickedText(text ? `${id}|${element ?? ""}` : null);
                  selectBlock(id, false, element);
                },
                sectionLabel: label,
                preview: previewMode,
                previewState,
                onNavigatePage: (slug) => {
                  const target = visiblePages.find((candidate) => candidate.slug === slug);
                  if (target && target.id !== page.id) switchPage(target.id);
                },
              }}
            />
            {previewMode ? null : (
              <BuilderCanvasOverlay
                selectedId={selectedId}
                selectedElement={selectedElement}
                fr={fr}
                editable={(id) => blocks.some((candidate) => candidate.id === id)}
                describe={canvasDescribe}
                canDrop={canvasCanDrop}
                onDrop={(id, drag, target) => dropInTree(id, drag, target)}
                onInsert={(id, type, target) => dropInTree(id, { add: type }, target)}
                onDuplicate={canvasDuplicate}
                onDelete={(id, element) => void canvasDelete(id, element)}
                onUndo={undo}
                onRedo={redo}
                inlineText={(id, element, language) => {
                  const block = blockById(id);
                  const found = block ? inlineTextOf(block, element, language) : null;
                  return found ? { value: found.value, multiline: found.multiline } : null;
                }}
                onInlineText={(id, element, language, value) => {
                  const index = blocks.findIndex((candidate) => candidate.id === id);
                  const block = blocks[index];
                  const found = block ? inlineTextOf(block, element, language) : null;
                  if (!found || found.value === value) return;
                  changeBlockAt(index, found.write(value));
                }}
              />
            )}
          </BuilderPreviewFrame>
        </div>

        {/* Right: edit the selected block or the page information */}
        <PageSectionsContext.Provider value={pageSectionsValue}>
        <aside className="flex min-h-0 shrink-0 flex-col border-t border-border bg-surface-1 lg:w-[400px] lg:border-l lg:border-t-0">
          <SelectionBreadcrumb path={selectionPath} fr={fr} />
          {panel === "theme" ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              <SiteTemplatesPanel
                value={!design.template && !design.theme && !zonesActive && !design.blockVariants ? ORIGIN_TEMPLATE : design.template}
                onApply={applySiteTemplate}
                fr={fr}
              />
              <ThemePanel
                value={design.theme}
                onChange={applyTheme}
                fr={fr}
              />
              <DesignPublishPanel
                dirty={designDirty}
                unpublished={designUnpublished}
                history={website.designHistory ?? []}
                saving={saveDesign.isPending}
                publishing={publishDesign.isPending}
                restoring={restoreDesign.isPending}
                onSave={() => void saveDesign.mutateAsync(design).then(() => toast.success(tr(fr, "Brouillon du design enregistré", "Design draft saved")))}
                onPublish={() => publishDesign.mutate()}
                onRestore={async (index) => {
                  if (designDirty && !await ask(tr(fr, "Vos changements non enregistrés du design seront remplacés. Continuer ?", "Your unsaved design changes will be replaced. Continue?")))
                    return;
                  restoreDesign.mutate(index);
                }}
                onDiscardDraft={async () => {
                  if (!await ask(tr(fr, "Revenir au design actuellement publié ? Le brouillon sera remplacé.", "Go back to the currently published design? The draft will be replaced.")))
                    return;
                  setDesign(JSON.parse(publishedDesignJson) as SiteDesign);
                }}
                fr={fr}
              />
            </div>
          ) : panel === "page" ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              <PageChecklist page={page} fr={fr} />
              <PageTemplatePanel
                onApply={(sections, mode) => {
                  setBlocks((current) => ordered(mode === "replace" ? sections : [...current, ...sections]));
                  toast.success(tr(fr, "Modèle ajouté : pensez à enregistrer.", "Template added: remember to save."));
                }}
                fr={fr}
              />
              <PageLayoutFields
                value={pageSettings}
                onChange={setPageSettings}
                dirty={pageSettingsDirty}
                saving={savingPage}
                onSave={savePageSettings}
                onReset={() => setPageSettings(JSON.parse(savedPageSettings) as Record<string, unknown>)}
                fr={fr}
              />
              <PageForm
                initial={page}
                title={tr(fr, "Titre, adresse (slug) et SEO", "Title, address (slug) and SEO")}
                submit={tr(fr, "Enregistrer les informations", "Save information")}
                saving={savingPage}
                onSave={(payload) => void onSavePage(payload).catch(() => undefined)}
                fr={fr}
              />
            </div>
          ) : selectedBlock ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  {selectedZone ? (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">
                        {tr(fr, "Zone globale · toutes les pages", "Global zone · every page")}
                      </p>
                      <p className="truncate text-sm font-semibold text-ink">{zoneLabels[selectedZone][fr ? 0 : 1]}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
                        {tr(fr, "Bloc", "Block")} {selectedIndex + 1} / {blocks.length}
                      </p>
                      <p className="truncate text-sm font-semibold text-ink">{label(selectedBlock)}</p>
                    </>
                  )}
                </div>
                {selectedZone ? null : (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={tr(fr, "Dupliquer", "Duplicate")}
                  aria-label={tr(fr, "Dupliquer", "Duplicate")}
                  onClick={() => duplicate(selectedIndex)}
                >
                  <Copy />
                </Button>
                )}
                {selectedElement && !(selectedElement === "canvas" && isDivBlock(selectedBlock)) ? (
                  canDeleteElement(selectedElement) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      title={tr(fr, "Supprimer seulement cet élément", "Delete only this element")}
                      onClick={deleteSelectedElement}
                    >
                      <Trash2 />
                      {tr(fr, "Supprimer l’élément", "Delete element")}
                    </Button>
                  ) : null
                ) : selectedZone ? null : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title={tr(fr, "Supprimer tout le bloc", "Delete the whole block")}
                    aria-label={tr(fr, "Supprimer tout le bloc", "Delete the whole block")}
                    onClick={() => remove(selectedIndex)}
                  >
                    <Trash2 />
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={tr(fr, "Fermer", "Close")}
                  aria-label={tr(fr, "Fermer", "Close")}
                  onClick={() => setSelectedId(null)}
                >
                  <X />
                </Button>
              </div>
              <div className="border-b border-border bg-surface-2/60 px-3 py-2">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                  {selectedZone
                    ? tr(fr, "Ajouter dans cette zone", "Add inside this zone")
                    : tr(fr, "Ajouter dans ce bloc", "Add inside this block")}
                </p>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-7 lg:grid-cols-4 xl:grid-cols-7">
                  {(selectedZone ? zoneAddTypes : blockAddTypes).map(([type, Icon]) => (
                    <button
                      key={type}
                      type="button"
                      draggable={!selectedZone}
                      onDragStart={(event) => {
                        dragState.current = { add: type };
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData("text/plain", type);
                      }}
                      onDragEnd={() => {
                        dragState.current = null;
                      }}
                      onClick={() => addExtra(type)}
                      title={extraTypeLabels[type]![fr ? 0 : 1]}
                      className="flex flex-col items-center gap-0.5 rounded-md border border-border bg-surface-1 px-1 py-1.5 text-[10px] font-medium text-ink-secondary transition hover:border-brand hover:text-brand"
                    >
                      <Icon className="size-4" />
                      <span className="truncate">{extraTypeLabels[type]![fr ? 0 : 1]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {selectedElement ? (
                  <ElementEditor
                    key={`${selectedBlock.id}-${selectedElement}`}
                    orgSlug={orgSlug}
                    block={selectedBlock}
                    element={selectedElement}
                    onChange={(value) => updateSelected(value)}
                    onBack={() => setSelectedElement(null)}
                    onSelectElement={setSelectedElement}
                    breakpoint={device}
                    onReplay={replayAnimations}
                    linkPages={linkPages}
                    previewState={previewState}
                    onPreviewState={setPreviewState}
                    clickedText={clickedText === `${selectedBlock.id}|${selectedElement}`}
                    fr={fr}
                  />
                ) : selectedZone && zoneData ? (
                  <ZonePanel
                    name={selectedZone}
                    zone={zoneData}
                    facts={siteFacts}
                    theme={design.theme}
                    pages={linkPages}
                    menuPages={menuLinkPages}
                    onChange={(next) => setZone(selectedZone, () => next)}
                    onSelectElement={setSelectedElement}
                    orgSlug={orgSlug}
                    onReplay={replayAnimations}
                    fr={fr}
                  />
                ) : (
                <>
                <BlockVariantPicker
                  block={selectedBlock}
                  siteVariant={design.blockVariants?.[selectedBlock.section_type]}
                  onChange={(variant) =>
                    updateSelected({ ...selectedBlock, content: { ...selectedBlock.content, blockVariant: variant } })
                  }
                  fr={fr}
                />
                {hiddenElementsOf(selectedBlock).length ? (
                  <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/[.07] px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      {tr(fr, "Éléments supprimés de ce bloc", "Elements deleted from this block")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {hiddenElementsOf(selectedBlock).map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => restoreElement(name)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 px-2 py-1 text-xs font-medium text-ink-secondary hover:border-brand hover:text-brand"
                          title={tr(fr, "Remettre cet élément", "Bring this element back")}
                        >
                          <Undo2 className="size-3.5" />
                          {elementDisplayName(name, fr)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <BlockEditor
                  key={selectedBlock.id}
                  orgSlug={orgSlug}
                  block={selectedBlock}
                  index={selectedIndex}
                  count={blocks.length}
                  onChange={(value) => updateSelected(value)}
                  onMove={move}
                  onRemove={remove}
                  onDragStart={() => undefined}
                  onDragEnd={() => undefined}
                  onDragOver={() => undefined}
                  onDrop={() => undefined}
                  isDragging={false}
                  isDropTarget={false}
                  fr={fr}
                  embedded
                  onReplay={replayAnimations}
                  linkPages={linkPages}
                  areaStyle={
                    <ElementEditor
                      key={`${selectedBlock.id}-area`}
                      orgSlug={orgSlug}
                      block={selectedBlock}
                      element={selectedBlock.section_type === "container" ? "canvas" : "root"}
                      onChange={(value) => updateSelected(value)}
                      onBack={() => undefined}
                      onSelectElement={setSelectedElement}
                      breakpoint={device}
                      onReplay={replayAnimations}
                      linkPages={linkPages}
                      previewState={previewState}
                      onPreviewState={setPreviewState}
                      inline
                      fr={fr}
                    />
                  }
                />
                </>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <PencilLine className="size-8 text-brand" />
              <p className="text-sm font-semibold text-ink">
                {tr(fr, "Comment c’est organisé", "How it is organised")}
              </p>
              <ol className="max-w-xs list-none space-y-2 text-left text-xs leading-5 text-ink-muted">
                <li>
                  <strong className="text-ink">1. {tr(fr, "Page", "Page")}</strong> —{" "}
                  {tr(fr, "une page du site (Accueil, Contact…), choisie en haut à gauche.", "a website page (Home, Contact…), chosen top left.")}
                </li>
                <li>
                  <strong className="text-ink">2. {tr(fr, "Bloc", "Block")}</strong> —{" "}
                  {tr(fr, "une section de la page, empilée de haut en bas (liste de gauche).", "a section of the page, stacked top to bottom (left list).")}
                </li>
                <li>
                  <strong className="text-ink">3. {tr(fr, "Élément", "Element")}</strong> —{" "}
                  {tr(fr, "ce qu’il y a dans un bloc : titre, texte, bouton, image, carte, conteneur…", "what a block contains: title, text, button, image, card, container…")}
                </li>
              </ol>
              <p className="max-w-xs text-xs leading-5 text-ink-muted">
                {tr(
                  fr,
                  "Cliquez dans l’aperçu : sur un élément pour le modifier, ou à côté pour sélectionner tout le bloc. Tout s’affiche immédiatement ; enregistrez ensuite.",
                  "Click in the preview: on an element to edit it, or beside it to select the whole block. Everything shows instantly; then save.",
                )}
              </p>
            </div>
          )}
        </aside>
        </PageSectionsContext.Provider>
      </div>
    </section>
  );
}

/** Background and colours shared by every block type. Values are stored in
 * the block content and drawn by the public renderer's SectionBackdrop. */
function BlockStyleFields({
  orgSlug,
  content,
  set,
  fr,
  onReplay,
}: {
  orgSlug: string;
  content: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  fr: boolean;
  onReplay?: () => void;
}) {
  const image = String(content.blockBackgroundImageUrl ?? "");
  const rawOpacity = Number(content.blockBackgroundImageOpacity);
  const opacity = Number.isFinite(rawOpacity) ? rawOpacity : 100;
  return (
    <fieldset className="space-y-3 rounded-xl border border-border bg-surface-2/60 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        <Palette className="mr-1 inline size-3.5" />
        {tr(fr, "Arrière-plan & couleurs", "Background & colours")}
      </legend>
      <BlockColorField
        label={tr(fr, "Couleur de fond", "Background colour")}
        value={content.blockBackgroundColor}
        onChange={(value) => set("blockBackgroundColor", value)}
        fallback="#ffffff"
        fr={fr}
      />
      <WebsiteImagePicker
        orgSlug={orgSlug}
        value={image}
        onChange={(url) => set("blockBackgroundImageUrl", url)}
        fr={fr}
        label={tr(fr, "Image de fond", "Background image")}
      />
      {image ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">
              {tr(fr, "Opacité de l’image", "Image opacity")}
            </span>
            <span className="tabular-nums text-ink-secondary">{opacity}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={opacity}
            onChange={(event) =>
              set("blockBackgroundImageOpacity", Number(event.target.value))
            }
            className="w-full accent-[var(--color-brand,#0b5cad)]"
            aria-label={tr(fr, "Opacité de l’image", "Image opacity")}
          />
          <p className="text-xs text-ink-muted">
            {tr(
              fr,
              "Baissez l’opacité pour laisser apparaître la couleur de fond et rendre le texte plus lisible.",
              "Lower the opacity to let the background colour show through and keep text readable.",
            )}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              set("blockBackgroundImageUrl", "");
            }}
          >
            <X />
            {tr(fr, "Retirer l’image de fond", "Remove background image")}
          </Button>
        </div>
      ) : null}
      <BlockColorField
        label={tr(fr, "Couleur du texte", "Text colour")}
        value={content.blockTextColor}
        onChange={(value) => set("blockTextColor", value)}
        fallback="#0f172a"
        fr={fr}
      />
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-sm font-medium text-ink">{tr(fr, "Taille du bloc", "Block size")}</p>
        <p className="text-[11px] leading-4 text-ink-muted">
          {tr(
            fr,
            "S’applique à tout le bloc, avec sa couleur ou son image de fond. Vide = toute la largeur. Sur téléphone, le bloc reprend toujours toute la largeur.",
            "Applies to the whole block, with its background colour or image. Empty = full width. On phones the block always takes the full width.",
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <UnitInput
            label={tr(fr, "Largeur", "Width")}
            value={content.blockWidth}
            units={["%", "px", "vw", "rem"]}
            placeholder="100"
            onChange={(value) => set("blockWidth", value)}
          />
          <UnitInput
            label={tr(fr, "Hauteur minimale", "Minimum height")}
            value={content.blockMinHeight}
            units={["px", "vh", "rem"]}
            placeholder="auto"
            onChange={(value) => set("blockMinHeight", value)}
          />
        </div>
        {content.blockWidth !== undefined && content.blockWidth !== "" ? (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-ink-muted">{tr(fr, "Position du bloc", "Block position")}</p>
            <Segmented
              value={content.blockAlign === "left" || content.blockAlign === "right" ? content.blockAlign : "center"}
              onChange={(value) => set("blockAlign", value === "left" || value === "right" ? value : undefined)}
              options={[
                ["left", tr(fr, "À gauche", "Left")],
                ["center", tr(fr, "Centré", "Centred")],
                ["right", tr(fr, "À droite", "Right")],
              ]}
            />
          </div>
        ) : null}
        <NumberBox
          label={tr(fr, "Arrondi des coins (px)", "Corner radius (px)")}
          value={content.blockRadius}
          max={80}
          onChange={(value) => set("blockRadius", value)}
        />
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-sm font-medium text-ink">
          {tr(fr, "Espacement du bloc (px)", "Block spacing (px)")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <NumberBox
            label={tr(fr, "Intérieur haut", "Padding top")}
            value={content.blockPaddingTop}
            max={320}
            onChange={(value) => set("blockPaddingTop", value)}
          />
          <NumberBox
            label={tr(fr, "Intérieur bas", "Padding bottom")}
            value={content.blockPaddingBottom}
            max={320}
            onChange={(value) => set("blockPaddingBottom", value)}
          />
          <NumberBox
            label={tr(fr, "Extérieur haut", "Margin top")}
            value={content.blockMarginTop}
            max={320}
            onChange={(value) => set("blockMarginTop", value)}
          />
          <NumberBox
            label={tr(fr, "Extérieur bas", "Margin bottom")}
            value={content.blockMarginBottom}
            max={320}
            onChange={(value) => set("blockMarginBottom", value)}
          />
        </div>
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        <AnimationFields
          value={
            content.blockAnimation && typeof content.blockAnimation === "object"
              ? (content.blockAnimation as Record<string, unknown>)
              : {}
          }
          onChange={(next) => set("blockAnimation", Object.keys(next).length ? next : undefined)}
          allowText={false}
          title={tr(fr, "Animation du bloc", "Block animation")}
          onReplay={onReplay}
          fr={fr}
        />
      </div>
    </fieldset>
  );
}

const blockColorPresets = [
  "#ffffff",
  "#f7faf8",
  "#075c4d",
  "#0b2545",
  "#e9a43a",
  "#0f172a",
];

function BlockColorField({
  label,
  value,
  onChange,
  fallback,
  fr,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  fallback: string;
  fr: boolean;
}) {
  const current =
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "";
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        {current ? (
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
              <span className="size-2.5 rounded-full border border-black/10" style={{ backgroundColor: current }} />
              {tr(fr, "Personnalisée", "Custom")}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              onClick={() => onChange("")}
              title={tr(fr, "Revenir à la couleur par défaut", "Back to the default colour")}
            >
              <RotateCcw className="size-3" />
              {tr(fr, "Réinitialiser", "Reset")}
            </button>
          </span>
        ) : (
          <span className="text-xs text-ink-muted">{tr(fr, "Par défaut (aucune)", "Default (none)")}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={current || fallback}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border bg-surface-1 p-0.5"
          aria-label={label}
        />
        <Input
          value={draft}
          placeholder={fallback}
          maxLength={7}
          className="font-mono uppercase"
          onChange={(event) => {
            const next = event.target.value.trim();
            setDraft(next);
            if (next === "" || /^#[0-9a-f]{6}$/i.test(next)) onChange(next);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {blockColorPresets.map((preset) => (
          <button
            key={preset}
            type="button"
            title={preset}
            aria-label={preset}
            onClick={() => onChange(preset)}
            className={`size-6 rounded-full border transition hover:scale-110 ${
              current.toLowerCase() === preset ? "border-brand ring-2 ring-brand/30" : "border-border"
            }`}
            style={{ backgroundColor: preset }}
          />
        ))}
      </div>
    </div>
  );
}

type ElementKind = "text" | "button" | "group" | "badges";
const extraTypeLabels: Record<string, [string, string]> = {
  heading: ["Sous-titre", "Subheading"],
  text: ["Paragraphe", "Paragraph"],
  button: ["Bouton", "Button"],
  image: ["Image", "Image"],
  spacer: ["Espace", "Spacer"],
  group: ["Div", "Div"],
  slider: ["Carrousel", "Carousel"],
  logo: ["Logo", "Logo"],
  menu: ["Menu", "Menu"],
  language: ["Langue FR/EN", "Language FR/EN"],
  social: ["Réseaux sociaux", "Social networks"],
  contact: ["Coordonnée", "Contact detail"],
  copyright: ["Copyright", "Copyright"],
  newsletter: ["Newsletter", "Newsletter"],
};
function newExtraElement(type: WebsiteExtraElement["type"]): WebsiteExtraElement {
  const id = `${type}-${Date.now().toString(36)}`;
  switch (type) {
    case "heading":
      return { id, type, textFr: "Nouveau sous-titre", textEn: "New subheading" };
    case "text":
      return { id, type, textFr: "Écrivez votre texte ici.", textEn: "Write your text here." };
    case "button":
      return { id, type, textFr: "En savoir plus", textEn: "Learn more", href: "/contact", variant: "primary" };
    case "image":
      return { id, type, imageUrl: "", textFr: "" };
    case "group":
      // An empty container: select it, then add any element inside.
      return { id, type, children: [] };
    case "slider":
      return {
        id,
        type,
        slider: { perView: 3, gap: 24, arrows: true, dots: true, autoplay: true, interval: 5000, speed: 500, loop: true, pauseOnHover: true },
        children: [1, 2, 3].map((number) => newSlideCard(number)),
      };
    default:
      return { id, type };
  }
}

let slideSeed = 0;
/** A ready-to-edit slide: a card container with a title, a text and a button. */
function newSlideCard(number: number): WebsiteExtraElement {
  const stamp = `${Date.now().toString(36)}${(slideSeed++).toString(36)}`;
  return {
    id: `card-${stamp}`,
    type: "group",
    children: [
      { id: `heading-${stamp}`, type: "heading", textFr: `Diapositive ${number}`, textEn: `Slide ${number}` },
      { id: `text-${stamp}`, type: "text", textFr: "Un court texte pour présenter cette diapositive.", textEn: "A short text introducing this slide." },
      { id: `button-${stamp}`, type: "button", textFr: "En savoir plus", textEn: "Learn more", href: "/contact", variant: "primary" },
    ],
  };
}

/** Card look for slides created by the builder (white card, padding, shadow). */
function slideCardStyles(item: WebsiteExtraElement): Record<string, Record<string, unknown>> {
  const styles: Record<string, Record<string, unknown>> = {};
  const cards = item.type === "slider" ? (item.children ?? []) : item.id.startsWith("card-") ? [item] : [];
  for (const card of cards) {
    if (card.type !== "group") continue;
    styles[`x:${card.id}`] = {
      display: "flex",
      direction: "column",
      alignItems: "start",
      gap: 12,
      paddingTop: 28,
      paddingRight: 28,
      paddingBottom: 28,
      paddingLeft: 28,
      background: "#ffffff",
      color: "#0f172a",
      radius: 22,
      shadow: "md",
      width: "full",
    };
  }
  return styles;
}

const isContainerType = (type: string | undefined) => type === "group" || type === "slider";

/** Starting box of a new div: visible when empty, content stacked. Every
 * value is an ordinary style the owner can change in the panel. */
const DEFAULT_DIV_STYLE: Record<string, unknown> = {
  display: "flex",
  direction: "column",
  alignItems: "start",
  gap: 16,
  paddingTop: 24,
  paddingRight: 24,
  paddingBottom: 24,
  paddingLeft: 24,
  minHeight: "120px",
};

/** A "Div" block: one single box (the block area is the div itself). */
function isDivBlock(block: WebsiteSection | null | undefined): boolean {
  return Boolean(block && block.section_type === "container" && block.content.divMode === true);
}

/** Turns an old free block (band + inner zone) into one single div, carrying
 * its background, text colour, size and spacing over to the div itself. */
function convertToDivBlock(block: WebsiteSection): WebsiteSection {
  const content = { ...block.content };
  const styles = { ...((content.elementStyles as Record<string, Record<string, unknown>> | undefined) ?? {}) };
  const canvas: Record<string, unknown> = { ...DEFAULT_DIV_STYLE, ...(styles.canvas ?? {}) };
  const number = (key: string) => {
    const value = Number(content[key]);
    return content[key] !== undefined && content[key] !== "" && Number.isFinite(value) ? value : undefined;
  };
  if (typeof content.blockBackgroundColor === "string" && canvas.background === undefined) canvas.background = content.blockBackgroundColor;
  if (typeof content.blockTextColor === "string" && canvas.color === undefined) canvas.color = content.blockTextColor;
  // The old block had 64px above and below and 32px on the sides on a
  // computer, around a zone at least 96px high: the div keeps that size.
  // (Tablets and phones still reduce the spacing automatically.)
  const top = number("blockPaddingTop") ?? 64;
  const bottom = number("blockPaddingBottom") ?? 64;
  canvas.paddingTop = top + (Number(styles.canvas?.paddingTop) || 0);
  canvas.paddingBottom = bottom + (Number(styles.canvas?.paddingBottom) || 0);
  canvas.paddingLeft = 32 + (Number(styles.canvas?.paddingLeft) || 0);
  canvas.paddingRight = 32 + (Number(styles.canvas?.paddingRight) || 0);
  if (styles.canvas?.minHeight === undefined) canvas.minHeight = `${top + bottom + 96}px`;
  if (number("blockMarginTop") !== undefined) canvas.marginTop = number("blockMarginTop");
  if (number("blockMarginBottom") !== undefined) canvas.marginBottom = number("blockMarginBottom");
  if (number("blockRadius") !== undefined) canvas.radius = number("blockRadius");
  const width = content.blockWidth;
  if (width !== undefined && width !== "") {
    canvas.width = typeof width === "number" ? `${width}px` : width;
    if (content.blockAlign !== "left") canvas.marginLeft = "auto";
    if (content.blockAlign !== "right") canvas.marginRight = "auto";
  }
  if (typeof content.blockMinHeight === "string" || typeof content.blockMinHeight === "number")
    canvas.minHeight = typeof content.blockMinHeight === "number" ? `${content.blockMinHeight}px` : content.blockMinHeight;
  for (const key of [
    "blockBackgroundColor",
    "blockTextColor",
    "blockPaddingTop",
    "blockPaddingBottom",
    "blockMarginTop",
    "blockMarginBottom",
    "blockRadius",
    "blockWidth",
    "blockAlign",
    "blockMinHeight",
    "zoneWidth",
  ])
    delete content[key];
  return { ...block, content: { ...content, divMode: true, elementStyles: { ...styles, canvas } } };
}

/** WordPress-like default box for a new container: full width, vertical flex,
 * some padding and space between its elements. Slide cards keep their look. */
function newElementStyles(item: WebsiteExtraElement): Record<string, Record<string, unknown>> {
  const styles = slideCardStyles(item);
  if (item.type === "group" && !item.id.startsWith("card-"))
    styles[`x:${item.id}`] = {
      display: "flex",
      direction: "column",
      alignItems: "stretch",
      gap: 16,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      width: "full",
      minHeight: "80px",
      ...(styles[`x:${item.id}`] ?? {}),
    };
  return styles;
}

/** Where a dragged element lands: inside a container, or before/after an element.
 * "canvas" (inside) means the top level of the block. */
const TOP_LEVEL_BUILT_INS = ["eyebrow", "title", "body", "buttons", "badges"];

/** How many containers are nested in an element (itself included). */
function containerLevels(item: WebsiteExtraElement): number {
  if (!isContainerType(item.type)) return 0;
  return 1 + Math.max(0, ...(item.children ?? []).map(containerLevels));
}

/** Puts an element (new or detached) at a drop target. Null when not allowed. */
function placeExtraInBlock(block: WebsiteSection, item: WebsiteExtraElement, target: DropTarget): WebsiteSection | null {
  const extras = readExtraElements(block.content);
  const order = elementOrderFor(block).filter((name) => name !== `x:${item.id}`);
  const levels = containerLevels(item);
  // A container at depth d holds its own containers down to d + levels - 1.
  const fits = (depth: number) => !levels || depth + levels - 1 < MAX_CONTAINER_DEPTH;
  const withContent = (nextExtras: WebsiteExtraElement[], nextOrder: string[]) => ({
    ...block,
    content: { ...block.content, extras: nextExtras, elementOrder: nextOrder },
  });
  const topLevelAt = (anchor: string | null, after: boolean) => {
    if (!fits(1)) return null;
    const nextExtras = [...extras];
    const extraIndex = anchor?.startsWith("x:") ? nextExtras.findIndex((candidate) => `x:${candidate.id}` === anchor) : -1;
    nextExtras.splice(extraIndex >= 0 ? extraIndex + (after ? 1 : 0) : nextExtras.length, 0, item);
    const nextOrder = [...order];
    const orderIndex = anchor ? nextOrder.indexOf(anchor) : -1;
    nextOrder.splice(orderIndex >= 0 ? orderIndex + (after ? 1 : 0) : nextOrder.length, 0, `x:${item.id}`);
    return withContent(nextExtras, nextOrder);
  };
  if (target.where === "inside") {
    if (target.element === "canvas" || target.element === "root") return topLevelAt(null, true);
    const location = locateExtra(extras, target.element);
    if (!location || !isContainerType(location.item.type) || !fits(location.depth + 1)) return null;
    return withContent(
      mapExtra(extras, location.item.id, (group) => ({ ...group, children: [...(group.children ?? []), item] })),
      order,
    );
  }
  const after = target.where === "after";
  if (TOP_LEVEL_BUILT_INS.includes(target.element) || target.element === "primaryButton")
    return topLevelAt(target.element, after);
  const location = locateExtra(extras, target.element);
  if (!location) return null;
  if (!location.parentId) return topLevelAt(target.element, after);
  if (!fits(location.depth)) return null;
  return withContent(
    mapExtra(extras, location.parentId, (group) => {
      const children = [...(group.children ?? [])];
      const index = children.findIndex((candidate) => candidate.id === location.item.id);
      children.splice(index + (after ? 1 : 0), 0, item);
      return { ...group, children };
    }),
    order,
  );
}

/** Moves an added element (and everything inside it) to a drop target. */
function moveExtraInBlock(block: WebsiteSection, source: string, target: DropTarget): WebsiteSection | null {
  if (source === target.element) return null;
  const extras = readExtraElements(block.content);
  const location = locateExtra(extras, source);
  if (!location) return null;
  // Never into itself or one of its own children.
  if (locateExtra(location.item.children ?? [], target.element)) return null;
  const detached: WebsiteSection = {
    ...block,
    content: { ...block.content, extras: mapExtra(extras, location.item.id, () => null) },
  };
  return placeExtraInBlock(detached, location.item, target);
}

/** Duplicates any element of a block: an added element (with everything inside
 * it, styles, links and animations, under new ids), a built-in text or button
 * (as an added copy), or a card. The copy lands right after the original. */
function duplicateInBlock(block: WebsiteSection, element: string): { block: WebsiteSection; element: string } | null {
  const content = block.content;
  const styles = (content.elementStyles as Record<string, unknown> | undefined) ?? {};
  const extras = readExtraElements(content);
  const location = locateExtra(extras, element);
  if (location) {
    const { item, styles: added } = cloneWithStyles(location.item, styles);
    const placed = placeExtraInBlock(block, item, { element, where: "after" });
    if (!placed) return null;
    return { block: { ...placed, content: { ...placed.content, elementStyles: { ...styles, ...added } } }, element: `x:${item.id}` };
  }
  if (["eyebrow", "title", "body", "primaryButton", "secondaryButton"].includes(element)) {
    if (hiddenElementsOf(block).includes(element)) return null;
    const fields = elementFieldKeys(block.section_type, element);
    const read = (keys?: string[]) => {
      const key = keys ? storedKey(content, keys) : undefined;
      return key ? String(content[key] ?? "") : "";
    };
    const type: WebsiteExtraElement["type"] = fields.kind === "button" ? "button" : element === "title" ? "heading" : "text";
    const base = newExtraElement(type);
    const item: WebsiteExtraElement = {
      ...base,
      id: `${base.id}${(cloneSeed++).toString(36)}`,
      textFr: read(fields.fr) || base.textFr,
      textEn: read(fields.en) || base.textEn,
      ...(type === "button" ? { href: read(fields.href) || base.href } : {}),
    };
    const placed = placeExtraInBlock(block, item, { element: movableElement(element), where: "after" });
    if (!placed) return null;
    const own = styles[element];
    return {
      block: own
        ? { ...placed, content: { ...placed.content, elementStyles: { ...styles, [`x:${item.id}`]: JSON.parse(JSON.stringify(own)) as unknown } } }
        : placed,
      element: `x:${item.id}`,
    };
  }
  const card = element.match(/^item:(\d+)$/);
  if (card && Array.isArray(content.items)) {
    const index = Number(card[1]);
    const items = [...(content.items as unknown[])];
    if (index >= items.length || items.length >= 24) return null;
    items.splice(index + 1, 0, JSON.parse(JSON.stringify(items[index])) as unknown);
    // Card styles are keyed by position: later cards move one place down.
    const nextStyles: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(styles)) {
      const match = key.match(/^item:(\d+)(:.*)?$/);
      if (!match) nextStyles[key] = value;
      else {
        const position = Number(match[1]);
        nextStyles[`item:${position > index ? position + 1 : position}${match[2] ?? ""}`] = value;
        if (position === index) nextStyles[`item:${index + 1}${match[2] ?? ""}`] = JSON.parse(JSON.stringify(value)) as unknown;
      }
    }
    return { block: { ...block, content: { ...content, items, elementStyles: nextStyles } }, element: `item:${index + 1}` };
  }
  return null;
}

/** Containers an element can be moved into (for the "Move into" list). */
function moveDestinations(block: WebsiteSection, source: string, fr: boolean): Array<[string, string]> {
  const extras = readExtraElements(block.content);
  const self = locateExtra(extras, source);
  const out: Array<[string, string]> = [];
  const walk = (items: WebsiteExtraElement[], path: string) => {
    for (const item of items) {
      if (`x:${item.id}` === source) continue;
      if (!isContainerType(item.type)) continue;
      const text = (fr ? item.textFr : item.textEn) ?? "";
      const name = `${extraTypeLabels[item.type]?.[fr ? 0 : 1] ?? item.type}${text.trim() ? ` · ${text.trim().slice(0, 20)}` : ""}`;
      const label = path ? `${path} › ${name}` : name;
      if (self && moveExtraInBlock(block, source, { element: `x:${item.id}`, where: "inside" })) out.push([`x:${item.id}`, label]);
      walk(item.children ?? [], label);
    }
  };
  walk(extras, "");
  return out;
}

/** Where an added element lives: at block level or inside a container. */
type ExtraLocation = {
  item: WebsiteExtraElement;
  parentId: string | null;
  index: number;
  siblings: WebsiteExtraElement[];
  /** 1 for elements placed directly in the block, 2 inside one container… */
  depth: number;
};
function locateExtra(
  extras: WebsiteExtraElement[],
  element: string,
  parentId: string | null = null,
  depth = 1,
): ExtraLocation | null {
  if (!element.startsWith("x:")) return null;
  const id = element.slice(2);
  for (let index = 0; index < extras.length; index += 1) {
    const item = extras[index]!;
    if (item.id === id) return { item, parentId, index, siblings: extras, depth };
    if (item.children?.length) {
      const found = locateExtra(item.children, element, item.id, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Updates (or removes, when the updater returns null) one element anywhere. */
function mapExtra(
  extras: WebsiteExtraElement[],
  id: string,
  updater: (item: WebsiteExtraElement) => WebsiteExtraElement | null,
): WebsiteExtraElement[] {
  return extras.flatMap((item) => {
    if (item.id === id) {
      const next = updater(item);
      return next ? [next] : [];
    }
    if (item.children?.length)
      return [{ ...item, children: mapExtra(item.children, id, updater) }];
    return [item];
  });
}
const elementLabels: Record<string, [string, string]> = {
  eyebrow: ["Petit titre", "Eyebrow"],
  title: ["Titre", "Title"],
  body: ["Texte", "Text"],
  buttons: ["Groupe de boutons", "Button group"],
  canvas: ["Zone du bloc libre (div)", "Free block area (div)"],
  root: ["Div du bloc", "Block div"],
  panel: ["Cadre du bloc", "Block frame"],
  media: ["Zone image", "Image area"],
  items: ["Ensemble des cartes", "All cards area"],
  sideCard: ["Carte latérale", "Side card"],
  sideText: ["Texte d’accompagnement", "Supporting text"],
  sideLink: ["Lien", "Link"],
  primaryButton: ["Bouton principal", "Main button"],
  secondaryButton: ["Bouton secondaire", "Secondary button"],
  badges: ["Points forts", "Highlights"],
};

/** The content keys an element reads. The renderer accepts several spellings
 * (older pages use snake_case), so edits go to the spelling already stored. */
function elementFieldKeys(
  type: SectionType,
  element: string,
): { kind: ElementKind; fr?: string[]; en?: string[]; href?: string[] } {
  switch (element) {
    case "eyebrow":
      return {
        kind: "text",
        fr: ["eyebrow_fr", "eyebrowFr", "kickerFr"],
        en: ["eyebrow_en", "eyebrowEn", "kickerEn"],
      };
    case "title":
      return { kind: "text", fr: ["title_fr", "titleFr"], en: ["title_en", "titleEn"] };
    case "body":
      return { kind: "text", fr: ["body_fr", "bodyFr"], en: ["body_en", "bodyEn"] };
    case "primaryButton":
      return type === "hero"
        ? {
            kind: "button",
            fr: ["primary_label_fr", "primaryLabelFr"],
            en: ["primary_label_en", "primaryLabelEn"],
            href: ["primary_href", "primaryHref"],
          }
        : {
            kind: "button",
            fr: ["label_fr", "labelFr", "buttonLabelFr"],
            en: ["label_en", "labelEn", "buttonLabelEn"],
            href: ["href", "buttonHref"],
          };
    case "secondaryButton":
      return {
        kind: "button",
        fr: ["secondary_label_fr", "secondaryLabelFr"],
        en: ["secondary_label_en", "secondaryLabelEn"],
        href: ["secondary_href", "secondaryHref"],
      };
    case "badges":
      return { kind: "badges" };
    case "sideText":
      return { kind: "text", fr: ["side_text_fr", "sideTextFr"], en: ["side_text_en", "sideTextEn"] };
    case "sideLink":
      return {
        kind: "button",
        fr: ["label_fr", "labelFr", "buttonLabelFr"],
        en: ["label_en", "labelEn", "buttonLabelEn"],
      };
    default:
      return { kind: "group" };
  }
}

/** Full order of the movable elements inside a block: the saved order, plus
 * any element it does not mention yet, in its natural place at the end. */
function elementOrderFor(block: WebsiteSection): string[] {
  const builtIn =
    block.section_type === "hero"
      ? ["eyebrow", "title", "body", "buttons", "badges"]
      : block.section_type === "container"
        ? []
        : ["eyebrow", "title", "body"];
  const all = [
    ...builtIn,
    ...readExtraElements(block.content).map((item) => `x:${item.id}`),
  ];
  const saved = Array.isArray(block.content.elementOrder)
    ? (block.content.elementOrder as unknown[]).filter(
        (name): name is string => typeof name === "string" && all.includes(name),
      )
    : [];
  return [...saved, ...all.filter((name) => !saved.includes(name))];
}

/** Elements of a built-in block that the owner deleted (hidden on the site,
 * restorable from the block panel). */
function hiddenElementsOf(block: WebsiteSection): string[] {
  return Array.isArray(block.content.hiddenElements)
    ? (block.content.hiddenElements as unknown[]).filter((name): name is string => typeof name === "string")
    : [];
}

/** Whether an element can be deleted on its own (the free block's own area
 * cannot: delete the block instead). */
function canDeleteElement(element: string) {
  return element !== "canvas" && element !== "root";
}

/**
 * Deletes one element from a block without touching the rest of the block:
 * added elements and cards are removed, built-in elements (title, text,
 * buttons...) are hidden and can be restored later.
 */
function deleteElementFromBlock(block: WebsiteSection, element: string): WebsiteSection | null {
  if (!canDeleteElement(element)) return null;
  const content = block.content;
  const styles =
    content.elementStyles && typeof content.elementStyles === "object"
      ? { ...(content.elementStyles as Record<string, unknown>) }
      : {};
  const extras = readExtraElements(content);
  const location = locateExtra(extras, element);
  if (location) {
    delete styles[element];
    const dropStyles = (items: WebsiteExtraElement[]) => {
      for (const child of items) {
        delete styles[`x:${child.id}`];
        dropStyles(child.children ?? []);
      }
    };
    dropStyles(location.item.children ?? []);
    return {
      ...block,
      content: {
        ...content,
        extras: mapExtra(extras, location.item.id, () => null),
        elementStyles: styles,
        elementOrder: elementOrderFor(block).filter((name) => name !== element),
      },
    };
  }
  const card = element.match(/^item:(\d+)$/);
  if (card) {
    const index = Number(card[1]);
    const items = readItems(block);
    if (!items[index]) return null;
    return {
      ...block,
      content: { ...content, items: items.filter((_item, position) => position !== index) },
    };
  }
  const hidden = hiddenElementsOf(block);
  if (hidden.includes(element)) return block;
  return { ...block, content: { ...content, hiddenElements: [...hidden, element] } };
}

/** Buttons move together with their row. */
function movableElement(element: string) {
  return element === "primaryButton" || element === "secondaryButton" ? "buttons" : element;
}

function storedKey(content: Record<string, unknown>, candidates: string[]) {
  return (
    candidates.find((key) => typeof content[key] === "string") ??
    candidates[candidates.length - 1]!
  );
}

const heroBadgeDefaults: Array<[string, string, string]> = [
  ["badge1", "Production locale", "Local production"],
  ["badge2", "Équipes engagées", "Committed teams"],
  ["badge3", "Impact suivi", "Tracked impact"],
];

/** Edits one element clicked in the preview: its words and its look. */
function ElementEditor({
  orgSlug,
  block,
  element,
  onChange,
  onBack,
  onSelectElement,
  breakpoint = "desktop",
  onReplay,
  linkPages = [],
  previewState = null,
  onPreviewState,
  clickedText = false,
  inline = false,
  fr,
}: {
  orgSlug: string;
  block: WebsiteSection;
  element: string;
  onChange: (block: WebsiteSection) => void;
  onBack: () => void;
  onSelectElement: (element: string | null) => void;
  /** The device shown in the preview: style edits apply to that device. */
  breakpoint?: Breakpoint;
  onReplay?: () => void;
  linkPages?: LinkPage[];
  /** State shown in the preview while "États et interactions" is edited. */
  previewState?: string | null;
  onPreviewState?: (state: string | null) => void;
  /** The preview click hit text that has no own element (only the container). */
  clickedText?: boolean;
  /** Shown inside the block's Style tab: no "selected element" header. */
  inline?: boolean;
  fr: boolean;
}) {
  const [lang, setLang] = useState<"fr" | "en">(fr ? "fr" : "en");
  const content = block.content;
  // Repeated items of the standard blocks: "item:2" (a card) or
  // "item:2:title" (a part of it). Styles can target one card or all cards.
  const itemMatch = element.match(/^item:(\d+)(?::([a-z]+))?$/);
  const itemIndex = itemMatch ? Number(itemMatch[1]) : -1;
  const itemPart = itemMatch?.[2] ?? null;
  const [allCards, setAllCards] = useState(false);
  const styleName =
    itemMatch && allCards ? (itemPart ? `card:${itemPart}` : "card") : element;
  const extras = readExtraElements(content);
  const location = locateExtra(extras, element);
  const extra = location?.item ?? null;
  // The free block's own area ("canvas") is a container like any other div.
  const isContainer = extra?.type === "group" || element === "canvas";
  const fields: ReturnType<typeof elementFieldKeys> = extra
    ? {
        kind:
          extra.type === "button"
            ? "button"
            : extra.type === "heading" || extra.type === "text"
              ? "text"
              : "group",
      }
    : itemMatch
      ? {
          kind:
            itemPart === null
              ? "group"
              : itemPart === "image"
                ? "group"
                : itemPart === "link"
                  ? "button"
                  : "text",
        }
      : elementFieldKeys(block.section_type, element);
  const setExtras = (next: WebsiteExtraElement[]) =>
    onChange({ ...block, content: { ...content, extras: next } });
  // An edited element is the owner's own: templates keep it from now on.
  const updateExtra = (patch: Partial<WebsiteExtraElement>) =>
    extra && setExtras(mapExtra(extras, extra.id, (item) => ({ ...item, ...patch, tpl: undefined })));
  const order = elementOrderFor(block);
  const movable = movableElement(element);
  // Inside a container, elements move among the container's elements.
  const insideContainer = Boolean(location?.parentId);
  const positions = insideContainer
    ? location!.siblings.map((item) => `x:${item.id}`)
    : order;
  const orderIndex = insideContainer ? location!.index : order.indexOf(movable);
  const moveTo = (target: number) => {
    if (orderIndex < 0 || target < 0 || target >= positions.length || target === orderIndex) return;
    if (insideContainer) {
      const siblings = [...location!.siblings];
      const [moving] = siblings.splice(orderIndex, 1);
      siblings.splice(target, 0, moving!);
      setExtras(
        mapExtra(extras, location!.parentId!, (group) => ({ ...group, children: siblings })),
      );
      return;
    }
    const next = [...order];
    const [moving] = next.splice(orderIndex, 1);
    next.splice(target, 0, moving!);
    onChange({ ...block, content: { ...content, elementOrder: next } });
  };
  const duplicateExtra = () => {
    if (!extra || !location) return;
    const currentStyles =
      content.elementStyles && typeof content.elementStyles === "object"
        ? (content.elementStyles as Record<string, unknown>)
        : {};
    const { item, styles: added } = cloneWithStyles(extra, currentStyles);
    const nextStyles = { ...currentStyles, ...added };
    if (location.parentId) {
      const siblings = [...location.siblings];
      siblings.splice(location.index + 1, 0, item);
      onChange({
        ...block,
        content: {
          ...content,
          extras: mapExtra(extras, location.parentId, (group) => ({ ...group, children: siblings })),
          elementStyles: nextStyles,
        },
      });
    } else {
      const next = [...extras];
      next.splice(location.index + 1, 0, item);
      const nextOrder = [...order];
      const at = nextOrder.indexOf(element);
      nextOrder.splice(at >= 0 ? at + 1 : nextOrder.length, 0, `x:${item.id}`);
      onChange({ ...block, content: { ...content, extras: next, elementOrder: nextOrder, elementStyles: nextStyles } });
    }
    onSelectElement(`x:${item.id}`);
  };
  /** The free block's area itself: its content goes into a container, which
   * is then duplicated, so the block holds two identical containers. */
  const duplicateCanvas = () => {
    const currentStyles =
      content.elementStyles && typeof content.elementStyles === "object"
        ? (content.elementStyles as Record<string, unknown>)
        : {};
    let source: WebsiteExtraElement;
    let baseStyles: Record<string, unknown> = currentStyles;
    if (extras.length === 1 && extras[0]!.type === "group") source = extras[0]!;
    else {
      source = { ...newExtraElement("group"), children: extras };
      if (containerLevels(source) >= MAX_CONTAINER_DEPTH) {
        toast.info(tr(fr, "Trop de conteneurs imbriqués pour dupliquer ici.", "Too many nested containers to duplicate here."));
        return;
      }
      baseStyles = { ...currentStyles, ...newElementStyles(source) };
    }
    const { item, styles: added } = cloneWithStyles(source, baseStyles);
    onChange({
      ...block,
      content: {
        ...content,
        extras: [source, item],
        elementOrder: [`x:${source.id}`, `x:${item.id}`],
        elementStyles: { ...baseStyles, ...added },
      },
    });
    onSelectElement(`x:${item.id}`);
  };
  const removeElement = async () => {
    const name = extra ? describeElement(block, element, fr) : label[fr ? 0 : 1];
    if (!await ask(tr(fr, `Supprimer « ${name} » ? Le reste du bloc est conservé.`, `Delete “${name}”? The rest of the block is kept.`)))
      return;
    const next = deleteElementFromBlock(block, element);
    if (!next) return;
    onChange(next);
    onSelectElement(null);
  };
  const styles =
    content.elementStyles && typeof content.elementStyles === "object"
      ? (content.elementStyles as Record<string, Record<string, unknown>>)
      : {};
  const baseStyle = styles[styleName] ?? {};
  const overrideOf = (device: "tablet" | "mobile") => {
    const value = baseStyle[device];
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  };
  // On tablet / phone the panel shows the inherited laptop values plus that
  // device's own adjustments; edits are stored only as adjustments.
  const style =
    breakpoint === "desktop"
      ? baseStyle
      : breakpoint === "tablet"
        ? { ...baseStyle, ...overrideOf("tablet") }
        : { ...baseStyle, ...overrideOf("tablet"), ...overrideOf("mobile") };
  const deviceOverrides = breakpoint === "desktop" ? {} : overrideOf(breakpoint);
  const setContent = (key: string, value: unknown) =>
    onChange({ ...block, content: { ...content, [key]: value } });
  const writeStyle = (nextStyle: Record<string, unknown>) => {
    const nextStyles = { ...styles, [styleName]: nextStyle };
    if (!Object.keys(nextStyle).length) delete nextStyles[styleName];
    onChange({ ...block, content: { ...content, elementStyles: nextStyles } });
  };
  const patchStyle = (patch: Record<string, unknown>) => {
    const clean = (target: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch))
        if (value === "" || value === null || value === undefined) delete target[key];
      return target;
    };
    if (breakpoint === "desktop") {
      writeStyle(clean({ ...baseStyle, ...patch }));
      return;
    }
    const nextOverride = clean({ ...deviceOverrides, ...patch });
    const nextStyle = { ...baseStyle, [breakpoint]: nextOverride };
    if (!Object.keys(nextOverride).length) delete nextStyle[breakpoint];
    writeStyle(nextStyle);
  };
  const setStyle = (key: string, value: unknown) => patchStyle({ [key]: value });
  const textKeys = lang === "fr" ? fields.fr : fields.en;
  const textKey = textKeys ? storedKey(content, textKeys) : null;
  const itemLabel = (): [string, string] => {
    const number = itemIndex + 1;
    const parts: Record<string, [string, string]> = {
      title: ["Titre", "Title"],
      body: ["Texte", "Text"],
      tag: ["Étiquette", "Tag"],
      link: ["Lien", "Link"],
      number: ["Numéro", "Number"],
      value: ["Chiffre", "Figure"],
      label: ["Libellé", "Label"],
      image: ["Image", "Image"],
      caption: ["Légende", "Caption"],
      question: ["Question", "Question"],
      answer: ["Réponse", "Answer"],
    };
    if (!itemPart) return [`Carte ${number}`, `Card ${number}`];
    const part = parts[itemPart] ?? [itemPart, itemPart];
    return [`${part[0]} · carte ${number}`, `${part[1]} · card ${number}`];
  };
  const label = extra
    ? (extraTypeLabels[extra.type] ?? [extra.type, extra.type])
    : element === "canvas" && isDivBlock(block)
      ? (["Div", "Div"] as [string, string])
    : itemMatch
      ? itemLabel()
      : (elementLabels[element] ?? [element, element]);
  return (
    <div className="space-y-4">
      {inline ? null : (
      <>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-brand"
      >
        <ChevronUp className="size-3.5 -rotate-90" />
        {tr(fr, "Tout le bloc", "Whole block")} · {blockLabel(block, fr)}
      </button>
      <div className="rounded-xl border border-sky-500/40 bg-sky-500/[.06] px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-600">
          {tr(fr, "Élément sélectionné", "Selected element")}
        </p>
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{label[fr ? 0 : 1]}</p>
          {extra ? (
            <Button size="icon-sm" variant="ghost" onClick={duplicateExtra} title={tr(fr, "Dupliquer l’élément", "Duplicate element")} aria-label={tr(fr, "Dupliquer l’élément", "Duplicate element")}>
              <Copy />
            </Button>
          ) : element !== "canvas" && element !== "root" && duplicateInBlock(block, element) ? (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                const result = duplicateInBlock(block, element);
                if (!result) return;
                onChange(result.block);
                onSelectElement(result.element);
              }}
              title={tr(fr, "Dupliquer l’élément", "Duplicate element")}
              aria-label={tr(fr, "Dupliquer l’élément", "Duplicate element")}
            >
              <Copy />
            </Button>
          ) : element === "canvas" && extras.length && !isDivBlock(block) ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={duplicateCanvas}
              title={tr(fr, "Met le contenu dans un conteneur et ajoute une copie à côté", "Puts the content in a container and adds a copy next to it")}
            >
              <Copy />
              {tr(fr, "Dupliquer le contenu", "Duplicate content")}
            </Button>
          ) : null}
          {canDeleteElement(element) ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600 hover:text-red-700"
              onClick={removeElement}
              title={tr(fr, "Supprimer seulement cet élément", "Delete only this element")}
            >
              <Trash2 />
              {tr(fr, "Supprimer", "Delete")}
            </Button>
          ) : null}
        </div>
      </div>
      </>
      )}
      {(() => {
        // One "Réglages du carrousel" panel, for the carousel itself and for
        // any slide (or element inside a slide) selected in the preview.
        const chain = extraChain(extras, element);
        const sliderIndex = chain.map((item) => item.type).lastIndexOf("slider");
        if (sliderIndex < 0) return null;
        const slider = chain[sliderIndex]!;
        const children = slider.children ?? [];
        const selectedSlide = chain[sliderIndex + 1]?.id;
        const writeSlides = (next: WebsiteExtraElement[], patch: Record<string, unknown> = {}, removeStyles: string[] = []) => {
          const nextStyles = { ...styles, ...patch };
          for (const key of removeStyles) delete nextStyles[key];
          onChange({
            ...block,
            content: {
              ...content,
              extras: mapExtra(extras, slider.id, (item) => ({ ...item, children: next })),
              elementStyles: nextStyles,
            },
          });
        };
        const textOf = (item: WebsiteExtraElement): string =>
          item.textFr?.trim() || (item.children ?? []).map(textOf).find(Boolean) || "";
        return (
          <CarouselSettingsPanel
            key={slider.id}
            value={slider.slider ?? {}}
            onChange={(settings) =>
              onChange({
                ...block,
                content: { ...content, extras: mapExtra(extras, slider.id, (item) => ({ ...item, slider: settings })) },
              })
            }
            slides={children.map((child, index) => textOf(child).slice(0, 40) || `${tr(fr, "Diapositive", "Slide")} ${index + 1}`)}
            selected={children.findIndex((child) => child.id === selectedSlide)}
            onSelect={(index) => onSelectElement(`x:${children[index]!.id}`)}
            onAdd={() => {
              const card = newSlideCard(children.length + 1);
              writeSlides([...children, card], slideCardStyles(card));
              onSelectElement(`x:${card.id}`);
            }}
            onDuplicate={(index) => {
              const { item, styles: added } = cloneWithStyles(children[index]!, styles);
              const next = [...children];
              next.splice(index + 1, 0, item);
              writeSlides(next, added);
              onSelectElement(`x:${item.id}`);
            }}
            onRemove={(index) => {
              const removed = children[index]!;
              const keys: string[] = [];
              const collect = (item: WebsiteExtraElement) => {
                keys.push(`x:${item.id}`);
                (item.children ?? []).forEach(collect);
              };
              collect(removed);
              writeSlides(children.filter((_child, position) => position !== index), {}, keys);
              onSelectElement(`x:${slider.id}`);
            }}
            onMove={(from, to) => {
              const next = [...children];
              const [moving] = next.splice(from, 1);
              next.splice(to, 0, moving!);
              writeSlides(next);
            }}
            defaultOpen={sliderIndex === chain.length - 1}
            fr={fr}
          />
        );
      })()}
      {extra && ["group", "text", "heading", "image", "button"].includes(extra.type) ? (
        <LinkFields
          value={extra.link}
          onChange={(next) => updateExtra({ link: next as WebsiteExtraElement["link"] })}
          pages={linkPages}
          orgSlug={orgSlug}
          subject={
            extra.type === "group"
              ? tr(fr, "ce conteneur", "this container")
              : extra.type === "button"
                ? tr(fr, "ce bouton (remplace le lien simple ci-dessous)", "this button (replaces the simple link below)")
              : extra.type === "image"
                ? tr(fr, "cette image", "this image")
                : tr(fr, "ce texte", "this text")
          }
          fr={fr}
        />
      ) : null}
      {element === "canvas" && isDivBlock(block) ? (
        <LinkFields
          value={content.blockLink}
          onChange={(next) => setContent("blockLink", next)}
          pages={linkPages}
          orgSlug={orgSlug}
          subject={tr(fr, "ce div", "this div")}
          fr={fr}
        />
      ) : null}
      {element === "canvas" && block.section_type === "container" && !isDivBlock(block) && !block.id.startsWith("zone-") ? (
        <div className="space-y-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-400/10 dark:text-amber-100">
          <p className="font-semibold">{tr(fr, "Ancien format : une bande et une zone intérieure", "Old format: a band and an inner zone")}</p>
          <p className="leading-5">
            {tr(
              fr,
              "Ce bloc a deux boîtes : la bande extérieure (fond du bloc) et cette zone intérieure. Convertissez-le en un seul div : fond, taille, padding et marges s’appliqueront à la même boîte. Le contenu est conservé.",
              "This block has two boxes: the outer band (block background) and this inner zone. Convert it to one single div: background, size, padding and margins will apply to the same box. Content is kept.",
            )}
          </p>
          <Button size="sm" variant="secondary" onClick={() => onChange(convertToDivBlock(block))}>
            {tr(fr, "Convertir en un seul div", "Convert to one single div")}
          </Button>
        </div>
      ) : null}
      {!extra && ["eyebrow", "title", "body", "sideText"].includes(element) ? (
        <LinkFields
          value={
            content.elementLinks && typeof content.elementLinks === "object"
              ? (content.elementLinks as Record<string, unknown>)[element]
              : undefined
          }
          onChange={(next) => {
            const links = {
              ...((content.elementLinks as Record<string, unknown> | undefined) ?? {}),
            };
            if (next) links[element] = next;
            else delete links[element];
            setContent("elementLinks", Object.keys(links).length ? links : undefined);
          }}
          pages={linkPages}
          orgSlug={orgSlug}
          subject={tr(fr, "ce texte", "this text")}
          fr={fr}
        />
      ) : null}
      {itemMatch && !itemPart && ["feature_grid", "metrics", "gallery"].includes(block.section_type) ? (
        <LinkFields
          value={
            Array.isArray(content.items)
              ? ((content.items as Record<string, unknown>[])[itemIndex]?.link as unknown)
              : undefined
          }
          onChange={(next) => {
            const items = Array.isArray(content.items) ? [...(content.items as Record<string, unknown>[])] : [];
            const current = items[itemIndex];
            if (!current) return;
            const updated = { ...current };
            if (next) updated.link = next;
            else delete updated.link;
            items[itemIndex] = updated;
            setContent("items", items);
          }}
          pages={linkPages}
          orgSlug={orgSlug}
          subject={tr(fr, "cette carte", "this card")}
          fr={fr}
        />
      ) : null}
      {isContainer && !inline ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5 text-ink-secondary">
          {tr(
            fr,
            "Conteneur sélectionné : les éléments ajoutés avec la barre du haut iront à l’intérieur. Cliquez sur un élément du conteneur pour le modifier.",
            "Container selected: elements added from the bar above go inside it. Click an element in the container to edit it.",
          )}
        </p>
      ) : null}
      {extra && !isContainer ? (
        <section className="space-y-3">
          {extra.type !== "spacer" && extra.type !== "image" ? (
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {tr(fr, "Contenu", "Content")}
              </span>
              <div className="flex rounded-md border border-border p-0.5">
                {(["fr", "en"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLang(value)}
                    className={`rounded px-2.5 py-0.5 text-xs font-bold uppercase transition ${
                      lang === value ? "bg-brand text-brand-ink" : "text-ink-secondary"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {extra.type === "heading" || extra.type === "text" ? (
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-ink-secondary">
                {tr(fr, "Balise (SEO) — le style ne change pas", "Tag (SEO) — the look does not change")}
              </span>
              <Segmented
                value={extra.tag ?? (extra.type === "heading" ? "h3" : "p")}
                onChange={(value) => updateExtra({ tag: value })}
                options={["h1", "h2", "h3", "h4", "h5", "h6", "p"].map((tag) => [tag, tag === "p" ? tr(fr, "Paragraphe", "Paragraph") : tag.toUpperCase()] as const)}
              />
            </div>
          ) : null}
          {extra.type === "text" ? (
            <Textarea
              rows={5}
              value={(lang === "fr" ? extra.textFr : extra.textEn) ?? ""}
              onChange={(event) => updateExtra(lang === "fr" ? { textFr: event.target.value } : { textEn: event.target.value })}
            />
          ) : extra.type === "heading" || extra.type === "button" ? (
            <Input
              value={(lang === "fr" ? extra.textFr : extra.textEn) ?? ""}
              onChange={(event) => updateExtra(lang === "fr" ? { textFr: event.target.value } : { textEn: event.target.value })}
            />
          ) : null}
          {extra.type === "button" ? (
            <>
              <Field label={tr(fr, "Lien du bouton", "Button link")}>
                <Input placeholder="/contact" value={extra.href ?? ""} onChange={(event) => updateExtra({ href: event.target.value })} />
              </Field>
              <div className="flex gap-1.5">
                {(
                  [
                    ["primary", tr(fr, "Plein", "Filled")],
                    ["secondary", tr(fr, "Contour", "Outline")],
                  ] as const
                ).map(([value, name]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateExtra({ variant: value })}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold ${
                      (extra.variant ?? "primary") === value ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {extra.type === "image" ? (
            <>
              <WebsiteImagePicker
                orgSlug={orgSlug}
                value={extra.imageUrl ?? ""}
                onChange={(url) => updateExtra({ imageUrl: url })}
                fr={fr}
                label={tr(fr, "Image", "Image")}
              />
              <Field label={tr(fr, "Description de l’image (accessibilité)", "Image description (accessibility)")}>
                <Input value={extra.textFr ?? ""} onChange={(event) => updateExtra({ textFr: event.target.value })} />
              </Field>
            </>
          ) : null}
          {ZONE_ELEMENT_TYPES.includes(extra.type) ? (
            <ZoneElementFields
              extra={extra}
              update={(patch) => updateExtra(patch)}
              lang={lang}
              pages={linkPages ?? []}
              orgSlug={orgSlug}
              fr={fr}
            />
          ) : null}
        </section>
      ) : null}

      {itemMatch && content.itemsLayout === "carousel" ? (
        <ItemsCarouselPanel block={block} onChange={onChange} onSelectElement={onSelectElement} selected={itemIndex} defaultOpen={false} fr={fr} />
      ) : null}
      {itemMatch ? (
        <ItemContentFields
          orgSlug={orgSlug}
          block={block}
          index={itemIndex}
          part={itemPart}
          onChange={onChange}
          onSelectElement={onSelectElement}
          fr={fr}
        />
      ) : null}
      {element === "items" && ["feature_grid", "gallery", "metrics"].includes(block.section_type) ? (
        <section className="space-y-3 rounded-xl border border-border p-3">
          <p className="text-sm font-semibold text-ink">
            {tr(fr, "Affichage des cartes", "Card display")}
          </p>
          <Segmented
            value={content.itemsLayout === "carousel" ? "carousel" : "grid"}
            onChange={(value) => setContent("itemsLayout", value === "carousel" ? "carousel" : undefined)}
            options={[
              ["grid", tr(fr, "Grille", "Grid")],
              ["carousel", tr(fr, "Carrousel", "Carousel")],
            ]}
          />
          <p className="text-[11px] text-ink-muted">
            {tr(
              fr,
              "Par défaut ce bloc est une grille (toutes les cartes visibles). En carrousel, les cartes défilent avec flèches et points.",
              "By default this block is a grid (all cards visible). As a carousel, cards scroll with arrows and dots.",
            )}
          </p>
          {content.itemsLayout === "carousel" ? (
            <ItemsCarouselPanel block={block} onChange={onChange} onSelectElement={onSelectElement} selected={-1} defaultOpen fr={fr} />
          ) : null}
        </section>
      ) : null}
      {!extra && !itemMatch && (fields.kind === "text" || fields.kind === "button" || fields.kind === "badges") ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              {tr(fr, "Contenu", "Content")}
            </span>
            <div className="flex rounded-md border border-border p-0.5">
              {(["fr", "en"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLang(value)}
                  className={`rounded px-2.5 py-0.5 text-xs font-bold uppercase transition ${
                    lang === value ? "bg-brand text-brand-ink" : "text-ink-secondary"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          {textKey ? (
            element === "body" ? (
              <Textarea
                rows={6}
                value={String(content[textKey] ?? "")}
                onChange={(event) => setContent(textKey, event.target.value)}
              />
            ) : (
              <Input
                value={String(content[textKey] ?? "")}
                onChange={(event) => setContent(textKey, event.target.value)}
              />
            )
          ) : null}
          {fields.href ? (
            <Field label={tr(fr, "Lien du bouton", "Button link")}>
              <Input
                placeholder="/contact"
                value={String(content[storedKey(content, fields.href)] ?? "")}
                onChange={(event) =>
                  setContent(storedKey(content, fields.href!), event.target.value)
                }
              />
            </Field>
          ) : null}
          {fields.kind === "badges"
            ? heroBadgeDefaults.map(([key, defaultFr, defaultEn], index) => {
                const contentKey = `${key}${lang === "fr" ? "Fr" : "En"}`;
                const stored = content[contentKey];
                return (
                  <Field key={key} label={`${tr(fr, "Point", "Item")} ${index + 1}`}>
                    <Input
                      value={
                        typeof stored === "string"
                          ? stored
                          : lang === "fr"
                            ? defaultFr
                            : defaultEn
                      }
                      onChange={(event) => setContent(contentKey, event.target.value)}
                    />
                  </Field>
                );
              })
            : null}
        </section>
      ) : null}

      {orderIndex >= 0 ? (
        <section className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {insideContainer
              ? tr(fr, "Place dans le conteneur", "Place in the container")
              : tr(fr, "Place dans le bloc", "Place in the block")}
          </span>
          {movable !== element ? (
            <p className="text-xs text-ink-muted">
              {tr(fr, "Les boutons se déplacent avec leur rangée.", "Buttons move together with their row.")}
            </p>
          ) : null}
          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                [0, ChevronsUp, tr(fr, "Tout en haut", "To top")],
                [orderIndex - 1, ChevronUp, tr(fr, "Monter", "Up")],
                [orderIndex + 1, ChevronDown, tr(fr, "Descendre", "Down")],
                [positions.length - 1, ChevronsDown, tr(fr, "Tout en bas", "To bottom")],
              ] as const
            ).map(([target, Icon, name]) => (
              <button
                key={name}
                type="button"
                disabled={target < 0 || target >= positions.length || target === orderIndex}
                onClick={() => moveTo(target)}
                className="flex flex-col items-center gap-0.5 rounded-md border border-border bg-surface-1 px-1 py-1.5 text-[10px] font-medium text-ink-secondary transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-border disabled:hover:text-ink-secondary"
              >
                <Icon className="size-4" />
                {name}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-muted">
            {insideContainer ? tr(fr, "Dans le conteneur · ", "In the container · ") : ""}
            {tr(fr, "Position", "Position")} {orderIndex + 1} / {positions.length}
          </p>
          {extra ? (
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-ink-muted">
                {tr(fr, "Déplacer dans un autre conteneur", "Move into another container")}
              </span>
              <select
                value=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  const next = moveExtraInBlock(block, element, { element: value, where: "inside" });
                  if (next) onChange(next);
                  else
                    toast.info(
                      tr(fr, "Impossible de le placer là (trop de conteneurs imbriqués).", "It can’t go there (too many nested containers)."),
                    );
                }}
                className="h-9 w-full rounded-md border border-border bg-surface-1 px-2 text-sm text-ink"
              >
                <option value="">{tr(fr, "Choisir une destination…", "Choose a destination…")}</option>
                {insideContainer ? (
                  <option value="canvas">
                    {block.section_type === "container"
                      ? tr(fr, "Zone principale du bloc libre", "Main area of the free block")
                      : tr(fr, "Niveau principal du bloc", "Top level of the block")}
                  </option>
                ) : null}
                {moveDestinations(block, element, fr)
                  .filter(([value]) => value !== (location?.parentId ? `x:${location.parentId}` : ""))
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
              <span className="block text-[11px] text-ink-muted">
                {tr(
                  fr,
                  "Ou glissez-le dans la colonne Structure : dedans, avant ou après un autre élément.",
                  "Or drag it in the Structure column: inside, before or after another element.",
                )}
              </span>
            </label>
          ) : null}
        </section>
      ) : null}

      {itemMatch ? (
        <label className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/[.05] px-3 py-2 text-xs text-ink">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={allCards}
            onChange={(event) => setAllCards(event.target.checked)}
          />
          <span>
            <strong>{tr(fr, "Appliquer le style à toutes les cartes", "Apply the style to all cards")}</strong>
            <br />
            <span className="text-ink-muted">
              {tr(
                fr,
                "Coché : vos réglages s’appliquent au même élément de chaque carte. Décoché : seulement à celle-ci (prioritaire).",
                "Checked: settings apply to the same element in every card. Unchecked: only this one (takes priority).",
              )}
            </span>
          </span>
        </label>
      ) : null}
      <StyleInspector
        orgSlug={orgSlug}
        style={style}
        setStyle={setStyle}
        patchStyle={patchStyle}
        kind={
          isContainer || (itemMatch && !itemPart) || element === "panel" || element === "items" || element === "sideCard" || element === "root"
            ? "container"
            : extra && extra.type !== "image" && fields.kind === "group"
              ? "box"
            : fields.kind === "group"
              ? "media"
              : fields.kind
        }
        element={element}
        clickedText={clickedText}
        breakpoint={breakpoint}
        onReplay={onReplay}
        overrideCount={Object.keys(deviceOverrides).length}
        onReset={
          breakpoint !== "desktop"
            ? Object.keys(deviceOverrides).length
              ? () => {
                  const nextStyle = { ...baseStyle };
                  delete nextStyle[breakpoint];
                  writeStyle(nextStyle);
                }
              : undefined
            : Object.keys(baseStyle).length
              ? () => {
                  const nextStyles = { ...styles };
                  delete nextStyles[styleName];
                  onChange({ ...block, content: { ...content, elementStyles: nextStyles } });
                }
              : undefined
        }
        fr={fr}
      />
      <StatesPanel
        orgSlug={orgSlug}
        style={baseStyle}
        onChange={writeStyle}
        state={previewState}
        onState={(next) => onPreviewState?.(next)}
        canDisable={extra?.type === "button" || element === "primaryButton" || element === "secondaryButton"}
        fr={fr}
      />
    </div>
  );
}

function NumberBox({
  label,
  value,
  onChange,
  max = 240,
}: {
  label: string;
  value: unknown;
  onChange: (value: number | undefined) => void;
  max?: number;
}) {
  const number = Number(value);
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">
      {label}
      <input
        type="number"
        min={0}
        max={max}
        placeholder="auto"
        value={value === undefined || value === "" || !Number.isFinite(number) ? "" : number}
        onChange={(event) =>
          onChange(
            event.target.value === ""
              ? undefined
              : Math.min(max, Math.max(0, Number(event.target.value))),
          )
        }
        className="h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-sm text-ink tabular-nums"
      />
    </label>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Style inspector: every CSS setting a div / element needs, grouped in
 * collapsible sections so the panel stays readable. Values are validated
 * again by the public renderer (website-element-style.ts).
 * ──────────────────────────────────────────────────────────────────────── */

type InspectorKind = "container" | "text" | "button" | "badges" | "media" | "box";
type SetStyle = (key: string, value: unknown) => void;

const STYLE_SUBJECTS: Record<InspectorKind, { fr: string; en: string; frameFr: string; frameEn: string; tone: string }> = {
  container: { fr: "Style du conteneur", en: "Container style", frameFr: "", frameEn: "", tone: "bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200" },
  text: { fr: "Style du texte", en: "Text style", frameFr: "Cadre autour du texte", frameEn: "Frame around the text", tone: "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200" },
  badges: { fr: "Style du texte", en: "Text style", frameFr: "Cadre autour du texte", frameEn: "Frame around the text", tone: "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200" },
  button: { fr: "Style du bouton", en: "Button style", frameFr: "Le bouton lui-même (fond, bordure, taille)", frameEn: "The button itself (background, border, size)", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200" },
  box: { fr: "Style de l’élément (div)", en: "Element style (div)", frameFr: "Taille, espace et cadre", frameEn: "Size, spacing and frame", tone: "bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200" },
  media: { fr: "Style de l’image", en: "Image style", frameFr: "L’image elle-même (taille, bordure, ombre)", frameEn: "The image itself (size, border, shadow)", tone: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200" },
};

/** A heading that splits the inspector into "the content" and "the box around it". */
function StyleGroup({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="pt-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">{title}</p>
      {hint ? <p className="text-[11px] leading-4 text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function InspectorSection({
  title,
  defaultOpen = false,
  active = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group/insp rounded-xl border border-border bg-surface-1">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          {title}
          {active ? <span className="size-1.5 rounded-full bg-brand" title="modifié" /> : null}
        </span>
        <ChevronDown className="size-4 text-ink-muted transition group-open/insp:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">{children}</div>
    </details>
  );
}

function InspectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-ink-muted">{label}</p>
      {children}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: unknown;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([option, name]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(value === option ? undefined : option)}
          className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
            value === option
              ? "border-brand bg-brand/10 text-brand"
              : "border-border text-ink-secondary hover:text-ink"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function NumInput({
  label,
  value,
  onChange,
  min = 0,
  max = 400,
  step = 1,
  placeholder = "auto",
}: {
  label?: string;
  value: unknown;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  const number = Number(value);
  const shown = value === undefined || value === "" || !Number.isFinite(number) ? "" : number;
  const input = (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={shown}
      onChange={(event) =>
        onChange(
          event.target.value === ""
            ? undefined
            : Math.min(max, Math.max(min, Number(event.target.value))),
        )
      }
      className="h-8 w-full min-w-0 rounded-md border border-border bg-surface-1 px-2 text-sm text-ink tabular-nums"
    />
  );
  return label ? (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-ink-muted">
      {label}
      {input}
    </label>
  ) : (
    input
  );
}

/** A CSS length: auto, or a number with px / % / rem / vh / vw. */
function LengthInput({
  label,
  value,
  onChange,
  allowNegative = false,
  allowNone = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: string | undefined) => void;
  allowNegative?: boolean;
  allowNone?: boolean;
}) {
  const raw = typeof value === "string" ? value : "";
  const match = raw.match(/^(-?\d+(?:\.\d+)?)(px|%|rem|vh|vw)$/);
  const [unit, setUnit] = useState<string>(match?.[2] ?? "px");
  const mode = raw === "auto" ? "auto" : raw === "none" ? "none" : match ? "value" : "";
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-ink-muted">
      {label}
      <div className="flex min-w-0">
        <input
          type="number"
          step="any"
          placeholder={mode === "auto" ? "auto" : mode === "none" ? "aucune" : "—"}
          value={match ? match[1] : ""}
          onChange={(event) => {
            const text = event.target.value;
            if (text === "") return onChange(undefined);
            let number = Number(text);
            if (!Number.isFinite(number)) return;
            if (!allowNegative) number = Math.max(0, number);
            onChange(`${Math.min(9999, Math.max(-9999, number))}${unit}`);
          }}
          className="h-8 w-full min-w-0 rounded-l-md border border-border bg-surface-1 px-2 text-sm text-ink tabular-nums"
        />
        <select
          value={mode === "auto" ? "auto" : mode === "none" ? "none" : unit}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "auto" || next === "none") return onChange(next);
            setUnit(next);
            if (match) onChange(`${match[1]}${next}`);
            else if (mode) onChange(undefined);
          }}
          className="h-8 rounded-r-md border border-l-0 border-border bg-surface-2 px-1 text-xs text-ink"
        >
          {["px", "%", "rem", "vh", "vw"].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          <option value="auto">auto</option>
          {allowNone ? <option value="none">aucune</option> : null}
        </select>
      </div>
    </label>
  );
}

/**
 * A value with its unit, chosen from a closed list (px, %, rem, vw, vh, and
 * "auto" only where CSS allows it). Pixels are stored as plain numbers, as
 * before, so historical values (28 = 28px) render exactly the same.
 */
function UnitInput({
  label,
  value,
  onChange,
  allowAuto = false,
  allowNegative = false,
  units = ["px", "%", "rem", "vw", "vh"],
  placeholder = "—",
}: {
  label: string;
  value: unknown;
  onChange: (value: number | string | undefined) => void;
  allowAuto?: boolean;
  allowNegative?: boolean;
  units?: string[];
  placeholder?: string;
}) {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? { number: value, unit: "px" }
      : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)
        ? { number: Number(value), unit: "px" }
        : typeof value === "string"
          ? (() => {
              const match = value.match(/^(-?\d+(?:\.\d+)?)(px|%|rem|vh|vw)$/);
              return match ? { number: Number(match[1]), unit: match[2]! } : null;
            })()
          : null;
  const isAuto = value === "auto";
  const [unit, setUnit] = useState<string>(parsed?.unit ?? units[0] ?? "px");
  const emit = (number: number, nextUnit: string) => {
    let clean = Math.min(9999, Math.max(allowNegative ? -9999 : 0, number));
    clean = Math.round(clean * 100) / 100;
    onChange(nextUnit === "px" ? clean : `${clean}${nextUnit}`);
  };
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-ink-muted">
      {label}
      <div className="flex min-w-0">
        <input
          type="number"
          step="any"
          placeholder={isAuto ? "auto" : placeholder}
          value={parsed ? parsed.number : ""}
          onChange={(event) => {
            const text = event.target.value;
            if (text === "") return onChange(undefined);
            const number = Number(text);
            if (Number.isFinite(number)) emit(number, unit === "auto" ? "px" : unit);
          }}
          className="h-8 w-full min-w-0 rounded-l-md border border-border bg-surface-1 px-1.5 text-sm text-ink tabular-nums"
        />
        <select
          aria-label={tr(true, "Unité", "Unit")}
          value={isAuto ? "auto" : parsed?.unit ?? unit}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "auto") return onChange("auto");
            setUnit(next);
            if (parsed) emit(parsed.number, next);
            else if (isAuto) onChange(undefined);
          }}
          className="h-8 rounded-r-md border border-l-0 border-border bg-surface-2 px-0.5 text-[11px] font-semibold text-ink"
        >
          {units.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          {allowAuto ? <option value="auto">auto</option> : null}
        </select>
      </div>
    </label>
  );
}

/** Four sides (top, right, bottom, left) with a "link values" switch. */
function SidesInput({
  label,
  prefix,
  style,
  patchStyle,
  min = 0,
  fr,
}: {
  label: string;
  prefix: "margin" | "padding";
  style: Record<string, unknown>;
  patchStyle: (patch: Record<string, unknown>) => void;
  min?: number;
  fr: boolean;
}) {
  const sides = ["Top", "Right", "Bottom", "Left"] as const;
  const values = sides.map((side) => style[`${prefix}${side}`]);
  const [linked, setLinked] = useState(
    values.every((value) => value === values[0]) && values[0] !== undefined,
  );
  const names = {
    Top: tr(fr, "Haut", "Top"),
    Right: tr(fr, "Droite", "Right"),
    Bottom: tr(fr, "Bas", "Bottom"),
    Left: tr(fr, "Gauche", "Left"),
  };
  const set = (side: (typeof sides)[number], value: number | string | undefined) =>
    patchStyle(
      linked
        ? Object.fromEntries(sides.map((key) => [`${prefix}${key}`, value]))
        : { [`${prefix}${side}`]: value },
    );
  return (
    <InspectorRow label={label}>
      <div className="flex items-end gap-1.5">
        <div className="grid flex-1 grid-cols-4 gap-1.5">
          {sides.map((side) => (
            <UnitInput
              key={side}
              label={names[side]}
              value={style[`${prefix}${side}`]}
              allowAuto={prefix === "margin"}
              allowNegative={prefix === "margin" && min < 0}
              onChange={(value) => set(side, value)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLinked((value) => !value)}
          title={tr(fr, "Lier les quatre valeurs", "Link the four values")}
          aria-pressed={linked}
          className={`grid size-8 shrink-0 place-items-center rounded-md border transition ${
            linked ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-muted"
          }`}
        >
          {linked ? <Link2 className="size-4" /> : <Unlink2 className="size-4" />}
        </button>
      </div>
      {prefix === "margin" ? (
        <button
          type="button"
          className="text-[11px] text-ink-muted hover:text-brand"
          onClick={() => patchStyle({ marginLeft: "auto", marginRight: "auto" })}
        >
          {tr(fr, "Centrer horizontalement (marges auto)", "Centre horizontally (auto margins)")}
        </button>
      ) : null}
    </InspectorRow>
  );
}

function StyleInspector({
  orgSlug,
  style,
  setStyle,
  patchStyle,
  kind,
  element,
  onReset,
  breakpoint = "desktop",
  overrideCount = 0,
  onReplay,
  clickedText = false,
  fr,
}: {
  orgSlug: string;
  style: Record<string, unknown>;
  setStyle: SetStyle;
  patchStyle: (patch: Record<string, unknown>) => void;
  kind: InspectorKind;
  element: string;
  onReset?: () => void;
  breakpoint?: Breakpoint;
  overrideCount?: number;
  onReplay?: () => void;
  clickedText?: boolean;
  fr: boolean;
}) {
  const isContainer = kind === "container";
  const subject = STYLE_SUBJECTS[kind];
  const hasText = kind !== "media" && kind !== "box";
  // A text is a text: only text CSS (font, size, colour, alignment) and its
  // place in the div. Box CSS (size, background, border, padding, shadow)
  // belongs to divs, so a text never looks like a box of its own.
  const textOnly = kind === "text" || kind === "badges";
  const BOX_KEYS = [
    "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "background", "gradientFrom", "gradientTo", "gradientAngle", "backgroundImage", "overlayColor", "overlayOpacity",
    "borderWidth", "borderStyle", "borderColor", "radius", "radiusTopLeft", "radiusTopRight", "radiusBottomRight", "radiusBottomLeft",
    "shadow", "position", "top", "right", "bottom", "left", "zIndex",
  ];
  const boxKeysUsed = textOnly ? BOX_KEYS.filter((key) => style[key] !== undefined) : [];
  const display = (style.display as string | undefined) ?? (isContainer && element !== "root" ? "flex" : undefined);
  const used = (...keys: string[]) => keys.some((key) => style[key] !== undefined);
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${subject.tone}`}>
          {tr(fr, subject.fr, subject.en)}
        </span>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-brand"
          >
            <RotateCcw className="size-3" />
            {breakpoint === "desktop"
              ? tr(fr, "Tout réinitialiser", "Reset all")
              : tr(fr, "Effacer les ajustements de cet appareil", "Clear this device’s adjustments")}
          </button>
        ) : null}
      </div>
      {breakpoint === "desktop" ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-5 text-ink-secondary">
          {tr(
            fr,
            "Réglages ordinateur. Tablette et téléphone s’adaptent automatiquement (colonnes empilées, espacements et textes réduits, rien ne dépasse). Choisissez Tablette ou Mobile en haut pour un ajustement facultatif.",
            "Laptop settings. Tablet and phone adapt automatically (stacked columns, smaller spacing and text, nothing overflows). Pick Tablet or Mobile at the top for an optional adjustment.",
          )}
        </p>
      ) : (
        <p className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-950 dark:bg-amber-400/10 dark:text-amber-100">
          {breakpoint === "tablet"
            ? tr(fr, "Ajustement Tablette (≤ 1024 px) : ", "Tablet adjustment (≤ 1024 px): ")
            : tr(fr, "Ajustement Mobile (≤ 640 px) : ", "Phone adjustment (≤ 640 px): ")}
          {tr(
            fr,
            "les valeurs affichées viennent de l’ordinateur ; ce que vous changez ici ne s’applique qu’à cet appareil, en plus de l’adaptation automatique.",
            "values shown come from the laptop design; what you change here applies only to this device, on top of the automatic adaptation.",
          )}
          {overrideCount ? ` (${overrideCount} ${tr(fr, "ajustement(s)", "adjustment(s)")})` : ""}
        </p>
      )}

      {isContainer && clickedText ? (
        <div role="note" className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-[11px] leading-5 text-violet-950 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-100">
          <strong>{tr(fr, "Vous avez cliqué sur un texte de ce conteneur.", "You clicked a text inside this container.")}</strong>{" "}
          {tr(
            fr,
            "Ce texte n’a pas de réglages à lui : Disposition, Espacement, Fond et Bordure changent tout le conteneur. Pour la police, la taille ou la couleur du texte, utilisez « Texte à l’intérieur » (ouvert ci-dessous) : il s’applique à tous les textes de ce conteneur.",
            "This text has no settings of its own: Layout, Spacing, Background and Border change the whole container. For the text font, size or colour use “Text inside” (open below): it applies to every text in this container.",
          )}
        </div>
      ) : null}

      {isContainer ? <StyleGroup title={tr(fr, "Disposition du conteneur", "Container layout")} /> : null}

      {isContainer ? (
        <InspectorSection
          title={tr(fr, "Disposition", "Layout")}
          defaultOpen
          active={used("display", "direction", "wrap", "justify", "alignItems", "alignContent")}
        >
          <InspectorRow label={tr(fr, "Affichage", "Display")}>
            <Segmented
              value={style.display}
              onChange={(value) => setStyle("display", value)}
              options={[
                ["block", tr(fr, "Bloc", "Block")],
                ["flex", "Flexbox"],
                ["grid", tr(fr, "Grille", "Grid")],
              ]}
            />
          </InspectorRow>
          {display === "flex" ? (
            <>
              <InspectorRow label={tr(fr, "Direction", "Direction")}>
                <Segmented
                  value={style.direction}
                  onChange={(value) => setStyle("direction", value)}
                  options={[
                    ["row", tr(fr, "Ligne →", "Row →")],
                    ["column", tr(fr, "Colonne ↓", "Column ↓")],
                    ["row-reverse", tr(fr, "Ligne ←", "Row ←")],
                    ["column-reverse", tr(fr, "Colonne ↑", "Column ↑")],
                  ]}
                />
              </InspectorRow>
              <label className="flex items-center gap-2 text-xs text-ink-secondary">
                <input
                  type="checkbox"
                  checked={style.wrap !== false}
                  onChange={(event) => setStyle("wrap", event.target.checked ? undefined : false)}
                />
                {tr(fr, "Retour à la ligne (wrap)", "Wrap items")}
              </label>
              {style.wrap === false ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  {tr(
                    fr,
                    "Sans retour à la ligne, le contenu peut dépasser sur ordinateur si la place manque. Sur tablette et mobile, le retour à la ligne est rétabli automatiquement.",
                    "Without wrapping, content may overflow on desktop when space runs out. On tablet and phone, wrapping is restored automatically.",
                  )}
                </p>
              ) : null}
            </>
          ) : null}
          {display === "flex" || display === "grid" ? (
            <>
              <InspectorRow label={tr(fr, "Répartition (justify-content)", "Distribution (justify-content)")}>
                <Segmented
                  value={style.justify}
                  onChange={(value) => setStyle("justify", value)}
                  options={[
                    ["start", tr(fr, "Début", "Start")],
                    ["center", tr(fr, "Centre", "Centre")],
                    ["end", tr(fr, "Fin", "End")],
                    ["between", "between"],
                    ["around", "around"],
                    ["evenly", "evenly"],
                  ]}
                />
              </InspectorRow>
              <InspectorRow label={tr(fr, "Alignement (align-items)", "Alignment (align-items)")}>
                <Segmented
                  value={style.alignItems}
                  onChange={(value) => setStyle("alignItems", value)}
                  options={[
                    ["start", tr(fr, "Début", "Start")],
                    ["center", tr(fr, "Centre", "Centre")],
                    ["end", tr(fr, "Fin", "End")],
                    ["stretch", tr(fr, "Étiré", "Stretch")],
                  ]}
                />
              </InspectorRow>
              <div className="grid grid-cols-3 gap-1.5">
                <UnitInput label="Gap" value={style.gap} onChange={(value) => setStyle("gap", value)} />
                <UnitInput label={tr(fr, "Gap lignes", "Row gap")} value={style.rowGap} onChange={(value) => setStyle("rowGap", value)} />
                <UnitInput label={tr(fr, "Gap colonnes", "Column gap")} value={style.columnGap} onChange={(value) => setStyle("columnGap", value)} />
              </div>
            </>
          ) : null}
        </InspectorSection>
      ) : null}

      {isContainer && display === "grid" ? (
        <InspectorSection
          title={tr(fr, "Grille", "Grid")}
          defaultOpen
          active={used("gridColumns", "gridColumnWidth", "gridColumnsMobile")}
        >
          <div className="grid grid-cols-3 gap-1.5">
            <NumInput
              label={tr(fr, "Colonnes", "Columns")}
              value={style.gridColumns}
              min={1}
              max={12}
              placeholder="1"
              onChange={(value) => setStyle("gridColumns", value)}
            />
            <NumInput
              label={tr(fr, "Colonnes tablette", "Tablet columns")}
              value={style.gridColumnsTablet}
              min={1}
              max={12}
              placeholder="auto"
              onChange={(value) => setStyle("gridColumnsTablet", value)}
            />
            <NumInput
              label={tr(fr, "Colonnes mobile", "Mobile columns")}
              value={style.gridColumnsMobile}
              min={1}
              max={6}
              placeholder="1"
              onChange={(value) => setStyle("gridColumnsMobile", value)}
            />
          </div>
          <LengthInput
            label={tr(fr, "Largeur des colonnes (vide = parts égales)", "Column width (empty = equal)")}
            value={style.gridColumnWidth}
            onChange={(value) => setStyle("gridColumnWidth", value)}
          />
          <p className="text-[11px] text-ink-muted">
            {tr(
              fr,
              "Les espaces entre lignes et colonnes se règlent dans Disposition (gap).",
              "Row and column gaps are set in Layout (gap).",
            )}
          </p>
        </InspectorSection>
      ) : null}

      {hasText && isContainer ? <StyleGroup title={tr(fr, "Les textes à l’intérieur", "The texts inside")} /> : null}
      {hasText ? (
        <InspectorSection
          title={isContainer ? tr(fr, "Texte à l’intérieur (tous les textes du conteneur)", "Text inside (every text in the container)") : tr(fr, "Texte", "Text")}
          defaultOpen={!isContainer || clickedText}
          active={used("fontFamily", "size", "weight", "bold", "italic", "color", "align", "lineHeight", "letterSpacing", "textTransform")}
        >
          <InspectorRow label={tr(fr, "Police", "Font")}>
            <select
              value={(style.fontFamily as string) ?? ""}
              onChange={(event) => setStyle("fontFamily", event.target.value || undefined)}
              className="h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-sm text-ink"
            >
              <option value="">{tr(fr, "Police du site", "Site font")}</option>
              {Object.entries(WEBSITE_FONTS).map(([key, font]) => (
                <option key={key} value={key}>
                  {font.label}
                </option>
              ))}
            </select>
          </InspectorRow>
          <div className="grid grid-cols-3 gap-1.5">
            <UnitInput label={tr(fr, "Taille du texte", "Text size")} value={style.size} units={["px", "rem", "%", "vw", "vh"]} onChange={(value) => setStyle("size", value)} />
            <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">
              {tr(fr, "Graisse", "Weight")}
              <select
                value={style.weight !== undefined ? String(style.weight) : ""}
                onChange={(event) =>
                  patchStyle({
                    weight: event.target.value ? Number(event.target.value) : undefined,
                    bold: undefined,
                  })
                }
                className="h-8 rounded-md border border-border bg-surface-1 px-1 text-sm text-ink"
              >
                <option value="">auto</option>
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => (
                  <option key={weight} value={weight}>
                    {weight}
                  </option>
                ))}
              </select>
            </label>
            <NumInput label={tr(fr, "Interligne", "Line height")} value={style.lineHeight} min={0.8} max={3} step={0.05} onChange={(value) => setStyle("lineHeight", value)} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumInput label={tr(fr, "Espacement lettres (em)", "Letter spacing (em)")} value={style.letterSpacing} min={-0.1} max={0.5} step={0.01} placeholder="0" onChange={(value) => setStyle("letterSpacing", value)} />
            <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">
              {tr(fr, "Casse", "Case")}
              <select
                value={(style.textTransform as string) ?? ""}
                onChange={(event) => setStyle("textTransform", event.target.value || undefined)}
                className="h-8 rounded-md border border-border bg-surface-1 px-1 text-sm text-ink"
              >
                <option value="">auto</option>
                <option value="none">{tr(fr, "Normale", "Normal")}</option>
                <option value="uppercase">MAJUSCULES</option>
                <option value="lowercase">minuscules</option>
                <option value="capitalize">Initiales</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={style.weight === 700 || style.bold === true}
              title={tr(fr, "Gras", "Bold")}
              onClick={() =>
                patchStyle({ weight: style.weight === 700 ? undefined : 700, bold: undefined })
              }
              className={`grid size-8 place-items-center rounded-md border ${style.weight === 700 || style.bold === true ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary"}`}
            >
              <Bold className="size-4" />
            </button>
            <button
              type="button"
              aria-pressed={style.italic === true}
              title={tr(fr, "Italique", "Italic")}
              onClick={() => setStyle("italic", style.italic === true ? undefined : true)}
              className={`grid size-8 place-items-center rounded-md border ${style.italic === true ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary"}`}
            >
              <Italic className="size-4" />
            </button>
            <span className="mx-1 h-5 w-px bg-border" />
            {(
              [
                ["left", AlignLeft, tr(fr, "Gauche", "Left")],
                ["center", AlignCenter, tr(fr, "Centre", "Centre")],
                ["right", AlignRight, tr(fr, "Droite", "Right")],
                ["justify", AlignJustify, tr(fr, "Justifié", "Justify")],
              ] as const
            ).map(([value, Icon, name]) => (
              <button
                key={value}
                type="button"
                title={name}
                aria-pressed={style.align === value}
                onClick={() => setStyle("align", style.align === value ? undefined : value)}
                className={`grid size-8 place-items-center rounded-md border ${style.align === value ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary"}`}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
          <BlockColorField
            label={tr(fr, "Couleur du texte", "Text colour")}
            value={style.color}
            onChange={(value) => setStyle("color", value)}
            fallback="#0f172a"
            fr={fr}
          />
        </InspectorSection>
      ) : null}

      <StyleGroup
        title={
          isContainer
            ? tr(fr, "Taille, espace et cadre du div", "Div size, spacing and frame")
            : textOnly
              ? tr(fr, "Place du texte dans son div", "Text placement in its div")
              : tr(fr, subject.frameFr, subject.frameEn)
        }
        hint={
          isContainer
            ? undefined
            : textOnly
              ? tr(
                  fr,
                  "Un texte n’a pas de boîte : réglez ici ses marges et son alignement. Le fond, la bordure, le padding et la taille se règlent sur le div qui le contient.",
                  "A text has no box: set its margins and alignment here. Background, border, padding and size are set on the div that holds it.",
                )
              : tr(
                  fr,
                  "Ces réglages s’appliquent à cet élément lui-même, pas au div qui le contient.",
                  "These settings apply to this element itself, not to the div that holds it.",
                )
        }
      />
      {boxKeysUsed.length ? (
        <div className="space-y-1.5 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-950 dark:bg-amber-400/10 dark:text-amber-100">
          <p>
            {tr(
              fr,
              "Ce texte a encore des réglages de boîte (fond, bordure, taille ou padding) d’une ancienne version : ils le font ressembler à un div.",
              "This text still has box settings (background, border, size or padding) from an older version: they make it look like a div.",
            )}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => patchStyle(Object.fromEntries(boxKeysUsed.map((key) => [key, undefined])))}
          >
            {tr(fr, "Retirer ces réglages de boîte", "Remove these box settings")}
          </Button>
        </div>
      ) : null}
      {textOnly ? null : (
      <InspectorSection
        title={tr(fr, "Dimensions", "Size")}
        active={used("width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight")}
        defaultOpen={element === "root"}
      >
        {element === "root" ? (
          <div className="space-y-2 rounded-lg bg-surface-2 p-2">
            <InspectorRow label={tr(fr, "Largeur du div", "Div width")}>
              <Segmented
                value={style.width === "full" && style.maxWidth === "none" ? "screen" : "contained"}
                onChange={(value) =>
                  patchStyle(value === "screen" ? { width: "full", maxWidth: "none" } : { width: undefined, maxWidth: undefined })
                }
                options={[
                  ["contained", tr(fr, "Centrée (largeur du site)", "Centred (site width)")],
                  ["screen", tr(fr, "Tout l’écran (100 %)", "Full screen (100%)")],
                ]}
              />
            </InspectorRow>
            <InspectorRow label={tr(fr, "Hauteur du div", "Div height")}>
              <Segmented
                value={style.minHeight === "100vh" ? "screen" : "auto"}
                onChange={(value) => patchStyle({ minHeight: value === "screen" ? "100vh" : undefined })}
                options={[
                  ["auto", tr(fr, "Selon le contenu", "Fit content")],
                  ["screen", tr(fr, "Plein écran (100 vh)", "Full screen (100 vh)")],
                ]}
              />
            </InspectorRow>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1">
          <Segmented
            value={style.width}
            onChange={(value) => setStyle("width", value)}
            options={[
              ["auto", tr(fr, "Largeur selon contenu", "Fit content")],
              ["full", tr(fr, "Toute la largeur", "Full width")],
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <LengthInput label={tr(fr, "Largeur", "Width")} value={style.width === "full" ? undefined : style.width} onChange={(value) => setStyle("width", value)} />
          <LengthInput label={tr(fr, "Hauteur", "Height")} value={style.height} onChange={(value) => setStyle("height", value)} />
          <LengthInput label={tr(fr, "Largeur min.", "Min width")} value={style.minWidth} onChange={(value) => setStyle("minWidth", value)} />
          <LengthInput label={tr(fr, "Largeur max.", "Max width")} value={style.maxWidth} allowNone onChange={(value) => setStyle("maxWidth", value)} />
          <LengthInput label={tr(fr, "Hauteur min.", "Min height")} value={style.minHeight} onChange={(value) => setStyle("minHeight", value)} />
          <LengthInput label={tr(fr, "Hauteur max.", "Max height")} value={style.maxHeight} allowNone onChange={(value) => setStyle("maxHeight", value)} />
        </div>
      </InspectorSection>
      )}

      {kind === "media" ? (
        <InspectorSection title={tr(fr, "Image", "Image")} defaultOpen active={used("objectFit", "objectPosition", "aspectRatio")}>
          <InspectorRow label={tr(fr, "Remplissage (object-fit)", "Fill (object-fit)")}>
            <Segmented
              value={style.objectFit}
              onChange={(value) => setStyle("objectFit", value)}
              options={[
                ["cover", tr(fr, "Couvrir", "Cover")],
                ["contain", tr(fr, "Contenir", "Contain")],
                ["fill", tr(fr, "Étirer", "Fill")],
                ["none", tr(fr, "Taille réelle", "None")],
                ["scale-down", tr(fr, "Réduire si besoin", "Scale down")],
              ]}
            />
          </InspectorRow>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">
              {tr(fr, "Position de l’image", "Image position")}
              <select
                value={typeof style.objectPosition === "string" ? style.objectPosition : ""}
                onChange={(event) => setStyle("objectPosition", event.target.value || undefined)}
                className="h-8 rounded-md border border-border bg-surface-1 px-1.5 text-xs text-ink"
              >
                <option value="">{tr(fr, "Centre (défaut)", "Centre (default)")}</option>
                {(
                  [
                    ["top", tr(fr, "Haut", "Top")],
                    ["bottom", tr(fr, "Bas", "Bottom")],
                    ["left", tr(fr, "Gauche", "Left")],
                    ["right", tr(fr, "Droite", "Right")],
                    ["top-left", tr(fr, "Haut gauche", "Top left")],
                    ["top-right", tr(fr, "Haut droite", "Top right")],
                    ["bottom-left", tr(fr, "Bas gauche", "Bottom left")],
                    ["bottom-right", tr(fr, "Bas droite", "Bottom right")],
                  ] as const
                ).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">
              {tr(fr, "Ratio (facultatif)", "Ratio (optional)")}
              <select
                value={typeof style.aspectRatio === "string" ? style.aspectRatio : ""}
                onChange={(event) => setStyle("aspectRatio", event.target.value || undefined)}
                className="h-8 rounded-md border border-border bg-surface-1 px-1.5 text-xs text-ink"
              >
                <option value="">{tr(fr, "Libre", "Free")}</option>
                {["1/1", "4/3", "3/2", "16/9", "21/9", "3/4", "2/3", "9/16"].map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio.replace("/", " : ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-ink-muted">
            {tr(
              fr,
              "Largeur, hauteur et min/max : section « Dimensions ». Rayon et bordure : « Bordure ». Ombre et opacité : « Effets ». Animation : « Animations ».",
              "Width, height and min/max: “Size”. Corners and border: “Border”. Shadow and opacity: “Effects”. Animation: “Animations”.",
            )}
          </p>
        </InspectorSection>
      ) : null}

      <InspectorSection
        title={tr(fr, "Espacement", "Spacing")}
        defaultOpen={isContainer}
        active={used("marginTop", "marginRight", "marginBottom", "marginLeft", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft")}
      >
        <SidesInput label={tr(fr, "Marge extérieure (margin)", "Margin")} prefix="margin" style={style} patchStyle={patchStyle} min={-400} fr={fr} />
        {textOnly ? null : (
          <SidesInput label={tr(fr, "Marge intérieure (padding)", "Padding")} prefix="padding" style={style} patchStyle={patchStyle} fr={fr} />
        )}
      </InspectorSection>

      {textOnly ? null : (
      <>
      <InspectorSection
        title={tr(fr, "Fond", "Background")}
        active={used("background", "gradientFrom", "gradientTo", "backgroundImage", "overlayColor")}
      >
        <BlockColorField
          label={kind === "button" ? tr(fr, "Couleur du bouton", "Button colour") : tr(fr, "Couleur de fond", "Background colour")}
          value={style.background}
          onChange={(value) => setStyle("background", value)}
          fallback="#ffffff"
          fr={fr}
        />
        <InspectorRow label={tr(fr, "Dégradé (les deux couleurs sont nécessaires)", "Gradient (both colours needed)")}>
          <div className="grid grid-cols-[1fr_1fr_70px] items-end gap-1.5">
            <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">
              {tr(fr, "De", "From")}
              <input type="color" value={(style.gradientFrom as string) || "#075c4d"} onChange={(event) => setStyle("gradientFrom", event.target.value)} className="h-8 w-full rounded-md border border-border p-0.5" />
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">
              {tr(fr, "À", "To")}
              <input type="color" value={(style.gradientTo as string) || "#0b2545"} onChange={(event) => setStyle("gradientTo", event.target.value)} className="h-8 w-full rounded-md border border-border p-0.5" />
            </label>
            <NumInput label={tr(fr, "Angle °", "Angle °")} value={style.gradientAngle} max={360} placeholder="135" onChange={(value) => setStyle("gradientAngle", value)} />
          </div>
          {style.gradientFrom || style.gradientTo ? (
            <button type="button" className="text-[11px] text-ink-muted hover:text-brand" onClick={() => patchStyle({ gradientFrom: undefined, gradientTo: undefined, gradientAngle: undefined })}>
              {tr(fr, "Retirer le dégradé", "Remove gradient")}
            </button>
          ) : null}
        </InspectorRow>
        <WebsiteImagePicker
          orgSlug={orgSlug}
          value={(style.backgroundImage as string) ?? ""}
          onChange={(url) => setStyle("backgroundImage", url || undefined)}
          fr={fr}
          label={tr(fr, "Image de fond", "Background image")}
        />
        {style.backgroundImage ? (
          <>
            <InspectorRow label={tr(fr, "Taille", "Size")}>
              <Segmented value={style.backgroundSize} onChange={(value) => setStyle("backgroundSize", value)} options={[["cover", tr(fr, "Couvrir", "Cover")], ["contain", tr(fr, "Contenir", "Contain")], ["auto", tr(fr, "Réelle", "Actual")]]} />
            </InspectorRow>
            <InspectorRow label={tr(fr, "Position", "Position")}>
              <Segmented value={style.backgroundPosition} onChange={(value) => setStyle("backgroundPosition", value)} options={[["center", tr(fr, "Centre", "Centre")], ["top", tr(fr, "Haut", "Top")], ["bottom", tr(fr, "Bas", "Bottom")], ["left", tr(fr, "Gauche", "Left")], ["right", tr(fr, "Droite", "Right")]]} />
            </InspectorRow>
            <InspectorRow label={tr(fr, "Répétition", "Repeat")}>
              <Segmented value={style.backgroundRepeat} onChange={(value) => setStyle("backgroundRepeat", value)} options={[["no-repeat", tr(fr, "Aucune", "None")], ["repeat", tr(fr, "Mosaïque", "Tile")], ["repeat-x", "X"], ["repeat-y", "Y"]]} />
            </InspectorRow>
            <button type="button" className="text-[11px] text-ink-muted hover:text-brand" onClick={() => setStyle("backgroundImage", undefined)}>
              {tr(fr, "Retirer l’image de fond", "Remove background image")}
            </button>
          </>
        ) : null}
        <InspectorRow label={tr(fr, "Superposition colorée", "Colour overlay")}>
          <div className="grid grid-cols-[1fr_90px] items-end gap-1.5">
            <BlockColorField label={tr(fr, "Couleur", "Colour")} value={style.overlayColor} onChange={(value) => setStyle("overlayColor", value)} fallback="#0f172a" fr={fr} />
            <NumInput label={tr(fr, "Opacité %", "Opacity %")} value={style.overlayOpacity} max={100} placeholder="40" onChange={(value) => setStyle("overlayOpacity", value)} />
          </div>
        </InspectorRow>
      </InspectorSection>

      <InspectorSection
        title={tr(fr, "Bordure", "Border")}
        active={used("borderWidth", "borderStyle", "borderColor", "radius", "radiusTopLeft", "radiusTopRight", "radiusBottomRight", "radiusBottomLeft")}
      >
        <div className="grid grid-cols-2 gap-1.5">
          <NumInput label={tr(fr, "Épaisseur (px)", "Width (px)")} value={style.borderWidth} max={24} onChange={(value) => setStyle("borderWidth", value)} />
          <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">
            {tr(fr, "Style", "Style")}
            <select value={(style.borderStyle as string) ?? ""} onChange={(event) => setStyle("borderStyle", event.target.value || undefined)} className="h-8 rounded-md border border-border bg-surface-1 px-1 text-sm text-ink">
              <option value="">{tr(fr, "Plein", "Solid")}</option>
              <option value="dashed">{tr(fr, "Tirets", "Dashed")}</option>
              <option value="dotted">{tr(fr, "Pointillés", "Dotted")}</option>
              <option value="double">{tr(fr, "Double", "Double")}</option>
              <option value="none">{tr(fr, "Aucune", "None")}</option>
            </select>
          </label>
        </div>
        {Number(style.borderWidth) > 0 ? (
          <BlockColorField label={tr(fr, "Couleur de bordure", "Border colour")} value={style.borderColor} onChange={(value) => setStyle("borderColor", value)} fallback="#e2e8f0" fr={fr} />
        ) : null}
        <NumInput label={tr(fr, "Arrondi global (px)", "Radius (px)")} value={style.radius} onChange={(value) => setStyle("radius", value)} />
        <InspectorRow label={tr(fr, "Arrondi par coin (px)", "Per-corner radius (px)")}>
          <div className="grid grid-cols-4 gap-1.5">
            <NumInput label="↖" value={style.radiusTopLeft} onChange={(value) => setStyle("radiusTopLeft", value)} />
            <NumInput label="↗" value={style.radiusTopRight} onChange={(value) => setStyle("radiusTopRight", value)} />
            <NumInput label="↘" value={style.radiusBottomRight} onChange={(value) => setStyle("radiusBottomRight", value)} />
            <NumInput label="↙" value={style.radiusBottomLeft} onChange={(value) => setStyle("radiusBottomLeft", value)} />
          </div>
        </InspectorRow>
      </InspectorSection>

      <InspectorSection title={tr(fr, "Effets", "Effects")} active={used("shadow", "opacity")}>
        <InspectorRow label={tr(fr, "Ombre", "Shadow")}>
          <Segmented value={style.shadow} onChange={(value) => setStyle("shadow", value)} options={[["none", tr(fr, "Aucune", "None")], ["sm", "S"], ["md", "M"], ["lg", "L"], ["xl", "XL"]]} />
        </InspectorRow>
        <InspectorRow label={`${tr(fr, "Opacité", "Opacity")} · ${style.opacity ?? 100}%`}>
          <input type="range" min={0} max={100} step={5} value={Number(style.opacity ?? 100)} onChange={(event) => setStyle("opacity", Number(event.target.value) === 100 ? undefined : Number(event.target.value))} className="w-full" />
        </InspectorRow>
      </InspectorSection>

      <InspectorSection title={tr(fr, "Position", "Position")} active={used("position", "top", "right", "bottom", "left", "zIndex")}>
        <Segmented
          value={style.position}
          onChange={(value) => setStyle("position", value)}
          options={[["static", tr(fr, "Normale", "Static")], ["relative", tr(fr, "Relative", "Relative")], ["absolute", tr(fr, "Absolue", "Absolute")], ["fixed", tr(fr, "Fixe", "Fixed")], ["sticky", "Sticky"]]}
        />
        {style.position && style.position !== "static" ? (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <LengthInput label={tr(fr, "Haut", "Top")} value={style.top} allowNegative onChange={(value) => setStyle("top", value)} />
              <LengthInput label={tr(fr, "Droite", "Right")} value={style.right} allowNegative onChange={(value) => setStyle("right", value)} />
              <LengthInput label={tr(fr, "Bas", "Bottom")} value={style.bottom} allowNegative onChange={(value) => setStyle("bottom", value)} />
              <LengthInput label={tr(fr, "Gauche", "Left")} value={style.left} allowNegative onChange={(value) => setStyle("left", value)} />
            </div>
            <p className="text-[11px] text-ink-muted">
              {tr(fr, "« Absolue » se place par rapport au conteneur parent en position relative.", "“Absolute” is placed relative to the nearest relative parent.")}
            </p>
          </>
        ) : null}
        <NumInput label={tr(fr, "Superposition (z-index)", "Stacking (z-index)")} value={style.zIndex} min={-10} max={100} onChange={(value) => setStyle("zIndex", value)} />
      </InspectorSection>
      </>
      )}

      {isContainer ? (
        <InspectorSection title={tr(fr, "Débordement", "Overflow")} active={used("overflow")}>
          <Segmented value={style.overflow} onChange={(value) => setStyle("overflow", value)} options={[["visible", tr(fr, "Visible", "Visible")], ["hidden", tr(fr, "Masqué", "Hidden")], ["auto", "Auto"], ["scroll", tr(fr, "Défilement", "Scroll")]]} />
        </InspectorSection>
      ) : null}

      {element !== "canvas" && element !== "root" ? (
        <InspectorSection
          title={textOnly ? tr(fr, "Placement dans le div", "Placement in the div") : tr(fr, "Comme élément enfant", "As a child element")}
          active={used("order", "flexGrow", "flexShrink", "flexBasis", "alignSelf")}
        >
          <p className="text-[11px] text-ink-muted">
            {tr(fr, "S’applique quand le parent est en Flexbox ou en grille.", "Applies when the parent uses Flexbox or grid.")}
          </p>
          <InspectorRow label={tr(fr, "Alignement individuel (align-self)", "Own alignment (align-self)")}>
            <Segmented value={style.alignSelf} onChange={(value) => setStyle("alignSelf", value)} options={[["start", tr(fr, "Début", "Start")], ["center", tr(fr, "Centre", "Centre")], ["end", tr(fr, "Fin", "End")], ["stretch", tr(fr, "Étiré", "Stretch")]]} />
          </InspectorRow>
          <div className="grid grid-cols-3 gap-1.5">
            <NumInput label={tr(fr, "Agrandir", "Grow")} value={style.flexGrow} max={10} placeholder="0" onChange={(value) => setStyle("flexGrow", value)} />
            <NumInput label={tr(fr, "Réduire", "Shrink")} value={style.flexShrink} max={10} placeholder="1" onChange={(value) => setStyle("flexShrink", value)} />
            <NumInput label={tr(fr, "Ordre", "Order")} value={style.order} min={-20} max={100} placeholder="0" onChange={(value) => setStyle("order", value)} />
          </div>
          <LengthInput label={tr(fr, "Largeur de base (flex-basis)", "Base width (flex-basis)")} value={style.flexBasis} onChange={(value) => setStyle("flexBasis", value)} />
        </InspectorSection>
      ) : null}
      <InspectorSection
        title={tr(fr, "Animations", "Animations")}
        active={used("animType")}
      >
        <AnimationFields
          value={style}
          onChange={(next) =>
            patchStyle({
              animType: next.animType,
              animDuration: next.animDuration,
              animDelay: next.animDelay,
              animTrigger: next.animTrigger,
            })
          }
          allowText={kind === "text" || kind === "badges"}
          onReplay={onReplay}
          fr={fr}
        />
      </InspectorSection>
    </section>
  );
}

/** Optional animation of a block, div, container or text. */
function AnimationFields({
  value,
  onChange,
  allowText,
  title,
  onReplay,
  fr,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  allowText: boolean;
  title?: string;
  onReplay?: () => void;
  fr: boolean;
}) {
  const type = typeof value.animType === "string" ? value.animType : "";
  const patch = (changes: Record<string, unknown>) => {
    const next: Record<string, unknown> = {
      animType: value.animType,
      animDuration: value.animDuration,
      animDelay: value.animDelay,
      animTrigger: value.animTrigger,
      ...changes,
    };
    if (!next.animType) {
      onChange({});
      return;
    }
    for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === "") delete next[key];
    onChange(next);
  };
  const options: Array<[string, string]> = [
    ["", tr(fr, "Aucune", "None")],
    ["fade", tr(fr, "Fondu", "Fade")],
    ["slide-up", tr(fr, "Glisser vers le haut", "Slide up")],
    ["slide-down", tr(fr, "Glisser vers le bas", "Slide down")],
    ["slide-left", tr(fr, "Glisser depuis la droite", "Slide from right")],
    ["slide-right", tr(fr, "Glisser depuis la gauche", "Slide from left")],
    ["zoom", tr(fr, "Zoom léger", "Gentle zoom")],
    ...(allowText
      ? ([
          ["words", tr(fr, "Mot par mot (texte)", "Word by word (text)")],
          ["typewriter", tr(fr, "Machine à écrire (texte)", "Typewriter (text)")],
        ] as Array<[string, string]>)
      : []),
  ];
  return (
    <div className="space-y-2">
      {title ? <p className="text-sm font-medium text-ink">{title}</p> : null}
      <select
        value={type}
        onChange={(event) => patch({ animType: event.target.value || undefined })}
        className="h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-sm text-ink"
        aria-label={tr(fr, "Type d’animation", "Animation type")}
      >
        {options.map(([option, name]) => (
          <option key={option} value={option}>
            {name}
          </option>
        ))}
      </select>
      {type ? (
        <>
          <InspectorRow label={tr(fr, "Déclenchement", "Trigger")}>
            <Segmented
              value={value.animTrigger ?? "view"}
              onChange={(next) => patch({ animTrigger: next === "hover" ? "hover" : undefined })}
              options={[
                ["view", tr(fr, "À l’apparition", "On scroll into view")],
                ["hover", tr(fr, "Au survol", "On hover")],
              ]}
            />
          </InspectorRow>
          <div className="grid grid-cols-2 gap-1.5">
            <NumInput
              label={tr(fr, "Durée (ms)", "Duration (ms)")}
              value={value.animDuration}
              min={100}
              max={4000}
              step={50}
              placeholder="700"
              onChange={(next) => patch({ animDuration: next })}
            />
            <NumInput
              label={tr(fr, "Délai (ms)", "Delay (ms)")}
              value={value.animDelay}
              max={5000}
              step={50}
              placeholder="0"
              onChange={(next) => patch({ animDelay: next })}
            />
          </div>
          {onReplay ? (
            <button
              type="button"
              onClick={onReplay}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
            >
              <Play className="size-3" />
              {tr(fr, "Rejouer les animations dans l’aperçu", "Replay animations in the preview")}
            </button>
          ) : null}
          <p className="text-[11px] leading-4 text-ink-muted">
            {tr(
              fr,
              "Le contenu reste visible si l’animation ne peut pas jouer, et les animations sont désactivées pour les visiteurs qui préfèrent réduire les mouvements.",
              "Content stays visible if the animation cannot run, and animations are switched off for visitors who prefer reduced motion.",
            )}
          </p>
        </>
      ) : null}
    </div>
  );
}

/** Carousel behaviour: visible slides, navigation and autoplay. */
/**
 * "Réglages du carrousel": slides, responsive display, navigation, autoplay
 * and accessibility of a carousel, in one panel. Used for added carousels
 * and for card blocks shown as a carousel.
 */
function CarouselSettingsPanel({
  value,
  onChange,
  slides,
  selected,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  onMove,
  defaultOpen,
  fr,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  slides: string[];
  selected: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  defaultOpen: boolean;
  fr: boolean;
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const set = (key: string, next: unknown) => {
    const result = { ...value, [key]: next };
    if (next === undefined || next === "") delete result[key];
    onChange(result);
  };
  const flag = (key: string, fallback: boolean) => (value[key] === undefined ? fallback : value[key] === true);
  const check = (key: string, label: string, fallback: boolean, hint?: string) => (
    <label className="flex items-start gap-2 text-xs text-ink">
      <input
        type="checkbox"
        className="mt-0.5 accent-violet-600"
        checked={flag(key, fallback)}
        onChange={(event) => set(key, event.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="block text-[11px] text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
  const autoplay = flag("autoplay", true);
  const perView = Number(value.perView) || 3;
  const target = selected >= 0 ? selected : slides.length - 1;
  return (
    <details open={defaultOpen} className="group/carousel rounded-xl border border-violet-500/40 bg-violet-500/[.04]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <GalleryHorizontal className="size-4 text-violet-600" />
          {tr(fr, "Réglages du carrousel", "Carousel settings")}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-ink-muted">
          {slides.length} {tr(fr, "diapositive(s)", "slide(s)")}
          {selected >= 0 ? ` · ${tr(fr, "n°", "#")}${selected + 1}` : ""}
          <ChevronDown className="size-4 transition group-open/carousel:rotate-180" />
        </span>
      </summary>
      <div className="space-y-3 border-t border-violet-500/20 px-3 pb-3 pt-3">
        {/* 1. Slides */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">1. {tr(fr, "Diapositives", "Slides")}</p>
            <Button size="sm" variant="secondary" onClick={onAdd}>
              <Plus />
              {tr(fr, "Ajouter", "Add")}
            </Button>
          </div>
          <ol className="space-y-1">
            {slides.map((label, index) => (
              <li
                key={`${index}-${label}`}
                draggable
                onDragStart={() => setDragged(index)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOver(index);
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setOver(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged !== null && dragged !== index) onMove(dragged, index);
                  setDragged(null);
                  setOver(null);
                }}
                className={`flex items-center gap-1 rounded-md border px-1 py-0.5 text-xs transition ${
                  selected === index ? "border-violet-500 bg-violet-500/10" : over === index && dragged !== index ? "border-violet-400 bg-violet-400/5" : "border-border bg-surface-1"
                } ${dragged === index ? "opacity-40" : ""}`}
              >
                <span className="grid size-6 shrink-0 cursor-grab place-items-center text-ink-muted" title={tr(fr, "Glisser pour réorganiser", "Drag to reorder")}>
                  <GripVertical className="size-3.5" />
                </span>
                <button type="button" className="min-w-0 flex-1 truncate py-1 text-left text-ink" onClick={() => onSelect(index)}>
                  <span className="mr-1 font-semibold text-ink-muted">{index + 1}.</span>
                  {label}
                </button>
                <Button size="icon-sm" variant="ghost" onClick={() => onDuplicate(index)} aria-label={tr(fr, `Dupliquer la diapositive ${index + 1}`, `Duplicate slide ${index + 1}`)}>
                  <Copy />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={slides.length <= 1}
                  onClick={async () => {
                    if (await ask(tr(fr, `Supprimer la diapositive ${index + 1} et son contenu ?`, `Delete slide ${index + 1} and its content?`))) onRemove(index);
                  }}
                  aria-label={tr(fr, `Supprimer la diapositive ${index + 1}`, `Delete slide ${index + 1}`)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ol>
          {slides.length ? (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => onDuplicate(target)}>
                <Copy />
                {selected >= 0
                  ? tr(fr, "Dupliquer la diapositive sélectionnée", "Duplicate the selected slide")
                  : tr(fr, "Dupliquer la dernière", "Duplicate the last one")}
              </Button>
            </div>
          ) : null}
          <p className="text-[11px] text-ink-muted">
            {tr(
              fr,
              "Cliquez sur une diapositive (ici ou dans l’aperçu) pour modifier son contenu, son image, ses liens et son style. Glissez-déposez pour changer l’ordre.",
              "Click a slide (here or in the preview) to edit its content, image, links and style. Drag and drop to reorder.",
            )}
          </p>
        </section>

        {/* 2. Responsive display */}
        <section className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">2. {tr(fr, "Affichage", "Display")}</p>
          <div className="grid grid-cols-3 gap-1.5">
            <NumInput label={tr(fr, "Visibles ordinateur", "Visible desktop")} value={value.perView} min={1} max={6} placeholder="3" onChange={(next) => set("perView", next)} />
            <NumInput label={tr(fr, "Tablette", "Tablet")} value={value.perViewTablet} min={1} max={6} placeholder="auto" onChange={(next) => set("perViewTablet", next)} />
            <NumInput label={tr(fr, "Mobile", "Phone")} value={value.perViewMobile} min={1} max={3} placeholder="auto" onChange={(next) => set("perViewMobile", next)} />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <NumInput label={tr(fr, "Espace ordinateur (px)", "Gap desktop (px)")} value={value.gap} min={0} max={80} placeholder="24" onChange={(next) => set("gap", next)} />
            <NumInput label={tr(fr, "Tablette (px)", "Tablet (px)")} value={value.gapTablet} min={0} max={80} placeholder="auto" onChange={(next) => set("gapTablet", next)} />
            <NumInput label={tr(fr, "Mobile (px)", "Phone (px)")} value={value.gapMobile} min={0} max={80} placeholder="auto" onChange={(next) => set("gapMobile", next)} />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-ink-secondary">{tr(fr, "Direction du défilement", "Scroll direction")}</p>
            <Segmented
              value={value.orientation === "vertical" ? "vertical" : "horizontal"}
              onChange={(next) => set("orientation", next === "vertical" ? "vertical" : undefined)}
              options={[
                ["horizontal", tr(fr, "Horizontale", "Horizontal")],
                ["vertical", tr(fr, "Verticale", "Vertical")],
              ]}
            />
          </div>
          {value.orientation === "vertical" ? (
            <NumInput label={tr(fr, "Hauteur du carrousel (px)", "Carousel height (px)")} value={value.height} min={160} max={1200} placeholder="420" onChange={(next) => set("height", next)} />
          ) : null}
          {slides.length > 0 && slides.length <= perView ? (
            <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
              {tr(
                fr,
                `${slides.length} diapositive(s) et ${perView} visible(s) sur ordinateur : tout est affiché, donc rien ne défile (pas de flèches, de points ni de défilement automatique sur ordinateur). Ajoutez au moins une diapositive pour qu’il défile.`,
                `${slides.length} slide(s) and ${perView} visible on desktop: everything is shown, so nothing scrolls (no arrows, dots or autoplay on desktop). Add at least one slide to make it scroll.`,
              )}
            </p>
          ) : null}
          <p className="text-[11px] text-ink-muted">
            {tr(
              fr,
              "« Visibles » = nombre de diapositives (blocs) montrées à la fois. Laissez tablette et mobile vides pour « auto » (2 puis 1).",
              "“Visible” = number of slides (blocks) shown at once. Leave tablet and phone empty for “auto” (2 then 1).",
            )}

          </p>
        </section>

        {/* 3. Navigation */}
        <section className="space-y-1.5 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">3. {tr(fr, "Navigation", "Navigation")}</p>
          {check("arrows", tr(fr, "Flèches", "Arrows"), true)}
          {flag("arrows", true) ? check("arrowsOnHover", tr(fr, "Flèches seulement au survol de la souris", "Arrows only on mouse-over"), false, tr(fr, "Toujours visibles sur écran tactile et au clavier.", "Always visible on touch screens and with the keyboard.")) : null}
          {check("dots", tr(fr, "Points de navigation", "Navigation dots"), true)}
          {check("loop", tr(fr, "Boucle infinie", "Infinite loop"), true)}
          {check("swipe", tr(fr, "Balayage tactile (glisser du doigt)", "Touch swipe"), true)}
          {check("keyboard", tr(fr, "Clavier : flèches gauche / droite, Home et End", "Keyboard: left / right arrows, Home and End"), true)}
        </section>

        {/* 4. Autoplay */}
        <section className="space-y-1.5 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">4. {tr(fr, "Défilement automatique", "Autoplay")}</p>
          {check("autoplay", tr(fr, "Défilement automatique", "Autoplay"), true)}
          {autoplay ? (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <NumInput label={tr(fr, "Intervalle (ms)", "Interval (ms)")} value={value.interval} min={1500} max={20000} step={500} placeholder="5000" onChange={(next) => set("interval", next)} />
                <NumInput label={tr(fr, "Vitesse de transition (ms)", "Transition speed (ms)")} value={value.speed} min={100} max={2000} step={50} placeholder="500" onChange={(next) => set("speed", next)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-ink-secondary">{tr(fr, "Sens de défilement", "Direction")}</span>
                <Segmented
                  value={value.direction === "prev" ? "prev" : "next"}
                  onChange={(next) => set("direction", next === "prev" ? "prev" : undefined)}
                  options={[
                    ["next", tr(fr, "Droite → gauche (suivante)", "Right → left (next)")],
                    ["prev", tr(fr, "Gauche → droite (précédente)", "Left → right (previous)")],
                  ]}
                />
              </div>
              {check("pauseOnHover", tr(fr, "Pause au survol de la souris", "Pause on mouse-over"), true)}
              {check("pauseOnFocus", tr(fr, "Pause quand le carrousel a le focus clavier", "Pause when the carousel has keyboard focus"), true)}
              {check("pauseWhenHidden", tr(fr, "Pause quand l’onglet du navigateur n’est pas visible", "Pause when the browser tab is hidden"), true)}
              {check("playButton", tr(fr, "Bouton Lecture / Pause visible sur le site", "Play / Pause button on the site"), false, tr(fr, "Recommandé pour l’accessibilité si le défilement dure longtemps.", "Recommended for accessibility when autoplay runs long."))}
            </>
          ) : (
            <NumInput label={tr(fr, "Vitesse de transition (ms)", "Transition speed (ms)")} value={value.speed} min={100} max={2000} step={50} placeholder="500" onChange={(next) => set("speed", next)} />
          )}
        </section>

        {/* 5. Accessibility */}
        <section className="space-y-1 border-t border-border pt-3 text-[11px] leading-4 text-ink-muted">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">5. {tr(fr, "Accessibilité (automatique)", "Accessibility (automatic)")}</p>
          <p>• {tr(fr, "Pas de défilement automatique pour les visiteurs qui ont choisi « réduire les animations ».", "No autoplay for visitors who chose “reduce motion”.")}</p>
          <p>• {tr(fr, "Chaque diapositive annonce sa position (« Diapositive 2 sur 5 »).", "Each slide announces its position (“Slide 2 of 5”).")}</p>
          <p>• {tr(fr, "Flèches, points et bouton pause ont des libellés lisibles par les lecteurs d’écran.", "Arrows, dots and the pause button have screen-reader labels.")}</p>
          <p>• {tr(fr, "Dans l’éditeur, le défilement s’arrête quand la souris est sur le carrousel.", "In the editor, autoplay stops while the mouse is over the carousel.")}</p>
        </section>
      </div>
    </details>
  );
}

/** The same panel for a card block (cards, figures, gallery) shown as a carousel. */
function ItemsCarouselPanel({
  block,
  onChange,
  onSelectElement,
  selected,
  defaultOpen,
  fr,
}: {
  block: WebsiteSection;
  onChange: (block: WebsiteSection) => void;
  onSelectElement: (element: string | null) => void;
  selected: number;
  defaultOpen: boolean;
  fr: boolean;
}) {
  const content = block.content;
  const items = readItems(block);
  const setItems = (next: Record<string, unknown>[]) => onChange({ ...block, content: { ...content, items: next } });
  const labelOf = (item: Record<string, unknown>, index: number) =>
    String(item.titleFr ?? item.captionFr ?? item.questionFr ?? item.labelFr ?? item.value ?? "").trim().slice(0, 40) ||
    `${tr(fr, "Carte", "Card")} ${index + 1}`;
  return (
    <CarouselSettingsPanel
      value={content.itemsCarousel && typeof content.itemsCarousel === "object" ? (content.itemsCarousel as Record<string, unknown>) : {}}
      onChange={(next) => onChange({ ...block, content: { ...content, itemsCarousel: next } })}
      slides={items.map(labelOf)}
      selected={selected}
      onSelect={(index) => onSelectElement(`item:${index}`)}
      onAdd={() => addStandardItem(block, onChange, onSelectElement)}
      onDuplicate={(index) => {
        const next = [...items];
        next.splice(index + 1, 0, JSON.parse(JSON.stringify(items[index])) as Record<string, unknown>);
        setItems(next);
        onSelectElement(`item:${index + 1}`);
      }}
      onRemove={(index) => {
        setItems(items.filter((_item, position) => position !== index));
        onSelectElement("items");
      }}
      onMove={(from, to) => {
        const next = [...items];
        const [moving] = next.splice(from, 1);
        next.splice(to, 0, moving!);
        setItems(next);
      }}
      defaultOpen={defaultOpen}
      fr={fr}
    />
  );
}

/** Content keys of one repeated item part (several spellings are accepted). */
const itemPartKeys: Record<string, { fr: string[]; en: string[]; fallbackFr?: string; fallbackEn?: string }> = {
  title: { fr: ["title_fr", "titleFr"], en: ["title_en", "titleEn"] },
  body: { fr: ["body_fr", "bodyFr"], en: ["body_en", "bodyEn"] },
  tag: { fr: ["tag_fr", "tagFr"], en: ["tag_en", "tagEn"], fallbackFr: "IMPACT", fallbackEn: "IMPACT" },
  link: { fr: ["link_fr", "linkFr"], en: ["link_en", "linkEn"], fallbackFr: "Découvrir", fallbackEn: "Explore" },
  label: { fr: ["label_fr", "labelFr"], en: ["label_en", "labelEn"] },
  caption: { fr: ["caption_fr", "captionFr"], en: ["caption_en", "captionEn"] },
  question: { fr: ["question_fr", "questionFr"], en: ["question_en", "questionEn"] },
  answer: { fr: ["answer_fr", "answerFr"], en: ["answer_en", "answerEn"] },
};

function readItems(block: WebsiteSection): Record<string, unknown>[] {
  return Array.isArray(block.content.items)
    ? (block.content.items as unknown[]).filter(
        (item): item is Record<string, unknown> => !!item && typeof item === "object",
      )
    : [];
}

/** Adds a card to a standard block (cards, metrics, gallery, questions). */
function addStandardItem(
  block: WebsiteSection,
  onChange: (block: WebsiteSection) => void,
  onSelectElement: (element: string | null) => void,
) {
  const items = readItems(block);
  const template =
    block.section_type === "metrics"
      ? { value: "0", labelFr: "Indicateur", labelEn: "Metric" }
      : block.section_type === "faq"
        ? { questionFr: "Question", questionEn: "Question", answerFr: "Réponse", answerEn: "Answer" }
        : block.section_type === "gallery"
          ? { imageUrl: "", captionFr: "", captionEn: "" }
          : { titleFr: "Titre", titleEn: "Title", bodyFr: "Description", bodyEn: "Description" };
  onChange({ ...block, content: { ...block.content, items: [...items, template] } });
  onSelectElement(`item:${items.length}`);
}

/**
 * Content of a card (or one of its parts) in a standard block: its words in
 * both languages, its link or image, and moving / duplicating / removing it.
 */
function ItemContentFields({
  orgSlug,
  block,
  index,
  part,
  onChange,
  onSelectElement,
  fr,
}: {
  orgSlug: string;
  block: WebsiteSection;
  index: number;
  part: string | null;
  onChange: (block: WebsiteSection) => void;
  onSelectElement: (element: string | null) => void;
  fr: boolean;
}) {
  const [lang, setLang] = useState<"fr" | "en">(fr ? "fr" : "en");
  const items = readItems(block);
  const item = items[index];
  if (!item) return null;
  const setItems = (next: Record<string, unknown>[]) =>
    onChange({ ...block, content: { ...block.content, items: next } });
  const setField = (key: string, value: unknown) =>
    setItems(items.map((candidate, position) => (position === index ? { ...candidate, [key]: value } : candidate)));
  const move = (direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setItems(next);
    onSelectElement(part ? `item:${target}:${part}` : `item:${target}`);
  };
  const duplicate = () => {
    const next = [...items];
    next.splice(index + 1, 0, JSON.parse(JSON.stringify(item)) as Record<string, unknown>);
    setItems(next);
    onSelectElement(`item:${index + 1}`);
  };
  const remove = async () => {
    if (!await ask(tr(fr, "Supprimer cette carte ?", "Delete this card?"))) return;
    setItems(items.filter((_candidate, position) => position !== index));
    onSelectElement(null);
  };
  const keys = part ? itemPartKeys[part] : undefined;
  const key = keys ? storedKey(item, lang === "fr" ? keys.fr : keys.en) : null;
  const fallback = keys ? (lang === "fr" ? keys.fallbackFr : keys.fallbackEn) : undefined;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
          {tr(fr, "Carte", "Card")} {index + 1} / {items.length}
        </span>
        <div className="flex gap-1">
          <Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => move(-1)} aria-label={tr(fr, "Avancer la carte", "Move card earlier")}>
            <ChevronUp className="-rotate-90" />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={index === items.length - 1} onClick={() => move(1)} aria-label={tr(fr, "Reculer la carte", "Move card later")}>
            <ChevronDown className="-rotate-90" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={duplicate} aria-label={tr(fr, "Dupliquer la carte", "Duplicate card")}>
            <Copy />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={remove} aria-label={tr(fr, "Supprimer la carte", "Delete card")}>
            <Trash2 />
          </Button>
        </div>
      </div>
      {keys || part === "value" ? (
        <div className="space-y-2">
          {keys ? (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-ink-muted">{tr(fr, "Langue", "Language")}</span>
              <div className="flex rounded-md border border-border p-0.5">
                {(["fr", "en"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLang(value)}
                    className={`rounded px-2.5 py-0.5 text-xs font-bold uppercase transition ${lang === value ? "bg-brand text-brand-ink" : "text-ink-secondary"}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {part === "value" ? (
            <Input value={String(item.value ?? "")} onChange={(event) => setField("value", event.target.value)} />
          ) : key && (part === "body" || part === "answer") ? (
            <Textarea rows={5} value={String(item[key] ?? "")} onChange={(event) => setField(key, event.target.value)} />
          ) : key ? (
            <Input
              value={typeof item[key] === "string" ? String(item[key]) : (fallback ?? "")}
              placeholder={fallback}
              onChange={(event) => setField(key, event.target.value)}
            />
          ) : null}
          {part === "tag" || part === "link" ? (
            <p className="text-[11px] text-ink-muted">
              {tr(fr, "Laissez vide pour masquer cet élément.", "Leave empty to hide this element.")}
            </p>
          ) : null}
        </div>
      ) : null}
      {part === "link" ? (
        <Field label={tr(fr, "Lien (facultatif)", "Link (optional)")}>
          <Input placeholder="/contact" value={String(item.href ?? "")} onChange={(event) => setField("href", event.target.value)} />
        </Field>
      ) : null}
      {part === "image" || (!part && block.section_type === "gallery") ? (
        <WebsiteImagePicker
          orgSlug={orgSlug}
          value={String(item.imageUrl ?? item.image ?? "")}
          onChange={(url) => setField(typeof item.image === "string" ? "image" : "imageUrl", url)}
          fr={fr}
          label={tr(fr, "Image", "Image")}
        />
      ) : null}
      {part === "number" || (!part && block.section_type === "feature_grid") ? (
        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          <input type="checkbox" checked={item.hideNumber === true} onChange={(event) => setField("hideNumber", event.target.checked || undefined)} />
          {tr(fr, "Masquer le numéro de cette carte", "Hide this card’s number")}
        </label>
      ) : null}
      {!part ? (
        <p className="text-[11px] leading-4 text-ink-muted">
          {tr(
            fr,
            "Cliquez sur le titre, le texte, l’étiquette ou le lien de la carte dans l’aperçu pour les modifier un par un.",
            "Click the card’s title, text, tag or link in the preview to edit them one by one.",
          )}
        </p>
      ) : null}
      <Button size="sm" variant="secondary" onClick={() => addStandardItem(block, onChange, onSelectElement)}>
        <Plus />
        {tr(fr, "Ajouter une carte", "Add a card")}
      </Button>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Page → Bloc → Conteneur → Élément : tree, breadcrumb, page settings,
 * "Lien au clic" and page creation for the visual builder.
 * ──────────────────────────────────────────────────────────────────────── */

type LinkPage = { slug: string; label: string; labelFr?: string; labelEn?: string };
type TreeKindName = "page" | "block" | "container" | "element";
type TreeNode = { element: string; label: string; kind: TreeKindName; children: TreeNode[] };

const treeKindStyle: Record<TreeKindName, { fr: string; en: string; className: string }> = {
  page: { fr: "Page", en: "Page", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  block: { fr: "Bloc", en: "Block", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  container: { fr: "Conteneur", en: "Container", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  element: { fr: "Élément", en: "Element", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
};

function TreeKind({ kind, fr }: { kind: TreeKindName; fr: boolean }) {
  const style = treeKindStyle[kind];
  return (
    <span className={`shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide ${style.className}`}>
      {fr ? style.fr : style.en}
    </span>
  );
}

/** Full payload of a page, for saving its settings without touching the rest. */
function pageFieldsPayload(page: BuilderPage): Record<string, unknown> {
  return {
    slug: page.slug,
    navigationLabelFr: page.navigationLabelFr,
    navigationLabelEn: page.navigationLabelEn,
    titleFr: page.titleFr,
    titleEn: page.titleEn,
    descriptionFr: page.descriptionFr || null,
    descriptionEn: page.descriptionEn || null,
    seoTitleFr: page.seoTitleFr || null,
    seoTitleEn: page.seoTitleEn || null,
    seoDescriptionFr: page.seoDescriptionFr || null,
    seoDescriptionEn: page.seoDescriptionEn || null,
    templateCode: page.templateCode,
    isHome: page.isHome,
  };
}

/** The added elements from the block level down to the selected one. */
function extraChain(extras: WebsiteExtraElement[], element: string): WebsiteExtraElement[] {
  if (!element.startsWith("x:")) return [];
  const id = element.slice(2);
  for (const item of extras) {
    if (item.id === id) return [item];
    const nested = extraChain(item.children ?? [], element);
    if (nested.length) return [item, ...nested];
  }
  return [];
}

/** Name of a block. A free block that holds a carousel is called a carousel. */
function blockLabel(block: WebsiteSection, fr: boolean): string {
  if (block.section_type === "container") {
    const extras = readExtraElements(block.content);
    if (extras.length && extras[0]!.type === "slider")
      return fr ? "Carrousel / slider" : "Carousel / slider";
    if (!isDivBlock(block)) return fr ? "Bloc libre (ancien format)" : "Free block (old format)";
  }
  return sectionLabels[block.section_type][fr ? 0 : 1];
}

/** Readable name of an element, with a few words of its text: « Paragraphe : “Écrivez…” ». */
function describeElement(block: WebsiteSection, element: string, fr: boolean): string {
  const found = locateExtra(readExtraElements(block.content), element)?.item;
  if (!found) return elementDisplayName(element, fr);
  const type = (extraTypeLabels[found.type] ?? [found.type, found.type])[fr ? 0 : 1];
  const words = ((fr ? found.textFr : found.textEn) ?? found.textFr ?? "").trim();
  return words ? `${type} : “${words.length > 32 ? `${words.slice(0, 32)}…` : words}”` : type;
}

function elementDisplayName(element: string, fr: boolean): string {
  const itemMatch = element.match(/^item:(\d+)(?::([a-z]+))?$/);
  if (itemMatch) {
    const parts: Record<string, [string, string]> = {
      title: ["Titre", "Title"],
      body: ["Texte", "Text"],
      tag: ["Étiquette", "Tag"],
      link: ["Lien", "Link"],
      number: ["Numéro", "Number"],
      value: ["Chiffre", "Figure"],
      label: ["Libellé", "Label"],
      image: ["Image", "Image"],
      caption: ["Légende", "Caption"],
      question: ["Question", "Question"],
      answer: ["Réponse", "Answer"],
    };
    if (!itemMatch[2]) return `${fr ? "Carte" : "Card"} ${Number(itemMatch[1]) + 1}`;
    return (parts[itemMatch[2]] ?? [itemMatch[2], itemMatch[2]])[fr ? 0 : 1];
  }
  if (element.startsWith("x:")) return fr ? "cet élément" : "this element";
  return (elementLabels[element] ?? [element, element])[fr ? 0 : 1];
}

/** What a block contains, as tree nodes (containers can be opened). */
function blockTreeChildren(block: WebsiteSection, fr: boolean): TreeNode[] {
  const fromExtras = (items: WebsiteExtraElement[]): TreeNode[] =>
    items.map((item) => {
      const text = (fr ? item.textFr : item.textEn) ?? item.textFr ?? "";
      const name = extraTypeLabels[item.type]?.[fr ? 0 : 1] ?? item.type;
      return {
        element: `x:${item.id}`,
        label: text.trim() ? `${name} · ${text.trim().slice(0, 28)}` : name,
        kind: isContainerType(item.type) ? "container" : "element",
        children: fromExtras(item.children ?? []),
      };
    });
  const nodes: TreeNode[] = [];
  const builtIn: Record<string, string[]> = {
    hero: ["eyebrow", "title", "body", "buttons", "badges"],
    rich_text: ["eyebrow", "title", "body"],
    feature_grid: ["eyebrow", "title", "body"],
    metrics: ["eyebrow", "title", "body"],
    image_callout: ["eyebrow", "title", "body", "primaryButton"],
    gallery: ["eyebrow", "title", "body"],
    faq: ["eyebrow", "title", "body"],
    cta: ["eyebrow", "title", "body", "primaryButton"],
    careers: ["eyebrow", "title", "body", "sideCard"],
    contact: ["eyebrow", "title", "body", "buttons"],
    container: [],
  };
  const hidden = hiddenElementsOf(block);
  for (const name of (builtIn[block.section_type] ?? []).filter((candidate) => !hidden.includes(candidate)))
    nodes.push({
      element: name,
      label: elementDisplayName(name, fr),
      kind: name === "buttons" || name === "sideCard" ? "container" : "element",
      children: [],
    });
  const items = Array.isArray(block.content.items) ? (block.content.items as unknown[]) : [];
  if (items.length && ["feature_grid", "metrics", "gallery", "faq"].includes(block.section_type)) {
    nodes.push({
      element: "items",
      label: elementDisplayName("items", fr),
      kind: "container",
      children: items.map((_item, index) => ({
        element: `item:${index}`,
        label: `${fr ? "Carte" : "Card"} ${index + 1}`,
        kind: "container" as const,
        children: [],
      })),
    });
  }
  // A Div block is the div itself: its children hang directly under it.
  if (isDivBlock(block)) return fromExtras(readExtraElements(block.content));
  if (block.section_type === "container")
    return [{ element: "canvas", label: elementDisplayName("canvas", fr), kind: "container", children: fromExtras(readExtraElements(block.content)) }];
  return [...nodes, ...fromExtras(readExtraElements(block.content))];
}

/** What is being dragged in the structure tree: an element or a new one. */
type TreeDrag = BuilderDrag;

/** Which drop positions a tree node accepts. */
function dropZonesOf(node: TreeNode): { inside: boolean; around: boolean } {
  if (node.element === "canvas") return { inside: true, around: false };
  if (node.element.startsWith("x:")) return { inside: node.kind === "container", around: true };
  if (TOP_LEVEL_BUILT_INS.includes(node.element) || node.element === "primaryButton") return { inside: false, around: true };
  return { inside: false, around: false };
}

function TreeNodes({
  nodes,
  selected,
  onSelect,
  onDrop,
  hint: sharedHint,
  setHint: setSharedHint,
  fr,
}: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (element: string) => void;
  /** Enables drag and drop (WordPress-like) in this tree. */
  onDrop?: (drag: TreeDrag, target: DropTarget) => void;
  hint?: DropTarget | null;
  setHint?: (hint: DropTarget | null) => void;
  fr: boolean;
}) {
  const [ownHint, setOwnHint] = useState<DropTarget | null>(null);
  const hint = setSharedHint ? sharedHint ?? null : ownHint;
  const setHint = setSharedHint ?? setOwnHint;
  const whereAt = (node: TreeNode, event: React.DragEvent<HTMLElement>): DropTarget["where"] | null => {
    const zones = dropZonesOf(node);
    if (!dragState.current || (!zones.inside && !zones.around)) return null;
    if (dragState.current.move === node.element) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    if (zones.inside && (!zones.around || (ratio > 0.28 && ratio < 0.72))) return "inside";
    if (!zones.around) return null;
    return ratio < 0.5 ? "before" : "after";
  };
  return (
    <ul className="ml-4 list-none space-y-0.5 border-l border-border py-0.5 pl-2">
      {nodes.map((node) => {
        const draggable = Boolean(onDrop) && node.element.startsWith("x:");
        const marked = hint?.element === node.element ? hint.where : null;
        return (
          <li key={node.element} className="relative">
            {marked === "before" ? <span aria-hidden="true" className="absolute -top-0.5 left-0 right-0 h-0.5 rounded bg-brand" /> : null}
            <button
              type="button"
              draggable={draggable}
              onDragStart={(event) => {
                event.stopPropagation();
                dragState.current = { move: node.element };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", node.element);
              }}
              onDragEnd={() => {
                dragState.current = null;
                setHint(null);
              }}
              onDragOver={
                onDrop
                  ? (event) => {
                      const where = whereAt(node, event);
                      if (!where) return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (hint?.element !== node.element || hint.where !== where) setHint({ element: node.element, where });
                    }
                  : undefined
              }
              onDragLeave={() => {
                if (hint?.element === node.element) setHint(null);
              }}
              onDrop={
                onDrop
                  ? (event) => {
                      const where = whereAt(node, event);
                      const drag = dragState.current;
                      setHint(null);
                      dragState.current = null;
                      if (!where || !drag) return;
                      event.preventDefault();
                      event.stopPropagation();
                      onDrop(drag, { element: node.element, where });
                    }
                  : undefined
              }
              onClick={() => onSelect(node.element)}
              title={draggable ? tr(fr, "Glissez pour déplacer (dans un conteneur, avant ou après)", "Drag to move (into a container, before or after)") : undefined}
              className={`flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-xs transition ${
                marked === "inside"
                  ? "border-brand bg-brand/10 text-ink"
                  : selected === node.element
                    ? "border-sky-500 bg-sky-500/10 text-ink"
                    : "border-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink"
              } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              {draggable ? <GripVertical className="size-3 shrink-0 text-ink-muted" /> : null}
              <TreeKind kind={node.kind} fr={fr} />
              <span className="truncate">{node.label}</span>
              {marked === "inside" ? (
                <span className="ml-auto shrink-0 text-[10px] font-semibold text-brand">{tr(fr, "Déposer dedans", "Drop inside")}</span>
              ) : null}
            </button>
            {marked === "after" ? <span aria-hidden="true" className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded bg-brand" /> : null}
            {node.children.length ? (
              <TreeNodes nodes={node.children} selected={selected} onSelect={onSelect} onDrop={onDrop} hint={hint} setHint={setHint} fr={fr} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Always says what is selected, and lets you climb back up the tree. */
function SelectionBreadcrumb({
  path,
  fr,
}: {
  path: Array<{ kind: TreeKindName; label: string; onClick?: () => void }>;
  fr: boolean;
}) {
  const current = path[path.length - 1]!;
  return (
    <div className="space-y-1 border-b border-border bg-surface-2/60 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs text-ink">
        <span className="text-ink-muted">{tr(fr, "Vous modifiez :", "You are editing:")}</span>
        <TreeKind kind={current.kind} fr={fr} />
        <strong className="truncate">{current.label}</strong>
      </p>
      <nav aria-label={tr(fr, "Chemin de la sélection", "Selection path")} className="flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
        {path.map((step, index) => (
          <span key={`${step.kind}-${index}`} className="inline-flex items-center gap-1">
            {index ? <span aria-hidden="true">›</span> : null}
            {step.onClick && index < path.length - 1 ? (
              <button type="button" onClick={step.onClick} className="hover:text-brand hover:underline">
                {step.label}
              </button>
            ) : (
              <span className={index === path.length - 1 ? "font-semibold text-ink" : ""}>{step.label}</span>
            )}
          </span>
        ))}
      </nav>
      <p className="text-[10px] leading-4 text-ink-muted">
        {tr(fr, "Les réglages ci-dessous ne modifient que cette sélection.", "The settings below only change this selection.")}
      </p>
    </div>
  );
}

/** Page design: background, content width, spacing, header and footer. */
function PageLayoutFields({
  value,
  onChange,
  dirty,
  saving,
  onSave,
  onReset,
  fr,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  fr: boolean;
}) {
  const set = (key: string, next: unknown) => {
    const result = { ...value, [key]: next };
    if (next === undefined || next === "") delete result[key];
    onChange(result);
  };
  return (
    <section className="space-y-3 rounded-xl border border-violet-500/30 p-3">
      <div>
        <p className="text-sm font-semibold text-ink">{tr(fr, "Mise en page de toute la page", "Whole-page layout")}</p>
        <p className="text-[11px] text-ink-muted">
          {tr(
            fr,
            "S’applique à toute la page. Les blocs gardent leurs propres réglages.",
            "Applies to the whole page. Blocks keep their own settings.",
          )}
        </p>
      </div>
      <label className="flex items-start justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
        <span>
          <span className="block font-medium">{tr(fr, "Afficher dans les menus du site", "Show in the site menus")}</span>
          <span className="block text-[11px] text-ink-muted">
            {tr(
              fr,
              "Header, top bar et footer. Décochée, la page reste accessible par son adresse et vos liens.",
              "Header, top bar and footer. Unticked, the page stays reachable by its address and your links.",
            )}
          </span>
        </span>
        <input
          type="checkbox"
          className="mt-1 size-4 accent-violet-600"
          checked={value.hideFromMenu !== true}
          onChange={(event) => set("hideFromMenu", event.target.checked ? undefined : true)}
        />
      </label>
      <BlockColorField
        label={tr(fr, "Fond général de la page", "Page background")}
        value={value.background}
        onChange={(next) => set("background", next)}
        fallback="#fbfcf8"
        fr={fr}
      />
      <InspectorRow label={tr(fr, "Largeur du contenu", "Content width")}>
        <Segmented
          value={value.contentWidth}
          onChange={(next) => set("contentWidth", next)}
          options={[
            ["narrow", tr(fr, "Étroite", "Narrow")],
            ["normal", tr(fr, "Normale", "Normal")],
            ["wide", tr(fr, "Large", "Wide")],
            ["full", tr(fr, "Pleine largeur", "Full width")],
          ]}
        />
      </InspectorRow>
      <div className="grid grid-cols-3 gap-1.5">
        <NumInput label={tr(fr, "Espace entre blocs", "Gap between blocks")} value={value.blockGap} max={200} placeholder="0" onChange={(next) => set("blockGap", next)} />
        <NumInput label={tr(fr, "Marge haut", "Top padding")} value={value.paddingTop} max={300} placeholder="0" onChange={(next) => set("paddingTop", next)} />
        <NumInput label={tr(fr, "Marge bas", "Bottom padding")} value={value.paddingBottom} max={300} placeholder="0" onChange={(next) => set("paddingBottom", next)} />
      </div>
      <InspectorRow label={tr(fr, "En-tête du site", "Site header")}>
        <Segmented
          value={value.header ?? "standard"}
          onChange={(next) => set("header", next === "standard" ? undefined : next)}
          options={[
            ["standard", tr(fr, "Complet", "Full")],
            ["minimal", tr(fr, "Simplifié", "Simple")],
            ["hidden", tr(fr, "Masqué", "Hidden")],
          ]}
        />
      </InspectorRow>
      <InspectorRow label={tr(fr, "Pied de page", "Footer")}>
        <Segmented
          value={value.footer ?? "standard"}
          onChange={(next) => set("footer", next === "standard" ? undefined : next)}
          options={[
            ["standard", tr(fr, "Complet", "Full")],
            ["minimal", tr(fr, "Simplifié", "Simple")],
            ["hidden", tr(fr, "Masqué", "Hidden")],
          ]}
        />
      </InspectorRow>
      <p className="text-[11px] text-ink-muted">
        {tr(
          fr,
          "Les espacements se réduisent automatiquement sur tablette et mobile.",
          "Spacing shrinks automatically on tablet and phone.",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={saving} disabled={!dirty} onClick={onSave}>
          <Save />
          {tr(fr, "Enregistrer la mise en page", "Save page layout")}
        </Button>
        {dirty ? (
          <Button size="sm" variant="ghost" onClick={onReset}>
            <RotateCcw />
            {tr(fr, "Annuler", "Discard")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** "Lien au clic": an internal page, or a URL / anchor, same or new tab. */
/** Blocks of the page being edited, for "Aller vers une section" links. */
const PageSectionsContext = createContext<{
  sections: Array<{ label: string; anchor?: string }>;
  ensureAnchor: (index: number) => string;
} | null>(null);

function LinkFields({
  value,
  onChange,
  pages,
  orgSlug,
  subject,
  fr,
}: {
  value: unknown;
  onChange: (next: Record<string, unknown> | undefined) => void;
  pages: LinkPage[];
  orgSlug: string;
  subject: string;
  fr: boolean;
}) {
  const link = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const kind = link?.kind === "page" || link?.kind === "url" ? (link.kind as string) : "";
  const url = typeof link?.url === "string" ? link.url : "";
  const urlValid =
    !url ||
    /^#[\w-]+$/.test(url) ||
    (/^\/(?!\/)/.test(url)) ||
    /^(mailto|tel):/.test(url) ||
    (() => {
      try {
        return new URL(url).protocol === "https:";
      } catch {
        return false;
      }
    })();
  const set = (patch: Record<string, unknown>) => onChange({ ...(link ?? {}), ...patch });
  const pageSections = useContext(PageSectionsContext);
  const mode = !kind
    ? "none"
    : kind === "page"
      ? "page"
      : url.startsWith("#")
        ? "section"
        : url.startsWith("mailto:")
          ? "email"
          : url.startsWith("tel:")
            ? "phone"
            : "external";
  const testHref =
    kind === "page" && typeof link?.page === "string"
      ? `/sites/${orgSlug}/${link.page}`
      : kind === "url" && url && urlValid
        ? url.startsWith("/") && !url.startsWith(`/sites/`)
          ? `/sites/${orgSlug}${url}`
          : url
        : null;
  return (
    <section className="space-y-3 rounded-xl border border-sky-500/30 p-3">
      <div>
        <p className="text-sm font-semibold text-ink">{tr(fr, "Lien au clic", "Link on click")}</p>
        <p className="text-[11px] leading-4 text-ink-muted">
          {tr(
            fr,
            `Toute la surface de ${subject} devient cliquable sur le site. Les boutons et liens à l’intérieur gardent leur propre action. Dans l’éditeur, un clic sélectionne toujours sans quitter la page.`,
            `The whole area of ${subject} becomes clickable on the site. Buttons and links inside keep their own action. In the editor, a click always selects without leaving the page.`,
          )}
        </p>
      </div>
      <Segmented
        value={mode}
        onChange={(next) => {
          if (!next || next === "none") onChange(undefined);
          else if (next === "page") set({ kind: "page" });
          else if (next === "section") set({ kind: "url", url: "#", newTab: undefined });
          else if (next === "email") set({ kind: "url", url: "mailto:", newTab: undefined });
          else if (next === "phone") set({ kind: "url", url: "tel:", newTab: undefined });
          else set({ kind: "url", url: "https://" });
        }}
        options={[
          ["none", tr(fr, "Aucun", "None")],
          ["page", tr(fr, "Page du site", "Website page")],
          ["section", tr(fr, "Section de cette page", "Section of this page")],
          ["external", tr(fr, "Adresse externe", "External address")],
          ["email", tr(fr, "E-mail", "Email")],
          ["phone", tr(fr, "Téléphone", "Phone")],
        ]}
      />
      {kind === "page" ? (
        <select
          value={typeof link?.page === "string" ? link.page : ""}
          onChange={(event) => set({ page: event.target.value || undefined })}
          className="h-9 w-full rounded-md border border-border bg-surface-1 px-2 text-sm text-ink"
          aria-label={tr(fr, "Page de destination", "Destination page")}
        >
          <option value="">{tr(fr, "Choisir une page…", "Choose a page…")}</option>
          {pages.map((candidate) => (
            <option key={candidate.slug} value={candidate.slug}>
              {candidate.label} (/{candidate.slug})
            </option>
          ))}
        </select>
      ) : null}
      {mode === "section" ? (
        pageSections?.sections.length ? (
          <select
            value={pageSections.sections.findIndex((section) => section.anchor && `#${section.anchor}` === url)}
            onChange={(event) => {
              const index = Number(event.target.value);
              if (index >= 0) set({ kind: "url", url: `#${pageSections.ensureAnchor(index)}` });
            }}
            className="h-9 w-full rounded-md border border-border bg-surface-1 px-2 text-sm text-ink"
            aria-label={tr(fr, "Section de destination", "Destination section")}
          >
            <option value={-1}>{tr(fr, "Choisir un bloc de la page…", "Choose a block of the page…")}</option>
            {pageSections.sections.map((section, index) => (
              <option key={index} value={index}>
                {section.label}
              </option>
            ))}
          </select>
        ) : (
          <Input value={url} placeholder="#contact" onChange={(event) => set({ url: `#${event.target.value.replace(/^#/, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}` })} />
        )
      ) : null}
      {mode === "email" ? (
        <Field label={tr(fr, "Adresse e-mail", "Email address")}>
          <Input
            type="email"
            value={url.replace(/^mailto:/, "")}
            placeholder="contact@exemple.com"
            onChange={(event) => set({ url: `mailto:${event.target.value.trim()}` })}
          />
        </Field>
      ) : null}
      {mode === "phone" ? (
        <Field label={tr(fr, "Numéro de téléphone", "Phone number")}>
          <Input
            type="tel"
            value={url.replace(/^tel:/, "")}
            placeholder="+243 000 000 000"
            onChange={(event) => set({ url: `tel:${event.target.value.replace(/[^\d+]/g, "")}` })}
          />
        </Field>
      ) : null}
      {mode === "external" ? (
        <Field label={tr(fr, "Adresse", "Address")}>
          <Input
            value={url}
            placeholder="https://… · /contact · #contact"
            onChange={(event) => set({ url: event.target.value })}
          />
          {!urlValid ? (
            <p className="mt-1 text-[11px] text-critical">
              {tr(
                fr,
                "Adresse non acceptée : utilisez https://…, /page, #ancre, mailto: ou tel:.",
                "Address not accepted: use https://…, /page, #anchor, mailto: or tel:.",
              )}
            </p>
          ) : null}
        </Field>
      ) : null}
      {kind ? (
        <>
          <Field label={tr(fr, "Texte lu par les lecteurs d’écran (facultatif)", "Screen-reader text (optional)")}>
            <Input
              value={typeof link?.label === "string" ? link.label : ""}
              placeholder={tr(fr, "Ex. : Découvrir nos activités", "E.g. Discover our activities")}
              onChange={(event) => set({ label: event.target.value || undefined })}
            />
          </Field>
          {mode === "external" || mode === "page" ? (
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={link?.newTab === true}
                onChange={(event) => set({ newTab: event.target.checked || undefined })}
              />
              {tr(fr, "Ouvrir dans un nouvel onglet", "Open in a new tab")}
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!testHref}
              onClick={() => testHref && window.open(testHref, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink />
              {tr(fr, "Tester le lien", "Test the link")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
              <Trash2 />
              {tr(fr, "Supprimer le lien", "Remove link")}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Creates a new empty page and opens it in the visual builder. */
function NewPageForm({
  pages,
  saving,
  onCancel,
  onCreate,
  fr,
}: {
  pages: BuilderPage[];
  saving: boolean;
  onCancel: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
  fr: boolean;
}) {
  const [nameFr, setNameFr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [summaryFr, setSummaryFr] = useState("");
  const [summaryEn, setSummaryEn] = useState("");
  const [seoTitleFr, setSeoTitleFr] = useState("");
  const [seoTitleEn, setSeoTitleEn] = useState("");
  const [seoDescriptionFr, setSeoDescriptionFr] = useState("");
  const [seoDescriptionEn, setSeoDescriptionEn] = useState("");
  const [inMenu, setInMenu] = useState(false);
  const [template, setTemplate] = useState("blank");
  const slugify = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  const finalSlug = slugEdited ? slug : slugify(nameFr);
  const taken = pages.some((page) => page.slug === finalSlug);
  const valid =
    nameFr.trim().length >= 2 &&
    nameEn.trim().length >= 2 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(finalSlug) &&
    !taken;
  const optional = (value: string) => value.trim() || null;
  return (
    <div className="space-y-2 rounded-lg border border-violet-500/30 bg-violet-500/[.04] p-2">
      <div className="space-y-1">
        <span className="text-xs font-semibold text-ink">{tr(fr, "Modèle de page", "Page template")}</span>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(PAGE_TEMPLATES).map(([key, entry]) => (
            <button
              key={key}
              type="button"
              aria-pressed={template === key}
              onClick={() => {
                setTemplate(key);
                if (!nameFr.trim() && entry.nameFr) setNameFr(entry.nameFr);
                if (!nameEn.trim() && entry.nameEn) setNameEn(entry.nameEn);
              }}
              className={`rounded-md border px-2 py-1.5 text-left transition ${
                template === key ? "border-violet-500 bg-violet-500/10" : "border-border bg-surface-1 hover:border-violet-400"
              }`}
            >
              <span className="block text-xs font-semibold text-ink">{entry.label[fr ? 0 : 1]}</span>
              <span className="block text-[10px] leading-3 text-ink-muted">{entry.hint[fr ? 0 : 1]}</span>
            </button>
          ))}
        </div>
      </div>
      <Field label={tr(fr, "Nom de la page (français)", "Page name (French)")} required>
        <Input value={nameFr} placeholder="Ex. : Nos services" onChange={(event) => setNameFr(event.target.value)} />
      </Field>
      <Field label={tr(fr, "Nom de la page (anglais)", "Page name (English)")} required>
        <Input value={nameEn} placeholder="E.g. Our services" onChange={(event) => setNameEn(event.target.value)} />
      </Field>
      <Field label={tr(fr, "Adresse (slug)", "Address (slug)")}>
        <Input
          value={finalSlug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(slugify(event.target.value));
          }}
        />
      </Field>
      {taken ? (
        <p className="text-[11px] text-critical">{tr(fr, "Cette adresse existe déjà.", "This address already exists.")}</p>
      ) : null}
      <details className="rounded-md border border-border bg-surface-1 px-2 py-1.5">
        <summary className="cursor-pointer text-xs font-semibold text-ink">
          {tr(fr, "Résumé et référencement (SEO), FR / EN", "Summary and search (SEO), FR / EN")}
        </summary>
        <div className="mt-2 space-y-2">
          <Field label={tr(fr, "Résumé français", "French summary")}>
            <Textarea rows={2} value={summaryFr} onChange={(event) => setSummaryFr(event.target.value)} />
          </Field>
          <Field label={tr(fr, "Résumé anglais", "English summary")}>
            <Textarea rows={2} value={summaryEn} onChange={(event) => setSummaryEn(event.target.value)} />
          </Field>
          <Field label={tr(fr, "Titre SEO français", "French SEO title")} hint={`${seoTitleFr.length}/60`}>
            <Input maxLength={180} value={seoTitleFr} onChange={(event) => setSeoTitleFr(event.target.value)} />
          </Field>
          <Field label={tr(fr, "Titre SEO anglais", "English SEO title")} hint={`${seoTitleEn.length}/60`}>
            <Input maxLength={180} value={seoTitleEn} onChange={(event) => setSeoTitleEn(event.target.value)} />
          </Field>
          <Field label={tr(fr, "Description SEO française", "French SEO description")} hint={`${seoDescriptionFr.length}/160`}>
            <Textarea rows={2} maxLength={320} value={seoDescriptionFr} onChange={(event) => setSeoDescriptionFr(event.target.value)} />
          </Field>
          <Field label={tr(fr, "Description SEO anglaise", "English SEO description")} hint={`${seoDescriptionEn.length}/160`}>
            <Textarea rows={2} maxLength={320} value={seoDescriptionEn} onChange={(event) => setSeoDescriptionEn(event.target.value)} />
          </Field>
        </div>
      </details>
      <label className="flex items-center justify-between gap-2 text-xs text-ink">
        {tr(fr, "Afficher dans les menus du site (header, footer)", "Show in the site menus (header, footer)")}
        <input type="checkbox" className="size-4 accent-violet-600" checked={inMenu} onChange={(event) => setInMenu(event.target.checked)} />
      </label>
      <p className="text-[11px] text-ink-muted">
        {tr(
          fr,
          "La page est créée en brouillon (avec les blocs du modèle choisi) : invisible pour les visiteurs et absente des menus tant qu’elle n’est pas publiée.",
          "The page is created as a draft (with the chosen template’s blocks): invisible to visitors and absent from menus until it is published.",
        )}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={saving}
          disabled={!valid}
          onClick={() =>
            void onCreate({
              slug: finalSlug,
              navigationLabelFr: nameFr.trim(),
              navigationLabelEn: nameEn.trim(),
              titleFr: nameFr.trim(),
              titleEn: nameEn.trim(),
              descriptionFr: optional(summaryFr),
              descriptionEn: optional(summaryEn),
              seoTitleFr: optional(seoTitleFr),
              seoTitleEn: optional(seoTitleEn),
              seoDescriptionFr: optional(seoDescriptionFr),
              seoDescriptionEn: optional(seoDescriptionEn),
              settings: inMenu ? {} : { hideFromMenu: true },
              templateCode: "blank",
              isHome: false,
              __sections: PAGE_TEMPLATES[template]?.build() ?? [],
            }).catch(() => undefined)
          }
        >
          <FilePlus2 />
          {tr(fr, "Créer et ouvrir", "Create and open")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {tr(fr, "Annuler", "Cancel")}
        </Button>
      </div>
    </div>
  );
}

/** What is still missing on a page: English translation and SEO. */
function PageChecklist({ page, fr }: { page: BuilderPage; fr: boolean }) {
  const same = (a: string | null, b: string | null) =>
    Boolean(a?.trim()) && a?.trim().toLowerCase() === b?.trim().toLowerCase();
  const empty = (value: string | null) => !value?.trim();
  const checks: Array<[boolean, string]> = [
    [!empty(page.titleEn) && !same(page.titleFr, page.titleEn), tr(fr, "Titre traduit en anglais", "Title translated into English")],
    [!empty(page.navigationLabelEn) && !same(page.navigationLabelFr, page.navigationLabelEn), tr(fr, "Nom du menu traduit en anglais", "Menu label translated into English")],
    [!empty(page.seoTitleFr) && !empty(page.seoDescriptionFr), tr(fr, "SEO français (titre + description)", "French SEO (title + description)")],
    [!empty(page.seoTitleEn) && !empty(page.seoDescriptionEn), tr(fr, "SEO anglais (titre + description)", "English SEO (title + description)")],
    [!empty(page.descriptionFr) && !empty(page.descriptionEn), tr(fr, "Résumé FR et EN", "FR and EN summary")],
  ];
  const missing = checks.filter(([ok]) => !ok).length;
  // Words that are the same in both languages (e.g. "Contact") are fine.
  return (
    <section className={`space-y-1.5 rounded-xl border p-3 ${missing ? "border-amber-500/40 bg-amber-500/[.06]" : "border-emerald-500/30 bg-emerald-500/[.05]"}`}>
      <p className="text-sm font-semibold text-ink">
        {missing
          ? tr(fr, `À compléter : ${missing} point(s)`, `To complete: ${missing} item(s)`)
          : tr(fr, "Traduction et SEO complets", "Translation and SEO complete")}
      </p>
      <ul className="space-y-0.5 text-xs">
        {checks.map(([ok, text]) => (
          <li key={text} className={`flex items-center gap-1.5 ${ok ? "text-ink-secondary" : "text-amber-800 dark:text-amber-300"}`}>
            {ok ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <X className="size-3.5" />}
            {text}
          </li>
        ))}
      </ul>
      {missing ? (
        <p className="text-[11px] text-ink-muted">
          {tr(
            fr,
            "Complétez ces champs plus bas, dans « Titre, adresse (slug) et SEO ». Un mot identique dans les deux langues (ex. « Contact ») peut rester tel quel.",
            "Fill these in below, under “Title, address (slug) and SEO”. A word that is the same in both languages (e.g. “Contact”) can stay as it is.",
          )}
        </p>
      ) : null}
    </section>
  );
}

/* ── Site design: global zones (top bar, header, footer) and themes ───── */

const zoneLabels: Record<ZoneName, [string, string]> = {
  topbar: ["Top bar (barre supérieure)", "Top bar"],
  header: ["Header (en-tête)", "Header"],
  footer: ["Footer (pied de page)", "Footer"],
};

type AddIcon = typeof Copy;
const blockAddTypes: ReadonlyArray<readonly [WebsiteExtraElement["type"], AddIcon]> = [
  ["group", LayoutPanelTop],
  ["slider", GalleryHorizontal],
  ["heading", Heading2],
  ["text", TextIcon],
  ["button", MousePointerClick],
  ["image", ImagePlus],
  ["spacer", MoveVertical],
];
const zoneAddTypes: ReadonlyArray<readonly [WebsiteExtraElement["type"], AddIcon]> = [
  ["group", LayoutPanelTop],
  ["heading", Heading2],
  ["text", TextIcon],
  ["button", MousePointerClick],
  ["image", ImagePlus],
  ["spacer", MoveVertical],
  ["logo", Gem],
  ["menu", Menu],
  ["language", Languages],
  ["social", Share2],
  ["contact", Phone],
  ["copyright", Copyright],
  ["newsletter", Mail],
];

/** JSON with sorted keys: the database stores objects with its own key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
}

let cloneSeed = 0;
/** Copies an element (and what it contains) with new ids and the same styles. */
function cloneWithStyles(
  item: WebsiteExtraElement,
  styles: Record<string, unknown>,
): { item: WebsiteExtraElement; styles: Record<string, unknown> } {
  const added: Record<string, unknown> = {};
  const copy = (source: WebsiteExtraElement): WebsiteExtraElement => {
    const id = `${source.type}-${Date.now().toString(36)}${(cloneSeed++).toString(36)}`.slice(0, 40);
    const style = styles[`x:${source.id}`];
    if (style) added[`x:${id}`] = JSON.parse(JSON.stringify(style)) as unknown;
    return {
      ...(JSON.parse(JSON.stringify(source)) as WebsiteExtraElement),
      id,
      children: source.children?.map(copy),
    };
  };
  return { item: copy(item), styles: added };
}

/** "Thème du site": colours, fonts, buttons and cards for the whole site. */
function ThemePanel({
  value,
  onChange,
  fr,
}: {
  value: string | undefined;
  onChange: (theme: string | undefined) => void;
  fr: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-violet-500/30 bg-violet-500/[.05] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Paintbrush className="size-4 text-violet-600" />
          {tr(fr, "Thème du site", "Site theme")}
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          {tr(
            fr,
            "Un thème change tout le design : couleurs et fond des pages, polices, boutons, cartes, cadres, et le style de la top bar, du header, du footer et des liens du menu. Il peut aussi appliquer ses modèles de zones. Vos pages, textes, images, liens et blocs restent tels quels, et vos propres réglages d’éléments gardent la priorité.",
            "A theme changes the whole design: page colours and background, fonts, buttons, cards, panels, and the style of the top bar, header, footer and menu links. It can also apply its zone templates. Your pages, texts, images, links and blocks stay as they are, and your own element settings keep priority.",
          )}
        </p>
      </div>
      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className={`rounded-xl border p-2.5 text-left transition ${
            !value ? "border-violet-500 ring-2 ring-violet-500/30" : "border-border hover:border-violet-400"
          }`}
        >
          <span className="block text-sm font-semibold text-ink">{tr(fr, "Identité actuelle", "Current identity")}</span>
          <span className="block text-xs text-ink-muted">
            {tr(fr, "Le design d’origine, avec les couleurs d’« Apparence & domaine ».", "The original design, with the colours from “Appearance & domain”.")}
          </span>
        </button>
        {Object.entries(SITE_THEMES).map(([key, theme]) => {
          const zoneColor = (look: string) =>
            look === "dark" ? theme.dark : look === "accent" ? theme.primary : look === "light" ? theme.alt : look === "transparent" ? theme.dark : theme.surface;
          const zoneText = (look: string) => (look === "dark" || look === "accent" || look === "transparent" ? "#ffffff" : theme.text);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={value === key}
              className={`overflow-hidden rounded-xl border text-left transition ${
                value === key ? "border-violet-500 ring-2 ring-violet-500/30" : "border-border hover:border-violet-400"
              }`}
            >
              {/* Small sketch of a page with this theme */}
              <span aria-hidden="true" className="block" style={{ background: theme.background }}>
                {theme.hideTopbar ? null : <span className="block h-2" style={{ background: zoneColor(theme.looks.topbar) }} />}
                <span
                  className="flex items-center justify-between px-2 py-1.5"
                  style={{
                    background: zoneColor(theme.looks.header),
                    color: zoneText(theme.looks.header),
                    margin: theme.looks.header === "floating" ? "4px 6px 0" : undefined,
                    borderRadius: theme.looks.header === "floating" ? 8 : undefined,
                    borderBottom: theme.looks.header === "bordered" ? `1px solid ${theme.border}` : undefined,
                  }}
                >
                  <span className="h-2 w-8 rounded" style={{ background: theme.looks.header === "transparent" ? theme.accent : theme.primary }} />
                  <span className="flex gap-1">
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="h-1.5 w-4"
                        style={{
                          background: "currentColor",
                          opacity: 0.45,
                          borderRadius: theme.links === "pill" ? 999 : 1,
                        }}
                      />
                    ))}
                  </span>
                </span>
                <span className="flex items-center gap-2 px-2 py-2">
                  <span
                    className="h-4 w-12"
                    style={{
                      borderRadius: Math.min(theme.buttonRadius, 10),
                      background: theme.buttonStyle === "outline" ? "transparent" : theme.buttonStyle === "soft" ? `${theme.primary}22` : theme.primary,
                      border: `2px solid ${theme.buttonStyle === "soft" ? "transparent" : theme.primary}`,
                    }}
                  />
                  <span className="h-5 flex-1" style={{ background: theme.surface, borderRadius: Math.min(theme.cardRadius, 8), boxShadow: theme.cardShadow === "none" ? `0 0 0 1px ${theme.border}` : theme.cardShadow }} />
                  <span className="h-5 flex-1" style={{ background: theme.alt, borderRadius: Math.min(theme.panelRadius, 8) }} />
                  <span className="size-3 rounded-full" style={{ background: theme.accent }} />
                </span>
                <span className="block h-3" style={{ background: zoneColor(theme.looks.footer), borderTop: theme.looks.footer === "minimal" ? `1px solid ${theme.border}` : undefined }} />
              </span>
              <span className="block px-2.5 py-2">
                <span className="block text-sm font-semibold text-ink">{theme.label[fr ? 0 : 1]}</span>
                <span className="block text-xs text-ink-muted">{theme.description[fr ? 0 : 1]}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Draft / publish / earlier versions of the site design. */
function DesignPublishPanel({
  dirty,
  unpublished,
  history,
  saving,
  publishing,
  restoring,
  onSave,
  onPublish,
  onRestore,
  onDiscardDraft,
  fr,
}: {
  dirty: boolean;
  unpublished: boolean;
  history: Array<{ savedAt: string; original?: boolean }>;
  saving: boolean;
  publishing: boolean;
  restoring: boolean;
  onSave: () => void;
  onPublish: () => void;
  onRestore: (index: number) => void;
  onDiscardDraft: () => void;
  fr: boolean;
}) {
  const date = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleString(fr ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  };
  return (
    <section className="space-y-3 rounded-xl border border-border p-3">
      <p className="text-sm font-semibold text-ink">{tr(fr, "Publication du design du site", "Site design publication")}</p>
      <p className="text-xs leading-5 text-ink-secondary">
        {dirty
          ? tr(fr, "Modifications en cours, visibles seulement dans cet éditeur.", "Changes in progress, visible only in this editor.")
          : unpublished
            ? tr(fr, "Brouillon enregistré, pas encore visible par les visiteurs.", "Draft saved, not yet visible to visitors.")
            : tr(fr, "Les visiteurs voient ce design.", "Visitors see this design.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={saving} disabled={!dirty} onClick={onSave}>
          <Save />
          {tr(fr, "Enregistrer le brouillon", "Save draft")}
        </Button>
        <Button size="sm" loading={publishing} disabled={!dirty && !unpublished} onClick={onPublish}>
          <Send />
          {tr(fr, "Publier sur toutes les pages", "Publish on every page")}
        </Button>
        {unpublished || dirty ? (
          <Button size="sm" variant="ghost" onClick={onDiscardDraft}>
            <RotateCcw />
            {tr(fr, "Revenir au design publié", "Back to published design")}
          </Button>
        ) : null}
      </div>
      {history.length ? (
        <div className="space-y-1.5 border-t border-border pt-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
            <History className="size-3.5" />
            {tr(fr, "Designs publiés précédemment", "Previously published designs")}
          </p>
          {history.map((entry, index) => (
            <div key={`${entry.savedAt}-${index}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-ink-secondary">
                {entry.original
                  ? tr(fr, "Design d’origine (production)", "Original design (production)")
                  : index === 0
                    ? tr(fr, "Précédent", "Previous")
                    : `#${index + 1}`}{" "}
                · {date(entry.savedAt)}
              </span>
              <Button size="sm" variant="ghost" loading={restoring} onClick={() => onRestore(index)}>
                <Undo2 />
                {tr(fr, "Revenir à ce design", "Use this design")}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** Schematic preview of a zone template. */
function ZoneTemplatePreview({ name, template }: { name: ZoneName; template: string }) {
  const bar = (width: string, strong = false) => (
    <span className={`block h-1.5 rounded ${strong ? "bg-current" : "bg-current/40"}`} style={{ width }} />
  );
  const logo = <span className="block size-3 shrink-0 rounded bg-emerald-500" />;
  const button = <span className="block h-2.5 w-7 shrink-0 rounded-full bg-amber-400" />;
  const dots = (
    <span className="flex gap-0.5">
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="block size-1.5 rounded-full bg-current/60" />
      ))}
    </span>
  );
  const box = "flex h-12 w-full items-center gap-1.5 rounded-md px-2";
  if (name === "topbar") {
    const shell = `${box} h-8 bg-slate-900 text-slate-200`;
    if (template === "announcement")
      return <span className={`${shell} justify-center`}>{bar("55%")}</span>;
    if (template === "social")
      return <span className={`${shell} justify-between`}>{bar("40%")}{dots}</span>;
    if (template === "announcement-button")
      return <span className={`${shell} justify-center`}>{bar("40%")}{button}</span>;
    return <span className={`${shell} justify-between`}><span className="flex w-1/2 gap-1">{bar("30%")}{bar("30%")}{bar("25%")}</span>{dots}</span>;
  }
  if (name === "header") {
    const shell = `${box} border border-slate-200 bg-white text-slate-700`;
    if (template === "centered")
      return (
        <span className={`${shell} flex-col justify-center gap-1`}>
          {logo}
          <span className="flex w-2/3 justify-center gap-1">{bar("20%")}{bar("20%")}{bar("20%")}</span>
        </span>
      );
    if (template === "two-rows")
      return (
        <span className={`${shell} flex-col justify-center gap-1`}>
          <span className="flex w-full items-center justify-between">{logo}<span className="flex gap-1">{bar("1.5rem")}{button}</span></span>
          <span className="flex w-full gap-1 border-t border-slate-200 pt-1">{bar("15%")}{bar("15%")}{bar("15%")}{bar("15%")}</span>
        </span>
      );
    return (
      <span className={`${shell} justify-between`}>
        {logo}
        <span className="flex w-1/2 justify-end gap-1">{bar("20%")}{bar("20%")}{bar("20%")}</span>
        {button}
      </span>
    );
  }
  const shell = "flex h-16 w-full flex-col justify-between rounded-md bg-slate-950 p-2 text-slate-300";
  const bottom = <span className="flex w-full justify-between border-t border-white/15 pt-1">{bar("30%")}</span>;
  if (template === "simple")
    return <span className={`${shell} justify-center`}><span className="flex w-full justify-between">{bar("35%")}{bar("30%")}</span></span>;
  const columns = template === "columns" ? 4 : 2;
  return (
    <span className={shell}>
      <span className="grid w-full gap-2" style={{ gridTemplateColumns: `repeat(${columns},1fr)` }}>
        {Array.from({ length: columns }, (_value, index) => (
          <span key={index} className="space-y-1">
            {index === 0 && template !== "newsletter" ? logo : bar("70%", true)}
            {bar("90%")}
            {template === "newsletter" && index === 0 ? <span className="block h-2 w-full rounded bg-white/80" /> : bar("60%")}
          </span>
        ))}
      </span>
      {bottom}
    </span>
  );
}

/**
 * The selected global zone: its template ("Modèle de la zone"), visibility,
 * fixed header, width, colours, and its columns / containers.
 */
function ZonePanel({
  name,
  zone,
  facts,
  theme,
  pages,
  menuPages,
  onChange,
  onSelectElement,
  orgSlug,
  onReplay,
  fr,
}: {
  name: ZoneName;
  zone: ZoneData;
  facts: SiteFacts;
  theme: string | undefined;
  pages: LinkPage[];
  menuPages: LinkPage[];
  onChange: (zone: ZoneData) => void;
  onSelectElement: (element: string | null) => void;
  orgSlug: string;
  onReplay?: () => void;
  fr: boolean;
}) {
  const content = zone.content;
  const extras = readExtraElements(content);
  const styles = (content.elementStyles as Record<string, unknown> | undefined) ?? {};
  const canvas = (styles.canvas as Record<string, unknown> | undefined) ?? {};
  const setContent = (patch: Record<string, unknown>) => onChange({ ...zone, content: { ...content, ...patch } });
  const writeExtras = (next: WebsiteExtraElement[], extraStyles: Record<string, unknown> = styles) =>
    setContent({ extras: next, elementOrder: next.map((item) => `x:${item.id}`), elementStyles: extraStyles });
  const applyTemplate = async (template: string) => {
    if (template === zone.template) return;
    const { zone: next, leftovers } = applyZoneTemplate(name, template, zone, facts);
    if (leftovers.length) {
      const names = leftovers
        .map((item) => (extraTypeLabels[item.type] ?? [item.type, item.type])[fr ? 0 : 1])
        .join(", ");
      if (
        !await ask(
          tr(
            fr,
            `Ce modèle n’a pas de place pour ${leftovers.length} élément(s) : ${names}.\n\nIls ne seront pas supprimés : ils sont placés dans un conteneur à la fin de la zone, à déplacer ou supprimer ensuite. Appliquer le modèle ?`,
            `This template has no place for ${leftovers.length} element(s): ${names}.\n\nThey are not deleted: they go into a container at the end of the zone, to move or delete later. Apply the template?`,
          ),
        )
      )
        return;
    }
    onChange(next);
    onSelectElement(null);
  };
  const columnStyle = { display: "flex", direction: "column", alignItems: "start", gap: 10 };
  // The footer's bottom row (copyright) stays last when columns are added.
  const bottomIndex = extras.findIndex(
    (item) => (styles[`x:${item.id}`] as Record<string, unknown> | undefined)?.spanAll === true,
  );
  const addColumn = () => {
    const column = zoneElement("group", facts, {
      children: [zoneElement("heading", facts, { textFr: "Nouvelle colonne", textEn: "New column" }), zoneElement("text", facts)],
    }) as WebsiteExtraElement;
    const next = [...extras];
    next.splice(bottomIndex >= 0 ? bottomIndex : next.length, 0, column);
    const columns = next.filter((item) => item.type === "group").length - (bottomIndex >= 0 ? 1 : 0);
    const nextCanvas =
      canvas.display === "grid" ? { ...canvas, gridColumns: Math.min(6, Math.max(Number(canvas.gridColumns) || 1, columns)) } : canvas;
    writeExtras(next, { ...styles, canvas: nextCanvas, [`x:${column.id}`]: columnStyle });
    onSelectElement(`x:${column.id}`);
  };
  const moveColumn = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= extras.length) return;
    const next = [...extras];
    [next[index], next[target]] = [next[target]!, next[index]!];
    writeExtras(next);
  };
  const duplicateColumn = (index: number) => {
    const source = extras[index];
    if (!source) return;
    const { item, styles: added } = cloneWithStyles(source, styles);
    const next = [...extras];
    next.splice(index + 1, 0, item);
    writeExtras(next, { ...styles, ...added });
  };
  const removeColumn = async (index: number) => {
    const source = extras[index];
    if (!source) return;
    const count = (function countAll(items: WebsiteExtraElement[]): number {
      return items.reduce((total, item) => total + 1 + countAll(item.children ?? []), 0);
    })(source.children ?? []);
    if (
      !await ask(
        count
          ? tr(fr, `Supprimer ce conteneur et les ${count} élément(s) qu’il contient ?`, `Delete this container and the ${count} element(s) inside?`)
          : tr(fr, "Supprimer cet élément ?", "Delete this element?"),
      )
    )
      return;
    writeExtras(extras.filter((_item, position) => position !== index));
  };
  const summary = (item: WebsiteExtraElement) => {
    const words = item.textFr?.trim();
    if (item.type !== "group") return words ? words.slice(0, 30) : "";
    return (item.children ?? [])
      .slice(0, 3)
      .map((child) => (extraTypeLabels[child.type] ?? [child.type, child.type])[fr ? 0 : 1])
      .join(" · ");
  };
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-violet-500/[.06] px-3 py-2 text-xs leading-5 text-ink-secondary">
        {tr(
          fr,
          "Cette zone s’affiche sur toutes les pages. Cliquez sur un élément dans l’aperçu pour le modifier, ou ajoutez-en avec la barre ci-dessus.",
          "This zone shows on every page. Click an element in the preview to edit it, or add one with the bar above.",
        )}
      </p>

      <section className="space-y-2">
        <p className="text-sm font-semibold text-ink">{tr(fr, "Modèle de la zone", "Zone template")}</p>
        <p className="text-[11px] leading-4 text-ink-muted">
          {tr(
            fr,
            "Change seulement la disposition de cette zone. Les textes, liens et coordonnées compatibles sont gardés.",
            "Changes only this zone’s layout. Compatible texts, links and contact details are kept.",
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(ZONE_TEMPLATES[name]).map(([key, template]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyTemplate(key)}
              aria-pressed={zone.template === key}
              className={`space-y-1.5 rounded-xl border p-2 text-left transition ${
                zone.template === key ? "border-violet-500 ring-2 ring-violet-500/30" : "border-border hover:border-violet-400"
              }`}
            >
              <ZoneTemplatePreview name={name} template={key} />
              <span className="block text-xs font-semibold text-ink">{template.label[fr ? 0 : 1]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-3">
        <p className="text-sm font-semibold text-ink">{tr(fr, "Style de la zone", "Zone style")}</p>
        <div className="space-y-1">
          <span className="text-xs font-medium text-ink-secondary">
            {tr(fr, "Apparence", "Look")} ·{" "}
            <span className="text-ink-muted">
              {zone.look
                ? tr(fr, "choisie ici", "chosen here")
                : tr(fr, `selon le thème (${(ZONE_LOOKS[name].find(([key]) => key === zoneLookOf(name, zone, theme))?.[1] ?? ["", ""])[0]})`, "from the theme")}
            </span>
          </span>
          <Segmented
            value={zone.look}
            onChange={(value) => onChange({ ...zone, look: value })}
            options={ZONE_LOOKS[name].map(([key, label]) => [key, label[fr ? 0 : 1]] as const)}
          />
          {name === "header" && zoneLookOf(name, zone, theme) === "transparent" ? (
            <p className="text-[11px] text-ink-muted">
              {tr(
                fr,
                "Transparent au-dessus de la grande image (bloc En-tête en premier), plein dès que la page défile. Sur les autres pages, le header est plein.",
                "Transparent over the large image (Header block first), solid once the page scrolls. On other pages the header is solid.",
              )}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium text-ink-secondary">
            {tr(fr, "Style des liens du menu", "Menu link style")}
            {zone.links ? "" : tr(fr, " · selon le thème", " · from the theme")}
          </span>
          <Segmented
            value={zone.links}
            onChange={(value) => onChange({ ...zone, links: value })}
            options={LINK_STYLES.map(([key, label]) => [key, label[fr ? 0 : 1]] as const)}
          />
        </div>
      </section>

      <MenuLinksManager zone={zone} pages={pages} menuPages={menuPages} onChange={onChange} fr={fr} />

      <section className="space-y-3 rounded-xl border border-border p-3">
        <p className="text-sm font-semibold text-ink">{tr(fr, "Affichage", "Display")}</p>
        {name === "header" ? (
          <div className="space-y-1">
            <span className="text-xs font-medium text-ink-secondary">{tr(fr, "Pendant le défilement", "While scrolling")}</span>
            <Segmented
              value={zone.sticky === false ? "normal" : "fixed"}
              onChange={(value) => onChange({ ...zone, sticky: value !== "normal" })}
              options={[
                ["fixed", tr(fr, "Fixe en haut", "Fixed at top")],
                ["normal", tr(fr, "Normal (défile)", "Normal (scrolls)")],
              ]}
            />
          </div>
        ) : (
          <label className="flex items-center justify-between gap-3 text-sm text-ink">
            {name === "topbar"
              ? tr(fr, "Afficher la top bar", "Show the top bar")
              : tr(fr, "Afficher le footer", "Show the footer")}
            <input
              type="checkbox"
              className="size-4 accent-violet-600"
              checked={!zone.hidden}
              onChange={(event) => onChange({ ...zone, hidden: event.target.checked ? undefined : true })}
            />
          </label>
        )}
        <div className="space-y-1">
          <span className="text-xs font-medium text-ink-secondary">{tr(fr, "Largeur du contenu", "Content width")}</span>
          <Segmented
            value={content.zoneWidth === "full" ? "full" : "contained"}
            onChange={(value) => setContent({ zoneWidth: value === "full" ? "full" : undefined })}
            options={[
              ["contained", tr(fr, "Centrée (1400 px)", "Centred (1400 px)")],
              ["full", tr(fr, "Toute la largeur", "Full width")],
            ]}
          />
        </div>
        {canvas.display === "grid" ? (
          <NumInput
            label={tr(fr, "Colonnes par ligne (ordinateur)", "Columns per row (desktop)")}
            value={canvas.gridColumns}
            min={1}
            max={6}
            onChange={(value) => setContent({ elementStyles: { ...styles, canvas: { ...canvas, gridColumns: value ?? 1 } } })}
          />
        ) : null}
        <Button size="sm" variant="secondary" className="w-full" onClick={() => onSelectElement("canvas")}>
          <Settings2 />
          {tr(fr, "Disposition, espacements et CSS de la zone", "Zone layout, spacing and CSS")}
        </Button>
      </section>

      <section className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">
            {name === "footer" ? tr(fr, "Colonnes et éléments", "Columns and elements") : tr(fr, "Conteneurs et éléments", "Containers and elements")}
          </p>
          <Button size="sm" variant="ghost" onClick={addColumn}>
            <Plus />
            {name === "footer" ? tr(fr, "Colonne", "Column") : tr(fr, "Conteneur", "Container")}
          </Button>
        </div>
        <ol className="space-y-1">
          {extras.map((item, index) => (
            <li key={item.id} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectElement(`x:${item.id}`)}>
                <span className="block truncate text-xs font-semibold text-ink">
                  {item.type === "group"
                    ? `${name === "footer" ? tr(fr, "Colonne", "Column") : tr(fr, "Conteneur", "Container")} ${index + 1}`
                    : (extraTypeLabels[item.type] ?? [item.type, item.type])[fr ? 0 : 1]}
                </span>
                <span className="block truncate text-[11px] text-ink-muted">{summary(item)}</span>
              </button>
              <Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => moveColumn(index, -1)} aria-label={tr(fr, "Avancer", "Move earlier")}>
                <ChevronUp />
              </Button>
              <Button size="icon-sm" variant="ghost" disabled={index === extras.length - 1} onClick={() => moveColumn(index, 1)} aria-label={tr(fr, "Reculer", "Move later")}>
                <ChevronDown />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => duplicateColumn(index)} aria-label={tr(fr, "Dupliquer", "Duplicate")}>
                <Copy />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => removeColumn(index)} aria-label={tr(fr, "Supprimer", "Delete")}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ol>
      </section>

      <BlockStyleFields
        orgSlug={orgSlug}
        content={content}
        set={(key, value) => setContent({ [key]: value })}
        onReplay={onReplay}
        fr={fr}
      />
    </div>
  );
}

/** Content of the site elements: logo, menu, language, social, contact… */
function ZoneElementFields({
  extra,
  update,
  lang,
  pages,
  orgSlug,
  fr,
}: {
  extra: WebsiteExtraElement;
  update: (patch: Partial<WebsiteExtraElement>) => void;
  lang: "fr" | "en";
  pages: LinkPage[];
  orgSlug: string;
  fr: boolean;
}) {
  const textKey = lang === "fr" ? "textFr" : "textEn";
  const items = extra.items ?? [];
  const setItems = (next: Array<Record<string, unknown>>) => update({ items: next });
  switch (extra.type) {
    case "logo":
      return (
        <div className="space-y-3">
          <Segmented
            value={extra.variant ?? "name"}
            onChange={(value) => update({ variant: value ?? "name" })}
            options={[
              ["name", tr(fr, "Logo + nom", "Logo + name")],
              ["name-tagline", tr(fr, "Logo + nom + slogan", "Logo + name + tagline")],
              ["image", tr(fr, "Logo seul", "Logo only")],
            ]}
          />
          <WebsiteImagePicker
            orgSlug={orgSlug}
            value={extra.imageUrl ?? ""}
            onChange={(url) => update({ imageUrl: url })}
            fr={fr}
            label={tr(fr, "Image du logo (sinon le logo du site)", "Logo image (otherwise the site logo)")}
          />
          <p className="text-[11px] text-ink-muted">
            {tr(fr, "Le logo mène toujours à la page d’accueil.", "The logo always leads to the home page.")}
          </p>
        </div>
      );
    case "menu":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-ink-secondary">{tr(fr, "Liens du menu", "Menu links")}</span>
            <Segmented
              value={extra.menuSource === "custom" ? "custom" : "pages"}
              onChange={(value) =>
                update(
                  value === "custom"
                    ? {
                        menuSource: "custom",
                        items: items.length
                          ? items
                          : pages.slice(0, 5).map((page) => ({ labelFr: page.label, labelEn: page.label, link: { kind: "page", page: page.slug } })),
                      }
                    : { menuSource: "pages" },
                )
              }
              options={[
                ["pages", tr(fr, "Pages publiées (auto)", "Published pages (auto)")],
                ["custom", tr(fr, "Liens choisis", "Chosen links")],
              ]}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-ink-secondary">{tr(fr, "Sens", "Direction")}</span>
            <Segmented
              value={extra.variant === "column" || extra.variant === "drawer" ? extra.variant : "row"}
              onChange={(value) => update({ variant: value === "column" || value === "drawer" ? value : "row" })}
              options={[
                ["row", tr(fr, "En ligne", "In a row")],
                ["column", tr(fr, "En colonne", "In a column")],
                ["drawer", tr(fr, "Bouton ☰ (toujours)", "☰ button (always)")],
              ]}
            />
          </div>
          {extra.menuSource === "custom" ? (
            <div className="space-y-2">
              {items.map((entry, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-border p-2">
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-8"
                      placeholder={tr(fr, "Texte du lien", "Link text")}
                      value={String((lang === "fr" ? entry.labelFr : entry.labelEn) ?? "")}
                      onChange={(event) =>
                        setItems(items.map((item, position) => (position === index ? { ...item, [lang === "fr" ? "labelFr" : "labelEn"]: event.target.value } : item)))
                      }
                    />
                    <Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => {
                      const next = [...items];
                      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                      setItems(next);
                    }} aria-label={tr(fr, "Monter", "Move up")}>
                      <ChevronUp />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => setItems(items.filter((_item, position) => position !== index))} aria-label={tr(fr, "Supprimer le lien", "Remove link")}>
                      <Trash2 />
                    </Button>
                  </div>
                  <LinkFields
                    value={entry.link}
                    onChange={(link) => setItems(items.map((item, position) => (position === index ? { ...item, link } : item)))}
                    pages={pages}
                    orgSlug={orgSlug}
                    subject={tr(fr, "ce lien du menu", "this menu link")}
                    fr={fr}
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setItems([...items, { labelFr: "Nouveau lien", labelEn: "New link", link: { kind: "url", url: "#" } }])}
              >
                <Plus />
                {tr(fr, "Ajouter un lien", "Add a link")}
              </Button>
            </div>
          ) : (
            <p className="text-[11px] text-ink-muted">
              {tr(fr, "Le menu suit les pages publiées et leur ordre (onglet Pages).", "The menu follows the published pages and their order (Pages tab).")}
            </p>
          )}
          <p className="text-[11px] text-ink-muted">
            {tr(fr, "Sur tablette et téléphone, le menu du header devient un bouton ☰.", "On tablets and phones, the header menu becomes a ☰ button.")}
          </p>
        </div>
      );
    case "language":
      return (
        <p className="text-xs text-ink-secondary">
          {tr(fr, "Bouton FR / EN : le visiteur change la langue du site.", "FR / EN button: the visitor switches the site language.")}
        </p>
      );
    case "social":
      return (
        <div className="space-y-2">
          {items.map((entry, index) => (
            <div key={index} className="flex items-center gap-1">
              <select
                className="h-8 rounded-md border border-border bg-surface-2 px-1.5 text-xs"
                value={String(entry.network ?? "facebook")}
                onChange={(event) => setItems(items.map((item, position) => (position === index ? { ...item, network: event.target.value } : item)))}
                aria-label={tr(fr, "Réseau", "Network")}
              >
                {SOCIAL_NETWORK_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
              <Input
                className="h-8"
                placeholder="https://"
                value={String(entry.url ?? "")}
                onChange={(event) => setItems(items.map((item, position) => (position === index ? { ...item, url: event.target.value } : item)))}
              />
              <Button size="icon-sm" variant="ghost" onClick={() => setItems(items.filter((_item, position) => position !== index))} aria-label={tr(fr, "Supprimer", "Remove")}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setItems([...items, { network: "instagram", url: "https://" }])}>
            <Plus />
            {tr(fr, "Ajouter un réseau", "Add a network")}
          </Button>
          <p className="text-[11px] text-ink-muted">{tr(fr, "Adresses en https:// uniquement.", "https:// addresses only.")}</p>
        </div>
      );
    case "contact":
      return (
        <div className="space-y-2">
          <Segmented
            value={extra.contactKind ?? "phone"}
            onChange={(value) => update({ contactKind: (value ?? "phone") as WebsiteExtraElement["contactKind"] })}
            options={[
              ["phone", tr(fr, "Téléphone", "Phone")],
              ["email", "Email"],
              ["address", tr(fr, "Adresse", "Address")],
              ["hours", tr(fr, "Horaires", "Hours")],
            ]}
          />
          <Input value={extra.value ?? ""} onChange={(event) => update({ value: event.target.value })} />
        </div>
      );
    case "copyright":
      return (
        <Field label={tr(fr, "Texte après « © année Nom. »", "Text after “© year Name.”")}>
          <Input value={extra[textKey] ?? ""} onChange={(event) => update({ [textKey]: event.target.value })} />
        </Field>
      );
    case "newsletter":
      return (
        <div className="space-y-2">
          <Field label={tr(fr, "Titre du champ", "Field title")}>
            <Input value={extra[textKey] ?? ""} onChange={(event) => update({ [textKey]: event.target.value })} />
          </Field>
          <Field label={tr(fr, "Texte du bouton", "Button text")}>
            <Input value={extra.value ?? ""} onChange={(event) => update({ value: event.target.value })} />
          </Field>
          <p className="text-[11px] text-ink-muted">
            {tr(fr, "Les inscriptions arrivent dans vos messages de contact du site.", "Sign-ups arrive in your website contact messages.")}
          </p>
        </div>
      );
    default:
      return null;
  }
}

type MenuEntry = { labelFr?: string; labelEn?: string; link?: Record<string, unknown>; children?: MenuEntry[] };

/**
 * WordPress-style menu editing for a zone: every menu of the zone, its links
 * (pages, anchors, external addresses), their order and one level of
 * sub-menus — shown right away in the preview.
 */
function MenuLinksManager({
  zone,
  pages,
  menuPages,
  onChange,
  fr,
}: {
  zone: ZoneData;
  pages: LinkPage[];
  /** Pages currently shown in menus: what "My links" starts from. */
  menuPages: LinkPage[];
  onChange: (zone: ZoneData) => void;
  fr: boolean;
}) {
  const extras = readExtraElements(zone.content);
  const menus: WebsiteExtraElement[] = [];
  const collect = (items: WebsiteExtraElement[]) => {
    for (const item of items) {
      if (item.type === "menu") menus.push(item);
      collect(item.children ?? []);
    }
  };
  collect(extras);
  if (!menus.length) return null;
  const updateMenu = (id: string, patch: Partial<WebsiteExtraElement>) =>
    onChange({
      ...zone,
      content: { ...zone.content, extras: mapExtra(extras, id, (item) => ({ ...item, ...patch, tpl: undefined })) },
    });
  const pageLabel = (slug: string) => pages.find((page) => page.slug === slug)?.label ?? slug;
  return (
    <section className="space-y-3 rounded-xl border border-border p-3">
      <div>
        <p className="text-sm font-semibold text-ink">{tr(fr, "Liens des menus", "Menu links")}</p>
        <p className="text-[11px] text-ink-muted">
          {tr(
            fr,
            "Ajoutez une page, une ancre (#section) ou une adresse externe : le lien s’affiche aussitôt. Décalez un lien (→) pour en faire un sous-menu du lien au-dessus.",
            "Add a page, an anchor (#section) or an external address: the link shows at once. Indent a link (→) to make it a sub-menu of the link above.",
          )}
        </p>
      </div>
      {menus.map((menu, menuIndex) => {
        const custom = menu.menuSource === "custom";
        const items = (menu.items ?? []) as MenuEntry[];
        // Flat view: top-level links and their sub-links.
        const rows: Array<{ entry: MenuEntry; parent: number; child: number }> = [];
        items.forEach((entry, parent) => {
          rows.push({ entry, parent, child: -1 });
          (entry.children ?? []).forEach((sub, child) => rows.push({ entry: sub, parent, child }));
        });
        const write = (next: MenuEntry[]) => updateMenu(menu.id, { items: next as Array<Record<string, unknown>> });
        const patchRow = (parent: number, child: number, patch: Partial<MenuEntry>) =>
          write(
            items.map((entry, index) =>
              index !== parent
                ? entry
                : child < 0
                  ? { ...entry, ...patch }
                  : { ...entry, children: (entry.children ?? []).map((sub, subIndex) => (subIndex === child ? { ...sub, ...patch } : sub)) },
            ),
          );
        const removeRow = (parent: number, child: number) =>
          write(
            child < 0
              ? items.filter((_entry, index) => index !== parent)
              : items.map((entry, index) =>
                  index === parent ? { ...entry, children: (entry.children ?? []).filter((_sub, subIndex) => subIndex !== child) } : entry,
                ),
          );
        const moveRow = (parent: number, child: number, direction: -1 | 1) => {
          if (child < 0) {
            const target = parent + direction;
            if (target < 0 || target >= items.length) return;
            const next = [...items];
            [next[parent], next[target]] = [next[target]!, next[parent]!];
            write(next);
            return;
          }
          const subs = [...(items[parent]?.children ?? [])];
          const target = child + direction;
          if (target < 0 || target >= subs.length) return;
          [subs[child], subs[target]] = [subs[target]!, subs[child]!];
          write(items.map((entry, index) => (index === parent ? { ...entry, children: subs } : entry)));
        };
        const indent = (parent: number) => {
          if (parent === 0) return;
          const moving = items[parent]!;
          const next = items.filter((_entry, index) => index !== parent);
          const host = next[parent - 1]!;
          next[parent - 1] = { ...host, children: [...(host.children ?? []), { ...moving, children: undefined }, ...(moving.children ?? [])] };
          write(next);
        };
        const outdent = (parent: number, child: number) => {
          const host = items[parent]!;
          const moving = host.children![child]!;
          const next = [...items];
          next[parent] = { ...host, children: host.children!.filter((_sub, subIndex) => subIndex !== child) };
          next.splice(parent + 1, 0, moving);
          write(next);
        };
        const linkValue = (entry: MenuEntry) =>
          entry.link?.kind === "page" && typeof entry.link.page === "string" ? `page:${entry.link.page}` : "url";
        return (
          <div key={menu.id} className="space-y-2 rounded-lg bg-surface-2/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink">
                {tr(fr, "Menu", "Menu")} {menuIndex + 1}
                {menu.part === "start" ? tr(fr, " · moitié gauche", " · left half") : menu.part === "end" ? tr(fr, " · moitié droite", " · right half") : ""}
              </span>
              <Segmented
                value={custom ? "custom" : "pages"}
                onChange={(value) =>
                  updateMenu(
                    menu.id,
                    value === "custom"
                      ? {
                          menuSource: "custom",
                          items: (items.length
                            ? items
                            : menuPages.map((page) => ({ labelFr: page.labelFr ?? page.label, labelEn: page.labelEn ?? page.label, link: { kind: "page", page: page.slug } }))) as Array<Record<string, unknown>>,
                        }
                      : { menuSource: "pages" },
                  )
                }
                options={[
                  ["pages", tr(fr, "Pages auto", "Auto pages")],
                  ["custom", tr(fr, "Mes liens", "My links")],
                ]}
              />
            </div>
            {!custom ? (
              <p className="text-[11px] text-ink-muted">
                {tr(
                  fr,
                  "Suit automatiquement les pages publiées et affichées dans les menus. Choisissez « Mes liens » pour composer le menu vous-même.",
                  "Automatically follows the published pages shown in menus. Choose “My links” to build the menu yourself.",
                )}
              </p>
            ) : (
              <>
                <ol className="space-y-1.5">
                  {rows.map(({ entry, parent, child }) => (
                    <li
                      key={`${parent}-${child}`}
                      className={`space-y-1 rounded-md border border-border bg-surface-1 p-1.5 ${child >= 0 ? "ml-5 border-dashed" : ""}`}
                    >
                      <div className="flex items-center gap-1">
                        <Input
                          className="h-7 text-xs"
                          aria-label={tr(fr, "Texte FR", "FR text")}
                          placeholder="FR"
                          value={entry.labelFr ?? ""}
                          onChange={(event) => patchRow(parent, child, { labelFr: event.target.value })}
                        />
                        <Input
                          className="h-7 text-xs"
                          aria-label={tr(fr, "Texte EN", "EN text")}
                          placeholder="EN"
                          value={entry.labelEn ?? ""}
                          onChange={(event) => patchRow(parent, child, { labelEn: event.target.value })}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <select
                          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-1 text-xs"
                          aria-label={tr(fr, "Destination", "Destination")}
                          value={linkValue(entry)}
                          onChange={(event) => {
                            const value = event.target.value;
                            patchRow(parent, child, {
                              link: value.startsWith("page:") ? { kind: "page", page: value.slice(5) } : { kind: "url", url: "" },
                            });
                          }}
                        >
                          {pages.map((page) => (
                            <option key={page.slug} value={`page:${page.slug}`}>
                              {tr(fr, "Page", "Page")} · {page.label}
                            </option>
                          ))}
                          <option value="url">{tr(fr, "Ancre ou adresse…", "Anchor or address…")}</option>
                        </select>
                        <Button size="icon-sm" variant="ghost" onClick={() => moveRow(parent, child, -1)} aria-label={tr(fr, "Monter", "Move up")}>
                          <ChevronUp />
                        </Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => moveRow(parent, child, 1)} aria-label={tr(fr, "Descendre", "Move down")}>
                          <ChevronDown />
                        </Button>
                        {child < 0 ? (
                          <Button size="icon-sm" variant="ghost" disabled={parent === 0} onClick={() => indent(parent)} title={tr(fr, "Sous-menu du lien au-dessus", "Sub-menu of the link above")} aria-label={tr(fr, "Décaler en sous-menu", "Indent as sub-menu")}>
                            <ChevronUp className="rotate-90" />
                          </Button>
                        ) : (
                          <Button size="icon-sm" variant="ghost" onClick={() => outdent(parent, child)} title={tr(fr, "Remettre au premier niveau", "Back to top level")} aria-label={tr(fr, "Sortir du sous-menu", "Outdent")}>
                            <ChevronUp className="-rotate-90" />
                          </Button>
                        )}
                        <Button size="icon-sm" variant="ghost" onClick={() => removeRow(parent, child)} aria-label={tr(fr, "Supprimer le lien", "Remove link")}>
                          <Trash2 />
                        </Button>
                      </div>
                      {linkValue(entry) === "url" ? (
                        <Input
                          className="h-7 text-xs"
                          placeholder="#section, /page, https://…"
                          value={typeof entry.link?.url === "string" ? entry.link.url : ""}
                          onChange={(event) => patchRow(parent, child, { link: { kind: "url", url: event.target.value } })}
                        />
                      ) : null}
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-1.5">
                  <select
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-1.5 text-xs"
                    aria-label={tr(fr, "Ajouter une page au menu", "Add a page to the menu")}
                    value=""
                    onChange={(event) => {
                      const slug = event.target.value;
                      if (!slug) return;
                      write([...items, { labelFr: pageLabel(slug), labelEn: pageLabel(slug), link: { kind: "page", page: slug } }]);
                    }}
                  >
                    <option value="">{tr(fr, "+ Ajouter une page…", "+ Add a page…")}</option>
                    {pages.map((page) => (
                      <option key={page.slug} value={page.slug}>
                        {page.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => write([...items, { labelFr: "Nouveau lien", labelEn: "New link", link: { kind: "url", url: "https://" } }])}
                  >
                    <Plus />
                    {tr(fr, "Lien personnalisé", "Custom link")}
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ── Site templates and block designs ─────────────────────────────────── */

/** Tiny drawing of a block design, for the pickers. */
function VariantSketch({ variant }: { variant: string }) {
  const line = (width: string, strong = false, color?: string) => (
    <span className="block h-1.5 rounded" style={{ width, background: color ?? "currentColor", opacity: strong ? 0.9 : 0.35 }} />
  );
  const box = "relative flex h-14 w-full overflow-hidden rounded-md";
  const card = (extra = "") => <span className={`h-6 flex-1 rounded bg-white shadow-sm ${extra}`} />;
  switch (variant) {
    case "hero-image":
      return (
        <span className={`${box} items-end bg-gradient-to-r from-slate-900 to-emerald-800 p-2 text-white`}>
          <span className="w-1/2 space-y-1">{line("90%", true)}{line("60%")}</span>
        </span>
      );
    case "hero-split":
      return (
        <span className={`${box} items-center bg-emerald-50 p-2 text-slate-800`}>
          <span className="w-1/2 space-y-1">{line("90%", true)}{line("60%")}</span>
          <span className="absolute inset-y-0 right-0 w-[45%] bg-gradient-to-br from-emerald-700 to-amber-600" />
        </span>
      );
    case "hero-centered":
      return (
        <span className={`${box} flex-col items-center justify-center gap-1 bg-gradient-to-r from-slate-800 to-emerald-900 text-white`}>
          {line("50%", true)}
          {line("30%")}
        </span>
      );
    case "hero-minimal":
      return (
        <span className={`${box} flex-col justify-center gap-1 bg-emerald-50 p-2 text-slate-800`}>
          {line("70%", true)}
          {line("40%")}
        </span>
      );
    case "text-centered":
      return <span className={`${box} flex-col items-center justify-center gap-1 bg-white text-slate-700`}>{line("50%", true)}{line("70%")}{line("60%")}</span>;
    case "text-left":
      return <span className={`${box} flex-col justify-center gap-1 bg-white p-2 text-slate-700`}>{line("50%", true)}{line("80%")}{line("70%")}</span>;
    case "text-split":
      return (
        <span className={`${box} items-center gap-2 bg-white p-2 text-slate-700`}>
          <span className="w-2/5">{line("90%", true)}</span>
          <span className="flex-1 space-y-1">{line("100%")}{line("90%")}{line("70%")}</span>
        </span>
      );
    case "cards-default":
      return <span className={`${box} items-center gap-1 bg-emerald-50 p-2`}>{card()}{card()}{card()}</span>;
    case "cards-minimal":
      return (
        <span className={`${box} items-center gap-2 bg-white p-2`}>
          {[0, 1, 2].map((index) => (
            <span key={index} className="h-6 flex-1 border-t-2 border-emerald-700" />
          ))}
        </span>
      );
    case "cards-numbered":
      return (
        <span className={`${box} items-center gap-1 bg-emerald-50 p-2`}>
          {["1", "2", "3"].map((number) => (
            <span key={number} className="flex h-7 flex-1 items-center rounded border-l-2 border-amber-500 bg-white pl-1 text-sm font-bold text-emerald-700">
              {number}
            </span>
          ))}
        </span>
      );
    case "cards-dark":
      return <span className={`${box} items-center gap-1 bg-slate-900 p-2`}>{[0, 1, 2].map((index) => <span key={index} className="h-6 flex-1 rounded bg-white/10" />)}</span>;
    case "metrics-band":
      return <span className={`${box} items-center justify-around bg-emerald-800 p-2 text-sm font-bold text-amber-100`}><span>12</span><span>40</span><span>3k</span></span>;
    case "metrics-light":
      return (
        <span className={`${box} items-center gap-1 bg-emerald-50 p-2 text-xs font-bold text-emerald-700`}>
          {["12", "40", "3k"].map((value) => (
            <span key={value} className="grid h-7 flex-1 place-items-center rounded bg-white shadow-sm">{value}</span>
          ))}
        </span>
      );
    case "metrics-inline":
      return (
        <span className={`${box} items-center gap-2 bg-white p-2 text-sm font-bold text-emerald-700`}>
          {["12", "40", "3k"].map((value) => (
            <span key={value} className="flex-1 border-l-2 border-emerald-700 pl-1">{value}</span>
          ))}
        </span>
      );
    case "callout-left":
    case "callout-right":
      return (
        <span className={`${box} items-stretch bg-white ${variant === "callout-right" ? "flex-row-reverse" : ""}`}>
          <span className="w-1/2 bg-gradient-to-br from-emerald-700 to-amber-500" />
          <span className="flex flex-1 flex-col justify-center gap-1 p-2 text-slate-700">{line("80%", true)}{line("60%")}</span>
        </span>
      );
    case "callout-overlay":
      return (
        <span className={`${box} items-center bg-gradient-to-br from-emerald-700 to-amber-500 p-2`}>
          <span className="w-1/2 space-y-1 rounded bg-white p-1.5 text-slate-700">{line("80%", true)}{line("60%")}</span>
        </span>
      );
    case "gallery-mosaic":
      return (
        <span className={`${box} grid grid-cols-4 grid-rows-2 gap-0.5 bg-white p-1`}>
          <span className="col-span-2 row-span-2 rounded bg-emerald-600" />
          {[0, 1, 2, 3].map((index) => <span key={index} className="rounded bg-emerald-300" />)}
        </span>
      );
    case "gallery-grid":
      return (
        <span className={`${box} grid grid-cols-4 grid-rows-2 gap-0.5 bg-white p-1`}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => <span key={index} className="rounded bg-emerald-400" />)}
        </span>
      );
    case "faq-list":
      return <span className={`${box} flex-col justify-center gap-1 bg-white p-2 text-slate-700`}>{line("100%")}{line("100%")}{line("100%")}</span>;
    case "faq-split":
      return (
        <span className={`${box} items-center gap-2 bg-white p-2 text-slate-700`}>
          <span className="w-1/3">{line("90%", true)}</span>
          <span className="flex-1 space-y-1">{line("100%")}{line("100%")}{line("100%")}</span>
        </span>
      );
    case "cta-dark":
    case "cta-light":
    case "cta-accent":
    case "careers-warm":
    case "careers-dark": {
      const background =
        variant === "cta-dark" || variant === "careers-dark" ? "bg-slate-900 text-white" : variant === "cta-accent" ? "bg-emerald-700 text-white" : variant === "careers-warm" ? "bg-amber-50 text-slate-800" : "bg-emerald-50 text-slate-800";
      return (
        <span className={`${box} items-center justify-between p-2 ${background}`}>
          <span className="w-1/2 space-y-1">{line("90%", true)}{line("60%")}</span>
          <span className="h-3 w-8 rounded-full bg-amber-400" />
        </span>
      );
    }
    default:
      return <span className={`${box} bg-slate-100`} />;
  }
}

/** "Design du bloc": the same content, another look. */
function BlockVariantPicker({
  block,
  siteVariant,
  onChange,
  fr,
}: {
  block: WebsiteSection;
  siteVariant: string | undefined;
  onChange: (variant: string | undefined) => void;
  fr: boolean;
}) {
  const type = block.section_type;
  if (!isBlockType(type)) return null;
  const options = BLOCK_VARIANTS[type];
  const own = typeof block.content.blockVariant === "string" ? block.content.blockVariant : undefined;
  const active = own ?? siteVariant ?? options[0]![0];
  return (
    <details open className="mb-3 rounded-xl border border-violet-500/30 bg-violet-500/[.04]">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span>{tr(fr, "Design du bloc", "Block design")}</span>
        <span className="text-[11px] font-normal text-ink-muted">
          {own ? tr(fr, "choisi pour ce bloc", "chosen for this block") : tr(fr, "selon le modèle du site", "from the site template")}
        </span>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <div className="grid grid-cols-2 gap-2">
          {options.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={active === key}
              onClick={() => onChange(key)}
              className={`space-y-1 rounded-lg border p-1.5 text-left transition ${
                active === key ? "border-violet-500 ring-2 ring-violet-500/30" : "border-border hover:border-violet-400"
              }`}
            >
              <VariantSketch variant={key} />
              <span className="block text-[11px] font-semibold leading-4 text-ink">{label[fr ? 0 : 1]}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-muted">
          {tr(fr, "Seul l’aspect change : textes, images, liens et cartes restent les mêmes.", "Only the look changes: texts, images, links and cards stay the same.")}
          {own ? (
            <>
              {" "}
              <button type="button" className="font-semibold text-violet-700 hover:underline" onClick={() => onChange(undefined)}>
                {tr(fr, "Suivre le modèle du site", "Follow the site template")}
              </button>
            </>
          ) : null}
        </p>
      </div>
    </details>
  );
}

/** The site's original design (production before any template). */
const ORIGIN_TEMPLATE = "origine";

/** Complete site templates, like LiteEvent: theme + zones + block designs. */
function SiteTemplatesPanel({
  value,
  onApply,
  fr,
}: {
  value: string | undefined;
  onApply: (key: string) => void;
  fr: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-violet-500/30 bg-violet-500/[.05] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <LayoutPanelTop className="size-4 text-violet-600" />
          {tr(fr, "Modèles de site complets", "Complete site templates")}
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          {tr(
            fr,
            "Un modèle applique en une fois un thème, une top bar, un header, un footer et le design de tous les blocs de toutes les pages. Vos contenus restent les mêmes ; chaque bloc peut ensuite choisir son propre design.",
            "A template applies at once a theme, a top bar, a header, a footer and the design of every block on every page. Your content stays the same; each block can then pick its own design.",
          )}
        </p>
      </div>
      <button
        type="button"
        aria-pressed={value === ORIGIN_TEMPLATE}
        onClick={() => onApply(ORIGIN_TEMPLATE)}
        className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition ${
          value === ORIGIN_TEMPLATE ? "border-emerald-600 ring-2 ring-emerald-600/30" : "border-emerald-600/40 hover:border-emerald-600"
        }`}
      >
        <span aria-hidden="true" className="block w-24 shrink-0 space-y-1 rounded-md bg-[#fbfcf8] p-1">
          <span className="block h-1.5 rounded-sm bg-slate-950" />
          <span className="block h-2 rounded-sm bg-white shadow-[0_0_0_1px_#e2e8f0]" />
          <VariantSketch variant="hero-image" />
          <span className="block h-2 rounded-sm bg-slate-950" />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {tr(fr, "Design d’origine (production)", "Original design (production)")}
            <Badge variant="good">{tr(fr, "Par défaut", "Default")}</Badge>
          </span>
          <span className="block text-[11px] leading-4 text-ink-muted">
            {tr(
              fr,
              "Le site tel qu’il est en ligne : header, footer, couleurs et blocs d’origine. Toujours disponible pour revenir en arrière.",
              "The site as it is online: original header, footer, colours and blocks. Always available to go back.",
            )}
          </span>
        </span>
      </button>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {Object.entries(SITE_TEMPLATES).map(([key, template]) => {
          const theme = SITE_THEMES[template.theme]!;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={value === key}
              onClick={() => onApply(key)}
              className={`overflow-hidden rounded-xl border text-left transition ${
                value === key ? "border-violet-500 ring-2 ring-violet-500/30" : "border-border hover:border-violet-400"
              }`}
            >
              <span aria-hidden="true" className="block space-y-1 p-1.5" style={{ background: theme.background, color: theme.text }}>
                <span className="block h-2 rounded-sm" style={{ background: theme.looks.header === "transparent" ? theme.dark : theme.surface, boxShadow: `0 0 0 1px ${theme.border}` }} />
                <VariantSketch variant={template.blockVariants.hero ?? "hero-image"} />
                <VariantSketch variant={template.blockVariants.feature_grid ?? "cards-default"} />
                <span className="block h-3 rounded-sm" style={{ background: theme.looks.footer === "accent" ? theme.primary : theme.looks.footer === "dark" ? theme.dark : theme.alt }} />
              </span>
              <span className="block px-2.5 py-2">
                <span className="block text-sm font-semibold text-ink">{template.label[fr ? 0 : 1]}</span>
                <span className="block text-[11px] leading-4 text-ink-muted">{template.description[fr ? 0 : 1]}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── Page templates ──────────────────────────────────────────────────── */

let pageTemplateSeed = 0;
/** A ready block: the standard seed of its type with the template's words. */
function templateBlock(type: SectionType, content: Record<string, unknown>): WebsiteSection {
  const seed = sectionSeed(type);
  return {
    ...seed,
    id: `local-${Date.now()}-${(pageTemplateSeed++).toString(36)}-${type}`,
    content: { ...seed.content, ...content },
  };
}
const card = (titleFr: string, titleEn: string, bodyFr: string, bodyEn: string) => ({ titleFr, titleEn, bodyFr, bodyEn });
const figure = (value: string, labelFr: string, labelEn: string) => ({ value, labelFr, labelEn });
const question = (questionFr: string, questionEn: string, answerFr: string, answerEn: string) => ({ questionFr, questionEn, answerFr, answerEn });
const IMG = {
  hero: "/website/congo-omega-hero.png",
  market: "/website/congo-omega-market.png",
  team: "/website/congo-omega-team.png",
  operations: "/website/congo-omega-operations.png",
  impact: "/website/congo-omega-impact.png",
};

/** Pages with their blocks already designed and filled in (FR + EN). */
const PAGE_TEMPLATES: Record<
  string,
  { label: [string, string]; hint: [string, string]; nameFr?: string; nameEn?: string; build: () => WebsiteSection[] }
> = {
  blank: { label: ["Page vide", "Blank page"], hint: ["À construire vous-même", "Build it yourself"], build: () => [] },
  home: {
    label: ["Accueil", "Home"],
    hint: ["Grande image, activités, chiffres…", "Large image, activities, figures…"],
    nameFr: "Accueil",
    nameEn: "Home",
    build: () => congoOmegaLandingSections.map((section) => ({ ...section, id: `local-${Date.now()}-${(pageTemplateSeed++).toString(36)}`, content: JSON.parse(JSON.stringify(section.content)) as Record<string, unknown> })),
  },
  about: {
    label: ["À propos", "About"],
    hint: ["Histoire, valeurs, chiffres, équipe", "Story, values, figures, team"],
    nameFr: "À propos",
    nameEn: "About us",
    build: () => [
      templateBlock("hero", { kickerFr: "QUI SOMMES-NOUS", kickerEn: "WHO WE ARE", titleFr: "Une entreprise ancrée dans son territoire.", titleEn: "A company rooted in its land.", bodyFr: "Nous produisons localement, avec des équipes engagées et des méthodes exigeantes.", bodyEn: "We produce locally, with committed teams and demanding methods.", imageUrl: IMG.team, primaryLabelFr: "Nos activités", primaryLabelEn: "Our activities", primaryHref: "/activites" }),
      templateBlock("rich_text", { kickerFr: "NOTRE HISTOIRE", kickerEn: "OUR STORY", titleFr: "Tout a commencé par une conviction simple.", titleEn: "It all started with a simple belief.", bodyFr: "Produire ici, pour les familles d’ici, avec rigueur et transparence. Racontez vos débuts, vos étapes clés et ce qui vous rend fiers aujourd’hui.", bodyEn: "Producing here, for families here, with rigour and transparency. Tell your beginnings, key milestones and what makes you proud today.", blockVariant: "text-split" }),
      templateBlock("feature_grid", { kickerFr: "NOS VALEURS", kickerEn: "OUR VALUES", titleFr: "Ce qui guide chaque décision.", titleEn: "What guides every decision.", items: [card("Exigence", "Rigour", "Des méthodes suivies et contrôlées.", "Followed and checked methods."), card("Proximité", "Closeness", "Des équipes et partenaires locaux.", "Local teams and partners."), card("Durabilité", "Sustainability", "Des choix pensés pour durer.", "Choices made to last.")] }),
      templateBlock("metrics", { titleFr: "Quelques repères", titleEn: "Key figures", items: [figure("2018", "Création", "Founded"), figure("120+", "Collaborateurs", "Team members"), figure("15", "Sites suivis", "Sites followed"), figure("3", "Provinces", "Provinces")] }),
      templateBlock("image_callout", { titleFr: "Une équipe sur le terrain", titleEn: "A team on the ground", bodyFr: "Présentez les personnes qui font avancer vos projets.", bodyEn: "Introduce the people who move your projects forward.", imageUrl: IMG.operations, labelFr: "Nous rejoindre", labelEn: "Join us", href: "/carrieres" }),
      templateBlock("cta", {}),
    ],
  },
  services: {
    label: ["Services / activités", "Services / activities"],
    hint: ["6 services, questions, contact", "6 services, questions, contact"],
    nameFr: "Nos services",
    nameEn: "Our services",
    build: () => [
      templateBlock("hero", { kickerFr: "NOS SERVICES", kickerEn: "OUR SERVICES", titleFr: "Des solutions concrètes, du champ au marché.", titleEn: "Concrete solutions, from field to market.", bodyFr: "Découvrez ce que nous faisons et comment nous pouvons travailler ensemble.", bodyEn: "Discover what we do and how we can work together.", imageUrl: IMG.market }),
      templateBlock("feature_grid", { titleFr: "Ce que nous proposons", titleEn: "What we offer", items: [card("Production agricole", "Farming", "Cultures suivies toute l’année.", "Crops followed all year round."), card("Élevage", "Livestock", "Des animaux suivis et soignés.", "Animals followed and cared for."), card("Transformation", "Processing", "Des produits prêts pour le marché.", "Market-ready products."), card("Distribution", "Distribution", "Une logistique fiable.", "Reliable logistics."), card("Formation", "Training", "Des équipes locales qualifiées.", "Qualified local teams."), card("Conseil", "Advice", "Un accompagnement sur mesure.", "Tailored support.")], blockVariant: "cards-numbered" }),
      templateBlock("faq", { items: [question("Comment travailler avec vous ?", "How can we work with you?", "Contactez-nous : nous étudions votre besoin et revenons vers vous rapidement.", "Contact us: we study your needs and get back to you quickly."), question("Où intervenez-vous ?", "Where do you operate?", "Indiquez ici vos zones d’intervention.", "List your areas of operation here."), question("Quels délais ?", "What lead times?", "Précisez vos délais habituels.", "State your usual lead times.")] }),
      templateBlock("cta", {}),
    ],
  },
  project: {
    label: ["Projet / réalisation", "Project"],
    hint: ["Image, récit, galerie, résultats", "Image, story, gallery, results"],
    nameFr: "Nos projets",
    nameEn: "Our projects",
    build: () => [
      templateBlock("hero", { kickerFr: "PROJET", kickerEn: "PROJECT", titleFr: "Le nom de votre projet", titleEn: "Your project’s name", bodyFr: "En une phrase : l’objectif et le résultat obtenu.", bodyEn: "In one sentence: the goal and the result.", imageUrl: IMG.impact }),
      templateBlock("image_callout", { titleFr: "Le défi", titleEn: "The challenge", bodyFr: "Expliquez le point de départ, puis la solution apportée.", bodyEn: "Explain the starting point, then the solution.", imageUrl: IMG.operations }),
      templateBlock("gallery", { titleFr: "Sur le terrain", titleEn: "On the ground", items: [IMG.hero, IMG.market, IMG.team, IMG.operations, IMG.impact].map((image) => ({ image, captionFr: "", captionEn: "" })) }),
      templateBlock("metrics", { titleFr: "Résultats", titleEn: "Results", items: [figure("+40 %", "Production", "Output"), figure("60", "Emplois créés", "Jobs created"), figure("12 mois", "Durée", "Duration")] }),
      templateBlock("cta", {}),
    ],
  },
  careers: {
    label: ["Carrières", "Careers"],
    hint: ["Culture, postes, questions", "Culture, roles, questions"],
    nameFr: "Carrières",
    nameEn: "Careers",
    build: () => [
      templateBlock("hero", { kickerFr: "CARRIÈRES", kickerEn: "CAREERS", titleFr: "Grandissez avec nous.", titleEn: "Grow with us.", bodyFr: "Rejoignez une équipe qui construit des projets utiles et durables.", bodyEn: "Join a team building useful, lasting projects.", imageUrl: IMG.team }),
      templateBlock("feature_grid", { titleFr: "Pourquoi nous rejoindre", titleEn: "Why join us", items: [card("Formation", "Training", "Vous apprenez sur le terrain.", "You learn on the ground."), card("Responsabilités", "Responsibility", "Des missions concrètes dès le départ.", "Real missions from day one."), card("Équipe", "Team", "Une équipe soudée et exigeante.", "A close, demanding team.")] }),
      templateBlock("careers", {}),
      templateBlock("faq", { items: [question("Comment postuler ?", "How do I apply?", "Choisissez un poste ouvert et envoyez votre candidature en ligne.", "Pick an open role and apply online."), question("Acceptez-vous les candidatures spontanées ?", "Do you accept open applications?", "Oui, écrivez-nous via la page contact.", "Yes, write to us through the contact page.")] }),
    ],
  },
  contact: {
    label: ["Contact", "Contact"],
    hint: ["Formulaire, coordonnées, questions", "Form, details, questions"],
    nameFr: "Contact",
    nameEn: "Contact",
    build: () => [
      templateBlock("hero", { kickerFr: "CONTACT", kickerEn: "CONTACT", titleFr: "Parlons de votre projet.", titleEn: "Let’s talk about your project.", bodyFr: "Une question, un partenariat ? Nous répondons rapidement.", bodyEn: "A question, a partnership? We answer quickly.", blockVariant: "hero-minimal" }),
      templateBlock("contact", {}),
      templateBlock("faq", { items: [question("Sous quel délai répondez-vous ?", "How fast do you reply?", "En général sous 48 heures ouvrées.", "Usually within two working days."), question("Peut-on vous rendre visite ?", "Can we visit you?", "Oui, sur rendez-vous.", "Yes, by appointment.")] }),
    ],
  },
};

/** Adds the blocks of a page template to the page being edited. */
function PageTemplatePanel({
  onApply,
  fr,
}: {
  onApply: (sections: WebsiteSection[], mode: "append" | "replace") => void;
  fr: boolean;
}) {
  const [choice, setChoice] = useState("about");
  return (
    <section className="space-y-2 rounded-xl border border-border p-3">
      <p className="text-sm font-semibold text-ink">{tr(fr, "Modèle de page", "Page template")}</p>
      <p className="text-[11px] text-ink-muted">
        {tr(
          fr,
          "Des blocs déjà mis en page et remplis (FR + EN), que vous adaptez ensuite. Rien n’est enregistré avant « Enregistrer ».",
          "Blocks already laid out and filled in (FR + EN), to adapt afterwards. Nothing is saved before “Save”.",
        )}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(PAGE_TEMPLATES)
          .filter(([key]) => key !== "blank")
          .map(([key, entry]) => (
            <button
              key={key}
              type="button"
              aria-pressed={choice === key}
              onClick={() => setChoice(key)}
              className={`rounded-md border px-2 py-1.5 text-left transition ${
                choice === key ? "border-violet-500 bg-violet-500/10" : "border-border bg-surface-1 hover:border-violet-400"
              }`}
            >
              <span className="block text-xs font-semibold text-ink">{entry.label[fr ? 0 : 1]}</span>
              <span className="block text-[10px] leading-3 text-ink-muted">{entry.hint[fr ? 0 : 1]}</span>
            </button>
          ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => onApply(PAGE_TEMPLATES[choice]!.build(), "append")}>
          <Plus />
          {tr(fr, "Ajouter à la fin de la page", "Add at the end of the page")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (await ask(tr(fr, "Remplacer tous les blocs de cette page par ce modèle ? (Annulable avec « Annuler » tant que vous n’enregistrez pas.)", "Replace every block of this page with this template? (Undo with “Discard” as long as you don’t save.)")))
              onApply(PAGE_TEMPLATES[choice]!.build(), "replace");
          }}
        >
          <RotateCcw />
          {tr(fr, "Remplacer la page", "Replace the page")}
        </Button>
      </div>
    </section>
  );
}

/** The pictures of a gallery block: add, reorder, caption and remove. */
function GalleryImagesField({
  orgSlug,
  items,
  onChange,
  strayImage,
  onAdoptStray,
  fr,
}: {
  orgSlug: string;
  items: Record<string, unknown>[];
  onChange: (items: Record<string, unknown>[]) => void;
  /** An image chosen earlier as "block image", which a gallery does not show. */
  strayImage?: string;
  onAdoptStray?: () => void;
  fr: boolean;
}) {
  const imageOf = (item: Record<string, unknown>) => String(item.imageUrl ?? item.image ?? "");
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        {tr(fr, "Images de la galerie", "Gallery images")} · {items.length}
      </p>
      {strayImage && onAdoptStray ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[.07] p-2">
          <img src={strayImage} alt="" className="size-10 rounded object-cover" />
          <p className="min-w-0 flex-1 text-[11px] text-ink-secondary">
            {tr(fr, "Cette image avait été choisie comme « image du bloc », qu’une galerie n’affiche pas.", "This image was chosen as the “block image”, which a gallery does not show.")}
          </p>
          <Button size="sm" variant="secondary" onClick={onAdoptStray}>
            {tr(fr, "L’ajouter à la galerie", "Add it to the gallery")}
          </Button>
        </div>
      ) : null}
      {items.length ? (
        <ol className="grid grid-cols-2 gap-2">
          {items.map((item, index) => (
            <li key={index} className="space-y-1 rounded-lg border border-border p-1.5">
              <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-surface-2">
                {imageOf(item) ? (
                  <img src={imageOf(item)} alt="" className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center text-[11px] text-ink-muted">{tr(fr, "Sans image", "No image")}</span>
                )}
                <span className="absolute left-1 top-1 rounded bg-slate-950/70 px-1.5 text-[10px] font-semibold text-white">{index + 1}</span>
              </div>
              <Input
                className="h-7 text-xs"
                placeholder={tr(fr, "Légende FR", "FR caption")}
                value={String(item.captionFr ?? "")}
                onChange={(event) => onChange(items.map((entry, position) => (position === index ? { ...entry, captionFr: event.target.value } : entry)))}
              />
              <Input
                className="h-7 text-xs"
                placeholder={tr(fr, "Légende EN", "EN caption")}
                value={String(item.captionEn ?? "")}
                onChange={(event) => onChange(items.map((entry, position) => (position === index ? { ...entry, captionEn: event.target.value } : entry)))}
              />
              <div className="flex justify-between">
                <Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)} aria-label={tr(fr, "Avancer", "Move earlier")}>
                  <ChevronUp className="-rotate-90" />
                </Button>
                <Button size="icon-sm" variant="ghost" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={tr(fr, "Reculer", "Move later")}>
                  <ChevronDown className="-rotate-90" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onChange(items.filter((_entry, position) => position !== index))}
                  aria-label={tr(fr, "Retirer l’image", "Remove image")}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <WebsiteImagePicker
        orgSlug={orgSlug}
        value=""
        onChange={(url) => {
          if (url) onChange([...items, { imageUrl: url, captionFr: "", captionEn: "" }]);
        }}
        onPickMany={(urls) => onChange([...items, ...urls.map((url) => ({ imageUrl: url, captionFr: "", captionEn: "" }))])}
        fr={fr}
        label={tr(fr, "Ajouter une image à la galerie", "Add an image to the gallery")}
      />
      <p className="text-[11px] text-ink-muted">
        {tr(fr, "Chaque image ajoutée apparaît tout de suite dans l’aperçu. Pensez à enregistrer.", "Each added image shows right away in the preview. Remember to save.")}
      </p>
    </div>
  );
}

/* ── States and interactions ─────────────────────────────────────────── */

function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const STATE_TABS: Array<[string | null, [string, string]]> = [
  [null, ["Normal", "Normal"]],
  ["hover", ["Survol", "Hover"]],
  ["active", ["Clic", "Press"]],
  ["focus", ["Focus", "Focus"]],
  ["disabled", ["Désactivé", "Disabled"]],
];
const CURSOR_LABELS: Record<string, [string, string]> = {
  auto: ["Automatique", "Automatic"],
  default: ["Flèche", "Arrow"],
  pointer: ["Main (cliquable)", "Hand (clickable)"],
  "zoom-in": ["Loupe +", "Zoom in"],
  "zoom-out": ["Loupe −", "Zoom out"],
  grab: ["Saisir", "Grab"],
  help: ["Aide", "Help"],
  text: ["Texte", "Text"],
  move: ["Déplacer", "Move"],
  "not-allowed": ["Interdit", "Not allowed"],
};

/**
 * "États et interactions": how the element looks in its normal, hover,
 * pressed, keyboard-focus and disabled states, with the transition between
 * them. The chosen state is shown in the preview while it is edited.
 * Only validated values are stored (colours, numbers, presets): no free CSS
 * and no script can be entered.
 */
function StatesPanel({
  orgSlug,
  style,
  onChange,
  state,
  onState,
  canDisable,
  fr,
}: {
  orgSlug: string;
  style: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  state: string | null;
  onState: (state: string | null) => void;
  canDisable: boolean;
  fr: boolean;
}) {
  const current: Record<string, unknown> =
    state && style[state] && typeof style[state] === "object" ? (style[state] as Record<string, unknown>) : state ? {} : style;
  const set = (key: string, value: unknown) => {
    const clean = (target: Record<string, unknown>) => {
      if (value === undefined || value === "" || value === null) delete target[key];
      else target[key] = value;
      return target;
    };
    if (!state) {
      onChange(clean({ ...style }));
      return;
    }
    const next = clean({ ...current });
    const result = { ...style, [state]: next };
    if (!Object.keys(next).length) delete result[state];
    onChange(result);
  };
  const resetState = () => {
    if (!state) return;
    const result = { ...style };
    delete result[state];
    onChange(result);
  };
  const edited = (key: string) => Boolean(style[key] && typeof style[key] === "object" && Object.keys(style[key] as object).length);
  const textColor = typeof current.color === "string" ? current.color : typeof style.color === "string" ? style.color : null;
  const background = typeof current.background === "string" ? current.background : typeof style.background === "string" ? style.background : null;
  const ratio = textColor && background && /^#[0-9a-f]{6}$/i.test(textColor) && /^#[0-9a-f]{6}$/i.test(background) ? contrastRatio(textColor, background) : null;
  const tabs = STATE_TABS.filter(([key]) => key !== "disabled" || canDisable);
  return (
    <InspectorSection title={tr(fr, "États et interactions", "States and interactions")} active={tabs.some(([key]) => key && edited(key))}>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={tr(fr, "État", "State")}>
        {tabs.map(([key, label]) => (
          <button
            key={key ?? "normal"}
            type="button"
            role="tab"
            aria-selected={state === key}
            onClick={() => onState(key)}
            className={`relative rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
              state === key ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300" : "border-border text-ink-secondary hover:text-ink"
            }`}
          >
            {label[fr ? 0 : 1]}
            {key && edited(key) ? <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-violet-600" /> : null}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-ink-muted">
        {state
          ? tr(fr, "L’aperçu montre cet état. Seules les valeurs choisies ici changent ; le reste vient de l’état normal.", "The preview shows this state. Only the values set here change; the rest comes from the normal state.")
          : tr(fr, "État normal : couleurs, fond et bordure se règlent dans les sections ci-dessus. Ici : curseur, position et transition.", "Normal state: colours, background and border are set in the sections above. Here: cursor, position and transition.")}
      </p>

      {state ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <BlockColorField label={tr(fr, "Texte et icônes", "Text and icons")} value={current.color} onChange={(value) => set("color", value || undefined)} fallback="#0f172a" fr={fr} />
            <BlockColorField label={tr(fr, "Fond", "Background")} value={current.background} onChange={(value) => set("background", value || undefined)} fallback="#ffffff" fr={fr} />
          </div>
          {ratio !== null && ratio < 4.5 ? (
            <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300">
              {tr(fr, `Contraste faible (${ratio.toFixed(1)}:1) : visez au moins 4,5:1 pour que le texte reste lisible.`, `Low contrast (${ratio.toFixed(1)}:1): aim for at least 4.5:1 so the text stays readable.`)}
            </p>
          ) : null}
          <WebsiteImagePicker
            orgSlug={orgSlug}
            value={typeof current.backgroundImage === "string" ? current.backgroundImage : ""}
            onChange={(url) => set("backgroundImage", url || undefined)}
            fr={fr}
            label={tr(fr, "Image de fond (facultatif)", "Background image (optional)")}
          />
          <div className="grid grid-cols-3 gap-1.5">
            <NumInput label={tr(fr, "Bordure (px)", "Border (px)")} value={current.borderWidth} min={0} max={24} placeholder="—" onChange={(value) => set("borderWidth", value)} />
            <NumInput label={tr(fr, "Opacité bordure %", "Border opacity %")} value={current.borderOpacity} min={0} max={100} placeholder="100" onChange={(value) => set("borderOpacity", value)} />
            <NumInput label={tr(fr, "Angles (px)", "Corners (px)")} value={current.radius} min={0} max={400} placeholder="—" onChange={(value) => set("radius", value)} />
          </div>
          <BlockColorField label={tr(fr, "Couleur de bordure", "Border colour")} value={current.borderColor} onChange={(value) => set("borderColor", value || undefined)} fallback="#0f172a" fr={fr} />
          <div className="grid grid-cols-2 gap-1.5">
            <label className="space-y-1 text-xs text-ink-secondary">
              {tr(fr, "Ombre", "Shadow")}
              <select
                className="h-8 w-full rounded-md border border-border bg-surface-1 px-1.5 text-xs text-ink"
                value={typeof current.shadow === "string" ? current.shadow : ""}
                onChange={(event) => set("shadow", event.target.value || undefined)}
              >
                <option value="">—</option>
                {["none", "sm", "md", "lg", "xl"].map((key) => (
                  <option key={key} value={key}>
                    {key === "none" ? tr(fr, "Aucune", "None") : key.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <NumInput label={tr(fr, "Transparence (opacité %)", "Opacity %")} value={current.opacity} min={0} max={100} placeholder="100" onChange={(value) => set("opacity", value)} />
          </div>
        </>
      ) : null}

      <div className="space-y-1">
        <span className="text-xs font-medium text-ink-secondary">{tr(fr, "Mouvement", "Movement")}</span>
        <div className="grid grid-cols-4 gap-1.5">
          <NumInput label={tr(fr, "Monter/desc. px", "Up/down px")} value={current.translateY} min={-400} max={400} placeholder="0" onChange={(value) => set("translateY", value)} />
          <NumInput label={tr(fr, "Gauche/droite px", "Left/right px")} value={current.translateX} min={-400} max={400} placeholder="0" onChange={(value) => set("translateX", value)} />
          <NumInput label={tr(fr, "Zoom %", "Zoom %")} value={current.scale} min={10} max={300} placeholder="100" onChange={(value) => set("scale", value)} />
          <NumInput label={tr(fr, "Rotation °", "Rotate °")} value={current.rotate} min={-360} max={360} placeholder="0" onChange={(value) => set("rotate", value)} />
        </div>
        {state === "hover" ? (
          <div className="flex flex-wrap gap-1">
            {(
              [
                [tr(fr, "Soulever", "Lift"), { translateY: -6, shadow: "lg" }],
                [tr(fr, "Agrandir", "Grow"), { scale: 104 }],
                [tr(fr, "Assombrir", "Dim"), { opacity: 85 }],
              ] as const
            ).map(([label, preset]) => (
              <button
                key={label}
                type="button"
                className="rounded-md border border-border px-2 py-0.5 text-[11px] text-ink-secondary hover:border-violet-500 hover:text-ink"
                onClick={() => onChange({ ...style, hover: { ...current, ...preset } })}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <label className="block space-y-1 text-xs text-ink-secondary">
        {tr(fr, "Curseur", "Cursor")}
        <select
          className="h-8 w-full rounded-md border border-border bg-surface-1 px-1.5 text-xs text-ink"
          value={typeof current.cursor === "string" ? current.cursor : ""}
          onChange={(event) => set("cursor", event.target.value || undefined)}
        >
          <option value="">—</option>
          {Object.entries(CURSOR_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label[fr ? 0 : 1]}
            </option>
          ))}
        </select>
      </label>

      {!state ? (
        <div className="space-y-1">
          <span className="text-xs font-medium text-ink-secondary">{tr(fr, "Transition entre les états", "Transition between states")}</span>
          <div className="grid grid-cols-3 gap-1.5">
            <NumInput label={tr(fr, "Durée (ms)", "Duration (ms)")} value={style.transitionDuration} min={0} max={3000} step={50} placeholder="220" onChange={(value) => set("transitionDuration", value)} />
            <NumInput label={tr(fr, "Délai (ms)", "Delay (ms)")} value={style.transitionDelay} min={0} max={3000} step={50} placeholder="0" onChange={(value) => set("transitionDelay", value)} />
            <label className="space-y-1 text-xs text-ink-secondary">
              {tr(fr, "Type", "Easing")}
              <select
                className="h-8 w-full rounded-md border border-border bg-surface-1 px-1.5 text-xs text-ink"
                value={typeof style.transitionEasing === "string" ? style.transitionEasing : "ease"}
                onChange={(event) => set("transitionEasing", event.target.value === "ease" ? undefined : event.target.value)}
              >
                <option value="ease">ease</option>
                <option value="ease-in">ease-in</option>
                <option value="ease-out">ease-out</option>
                <option value="ease-in-out">ease-in-out</option>
                <option value="linear">linear</option>
                <option value="spring">{tr(fr, "ressort (spring)", "spring")}</option>
              </select>
            </label>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" disabled={!edited(state)} onClick={resetState}>
          <RotateCcw />
          {tr(fr, "Effacer cet état", "Clear this state")}
        </Button>
      )}
      <p className="text-[11px] text-ink-muted">
        {tr(
          fr,
          "Accessibilité préservée : le focus clavier reste toujours visible, et les mouvements sont supprimés pour les visiteurs qui réduisent les animations.",
          "Accessibility kept: keyboard focus always stays visible, and movement is removed for visitors who reduce motion.",
        )}
      </p>
    </InspectorSection>
  );
}
