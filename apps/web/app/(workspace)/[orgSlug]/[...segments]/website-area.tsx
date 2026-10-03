"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  FilePlus2,
  Globe2,
  GripVertical,
  Images,
  Layers3,
  Mail,
  Megaphone,
  Palette,
  PencilLine,
  Plus,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
  Trash2,
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
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { del, get, orgUrl, patch, post, put } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";
import {
  PublicWebsiteRenderer,
  type PublicWebsite,
  type PublicWebsitePage,
  type WebsiteSection,
} from "@/components/website/public-website-renderer";

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
type Tab = "pages" | "editor" | "media" | "activities" | "appearance" | "preview";
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
};
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
const blankPage = (): Omit<BuilderPage, "id" | "sections" | "sortOrder"> => ({
  slug: "",
  navigationLabelFr: "",
  navigationLabelEn: "",
  titleFr: "",
  titleEn: "",
  descriptionFr: "",
  descriptionEn: "",
  seoTitleFr: "",
  seoTitleEn: "",
  seoDescriptionFr: "",
  seoDescriptionEn: "",
  templateCode: "company",
  status: "draft",
  isHome: false,
});
const toOptional = (value: string | null | undefined) => value?.trim() || null;

function sectionSeed(type: SectionType): WebsiteSection {
  const common = { id: `local-${Date.now()}-${type}`, sort_order: 0 };
  switch (type) {
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
  const [newPage, setNewPage] = useState(false);
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
    mutationFn: (payload: Record<string, unknown>) =>
      post<{ page: BuilderPage }>(
        orgUrl(orgSlug, "website/pages"),
        payload,
      ).then((response) => response.page),
    onSuccess: (page) => {
      refresh();
      setSelectedPageId(page.id);
      setNewPage(false);
      setTab("editor");
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
  const completeStarterPages = useMutation({
    mutationFn: () =>
      post<{
        created: number;
        prepared: number;
        published: number;
        total: number;
      }>(orgUrl(orgSlug, "website/complete-starter-pages")),
    onSuccess: (response) => {
      refresh();
      toast.success(
        tr(
          fr,
          `${response.total} pages prêtes et publiées`,
          `${response.total} pages ready and published`,
        ),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const addVisualHighlights = useMutation({
    mutationFn: () =>
      post<{ added: number }>(orgUrl(orgSlug, "website/visual-highlights")),
    onSuccess: (response) => {
      refresh();
      toast.success(
        response.added
          ? tr(
              fr,
              "Images ajoutées aux pages brouillon",
              "Images added to draft pages",
            )
          : tr(
              fr,
              "Les pages brouillon ont déjà leurs images",
              "Draft pages already have images",
            ),
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
  return (
    <main className="mx-auto max-w-[1540px] space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="overflow-hidden rounded-3xl border border-brand/20 bg-surface-1 shadow-[0_20px_55px_-36px_rgb(30_64_175_/_0.7)]">
        <div className="grid gap-5 bg-[radial-gradient(circle_at_88%_-20%,rgba(251,191,36,.26),transparent_36%),linear-gradient(125deg,#0b2545,#146c7e)] px-6 py-8 text-white sm:px-8 md:grid-cols-[1fr_auto]">
          <div className="max-w-3xl">
            <p className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-[.16em] text-cyan-50">
              {tr(fr, "SITE WEB", "WEBSITE")}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              {tr(
                fr,
                "Construisez votre présence publique",
                "Build your public presence",
              )}
            </h1>
            <p className="mt-3 text-sm leading-6 text-cyan-50/95">
              {tr(
                fr,
                "Pages, identité, aperçu, domaine et publication restent au même endroit. Les données internes de LiteHubs restent privées.",
                "Pages, identity, preview, domain and publication stay in one place. LiteHubs internal data remains private.",
              )}
            </p>
          </div>
          {builder.website ? (
            <div className="flex flex-wrap gap-2 self-end">
              <a href={`/sites/${orgSlug}`} target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <ExternalLink />
                  {tr(fr, "Ouvrir l’aperçu privé", "Open private preview")}
                </Button>
              </a>
              <Button
                className="bg-white text-sky-950 hover:bg-cyan-50"
                loading={publication.isPending}
                onClick={() =>
                  publication.mutate(
                    builder.website!.publicationStatus === "published"
                      ? "paused"
                      : "published",
                  )
                }
              >
                <Globe2 />
                {builder.website.publicationStatus === "published"
                  ? tr(fr, "Mettre en pause", "Pause site")
                  : tr(fr, "Publier le site", "Publish website")}
              </Button>
            </div>
          ) : null}
        </div>
        {builder.website ? (
          <div className="grid grid-cols-2 gap-px bg-border/70 sm:grid-cols-4">
            <Stat
              label={tr(fr, "Pages", "Pages")}
              value={pages.filter((page) => page.status !== "archived").length}
            />
            <Stat
              label={tr(fr, "Publiées", "Published")}
              value={pages.filter((page) => page.status === "published").length}
            />
            <Stat
              label={tr(fr, "Domaine", "Domain")}
              value={builder.website.customDomain ?? tr(fr, "Aucun", "None")}
            />
            <Stat
              label={tr(fr, "État", "Status")}
              value={statusLabel(builder.website.publicationStatus, fr)}
            />
          </div>
        ) : null}
      </section>

      {builder.website && builder.website.publicationStatus !== "published" ? (
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-amber-300/60 bg-amber-50 px-5 py-4 text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
          <div>
            <p className="font-semibold">
              {tr(fr, "Le site public est en pause", "The public website is paused")}
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-6">
              {tr(
                fr,
                "L’aperçu privé montre vos modifications, y compris le logo, mais congoomega.com ne montrera les pages publiées qu’après « Publier le site ».",
                "The private preview shows your changes, including the logo, but the custom domain will only show published pages after you choose “Publish website”.",
              )}
            </p>
          </div>
          <Button
            size="sm"
            loading={publication.isPending}
            onClick={() => publication.mutate("published")}
          >
            <Globe2 />
            {tr(fr, "Publier le site", "Publish website")}
          </Button>
        </div>
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
              active={tab === "editor"}
              onClick={() => setTab("editor")}
              icon={Layers3}
              label={tr(fr, "Éditeur", "Editor")}
            />
            <TabButton
              active={tab === "media"}
              onClick={() => setTab("media")}
              icon={Images}
              label={tr(fr, "Bibliothèque média", "Media library")}
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
            <TabButton
              active={tab === "preview"}
              onClick={() => setTab("preview")}
              icon={Eye}
              label={tr(fr, "Aperçu", "Preview")}
            />
          </div>
          {tab === "pages" ? (
            <PagesTab
              pages={pages}
              selectedId={selectedPageId}
              onSelect={(id) => {
                setSelectedPageId(id);
                setTab("editor");
              }}
              onNew={() => setNewPage(true)}
              onInstall={() => installStarterPages.mutate()}
              installing={installStarterPages.isPending}
              onComplete={() => completeStarterPages.mutate()}
              completing={completeStarterPages.isPending}
              onAddVisuals={() => addVisualHighlights.mutate()}
              addingVisuals={addVisualHighlights.isPending}
              onPublish={(page) => publishPage.mutate(page.id)}
              publishing={publishPage.isPending}
              onArchive={(page) => archivePage.mutate(page.id)}
              onReorder={(pageIds) => reorderPages.mutate(pageIds)}
              reordering={reorderPages.isPending}
              newPage={newPage}
              onCancel={() => setNewPage(false)}
              onCreate={(payload) => createPage.mutate(payload)}
              fr={fr}
              creating={createPage.isPending}
            />
          ) : null}
          {tab === "editor" ? (
            <EditorTab
              orgSlug={orgSlug}
              page={selected}
              onSavePage={(payload) =>
                selected && savePage.mutate({ id: selected.id, payload })
              }
              onSaveSections={(sections) =>
                selected && saveSections.mutate({ id: selected.id, sections })
              }
              onPublish={() => selected && publishPage.mutate(selected.id)}
              savingPage={savePage.isPending}
              savingSections={saveSections.isPending}
              publishing={publishPage.isPending}
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
            <PreviewTab
              orgSlug={orgSlug}
              website={builder.website}
              page={selected}
              pages={pages}
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
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface-1 px-5 py-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
function statusLabel(status: string, fr: boolean) {
  return status === "published"
    ? tr(fr, "Publié", "Published")
    : status === "paused"
      ? tr(fr, "En pause", "Paused")
      : tr(fr, "Brouillon", "Draft");
}

function PagesTab({
  pages,
  selectedId,
  onSelect,
  onNew,
  onInstall,
  installing,
  onComplete,
  completing,
  onAddVisuals,
  addingVisuals,
  onPublish,
  publishing,
  onArchive,
  onReorder,
  reordering,
  newPage,
  onCancel,
  onCreate,
  creating,
  fr,
}: {
  pages: BuilderPage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onInstall: () => void;
  installing: boolean;
  onComplete: () => void;
  completing: boolean;
  onAddVisuals: () => void;
  addingVisuals: boolean;
  onPublish: (page: BuilderPage) => void;
  publishing: boolean;
  onArchive: (page: BuilderPage) => void;
  onReorder: (pageIds: string[]) => void;
  reordering: boolean;
  newPage: boolean;
  onCancel: () => void;
  onCreate: (payload: Record<string, unknown>) => void;
  creating: boolean;
  fr: boolean;
}) {
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dragOverPageId, setDragOverPageId] = useState<string | null>(null);
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
  const orderChanged = orderedPages.some(
    (page, index) => page.id !== pages[index]?.id,
  );
  const homeIndex = orderedPages.findIndex((page) => page.isHome);
  const firstMovableIndex = homeIndex >= 0 ? homeIndex + 1 : 0;

  const movePage = (pageId: string, direction: -1 | 1) => {
    const currentIndex = orderedPages.findIndex((page) => page.id === pageId);
    const targetIndex = Math.max(
      firstMovableIndex,
      Math.min(orderedPages.length - 1, currentIndex + direction),
    );
    if (currentIndex < firstMovableIndex || targetIndex === currentIndex) return;
    const nextPages = [...orderedPages];
    const currentPage = nextPages[currentIndex];
    const targetPage = nextPages[targetIndex];
    if (!currentPage || !targetPage) return;
    nextPages[currentIndex] = targetPage;
    nextPages[targetIndex] = currentPage;
    setOrderedPageIds(nextPages.map((page) => page.id));
  };

  const moveDraggedPage = (targetId: string) => {
    if (!draggedPageId || draggedPageId === targetId) return;
    const sourceIndex = orderedPages.findIndex(
      (page) => page.id === draggedPageId,
    );
    const movingPage = orderedPages.find((page) => page.id === draggedPageId);
    if (!movingPage || movingPage.isHome || sourceIndex < 0) return;
    const nextPages = orderedPages.filter((page) => page.id !== draggedPageId);
    const targetIndex = nextPages.findIndex((page) => page.id === targetId);
    if (targetIndex < 0) return;
    const home = nextPages.find((page) => page.isHome);
    const targetWasAfterSource = orderedPages.findIndex(
      (page) => page.id === targetId,
    ) > sourceIndex;
    // Dropping down must place the item after its target.  Previously every
    // drop meant "before", so dropping on the following page changed nothing.
    const insertAt =
      targetId === home?.id
        ? 1
        : Math.max(0, targetIndex + (targetWasAfterSource ? 1 : 0));
    nextPages.splice(insertAt, 0, movingPage);
    setOrderedPageIds(nextPages.map((page) => page.id));
  };

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{tr(fr, "Pages du site", "Website pages")}</CardTitle>
            <CardDescription>
              {tr(
                fr,
                "Créez vos pages ici, puis ouvrez l’éditeur pour organiser leur contenu.",
                "Create pages here, then open the editor to arrange their content.",
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button loading={completing} onClick={onComplete}>
              <CheckCircle2 />
              {tr(
                fr,
                "Finaliser et publier le site",
                "Finish and publish website",
              )}
            </Button>
            <Button
              variant="secondary"
              loading={installing}
              onClick={onInstall}
            >
              <Sparkles />
              {tr(fr, "Installer le site complet", "Install complete site")}
            </Button>
            <Button
              variant="secondary"
              loading={addingVisuals}
              onClick={onAddVisuals}
            >
              <Sparkles />
              {tr(fr, "Ajouter les images", "Add images")}
            </Button>
            <Button onClick={onNew}>
              <Plus />
              {tr(fr, "Nouvelle page", "New page")}
            </Button>
            <Button
              variant="secondary"
              loading={reordering}
              disabled={!orderChanged}
              onClick={() => onReorder(orderedPages.map((page) => page.id))}
            >
              <Save />
              {tr(fr, "Enregistrer l’ordre", "Save order")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-5 rounded-xl border border-brand/20 bg-brand/[.06] p-4">
            <p className="text-sm font-semibold text-ink">
              {tr(
                fr,
                "Site complet en un clic",
                "Complete website in one click",
              )}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {tr(
                fr,
                "Finaliser publie les pages standard : Accueil, Notre entreprise, Activités, Projets, Impact, Carrières et Contact. Les pages personnalisées restent en brouillon pour votre contrôle.",
                "Finish publishes the standard pages: Home, Company, Activities, Projects, Impact, Careers and Contact. Custom pages stay as drafts for your control.",
              )}
            </p>
          </div>
          {pages.length ? (
            <>
              <p className="mb-3 text-sm text-ink-secondary">
                {tr(
                fr,
                "Glissez une page par sa poignée, puis cliquez sur « Enregistrer l’ordre ». Accueil reste en première position.",
                "Drag a page by its handle, then choose “Save order”. Home stays first.",
              )}
            </p>
            <div className="divide-y divide-border rounded-lg border border-border">
              {orderedPages.map((page, index) => (
                <div
                  key={page.id}
                  draggable={!page.isHome && !reordering}
                  onDragStart={() => {
                    if (!page.isHome) setDraggedPageId(page.id);
                  }}
                  onDragEnd={() => {
                    setDraggedPageId(null);
                    setDragOverPageId(null);
                  }}
                  onDragOver={(event) => {
                    if (!reordering) {
                      event.preventDefault();
                      setDragOverPageId(page.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    moveDraggedPage(page.id);
                    setDraggedPageId(null);
                    setDragOverPageId(null);
                  }}
                  className={`flex flex-wrap items-center justify-between gap-3 p-4 transition-all ${selectedId === page.id ? "bg-surface-2" : "hover:bg-surface-2/65"} ${draggedPageId === page.id ? "opacity-45" : ""} ${dragOverPageId === page.id && draggedPageId !== page.id ? "border-y-2 border-brand bg-brand/[.06]" : ""}`}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted ${page.isHome ? "cursor-not-allowed opacity-40" : "cursor-grab active:cursor-grabbing"}`}
                    aria-hidden="true"
                  >
                    <GripVertical className="size-4" />
                  </span>
                  <button
                    type="button"
                    className="group min-w-0 flex-1 cursor-pointer rounded-lg px-1 py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand"
                    aria-label={tr(
                      fr,
                      `Ouvrir la page ${page.navigationLabelFr}`,
                      `Open ${page.navigationLabelEn}`,
                    )}
                    onClick={() => onSelect(page.id)}
                  >
                    <p className="font-medium text-ink">
                      {page.navigationLabelFr}
                      <span className="ml-2 text-xs font-normal text-ink-muted">
                        /{page.slug}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {page.isHome
                        ? tr(fr, "Accueil", "Home")
                        : page.templateCode}{" "}
                      · {statusLabel(page.status, fr)}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      type="button"
                      disabled={
                        reordering ||
                        page.isHome ||
                        index <= firstMovableIndex
                      }
                      aria-label={tr(fr, "Déplacer vers le haut", "Move up")}
                      onClick={() => movePage(page.id, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      type="button"
                      disabled={
                        reordering ||
                        page.isHome ||
                        index >= pages.length - 1
                      }
                      aria-label={tr(fr, "Déplacer vers le bas", "Move down")}
                      onClick={() => movePage(page.id, 1)}
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      onClick={() => onSelect(page.id)}
                    >
                      <Settings2 />
                      {tr(fr, "Modifier", "Edit")}
                    </Button>
                    {page.status === "draft" ? (
                      <Button
                        size="sm"
                        type="button"
                        loading={publishing}
                        onClick={() => onPublish(page)}
                      >
                        <Send />
                        {tr(fr, "Publier", "Publish")}
                      </Button>
                    ) : null}
                    <Badge
                      variant={
                        page.status === "published"
                          ? "good"
                          : page.status === "archived"
                            ? "serious"
                            : "warning"
                      }
                    >
                      {statusLabel(page.status, fr)}
                    </Badge>
                    {!page.isHome && page.status !== "archived" ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={tr(fr, "Archiver", "Archive")}
                        onClick={() => onArchive(page)}
                      >
                        <Archive />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              </div>
            </>
          ) : (
            <EmptyState
              title={tr(fr, "Aucune page", "No pages")}
              description={tr(
                fr,
                "Installez la collection complète ou créez une page sur mesure.",
                "Install the complete collection or create a custom page.",
              )}
              action={{
                label: tr(
                  fr,
                  "Installer le site complet",
                  "Install complete site",
                ),
                onClick: onInstall,
              }}
            />
          )}
        </CardContent>
      </Card>
      {newPage ? (
        <PageForm
          initial={blankPage()}
          title={tr(fr, "Créer une page", "Create a page")}
          submit={tr(fr, "Créer la page", "Create page")}
          saving={creating}
          onCancel={onCancel}
          onSave={onCreate}
          fr={fr}
        />
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-8">
            <p className="text-sm font-medium text-ink">
              {tr(fr, "Collection complète", "Complete collection")}
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              {tr(
                fr,
                "Accueil, Entreprise, Activités, Projets, Impact, Carrières et Contact sont prêts avec des sections modernes. Utilisez Ajouter les images pour enrichir sans écraser les pages déjà écrites.",
                "Home, Company, Activities, Projects, Impact, Careers and Contact are ready with modern sections. Use Add images to enrich pages without replacing text you have already written.",
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </section>
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

function EditorTab({
  orgSlug,
  page,
  onSavePage,
  onSaveSections,
  onPublish,
  savingPage,
  savingSections,
  publishing,
  fr,
}: {
  orgSlug: string;
  page: BuilderPage | null;
  onSavePage: (payload: Record<string, unknown>) => void;
  onSaveSections: (sections: WebsiteSection[]) => void;
  onPublish: () => void;
  savingPage: boolean;
  savingSections: boolean;
  publishing: boolean;
  fr: boolean;
}) {
  const [blocks, setBlocks] = useState<WebsiteSection[]>([]);
  useEffect(() => {
    setBlocks(
      (page?.sections ?? []).map((section, index) => ({
        id: section.id,
        section_type: section.type,
        content: section.content,
        sort_order: index,
      })),
    );
  }, [page]);
  const changeBlock = (index: number, block: WebsiteSection) =>
    setBlocks((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? block : item)),
    );
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
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-4">
        <div>
          <p className="font-semibold text-ink">{page.navigationLabelFr}</p>
          <p className="text-xs text-ink-secondary">
            /{page.slug} · {statusLabel(page.status, fr)}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {tr(
              fr,
              "Enregistrez les informations à gauche et l’ordre des blocs à droite.",
              "Save page information on the left and block order on the right.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button loading={publishing} onClick={onPublish}>
            <Send />
            {tr(fr, "Publier la page", "Publish page")}
          </Button>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[410px_minmax(0,1fr)]">
        <PageForm
          initial={page}
          title={tr(fr, "Informations de la page", "Page information")}
          submit={tr(fr, "Enregistrer les informations", "Save information")}
          saving={savingPage}
          onSave={onSavePage}
          fr={fr}
        />
        <BlockComposer
          orgSlug={orgSlug}
          blocks={blocks}
          onChange={setBlocks}
          onSave={() => onSaveSections(blocks)}
          saving={savingSections}
          fr={fr}
          changeBlock={changeBlock}
        />
      </div>
    </section>
  );
}

function BlockComposer({
  orgSlug,
  blocks,
  onChange,
  onSave,
  saving,
  fr,
  changeBlock,
}: {
  orgSlug: string;
  blocks: WebsiteSection[];
  onChange: (blocks: WebsiteSection[]) => void;
  onSave: () => void;
  saving: boolean;
  fr: boolean;
  changeBlock: (index: number, block: WebsiteSection) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
  const ordered = (next: WebsiteSection[]) =>
    next.map((block, sort_order) => ({ ...block, sort_order }));
  const move = (index: number, direction: -1 | 1) => {
    const next = [...blocks];
    const target = index + direction;
    const currentBlock = next[index];
    const targetBlock = next[target];
    if (!currentBlock || !targetBlock || target < 0 || target >= next.length)
      return;
    next[index] = targetBlock;
    next[target] = currentBlock;
    onChange(ordered(next));
  };
  const remove = (index: number) =>
    onChange(ordered(blocks.filter((_block, blockIndex) => blockIndex !== index)));
  const moveDraggedBlock = (targetId: string) => {
    if (!draggedBlockId || draggedBlockId === targetId) return;
    const sourceIndex = blocks.findIndex((block) => block.id === draggedBlockId);
    const moving = blocks.find((block) => block.id === draggedBlockId);
    if (!moving || sourceIndex < 0) return;
    const next = blocks.filter((block) => block.id !== draggedBlockId);
    const targetIndex = next.findIndex((block) => block.id === targetId);
    if (targetIndex < 0) return;
    const targetWasAfterSource = blocks.findIndex(
      (block) => block.id === targetId,
    ) > sourceIndex;
    // Use the target's lower edge when moving down and its upper edge when
    // moving up. This makes both directions visibly move by at least one row.
    next.splice(targetIndex + (targetWasAfterSource ? 1 : 0), 0, moving);
    onChange(ordered(next));
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{tr(fr, "Blocs de contenu", "Content blocks")}</CardTitle>
          <CardDescription>
            {tr(
              fr,
              "Glissez un bloc par sa poignée pour le réorganiser, ou utilisez les flèches. Enregistrez ensuite l’ordre de la page.",
              "Drag a block by its handle to reorder it, or use the arrows. Then save the page order.",
            )}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAdding(!adding)}>
            <Plus />
            {tr(fr, "Ajouter", "Add")}
          </Button>
          <Button loading={saving} onClick={onSave}>
            <Save />
            {tr(fr, "Enregistrer l’ordre", "Save order")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding ? (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-2 p-3 sm:grid-cols-3">
            {(Object.keys(sectionLabels) as SectionType[]).map((type) => (
              <button
                key={type}
                className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-left text-xs font-medium text-ink hover:border-brand"
                onClick={() => {
                  onChange([...blocks, sectionSeed(type)]);
                  setAdding(false);
                }}
              >
                {sectionLabels[type][fr ? 0 : 1]}
              </button>
            ))}
          </div>
        ) : null}
        {blocks.length ? (
          <>
            <div className="flex items-center justify-between rounded-lg border border-brand/15 bg-brand/[.035] px-3 py-2 text-xs text-ink-secondary">
              <span className="font-semibold text-ink">{tr(fr, "Ordre de la page", "Page order")}</span>
              <span>{blocks.length} {tr(fr, "bloc(s)", "block(s)")}</span>
            </div>
            {blocks.map((block, index) => (
              <BlockEditor
                orgSlug={orgSlug}
                key={block.id}
                block={block}
                index={index}
                count={blocks.length}
                onChange={(value) => changeBlock(index, value)}
                onMove={move}
                onRemove={remove}
                onDragStart={() => setDraggedBlockId(block.id)}
                onDragEnd={() => {
                  setDraggedBlockId(null);
                  setDragOverBlockId(null);
                }}
                onDragOver={() => setDragOverBlockId(block.id)}
                onDrop={() => {
                  moveDraggedBlock(block.id);
                  setDraggedBlockId(null);
                  setDragOverBlockId(null);
                }}
                isDragging={draggedBlockId === block.id}
                isDropTarget={dragOverBlockId === block.id && draggedBlockId !== block.id}
                fr={fr}
              />
            ))}
          </>
        ) : (
          <EmptyState
            title={tr(fr, "Aucun bloc", "No blocks")}
            description={tr(
              fr,
              "Ajoutez un en-tête ou du texte pour commencer.",
              "Add a hero or text block to get started.",
            )}
          />
        )}
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
}) {
  const [open, setOpen] = useState(index === 0);
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
      className={`rounded-xl border bg-surface-1 transition-all ${
        isDragging
          ? "border-brand/30 opacity-45"
          : isDropTarget
            ? "border-brand bg-brand/[.055] ring-2 ring-brand/20"
            : "border-border"
      }`}
    >
      <div className="flex items-center gap-2 p-3">
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
            {sectionLabels[block.section_type][fr ? 0 : 1]}
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
        <div className="space-y-3 border-t border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr(fr, "Titre français", "French title")}>
              <Input
                value={read("titleFr")}
                onChange={(event) => set("titleFr", event.target.value)}
              />
            </Field>
            <Field label={tr(fr, "Titre anglais", "English title")}>
              <Input
                value={read("titleEn")}
                onChange={(event) => set("titleEn", event.target.value)}
              />
            </Field>
          </div>
          <Field label={tr(fr, "Texte français", "French text")}>
            <Textarea
              value={read("bodyFr")}
              onChange={(event) => set("bodyFr", event.target.value)}
            />
          </Field>
          <Field label={tr(fr, "Texte anglais", "English text")}>
            <Textarea
              value={read("bodyEn")}
              onChange={(event) => set("bodyEn", event.target.value)}
            />
          </Field>
          {["hero", "image_callout", "gallery"].includes(block.section_type) ? (
            <div
              className={
                block.section_type === "hero"
                  ? "grid gap-3 xl:grid-cols-3"
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
          {["hero", "cta", "image_callout", "careers"].includes(
            block.section_type,
          ) ? (
            <div className="grid gap-3 sm:grid-cols-2">
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
          {["feature_grid", "metrics", "faq", "gallery"].includes(
            block.section_type,
          ) ? (
            <EditableItems
              orgSlug={orgSlug}
              type={block.section_type}
              items={items}
              setItems={setItems}
              fr={fr}
            />
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
                  value={String(item.imageUrl ?? "")}
                  onChange={(url) => update(index, "imageUrl", url)}
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
  fr,
  label,
}: {
  orgSlug: string;
  value: string;
  onChange: (url: string) => void;
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

function PreviewTab({
  orgSlug,
  website,
  page,
  pages,
  fr,
}: {
  orgSlug: string;
  website: BuilderWebsite;
  page: BuilderPage | null;
  pages: BuilderPage[];
  fr: boolean;
}) {
  if (!page)
    return (
      <EmptyState title={tr(fr, "Choisissez une page", "Choose a page")} />
    );
  const previewWebsite: PublicWebsite = {
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
    // The private preview deliberately includes drafts, but it must use the
    // same navigation order as the page list.  Showing only the selected page
    // here made a successful menu reordering look as though it had failed.
    navigation: pages
      .filter((candidate) => candidate.status !== "archived")
      .map((candidate) => ({
        slug: candidate.slug,
        label_fr: candidate.navigationLabelFr,
        label_en: candidate.navigationLabelEn,
      })),
  };
  const previewPage: PublicWebsitePage = {
    slug: page.slug,
    title_fr: page.titleFr,
    title_en: page.titleEn,
    description_fr: page.descriptionFr,
    description_en: page.descriptionEn,
    sections: page.sections.map((section, index) => ({
      id: section.id,
      section_type: section.type,
      content: section.content,
      sort_order: index,
    })),
  };
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border bg-surface-1 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {tr(fr, "Aperçu de l’éditeur", "Editor preview")}
          </p>
          <p className="text-xs text-ink-secondary">
            {tr(
              fr,
              "Les brouillons restent visibles ici seulement pour vous.",
              "Drafts are visible here only to you.",
            )}
          </p>
        </div>
        <a
          href={
            page.isHome ? `/sites/${orgSlug}` : `/sites/${orgSlug}/${page.slug}`
          }
          target="_blank"
          rel="noreferrer"
        >
          <Button size="sm" variant="secondary">
            <ExternalLink />
            {tr(fr, "Nouvel onglet", "New tab")}
          </Button>
        </a>
      </div>
      <PublicWebsiteRenderer website={previewWebsite} page={previewPage} />
    </section>
  );
}
