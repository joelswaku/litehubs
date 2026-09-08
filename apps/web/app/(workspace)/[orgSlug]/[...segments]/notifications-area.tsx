"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
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

const PAGE_SIZE = 30;
const CATEGORIES = [
  "training", "task", "project", "alert", "approval", "leave", "payroll",
  "maintenance", "inventory", "procurement", "finance", "document", "contract",
  "attendance", "schedule", "discipline", "incident", "security", "poultry",
  "pigs", "agriculture", "veterinary", "general",
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

export function NotificationsArea({ orgSlug }: { orgSlug: string }) {
  const { locale, t } = useLanguage();
  const router = useRouter();
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
    onSuccess: () => void refresh(),
  });
  const bulk = useMutation({
    mutationFn: (action: "read-all" | "archive-read") =>
      action === "read-all" ? notificationsApi.readAll(orgSlug) : notificationsApi.archiveRead(orgSlug),
    onSuccess: async () => {
      await refresh();
      toast.success(t("notifications.updated"));
    },
  });
  const open = async (item: NotificationItem) => {
    if (!item.isRead) await mutate.mutateAsync({ action: "read", item });
    const path = notificationActionPath(orgSlug, item);
    if (path) router.push(path);
  };
  const changeTab = (next: NotificationTab) => {
    setTab(next);
    setOffset(0);
  };
  const markAllRead = async () => {
    const urgent = await notificationsApi.list(orgSlug, { tab: "unread", priority: "urgent", limit: 1 });
    if (urgent.notifications.length && !window.confirm(t("notifications.confirmUrgent"))) return;
    bulk.mutate("read-all");
  };
  const localeTag = locale === "fr" ? "fr-FR" : "en-US";
  const notifications = inbox.data?.notifications ?? [];
  const total = inbox.data?.pagination.total ?? 0;
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="overflow-hidden rounded-3xl border border-border bg-[radial-gradient(circle_at_top_right,rgba(26,115,232,.16),transparent_42%),linear-gradient(135deg,var(--surface-1),var(--surface-2))] p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-brand"><BellRing className="size-5" aria-hidden /><span className="text-sm font-semibold">LiteHubs</span></div>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-.025em] text-ink sm:text-3xl">{t("notifications.title")}</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-ink-secondary">{t("notifications.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unreadCount > 0 ? <Badge variant="critical">{t("notifications.unreadCount", { count: unreadCount > 99 ? "99+" : unreadCount })}</Badge> : null}
            <Button variant="secondary" size="sm" onClick={() => setPreferencesOpen(true)}><Settings2 />{t("notifications.preferences")}</Button>
            <Button size="sm" onClick={() => void markAllRead()} loading={bulk.isPending}><CheckCheck />{t("notifications.markAllRead")}</Button>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-surface-1 p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("notifications.title")}>
          {(["all", "unread", "important", "archived"] as NotificationTab[]).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => changeTab(item)} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === item ? "bg-brand text-brand-ink" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"}`}>{t(`notifications.${item}` as const)}</button>
          ))}
          <div className="ml-auto hidden sm:block">{tab !== "archived" ? <Button size="sm" variant="ghost" onClick={() => bulk.mutate("archive-read")} loading={bulk.isPending}><Archive />{t("notifications.archiveRead")}</Button> : null}</div>
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_repeat(4,minmax(130px,auto))]">
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-muted" aria-hidden /><Input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} className="pl-9" placeholder={t("notifications.search")} aria-label={t("notifications.search")} /></label>
          <select value={category} onChange={(event) => { setCategory(event.target.value); setOffset(0); }} className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink" aria-label={t("notifications.category")}><option value="">{t("notifications.allCategories")}</option>{CATEGORIES.map((item) => <option key={item} value={item}>{t(categoryKey(item))}</option>)}</select>
          <select value={priority} onChange={(event) => { setPriority(event.target.value as "" | NotificationPriority); setOffset(0); }} className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink" aria-label={t("notifications.priority")}><option value="">{t("notifications.allPriorities")}</option>{PRIORITIES.map((item) => <option key={item} value={item}>{t(priorityKey(item))}</option>)}</select>
          {(provinces.data?.provinces.length ?? 0) > 1 ? <select value={provinceId} onChange={(event) => { setProvinceId(event.target.value); setOffset(0); }} className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink" aria-label={t("notifications.province")}><option value="">{t("notifications.allProvinces")}</option>{provinces.data?.provinces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
          <select value={dateRange} onChange={(event) => { setDateRange(event.target.value); setOffset(0); }} className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink" aria-label={t("notifications.date")}><option value="">{t("notifications.allDates")}</option><option value="today">{t("notifications.today")}</option><option value="week">{t("notifications.last7Days")}</option><option value="month">{t("notifications.last30Days")}</option></select>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
        {inbox.isLoading ? <div className="space-y-1 p-3"><SkeletonCard rows={3} /><SkeletonCard rows={3} /></div> : null}
        {inbox.isError ? <ErrorState title={t("notifications.loadFailed")} description={(inbox.error as Error).message} onRetry={() => void inbox.refetch()} /> : null}
        {!inbox.isLoading && !inbox.isError && !notifications.length ? <EmptyState icon={Inbox} title={t("notifications.empty")} description={t("notifications.emptyDescription")} /> : null}
        {!inbox.isLoading && !inbox.isError && notifications.length ? <div className="divide-y divide-border">{notifications.map((item) => <NotificationCard key={item.id} item={item} locale={localeTag} onOpen={() => void open(item)} onAction={(action) => mutate.mutate({ action, item })} loading={mutate.isPending} />)}</div> : null}
        {offset + notifications.length < total ? <div className="border-t border-border p-3 text-center"><Button variant="secondary" size="sm" onClick={() => setOffset((current) => current + PAGE_SIZE)}>{t("notifications.loadMore")}</Button></div> : null}
      </section>
      {preferencesOpen ? <PreferencesDialog orgSlug={orgSlug} onClose={() => setPreferencesOpen(false)} /> : null}
    </main>
  );
}

function NotificationCard({ item, locale, onOpen, onAction, loading }: { item: NotificationItem; locale: string; onOpen: () => void; onAction: (action: "read" | "unread" | "archive" | "delete") => void; loading: boolean }) {
  const { t } = useLanguage();
  const Icon = categoryIcon(item.category);
  return <article className={`group relative flex gap-3 p-4 transition-colors sm:p-5 ${!item.isRead ? "bg-brand-subtle/45" : "hover:bg-surface-2/70"}`}>
    <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${item.priority === "urgent" ? "bg-critical/15 text-critical" : "bg-brand/10 text-brand"}`}><Icon className="size-5" aria-hidden /></div>
    <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-ink">{item.title}</h2>{!item.isRead ? <span className="size-2 rounded-full bg-critical" aria-label={t("notifications.unread")} /> : null}<Badge variant={severityVariant(item.priority)}>{t(priorityKey(item.priority))}</Badge><Badge variant="outline" icon={false}>{t(categoryKey(item.category))}</Badge></div>{item.message ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-ink-secondary">{item.message}</p> : null}<p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted"><Clock3 className="size-3" aria-hidden />{relativeTime(item.createdAt, locale)}<span aria-hidden>·</span><time dateTime={item.createdAt}>{displayDate(item.createdAt, locale)}</time>{item.actor?.fullName ? <><span aria-hidden>·</span><span>{item.actor.fullName}</span></> : null}{item.province?.name ? <><span aria-hidden>·</span><span>{item.province.name}</span></> : null}</p></button>
    <div className="flex shrink-0 items-start gap-1"><Button variant="ghost" size="icon-sm" onClick={() => onAction(item.isRead ? "unread" : "read")} disabled={loading} aria-label={item.isRead ? t("notifications.markUnread") : t("notifications.markRead")}>{item.isRead ? <Bell className="size-4" /> : <Check className="size-4" />}</Button><details className="relative"><summary className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-secondary hover:bg-surface-3 hover:text-ink" aria-label={t("notifications.preferences")}><MoreHorizontal className="size-4" /></summary><div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-border bg-surface-1 p-1 shadow-lg"><button type="button" onClick={() => onAction("archive")} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-ink-secondary hover:bg-surface-2"><Archive className="size-3.5" />{t("notifications.archive")}</button><button type="button" onClick={() => onAction("delete")} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-critical hover:bg-critical/10"><Trash2 className="size-3.5" />{t("notifications.delete")}</button></div></details>{item.actionUrl ? <ChevronRight className="mt-2 size-4 text-ink-muted" aria-hidden /> : null}</div>
  </article>;
}

function PreferencesDialog({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const { locale, t } = useLanguage();
  const { refresh } = useNotificationCenter();
  const preferences = useQuery({ queryKey: ["notification-preferences", orgSlug], queryFn: () => notificationsApi.preferences(orgSlug) });
  const save = useMutation({ mutationFn: (body: Parameters<typeof notificationsApi.updatePreferences>[1]) => notificationsApi.updatePreferences(orgSlug, body), onSuccess: async () => { await refresh(); onClose(); toast.success(t("notifications.updated")); } });
  if (preferences.isLoading) return <DialogShell title={t("notifications.settingsTitle")} onClose={onClose}><SkeletonCard rows={6} /></DialogShell>;
  if (preferences.isError) return <DialogShell title={t("notifications.settingsTitle")} onClose={onClose}><ErrorState title={t("notifications.loadFailed")} onRetry={() => void preferences.refetch()} /></DialogShell>;
  const profile = preferences.data!.profile;
  const existing = new Map(preferences.data!.categories.map((item) => [item.category, item]));
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const categories: CategoryPreference[] = CATEGORIES.map((item) => { const value = existing.get(item); return { category: item, inApp: form.get(`inApp-${item}`) === "on", email: form.get(`email-${item}`) === "on", minEmailSeverity: value?.minEmailSeverity ?? "warning" }; }); save.mutate({ inAppEnabled: form.get("inAppEnabled") === "on", emailEnabled: form.get("emailEnabled") === "on", smsEnabled: form.get("smsEnabled") === "on", pushEnabled: form.get("pushEnabled") === "on", digestFrequency: String(form.get("digestFrequency")) as "none" | "daily" | "weekly", quietHoursStart: String(form.get("quietHoursStart") || "") || null, quietHoursEnd: String(form.get("quietHoursEnd") || "") || null, preferredLanguage: String(form.get("preferredLanguage")) as "fr" | "en", categories }); };
  return <DialogShell title={t("notifications.settingsTitle")} onClose={onClose}><form onSubmit={submit} className="space-y-5"><p className="text-sm leading-6 text-ink-secondary">{t("notifications.settingsDescription")}</p><div className="grid gap-3 sm:grid-cols-2">{([ ["inAppEnabled", "notifications.inApp"], ["emailEnabled", "notifications.email"], ["smsEnabled", "notifications.sms"], ["pushEnabled", "notifications.push"] ] as const).map(([name, label]) => <label key={name} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-ink"><input name={name} type="checkbox" defaultChecked={profile[name]} />{t(label)}</label>)}</div><div className="grid gap-4 sm:grid-cols-2"><Field label={t("notifications.digest")}><select name="digestFrequency" defaultValue={profile.digestFrequency} className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"><option value="none">{t("notifications.none")}</option><option value="daily">{t("notifications.daily")}</option><option value="weekly">{t("notifications.weekly")}</option></select></Field><Field label={t("notifications.language")}><select name="preferredLanguage" defaultValue={profile.preferredLanguage || locale} className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"><option value="fr">Français</option><option value="en">English</option></select></Field><Field label={`${t("notifications.quietHours")} · ${t("notifications.start")}`}><Input name="quietHoursStart" type="time" defaultValue={profile.quietHoursStart ?? ""} /></Field><Field label={`${t("notifications.quietHours")} · ${t("notifications.end")}`}><Input name="quietHoursEnd" type="time" defaultValue={profile.quietHoursEnd ?? ""} /></Field></div><section><h3 className="text-sm font-semibold text-ink">{t("notifications.categorySettings")}</h3><div className="mt-3 divide-y divide-border rounded-lg border border-border">{CATEGORIES.map((category) => { const setting = existing.get(category); return <div key={category} className="flex items-center justify-between gap-3 px-3 py-2.5"><span className="text-sm text-ink">{t(categoryKey(category))}</span><div className="flex gap-3 text-xs text-ink-secondary"><label className="flex items-center gap-1"><input name={`inApp-${category}`} type="checkbox" defaultChecked={setting?.inApp ?? true} />{t("notifications.inAppShort")}</label><label className="flex items-center gap-1"><input name={`email-${category}`} type="checkbox" defaultChecked={setting?.email ?? false} />{t("notifications.emailShort")}</label></div></div>; })}</div></section><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{t("members.cancel")}</Button><Button type="submit" loading={save.isPending}><Check />{t("notifications.savePreferences")}</Button></div></form></DialogShell>;
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useLanguage();
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4"><section role="dialog" aria-modal="true" aria-label={title} className="mx-auto my-6 max-w-2xl rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-3"><h2 className="text-lg font-semibold text-ink">{title}</h2><Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t("members.close")}><X /></Button></div><div className="mt-5">{children}</div></section></div>;
}
