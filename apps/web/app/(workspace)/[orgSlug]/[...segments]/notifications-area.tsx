"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  Inbox,
  MoreHorizontal,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { useLanguage } from "@/providers/language-provider";
import { notificationActionPath, useNotificationCenter } from "@/providers/notifications-provider";
import { companySetupApi, type Province } from "@/lib/company-setup-api";
import {
  notificationsApi,
  type CategoryPreference,
  type NotificationItem,
  type NotificationPriority,
  type NotificationQuery,
  type NotificationTab,
} from "@/services/notification.service";
import { confirmText } from "@/components/ui/confirm-dialog";

const PAGE_SIZE = 30;
const CATEGORIES = [
  "training", "task", "project", "alert", "approval", "leave", "payroll",
  "maintenance", "inventory", "procurement", "finance", "document", "contract",
  "attendance", "schedule", "discipline", "incident", "security", "poultry",
  "pigs", "agriculture", "veterinary", "report", "general",
] as const;
const PRIORITIES: NotificationPriority[] = ["low", "normal", "high", "urgent"];

function categoryKey(category: string) {
  switch (category) {
    case "training": return "notifications.category.training";
    case "task": return "notifications.category.task";
    case "project": return "notifications.category.project";
    case "alert": return "notifications.category.alert";
    case "approval": return "notifications.category.approval";
    case "leave": return "notifications.category.leave";
    case "payroll": return "notifications.category.payroll";
    case "maintenance": return "notifications.category.maintenance";
    case "inventory": return "notifications.category.inventory";
    case "procurement": return "notifications.category.procurement";
    case "finance": return "notifications.category.finance";
    case "document": return "notifications.category.document";
    case "contract": return "notifications.category.contract";
    case "attendance": return "notifications.category.attendance";
    case "schedule": return "notifications.category.schedule";
    case "discipline": return "notifications.category.discipline";
    case "incident": return "notifications.category.incident";
    case "security": return "notifications.category.security";
    case "poultry": return "notifications.category.poultry";
    case "pigs": return "notifications.category.pigs";
    case "agriculture": return "notifications.category.agriculture";
    case "veterinary": return "notifications.category.veterinary";
    case "report": return "notifications.category.report";
    case "general": return "notifications.category.general";
    default: return "notifications.category.other";
  }
}
function priorityKey(priority: NotificationPriority) {
  return `notifications.priority.${priority}` as const;
}
function categoryIcon(category: string) {
  if (["alert", "incident", "security", "discipline"].includes(category)) return CircleAlert;
  if (["document", "contract"].includes(category)) return FileText;
  if (["task", "project", "training", "approval"].includes(category)) return CheckCheck;
  return Bell;
}
function relativeTime(value: string, locale: string) {
  const difference = new Date(value).getTime() - Date.now();
  const seconds = Math.round(difference / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}
function displayDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/** Categories a member may switch off; every other category is mandatory (mirrors the API). */
const OPTIONAL_CATEGORIES = [
  "project", "maintenance", "inventory", "procurement", "finance", "poultry",
  "pigs", "agriculture", "veterinary", "report", "general",
] as const;
const MANDATORY_CATEGORIES = CATEGORIES.filter(
  (item) => !(OPTIONAL_CATEGORIES as readonly string[]).includes(item),
);

function categoryTone(category: string, priority: NotificationPriority) {
  if (priority === "urgent") return "bg-critical/12 text-critical";
  if (["alert", "incident", "security", "discipline"].includes(category)) return "bg-warning/15 text-warning-ink";
  if (["payroll", "finance", "procurement"].includes(category)) return "bg-good/12 text-good-ink";
  if (["training", "document", "contract"].includes(category)) return "bg-[#6643ae]/12 text-[#6643ae] dark:text-[#b9a3ec]";
  return "bg-brand/10 text-brand";
}

function dayLabel(value: string, fr: boolean, locale: string) {
  const day = new Date(value);
  const today = new Date();
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const difference = Math.round((start(today) - start(day)) / 86_400_000);
  if (difference === 0) return fr ? "Aujourd’hui" : "Today";
  if (difference === 1) return fr ? "Hier" : "Yesterday";
  if (difference < 7) return fr ? "Cette semaine" : "This week";
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(day);
}

export function NotificationsArea({ orgSlug }: { orgSlug: string }) {
  const { locale, t } = useLanguage();
  const fr = locale === "fr";
  const router = useRouter();
  const searchParams = useSearchParams();
  const markReadOnOpen = searchParams.get("markRead") === "1";
  const { unreadCount, refresh } = useNotificationCenter();
  const [tab, setTab] = useState<NotificationTab>("all");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<"" | NotificationPriority>("");
  const [provinceId, setProvinceId] = useState("");
  const [dateRange, setDateRange] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const dateBounds = useMemo(() => {
    if (!dateRange) return {};
    const today = new Date();
    const from = new Date(today);
    if (dateRange === "today") from.setHours(0, 0, 0, 0);
    else from.setDate(today.getDate() - (dateRange === "week" ? 7 : 30));
    return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
  }, [dateRange]);
  const query = useMemo<NotificationQuery>(
    () => ({
      tab,
      category: category || undefined,
      priority: priority || undefined,
      provinceId: provinceId || undefined,
      search: search.trim() || undefined,
      ...dateBounds,
      limit: PAGE_SIZE,
      offset,
    }),
    [category, dateBounds, offset, priority, provinceId, search, tab],
  );
  const provinces = useQuery({
    queryKey: ["notification-provinces", orgSlug],
    queryFn: () => companySetupApi.listProvinces<{ provinces: Province[] }>(orgSlug),
  });
  const inbox = useQuery({
    queryKey: ["notifications", orgSlug, "list", query],
    queryFn: () => notificationsApi.list(orgSlug, query),
  });
  const mutate = useMutation({
    mutationFn: async ({ action, item }: { action: "read" | "unread" | "archive" | "delete"; item: NotificationItem }) => {
      if (action === "read") return notificationsApi.read(orgSlug, item.id);
      if (action === "unread") return notificationsApi.unread(orgSlug, item.id);
      if (action === "archive") return notificationsApi.archive(orgSlug, item.id);
      return notificationsApi.remove(orgSlug, item.id);
    },
    onSuccess: async () => {
      await refresh();
    },
  });
  const bulk = useMutation({
    mutationFn: (action: "read-all" | "archive-read") =>
      action === "read-all" ? notificationsApi.readAll(orgSlug) : notificationsApi.archiveRead(orgSlug),
    onSuccess: async () => {
      await refresh();
      toast.success(t("notifications.updated"));
    },
  });
  useEffect(() => {
    if (!markReadOnOpen) return;
    let active = true;
    void notificationsApi.readAll(orgSlug)
      .then(async () => {
        if (!active) return;
        await refresh();
        router.replace(`/${orgSlug}/notifications`);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [markReadOnOpen, orgSlug, refresh, router]);

  // Opening a notification marks it read and follows its link; it stays in
  // the inbox (archiving is a separate, explicit action).
  const open = async (item: NotificationItem) => {
    if (!item.isRead) await notificationsApi.read(orgSlug, item.id);
    await refresh();
    const path = notificationActionPath(orgSlug, item);
    if (path) router.push(path);
  };
  const changeTab = (next: NotificationTab) => {
    setTab(next);
    setOffset(0);
  };
  const markAllRead = async () => {
    const urgent = await notificationsApi.list(orgSlug, { tab: "unread", priority: "urgent", limit: 1 });
    if (urgent.notifications.length && !await confirmText(t("notifications.confirmUrgent"))) return;
    bulk.mutate("read-all");
  };
  const clearFilters = () => {
    setCategory("");
    setPriority("");
    setProvinceId("");
    setDateRange("");
    setSearch("");
    setOffset(0);
  };
  const filtered = Boolean(category || priority || provinceId || dateRange || search.trim());
  const localeTag = fr ? "fr-FR" : "en-US";
  const notifications = inbox.data?.notifications ?? [];
  const total = inbox.data?.pagination.total ?? 0;
  const groups = useMemo(() => {
    // The list can be ordered by priority, so the same day label may come
    // back later in it: collect every item under one group per label.
    const result = new Map<string, NotificationItem[]>();
    for (const item of notifications) {
      const label = dayLabel(item.createdAt, fr, localeTag);
      const items = result.get(label);
      if (items) items.push(item);
      else result.set(label, [item]);
    }
    return [...result].map(([label, items]) => ({ label, items }));
  }, [fr, localeTag, notifications]);
  const selectClass = "h-9 rounded-lg border border-border bg-surface-1 px-3 text-sm text-ink focus:border-brand focus:outline-none";
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-brand text-brand-ink shadow-sm"><BellRing className="size-5" aria-hidden /></span>
          <div>
            <h1 className="text-xl font-semibold tracking-[-.02em] text-ink sm:text-2xl">{t("notifications.title")}</h1>
            <p className="text-sm text-ink-secondary">
              {unreadCount > 0
                ? fr
                  ? `${unreadCount > 99 ? "99+" : unreadCount} non lue${unreadCount > 1 ? "s" : ""} · ${t("notifications.subtitle")}`
                  : `${unreadCount > 99 ? "99+" : unreadCount} unread · ${t("notifications.subtitle")}`
                : fr ? "Vous êtes à jour." : "You are all caught up."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPreferencesOpen(true)}><Settings2 />{t("notifications.preferences")}</Button>
          <Button size="sm" onClick={() => void markAllRead()} loading={bulk.isPending} disabled={unreadCount === 0}><CheckCheck />{t("notifications.markAllRead")}</Button>
        </div>
      </header>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label={t("notifications.title")}>
            {(["all", "unread", "important", "archived"] as NotificationTab[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                onClick={() => changeTab(item)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${tab === item ? "bg-surface-1 text-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`}
              >
                {t(`notifications.${item}` as const)}
                {item === "unread" && unreadCount > 0 ? (
                  <span className="rounded-full bg-critical px-1.5 text-[11px] font-semibold leading-5 text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>
                ) : null}
              </button>
            ))}
          </div>
          {tab !== "archived" ? (
            <Button size="sm" variant="ghost" onClick={() => bulk.mutate("archive-read")} loading={bulk.isPending}><Archive />{t("notifications.archiveRead")}</Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2/40 px-3 py-2.5 sm:px-4">
          <label className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-muted" aria-hidden />
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} className="h-9 pl-9" placeholder={t("notifications.search")} aria-label={t("notifications.search")} />
          </label>
          <select value={category} onChange={(event) => { setCategory(event.target.value); setOffset(0); }} className={selectClass} aria-label={t("notifications.category")}><option value="">{t("notifications.allCategories")}</option>{CATEGORIES.map((item) => <option key={item} value={item}>{t(categoryKey(item))}</option>)}</select>
          <select value={priority} onChange={(event) => { setPriority(event.target.value as "" | NotificationPriority); setOffset(0); }} className={selectClass} aria-label={t("notifications.priority")}><option value="">{t("notifications.allPriorities")}</option>{PRIORITIES.map((item) => <option key={item} value={item}>{t(priorityKey(item))}</option>)}</select>
          {(provinces.data?.provinces.length ?? 0) > 1 ? <select value={provinceId} onChange={(event) => { setProvinceId(event.target.value); setOffset(0); }} className={selectClass} aria-label={t("notifications.province")}><option value="">{t("notifications.allProvinces")}</option>{provinces.data?.provinces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
          <select value={dateRange} onChange={(event) => { setDateRange(event.target.value); setOffset(0); }} className={selectClass} aria-label={t("notifications.date")}><option value="">{t("notifications.allDates")}</option><option value="today">{t("notifications.today")}</option><option value="week">{t("notifications.last7Days")}</option><option value="month">{t("notifications.last30Days")}</option></select>
          {filtered ? <Button size="sm" variant="ghost" onClick={clearFilters}><X />{fr ? "Effacer" : "Clear"}</Button> : null}
        </div>

        {inbox.isLoading ? <div className="space-y-1 p-3"><SkeletonCard rows={3} /><SkeletonCard rows={3} /></div> : null}
        {inbox.isError ? <ErrorState title={t("notifications.loadFailed")} description={(inbox.error as Error).message} onRetry={() => void inbox.refetch()} /> : null}
        {!inbox.isLoading && !inbox.isError && !notifications.length ? <div className="py-6"><EmptyState icon={Inbox} title={t("notifications.empty")} description={t("notifications.emptyDescription")} /></div> : null}
        {!inbox.isLoading && !inbox.isError && notifications.length ? (
          <div>
            {groups.map((group) => (
              <div key={group.label}>
                <p className="sticky top-0 z-[1] border-b border-border bg-surface-2/90 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[.12em] text-ink-muted backdrop-blur sm:px-5">{group.label}</p>
                <div className="divide-y divide-border">
                  {group.items.map((item) => (
                    <NotificationCard key={item.id} item={item} fr={fr} locale={localeTag} language={locale} onOpen={() => void open(item)} onAction={(action) => mutate.mutate({ action, item })} loading={mutate.isPending && mutate.variables?.item.id === item.id} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {offset + notifications.length < total ? <div className="border-t border-border p-3 text-center"><Button variant="secondary" size="sm" onClick={() => setOffset((current) => current + PAGE_SIZE)}>{t("notifications.loadMore")}</Button></div> : null}
      </section>
      {preferencesOpen ? <PreferencesDialog orgSlug={orgSlug} onClose={() => setPreferencesOpen(false)} /> : null}
    </main>
  );
}

type NotificationCopy = { title: string; message: string | null };

function notificationDate(value: string, language: "fr" | "en") {
  return new Intl.DateTimeFormat(language === "fr" ? "fr-FR" : "en-US", { dateStyle: "long" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

/** New notifications keep their source text; known system notices are rendered in the member's chosen language, including old rows already stored in English. */
function localizedNotificationCopy(item: NotificationItem, language: "fr" | "en"): NotificationCopy {
  const message = item.message ?? "";
  const isContractSignature = ["contract_signature_requested", "employment_contract_signature_requested", "contract_signature_reminder"].includes(item.type);
  if (isContractSignature) {
    const contract = message.match(/^(.*?) \(([^()]+)\) (?:is ready for (?:your )?secure review and signature|is ready for review and signature|still needs your secure review and signature)\.$/);
    const rawTitle = contract?.[1]?.trim() ?? "";
    const safeTitle = /^(no access|your role does not include|validation failed|internal server error|accès refusé)/i.test(rawTitle)
      ? (language === "fr" ? "Votre contrat de travail" : "Your employment contract")
      : rawTitle || (language === "fr" ? "Votre contrat de travail" : "Your employment contract");
    const reference = contract?.[2] ? ` (${contract[2]})` : "";
    return language === "fr"
      ? {
          title: item.type === "contract_signature_reminder" ? "Rappel de signature du contrat" : "Signature du contrat requise",
          message: `${safeTitle}${reference} est prêt à être lu et signé en toute sécurité.`,
        }
      : {
          title: item.type === "contract_signature_reminder" ? "Contract signature reminder" : "Contract signature required",
          message: `${safeTitle}${reference} is ready for your secure review and signature.`,
        };
  }

  if (language !== "fr") return { title: item.title, message: item.message };

  const training = message.match(/^(.*?) was due on (\d{4}-\d{2}-\d{2})\.$/);
  if (item.type === "training_overdue") {
    return {
      title: "Formation en retard",
      message: training?.[1] && training[2] ? `La formation « ${training[1]} » devait être terminée le ${notificationDate(training[2], language)}.` : "Une formation obligatoire est en retard.",
    };
  }
  if (item.type === "training_deadline_approaching") {
    const due = message.match(/^(.*?) is due on (\d{4}-\d{2}-\d{2})\.$/);
    return {
      title: "Échéance de formation proche",
      message: due?.[1] && due[2] ? `La formation « ${due[1]} » doit être terminée le ${notificationDate(due[2], language)}.` : "Une formation arrive bientôt à échéance.",
    };
  }
  const frenchTitles: Record<string, string> = {
    training_certificate_issued: "Certificat de formation délivré",
    training_question_asked: "Nouvelle question sur une leçon",
    training_question_answered: "Le formateur a répondu à votre question",
    training_validation_required: "Formation à valider",
    training_completion_approved: "Formation validée",
    training_completion_returned: "Formation renvoyée pour complément",
  };
  if (frenchTitles[item.type]) return { title: frenchTitles[item.type]!, message: item.message };
  if (["employment_contract_available", "contract_available"].includes(item.type)) {
    return { title: "Contrat de travail disponible", message: "Votre contrat de travail est disponible dans Mes contrats." };
  }
  return { title: item.title, message: item.message };
}
function NotificationCard({ item, fr, locale, language, onOpen, onAction, loading }: { item: NotificationItem; fr: boolean; locale: string; language: "fr" | "en"; onOpen: () => void; onAction: (action: "read" | "unread" | "archive" | "delete") => void; loading: boolean }) {
  const { t } = useLanguage();
  const Icon = categoryIcon(item.category);
  const copy = localizedNotificationCopy(item, language);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);
  const important = item.priority === "urgent" || item.priority === "high";
  return (
    <article className={`group relative flex gap-3 px-4 py-3.5 transition-colors sm:px-5 ${!item.isRead ? "bg-brand/[0.045] hover:bg-brand/[0.07]" : "hover:bg-surface-2/60"}`}>
      {!item.isRead ? <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" aria-hidden /> : null}
      <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${categoryTone(item.category, item.priority)}`}><Icon className="size-[18px]" aria-hidden /></div>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className={`text-sm ${!item.isRead ? "font-semibold text-ink" : "font-medium text-ink-secondary"}`}>{copy.title}</h2>
          {important ? <Badge variant={severityVariant(item.priority)}>{t(priorityKey(item.priority))}</Badge> : null}
          <span className="text-xs text-ink-muted">{t(categoryKey(item.category))}</span>
        </div>
        {copy.message ? <p className={`mt-0.5 line-clamp-2 text-sm leading-6 ${!item.isRead ? "text-ink-secondary" : "text-ink-muted"}`}>{copy.message}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
          <Clock3 className="size-3" aria-hidden />
          <time dateTime={item.createdAt} title={displayDate(item.createdAt, locale)}>{relativeTime(item.createdAt, locale)}</time>
          {item.actor?.fullName ? <><span aria-hidden>·</span><span>{item.actor.fullName}</span></> : null}
          {item.province?.name ? <><span aria-hidden>·</span><span>{item.province.name}</span></> : null}
        </p>
      </button>
      <div className="flex shrink-0 items-center gap-1 self-start">
        {!item.isRead ? (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onAction("read")} disabled={loading} title={t("notifications.markRead")}>
            <Check className="size-4" />
            <span className="hidden sm:inline">{fr ? "Lu" : "Read"}</span>
          </Button>
        ) : null}
        <div className="relative">
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value); }}
            className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-surface-3 hover:text-ink"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={fr ? "Plus d’actions" : "More actions"}
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menuOpen ? (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-border bg-surface-1 p-1 shadow-lg" onClick={(event) => event.stopPropagation()}>
              {item.isRead ? (
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onAction("unread"); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-ink-secondary hover:bg-surface-2"><Bell className="size-3.5" />{t("notifications.markUnread")}</button>
              ) : null}
              {!item.isArchived ? (
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onAction("archive"); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-ink-secondary hover:bg-surface-2"><Archive className="size-3.5" />{t("notifications.archive")}</button>
              ) : null}
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onAction("delete"); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-critical hover:bg-critical/10"><Trash2 className="size-3.5" />{t("notifications.delete")}</button>
            </div>
          ) : null}
        </div>
        {item.actionUrl ? <ChevronRight className="size-4 text-ink-muted" aria-hidden /> : null}
      </div>
    </article>
  );
}

function PreferencesDialog({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const { locale, setLocale, t } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();
  const { refresh } = useNotificationCenter();
  const preferences = useQuery({ queryKey: ["notification-preferences", orgSlug], queryFn: () => notificationsApi.preferences(orgSlug) });
  const save = useMutation({
    mutationFn: (body: Parameters<typeof notificationsApi.updatePreferences>[1]) => notificationsApi.updatePreferences(orgSlug, body),
    onSuccess: async (result) => {
      queryClient.setQueryData(["notification-preferences", orgSlug], result);
      setLocale(result.profile.preferredLanguage);
      await refresh();
      onClose();
      toast.success(t("notifications.updated"));
    },
  });
  if (preferences.isLoading) return <DialogShell title={t("notifications.settingsTitle")} onClose={onClose}><SkeletonCard rows={6} /></DialogShell>;
  if (preferences.isError) return <DialogShell title={t("notifications.settingsTitle")} onClose={onClose}><ErrorState title={t("notifications.loadFailed")} onRetry={() => void preferences.refetch()} /></DialogShell>;
  const profile = preferences.data!.profile;
  const existing = new Map(preferences.data!.categories.map((item) => [item.category, item]));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // Only optional categories are sent: mandatory ones cannot be switched off.
    const categories: CategoryPreference[] = OPTIONAL_CATEGORIES.map((item) => {
      const value = existing.get(item);
      return { category: item, inApp: form.get(`inApp-${item}`) === "on", email: form.get(`email-${item}`) === "on", minEmailSeverity: value?.minEmailSeverity ?? "warning" };
    });
    save.mutate({
      emailEnabled: form.get("emailEnabled") === "on",
      digestFrequency: String(form.get("digestFrequency")) as "none" | "daily" | "weekly",
      quietHoursStart: String(form.get("quietHoursStart") || "") || null,
      quietHoursEnd: String(form.get("quietHoursEnd") || "") || null,
      preferredLanguage: String(form.get("preferredLanguage")) as "fr" | "en",
      categories,
    });
  };
  const selectClass = "h-9 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-ink";
  return (
    <DialogShell title={t("notifications.settingsTitle")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <section className="rounded-xl border border-brand/20 bg-brand/[0.05] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><BellRing className="size-4 text-brand" aria-hidden />{fr ? "Toujours reçues" : "Always delivered"}</p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {fr
              ? "Ces notifications concernent votre travail, votre paie et la sécurité. Elles ne peuvent pas être désactivées."
              : "These notices concern your work, your pay and safety. They cannot be turned off."}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {MANDATORY_CATEGORIES.map((item) => (
              <span key={item} className="rounded-full border border-border bg-surface-1 px-2.5 py-0.5 text-xs text-ink-secondary">{t(categoryKey(item))}</span>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink">{fr ? "Informations facultatives" : "Optional updates"}</h3>
          <p className="mt-0.5 text-xs text-ink-secondary">{fr ? "Choisissez ce que vous voulez suivre." : "Choose what you want to follow."}</p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[1fr_5.5rem_4.5rem] gap-2 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <span>{fr ? "Catégorie" : "Category"}</span>
              <span className="text-center">{t("notifications.inAppShort")}</span>
              <span className="text-center">{t("notifications.emailShort")}</span>
            </div>
            <div className="divide-y divide-border">
              {OPTIONAL_CATEGORIES.map((category) => {
                const setting = existing.get(category);
                return (
                  <div key={category} className="grid grid-cols-[1fr_5.5rem_4.5rem] items-center gap-2 px-3 py-2">
                    <span className="text-sm text-ink">{t(categoryKey(category))}</span>
                    <span className="text-center"><input aria-label={`${t(categoryKey(category))} · ${t("notifications.inAppShort")}`} name={`inApp-${category}`} type="checkbox" className="size-4 accent-[var(--brand)]" defaultChecked={setting?.inApp ?? true} /></span>
                    <span className="text-center"><input aria-label={`${t(categoryKey(category))} · ${t("notifications.emailShort")}`} name={`email-${category}`} type="checkbox" className="size-4 accent-[var(--brand)]" defaultChecked={setting?.email ?? false} /></span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm text-ink sm:col-span-2">
            <input name="emailEnabled" type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" defaultChecked={profile.emailEnabled} />
            <span>
              <span className="font-medium">{fr ? "Recevoir aussi par e-mail" : "Also receive by e-mail"}</span>
              <span className="block text-xs text-ink-secondary">{fr ? "Les notifications importantes vous sont aussi envoyées par e-mail." : "Important notices are also sent to your e-mail."}</span>
            </span>
          </label>
          <Field label={t("notifications.digest")}><select name="digestFrequency" defaultValue={profile.digestFrequency} className={selectClass}><option value="none">{t("notifications.none")}</option><option value="daily">{t("notifications.daily")}</option><option value="weekly">{t("notifications.weekly")}</option></select></Field>
          <Field label={t("notifications.language")}><select name="preferredLanguage" defaultValue={profile.preferredLanguage || locale} className={selectClass}><option value="fr">Français</option><option value="en">English</option></select></Field>
          <Field label={`${t("notifications.quietHours")} · ${t("notifications.start")}`}><Input name="quietHoursStart" type="time" defaultValue={profile.quietHoursStart ?? ""} /></Field>
          <Field label={`${t("notifications.quietHours")} · ${t("notifications.end")}`}><Input name="quietHoursEnd" type="time" defaultValue={profile.quietHoursEnd ?? ""} /></Field>
        </section>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>{t("members.cancel")}</Button>
          <Button type="submit" loading={save.isPending}><Check />{t("notifications.savePreferences")}</Button>
        </div>
      </form>
    </DialogShell>
  );
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useLanguage();
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4" onMouseDown={onClose}><section role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()} className="mx-auto my-6 max-w-2xl rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-3"><h2 className="text-lg font-semibold text-ink">{title}</h2><Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t("members.close")}><X /></Button></div><div className="mt-5">{children}</div></section></div>;
}
