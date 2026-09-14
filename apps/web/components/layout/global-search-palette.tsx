"use client";

import { Command } from "cmdk";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type NavGroup, type NavItem } from "@/lib/navigation";
import { navTranslationKey } from "@/lib/i18n";
import { visibleTo } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";

/** Workspace-wide navigation search, filtered with the same visibility rules as the sidebar. */
export function GlobalSearchPalette({ orgSlug, groups }: { orgSlug: string; groups: NavGroup[] }) {
  const router = useRouter();
  const { locale, t } = useLanguage();
  const user = useSessionUser();
  const open = useUiStore((state) => state.commandOpen);
  const setOpen = useUiStore((state) => state.setCommandOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const french = locale === "fr";

  const searchableGroups = useMemo(
    () => groups.map((group) => ({ ...group, items: visibleTo(user, group.items) })).filter((group) => group.items.length > 0),
    [groups, user],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const goTo = (item: NavItem) => {
    setOpen(false);
    router.push(`/${orgSlug}${item.path}`);
  };
  const title = french ? "Recherche rapide" : "Quick search";
  const placeholder = french ? "Rechercher une page, une opération ou un module…" : "Search a page, operation, or module…";
  const noResults = french ? "Aucun espace ne correspond à votre recherche." : "No workspace area matches your search.";

  return (
    <div className="fixed inset-0 z-[100] p-3 sm:p-8" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[1px]" aria-label={french ? "Fermer la recherche" : "Close search"} onClick={() => setOpen(false)} />
      <Command className="relative mx-auto flex max-h-[min(620px,calc(100dvh-1.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl shadow-black/25" shouldFilter={false} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-5 shrink-0 text-brand" aria-hidden />
          <Command.Input ref={inputRef} value={query} onValueChange={setQuery} placeholder={placeholder} className="h-14 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted" />
          <button type="button" onClick={() => setOpen(false)} className="grid size-8 shrink-0 place-items-center rounded-md text-ink-muted transition hover:bg-surface-2 hover:text-ink" aria-label={french ? "Fermer" : "Close"}><X className="size-4" aria-hidden /></button>
        </div>
        <Command.List className="scrollbar-thin max-h-[min(500px,calc(100dvh-8rem))] overflow-y-auto p-2">
          {searchableGroups.map((group) => {
            const labelledItems = group.items.filter((item) => matchesQuery(query, [item.label, t(navTranslationKey(item.label)), group.label, t(navTranslationKey(group.label)), item.path].join(" ")));
            if (!labelledItems.length) return null;
            return <Command.Group key={group.id} heading={t(navTranslationKey(group.label))} className="mb-1 last:mb-0">
              {labelledItems.map((item) => <SearchResult key={item.path} item={item} label={t(navTranslationKey(item.label))} group={t(navTranslationKey(group.label))} onSelect={() => goTo(item)} />)}
            </Command.Group>;
          })}
          {!searchableGroups.some((group) => group.items.some((item) => matchesQuery(query, [item.label, t(navTranslationKey(item.label)), group.label, t(navTranslationKey(group.label)), item.path].join(" ")))) ? <div className="px-4 py-12 text-center text-sm text-ink-secondary" role="status">{noResults}</div> : null}
        </Command.List>
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2/45 px-4 py-2.5 text-xs text-ink-muted">
          <span>{french ? "Navigation" : "Navigation"}</span><span className="hidden sm:inline">{french ? "Flèches pour naviguer, Entrée pour ouvrir." : "Use arrow keys to navigate, Enter to open."}</span><kbd className="rounded border border-border bg-surface-1 px-1.5 py-0.5 font-sans text-[10px]">Esc</kbd>
        </div>
      </Command>
    </div>
  );
}

function SearchResult({ item, label, group, onSelect }: { item: NavItem; label: string; group: string; onSelect: () => void }) {
  const Icon = item.icon;
  return <Command.Item value={item.path} onSelect={onSelect} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-secondary outline-none data-[selected=true]:bg-brand-subtle data-[selected=true]:text-brand">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-ink-muted"><Icon className="size-4" aria-hidden /></span>
    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{label}</span><span className="block truncate text-xs text-ink-muted">{group}</span></span>
  </Command.Item>;
}

function matchesQuery(query: string, candidate: string): boolean {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  const normalizedCandidate = normalizeSearch(candidate);
  return normalizedQuery.split(" ").every((term) => normalizedCandidate.includes(term));
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}



