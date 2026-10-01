"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Globe2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, SkeletonCard, EmptyState } from "@/components/ui/states";
import { get } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

type PlatformWebsite = {
  organizationSlug: string;
  organizationName: string;
  publicationStatus: "draft" | "published" | "paused";
  customDomain: string | null;
  updatedAt: string;
  pageCount: number;
  publishedPageCount: number;
};

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const statusLabel = (status: PlatformWebsite["publicationStatus"], fr: boolean) => status === "published" ? tr(fr, "Publié", "Published") : status === "paused" ? tr(fr, "En pause", "Paused") : tr(fr, "Brouillon", "Draft");

export function PlatformWebsites() {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const query = useQuery({ queryKey: ["platform-websites"], queryFn: () => get<{ websites: PlatformWebsite[] }>("/platform/websites") });
  if (query.isLoading) return <div className="p-6"><SkeletonCard rows={8} /></div>;
  if (query.isError || !query.data) return <div className="p-6"><ErrorState title={tr(fr, "Impossible de charger les sites", "Could not load websites")} description={(query.error as Error | undefined)?.message} onRetry={() => void query.refetch()} /></div>;
  const websites = query.data.websites;
  return <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8"><section className="overflow-hidden rounded-3xl border border-brand/20 bg-surface-1"><div className="bg-[radial-gradient(circle_at_80%_0%,rgba(250,204,21,.25),transparent_36%),linear-gradient(125deg,#172554,#0f766e)] px-6 py-8 text-white sm:px-8"><p className="text-xs font-bold tracking-[.16em] text-cyan-100">LITEHUBS PLATFORM</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">{tr(fr, "Sites et domaines des entreprises", "Company websites and domains")}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-cyan-50">{tr(fr, "Cette vue Super admin vérifie les demandes de site public et de domaine. Elle ne donne jamais accès aux contenus internes ou à l’éditeur d’une entreprise.", "This Super admin view checks public site and domain requests. It never grants access to an organization's internal content or editor.")}</p></div></section><div className="grid gap-4 sm:grid-cols-3"><Metric label={tr(fr, "Sites configurés", "Configured websites")} value={websites.length} /><Metric label={tr(fr, "Sites publiés", "Published websites")} value={websites.filter((website) => website.publicationStatus === "published").length} /><Metric label={tr(fr, "Domaines demandés", "Requested domains")} value={websites.filter((website) => website.customDomain).length} /></div><Card><CardHeader><div><CardTitle>{tr(fr, "Registre des sites", "Website register")}</CardTitle><CardDescription>{tr(fr, "Validez l’hébergement et donnez les instructions DNS exactes avant d’annoncer un domaine personnalisé.", "Validate hosting and provide exact DNS instructions before announcing a custom domain.")}</CardDescription></div></CardHeader><CardContent>{websites.length ? <div className="divide-y divide-border rounded-lg border border-border">{websites.map((website) => <article key={website.organizationSlug} className="flex flex-wrap items-center justify-between gap-4 p-4"><div className="min-w-0"><p className="font-semibold text-ink">{website.organizationName}</p><p className="mt-1 text-xs text-ink-secondary">/{website.organizationSlug} · {website.pageCount} {tr(fr, "page(s)", "page(s)")} · {website.publishedPageCount} {tr(fr, "publiée(s)", "published")}</p></div><div className="flex flex-wrap items-center gap-3"><div className="max-w-56 text-right"><p className="truncate text-sm font-medium text-ink">{website.customDomain ?? tr(fr, "Aucun domaine demandé", "No requested domain")}</p><p className="text-xs text-ink-muted">{new Date(website.updatedAt).toLocaleDateString(fr ? "fr-FR" : "en-GB")}</p></div><Badge variant={website.publicationStatus === "published" ? "good" : website.publicationStatus === "paused" ? "neutral" : "warning"}>{statusLabel(website.publicationStatus, fr)}</Badge><Link href={`/sites/${website.organizationSlug}`} target="_blank" className="inline-flex size-9 items-center justify-center rounded-md border border-border text-ink hover:bg-surface-2" aria-label={tr(fr, "Ouvrir l’aperçu", "Open preview")}><ExternalLink className="size-4" /></Link></div></article>)}</div> : <EmptyState icon={Globe2} title={tr(fr, "Aucun site configuré", "No configured websites")} description={tr(fr, "Les demandes de site web des propriétaires apparaîtront ici.", "Owner website requests will appear here.")} />}</CardContent></Card><Card className="border-dashed"><CardContent className="flex gap-3 py-5"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" /><p className="text-sm leading-6 text-ink-secondary">{tr(fr, "La connexion DNS est une action d’infrastructure distincte : vérifiez d’abord le domaine demandé, puis configurez l’hébergement et transmettez les enregistrements DNS vérifiés au propriétaire.", "DNS connection is a separate infrastructure action: first verify the requested domain, then configure hosting and give verified DNS records to the owner.")}</p></CardContent></Card></div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <Card><CardContent className="py-5"><p className="text-xs font-medium text-ink-muted">{label}</p><p className="mt-1 text-2xl font-semibold text-ink">{value}</p></CardContent></Card>; }
