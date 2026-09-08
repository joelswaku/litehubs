"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Bird, BriefcaseBusiness, CheckCircle2, Package, PiggyBank, Sprout, Users, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WorkspaceProfile } from "@/hooks/useWorkspace";
import { orgUrl, put } from "@/lib/api";

const copy = (fr: boolean, english: string, french: string) => (fr ? french : english);

type ServiceId = "poultry" | "pigs" | "agriculture" | "projects" | "procurement";

const services: Array<{ id: ServiceId; icon: LucideIcon; href: string; english: [string, string]; french: [string, string] }> = [
  { id: "poultry", icon: Bird, href: "/poultry", english: ["Poultry", "Flocks, houses, production and health."], french: ["Aviculture", "Lots, bâtiments, production et santé."] },
  { id: "pigs", icon: PiggyBank, href: "/pigs", english: ["Pigs", "Pens, animals, reproduction and care."], french: ["Élevage porcin", "Enclos, animaux, reproduction et soins."] },
  { id: "agriculture", icon: Sprout, href: "/agriculture", english: ["Agriculture", "Farms, fields, crops and harvests."], french: ["Agriculture", "Fermes, parcelles, cultures et récoltes."] },
  { id: "projects", icon: BriefcaseBusiness, href: "/projects", english: ["Projects", "Plan investments, phases, budget and work."], french: ["Projets", "Pilotez investissements, phases, budget et travaux."] },
  { id: "procurement", icon: Package, href: "/procurement", english: ["Supply & purchasing", "Purchasing, stock, suppliers and equipment."], french: ["Achats et approvisionnement", "Achats, stock, fournisseurs et équipements."] },
];

export function OperationalServiceSetup({ orgSlug, fr, initialServices, onSaved }: { orgSlug: string; fr: boolean; initialServices: string[] | null; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>(initialServices ?? []);
  const save = useMutation({
    mutationFn: () => put<{ services: string[] }>(orgUrl(orgSlug, "operational-services"), { services: selected }),
    onSuccess: (result) => {
      queryClient.setQueryData<WorkspaceProfile>(["workspace-profile", orgSlug], (current) => current ? { ...current, organization: { ...current.organization, operationalServices: result.services } } : current);
      onSaved();
    },
  });
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((service) => service !== id) : [...current, id]);
  const initial = initialServices === null;

  return <section className="overflow-hidden rounded-[1.5rem] border border-brand/20 bg-surface-1 shadow-[0_20px_50px_-36px_rgba(12,74,132,.52)]">
    <div className="border-b border-border bg-[linear-gradient(115deg,rgba(18,128,168,.11),rgba(56,189,158,.07),transparent)] px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-brand">{copy(fr, "Workspace foundation", "Fondation de l’entreprise")}</p><h2 className="mt-2 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{copy(fr, "Choose the operations you manage", "Choisissez les activités que vous gérez")}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{copy(fr, "Select the areas your company uses today. You can refine this selection later as the business grows.", "Sélectionnez les espaces utilisés aujourd’hui par votre entreprise. Vous pourrez modifier ce choix au fur et à mesure de son évolution.")}</p></div><Badge variant="info">{initial ? copy(fr, "First configuration", "Première configuration") : copy(fr, "Owner settings", "Paramètres propriétaire")}</Badge></div>
    </div>
    <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-5">{services.map((service) => { const selectedService = selected.includes(service.id); const Icon = service.icon; const text = fr ? service.french : service.english; return <button type="button" key={service.id} onClick={() => toggle(service.id)} aria-pressed={selectedService} className={`group relative min-h-40 rounded-2xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selectedService ? "border-brand bg-brand/10 shadow-sm" : "border-border bg-surface-2 hover:border-brand/45 hover:bg-surface-3"}`}><span className={`grid size-10 place-items-center rounded-xl ${selectedService ? "bg-brand text-brand-ink" : "bg-surface-1 text-brand"}`}><Icon className="size-5" aria-hidden /></span><h3 className="mt-4 text-sm font-semibold text-ink">{text[0]}</h3><p className="mt-1 text-xs leading-5 text-ink-secondary">{text[1]}</p><span className={`absolute right-3 top-3 grid size-5 place-items-center rounded-full border ${selectedService ? "border-brand bg-brand text-brand-ink" : "border-border-strong bg-surface-1"}`}>{selectedService ? <CheckCircle2 className="size-3.5" aria-hidden /> : null}</span></button>; })}</div>
    <div className="mx-5 mb-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4 sm:mx-6 sm:mb-6"><div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"><Users className="size-4" aria-hidden /></span><div><h3 className="text-sm font-semibold text-ink">{copy(fr, "People and access stay shared", "Les personnes et les accès restent communs")}</h3><p className="mt-1 text-xs leading-5 text-ink-secondary">{copy(fr, "Each person has one secure employee profile. Assign that same person to sites, services and work without creating duplicate records.", "Chaque collaborateur possède une seule fiche employé sécurisée. Affectez ensuite cette même personne aux sites, services et tâches, sans créer de doublon.")}</p></div></div></div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6"><p className="text-xs text-ink-muted">{selected.length ? copy(fr, `${selected.length} service${selected.length > 1 ? "s" : ""} selected`, `${selected.length} service${selected.length > 1 ? "s" : ""} sélectionné${selected.length > 1 ? "s" : ""}`) : copy(fr, "Select at least one service to continue.", "Sélectionnez au moins un service pour continuer.")}</p><Button onClick={() => save.mutate()} disabled={!selected.length} loading={save.isPending} className="rounded-xl">{copy(fr, "Save my services", "Enregistrer mes services")}<ArrowUpRight aria-hidden /></Button></div>
    {save.isError ? <p className="border-t border-critical/20 bg-critical/10 px-5 py-3 text-sm text-critical sm:px-6" role="alert">{copy(fr, "The service selection could not be saved. Please try again.", "La sélection des services n’a pas pu être enregistrée. Réessayez.")}</p> : null}
  </section>;
}

export function ActiveServicesBar({ orgSlug, services: activeServices, fr, onEdit }: { orgSlug: string; services: string[]; fr: boolean; onEdit: () => void }) {
  const active = services.filter((service) => activeServices.includes(service.id));
  return <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-1 px-4 py-3 shadow-sm"><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-xs font-semibold text-ink-secondary">{copy(fr, "Active operations", "Activités actives")}</span>{active.map((service) => { const Icon = service.icon; const text = fr ? service.french : service.english; return <Link key={service.id} href={`/${orgSlug}${service.href}`} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-surface-3"><Icon className="size-3.5 text-brand" aria-hidden />{text[0]}</Link>; })}</div><Button type="button" variant="ghost" size="sm" onClick={onEdit}>{copy(fr, "Edit", "Modifier")}</Button></section>;
}