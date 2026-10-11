"use client";

/**
 * Social studio: Facebook / Instagram publishing, AI content plan, ad copy and
 * public comments.  This is the company's showcase page, so it carries a
 * richer visual treatment than the operational screens: an animated hero,
 * glass metrics, a live post preview and a timeline of posts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Globe2,
  Heart,
  ImagePlus,
  Link2,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plug,
  RefreshCw,
  Search,
  Send,
  Share2,
  Sparkles,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import { api, del, get, orgUrl, patch, post } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";
import { AdCopyForm, ContentPlanForm, PostEditor } from "@/components/social/social-ai";

type Account = {
  id: string;
  pageId: string;
  pageName: string;
  instagram: { id: string; username: string | null } | null;
  status: "active" | "paused" | "error";
  lastError: string | null;
};
type Overview = {
  configured: boolean;
  isOwner: boolean;
  accounts: Account[];
  pendingComments: number;
  scheduledPosts: number;
  setup: { callbackUrl: string; webhookUrl: string } | null;
};
type Comment = {
  id: string;
  platform: "facebook" | "instagram";
  author: string | null;
  body: string;
  receivedAt: string;
  isReply: boolean;
  reply: { body: string; at: string; by: string | null } | null;
  replyError: string | null;
  done: boolean;
};
type Post = {
  id: string;
  message: string;
  imageUrl: string | null;
  linkUrl: string | null;
  toFacebook: boolean;
  toInstagram: boolean;
  status: "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed";
  scheduledAt: string;
  publishedAt: string | null;
  error: string | null;
  author: string | null;
  aiGenerated?: boolean;
  facebookPostId?: string | null;
  instagramMediaId?: string | null;
  archivedAt?: string | null;
};
type PostList = { posts: Post[]; historyTotal?: number; archivedTotal?: number };

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const errorMessage = (error: unknown) =>
  (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
  (error instanceof Error ? error.message : "");
const when = (value: string, fr: boolean) =>
  new Date(value).toLocaleString(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "LH";

/** Network chip: colour carries the network, the word carries the meaning. */
export function PlatformBadge({ platform }: { platform: "facebook" | "instagram" | "website" }) {
  const style =
    platform === "facebook"
      ? "bg-[#1877f2]/10 text-[#1877f2] ring-[#1877f2]/20"
      : platform === "instagram"
        ? "bg-[linear-gradient(120deg,rgba(245,133,41,.14),rgba(221,42,123,.14),rgba(129,52,175,.14))] text-[#c13584] ring-[#c13584]/20"
        : "bg-brand/10 text-brand ring-brand/20";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${style}`}>
      <span
        className={`size-1.5 rounded-full ${
          platform === "facebook" ? "bg-[#1877f2]" : platform === "instagram" ? "bg-[linear-gradient(135deg,#f58529,#dd2a7b,#8134af)]" : "bg-brand"
        }`}
      />
      {platform === "facebook" ? "Facebook" : platform === "instagram" ? "Instagram" : "Site"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type Tab = "posts" | "comments" | "accounts";

export function SocialArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const [tab, setTab] = useState<Tab>("posts");
  const overview = useQuery({
    queryKey: ["social", orgSlug],
    queryFn: () => get<Overview>(orgUrl(orgSlug, "social")),
    refetchInterval: 30_000,
  });
  const connected = Boolean(overview.data?.accounts.some((item) => item.status === "active"));
  const posts = useQuery({
    queryKey: ["social-posts", orgSlug],
    queryFn: () => get<{ posts: Post[] }>(orgUrl(orgSlug, "social/posts")),
    refetchInterval: 20_000,
    enabled: connected,
  });

  // Back from Facebook: ?connected=1 or ?error=...  Deep links: ?tab=comments
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("tab");
    if (wanted === "comments" || wanted === "posts" || wanted === "accounts") setTab(wanted);
    if (params.get("connected")) {
      toast.success(tr(fr, "Facebook et Instagram sont connectés.", "Facebook and Instagram are connected."));
      setTab("accounts");
    }
    if (params.get("error")) {
      toast.error(params.get("error"));
      setTab("accounts");
    }
    if (params.get("connected") || params.get("error")) window.history.replaceState(null, "", window.location.pathname);
  }, [fr]);

  if (overview.isLoading)
    return (
      <div className="mx-auto w-full max-w-[1680px] space-y-4 p-3 sm:p-6">
        <div className="h-64 animate-pulse rounded-[28px] bg-[linear-gradient(120deg,#0b1530,#13306b)]" />
        <SkeletonCard rows={5} />
      </div>
    );
  if (overview.isError || !overview.data)
    return (
      <div className="p-4 sm:p-6">
        <ErrorState title={tr(fr, "Réseaux sociaux indisponibles", "Social media unavailable")} description={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />
      </div>
    );
  const data = overview.data;
  const current: Tab = !connected ? "accounts" : tab;
  const account = data.accounts.find((item) => item.status === "active");
  const list = posts.data?.posts ?? [];
  const monthAgo = Date.now() - 30 * 86_400_000;
  const stats = {
    drafts: list.filter((item) => item.status === "draft").length,
    scheduled: list.filter((item) => item.status === "scheduled").length,
    published: list.filter((item) => item.status === "published" && new Date(item.publishedAt ?? item.scheduledAt).getTime() >= monthAgo).length,
    comments: data.pendingComments,
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 p-3 sm:p-6">
      <Hero fr={fr} account={account} connected={connected} stats={stats} onOpen={(next) => setTab(next)} />

      <nav
        className="sticky top-2 z-20 mx-auto flex w-full max-w-xl gap-1 rounded-2xl border border-border bg-surface-1/85 p-1.5 shadow-[0_12px_30px_-22px_rgba(15,23,42,.6)] backdrop-blur-xl"
        aria-label={tr(fr, "Sections", "Sections")}
      >
        {(
          [
            { key: "posts", label: tr(fr, "Publications", "Posts"), icon: Send, count: stats.drafts + stats.scheduled },
            { key: "comments", label: tr(fr, "Commentaires", "Comments"), icon: MessageCircle, count: data.pendingComments },
            { key: "accounts", label: tr(fr, "Comptes", "Accounts"), icon: Plug, count: 0 },
          ] as const
        ).map((item) => {
          const active = current === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              disabled={!connected && item.key !== "accounts"}
              onClick={() => setTab(item.key)}
              aria-current={active ? "page" : undefined}
              className={`relative inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-300 disabled:opacity-40 ${
                active
                  ? "bg-[linear-gradient(135deg,var(--brand),#5b4bd8)] text-white shadow-[0_10px_24px_-12px_var(--brand)]"
                  : "text-ink-secondary hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{item.label}</span>
              {item.count ? (
                <span className={`rounded-full px-1.5 text-[11px] font-bold ${active ? "bg-white/25 text-white" : "bg-brand text-brand-ink"}`}>{item.count}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div key={current} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
        {current === "accounts" ? <Accounts orgSlug={orgSlug} fr={fr} data={data} /> : null}
        {current === "posts" && account ? <Posts orgSlug={orgSlug} fr={fr} account={account} /> : null}
        {current === "comments" ? <Comments orgSlug={orgSlug} fr={fr} /> : null}
      </div>
    </div>
  );
}

function Hero({
  fr,
  account,
  connected,
  stats,
  onOpen,
}: {
  fr: boolean;
  account: Account | undefined;
  connected: boolean;
  stats: { drafts: number; scheduled: number; published: number; comments: number };
  onOpen: (tab: Tab) => void;
}) {
  const tiles = [
    { label: tr(fr, "À valider", "To approve"), value: stats.drafts, icon: Wand2, tab: "posts" as Tab, tone: "from-amber-300/30 to-amber-500/5" },
    { label: tr(fr, "Programmées", "Scheduled"), value: stats.scheduled, icon: CalendarClock, tab: "posts" as Tab, tone: "from-sky-300/30 to-sky-500/5" },
    { label: tr(fr, "Publiées · 30 j", "Published · 30 d"), value: stats.published, icon: CheckCircle2, tab: "posts" as Tab, tone: "from-emerald-300/30 to-emerald-500/5" },
    { label: tr(fr, "Commentaires", "Comments"), value: stats.comments, icon: MessagesSquare, tab: "comments" as Tab, tone: "from-fuchsia-300/30 to-fuchsia-500/5" },
  ];
  return (
    <header className="relative isolate overflow-hidden rounded-[28px] border border-white/10 bg-[#0a1430] px-5 py-6 text-white shadow-[0_34px_80px_-42px_rgba(8,18,60,.95)] sm:px-8 sm:py-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-28 -top-32 size-[22rem] rounded-full bg-[#1877f2]/45 blur-3xl animate-[lh-float_16s_ease-in-out_infinite]" />
        <div className="absolute -right-20 -top-10 size-80 rounded-full bg-[radial-gradient(circle,#f58529,#dd2a7b_45%,#8134af_80%)] opacity-45 blur-3xl animate-[lh-float_20s_ease-in-out_infinite_reverse]" />
        <div className="absolute -bottom-40 left-1/3 size-[26rem] rounded-full bg-teal-400/25 blur-3xl animate-[lh-float_24s_ease-in-out_infinite]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] bg-[size:34px_34px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black,transparent)]" />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.18em] text-white/80 backdrop-blur">
            <Sparkles className="size-3.5 text-amber-300" />
            {tr(fr, "Studio social", "Social studio")}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-.04em] sm:text-[2.6rem] sm:leading-[1.05]">
            {tr(fr, "Votre marque, ", "Your brand, ")}
            <span className="bg-[linear-gradient(110deg,#7dd3fc,#c4b5fd,#f9a8d4,#7dd3fc)] bg-[length:250%_100%] bg-clip-text text-transparent animate-[lh-gradient-pan_9s_ease-in-out_infinite]">
              {tr(fr, "partout où sont vos clients.", "wherever your customers are.")}
            </span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">
            {tr(
              fr,
              "Publiez sur Facebook et Instagram, laissez l’IA préparer votre calendrier et répondez aux commentaires. Les messages privés arrivent dans la Messagerie.",
              "Post to Facebook and Instagram, let the AI prepare your calendar and answer comments. Private messages land in Messaging.",
            )}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {account ? (
            <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-2 pr-4 backdrop-blur-md">
              <div className="flex -space-x-2">
                <span className="grid size-10 place-items-center rounded-full bg-[#1877f2] text-sm font-bold ring-2 ring-[#0a1430]">{initials(account.pageName)}</span>
                {account.instagram ? (
                  <span className="grid size-10 place-items-center rounded-full bg-[linear-gradient(135deg,#f58529,#dd2a7b,#8134af)] text-sm font-bold ring-2 ring-[#0a1430]">
                    {initials(account.instagram.username ?? account.pageName)}
                  </span>
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{account.pageName}</p>
                <p className="flex items-center gap-1.5 text-xs text-white/70">
                  <span className="size-2 rounded-full bg-emerald-400 animate-[lh-pulse-ring_1.8s_ease-out_infinite]" />
                  {account.instagram ? `@${account.instagram.username ?? account.instagram.id}` : tr(fr, "Page connectée", "Page connected")}
                </p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onOpen("accounts")}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold backdrop-blur-md transition hover:bg-white/20"
            >
              <Plug className="size-4" />
              {tr(fr, "Connecter Facebook et Instagram", "Connect Facebook and Instagram")}
            </button>
          )}
        </div>
      </div>
      {connected ? (
        <div className="mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {tiles.map((tile, index) => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.label}
                type="button"
                onClick={() => onOpen(tile.tab)}
                style={{ animationDelay: `${index * 80}ms` }}
                className={`group relative overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-br ${tile.tone} p-3.5 text-left backdrop-blur-md transition duration-300 animate-in fade-in slide-in-from-bottom-2 hover:-translate-y-0.5 hover:border-white/30`}
              >
                <span aria-hidden className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 group-hover:opacity-100 group-hover:animate-[lh-shimmer_1.1s_ease-out]" />
                <Icon className="size-4 text-white/80" />
                <p className="mt-2 text-2xl font-semibold tabular-nums">{tile.value}</p>
                <p className="text-xs text-white/70">{tile.label}</p>
              </button>
            );
          })}
        </div>
      ) : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="truncate font-mono text-xs text-ink">{value}</p>
      </div>
      <Button size="icon-sm" variant="ghost" title="Copier" onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success("Copié"))}>
        <Copy className="size-4" />
      </Button>
    </div>
  );
}

function Accounts({ orgSlug, fr, data }: { orgSlug: string; fr: boolean; data: Overview }) {
  const queryClient = useQueryClient();
  const refresh = (next: Overview) => queryClient.setQueryData(["social", orgSlug], next);
  const connect = useMutation({
    mutationFn: () => post<{ url: string }>(orgUrl(orgSlug, "social/connect"), {}),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const pause = useMutation({
    mutationFn: (input: { id: string; status: "active" | "paused" }) => patch<Overview>(orgUrl(orgSlug, `social/accounts/${input.id}`), { status: input.status }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del<Overview>(orgUrl(orgSlug, `social/accounts/${id}`)),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="space-y-4">
      {!data.configured ? (
        <section className="flex gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-ink">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <p className="font-semibold">{tr(fr, "L’application Meta n’est pas encore configurée", "The Meta app is not configured yet")}</p>
            <p className="mt-1 text-ink-secondary">
              {tr(
                fr,
                "Ajoutez META_APP_ID, META_APP_SECRET et META_WEBHOOK_VERIFY_TOKEN dans les variables Railway de l’API, puis redéployez.",
                "Add META_APP_ID, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN to the API's Railway variables, then redeploy.",
              )}
            </p>
          </div>
        </section>
      ) : null}

      <section className="relative overflow-hidden rounded-3xl border border-border bg-surface-1 p-5 shadow-sm sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-[radial-gradient(circle,rgba(24,119,242,.18),transparent_70%)]" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="flex -space-x-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-[#1877f2] text-white shadow-lg ring-4 ring-surface-1">
              <Globe2 className="size-5" />
            </span>
            <span className="grid size-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,#f58529,#dd2a7b,#8134af)] text-white shadow-lg ring-4 ring-surface-1">
              <ImagePlus className="size-5" />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-ink">{tr(fr, "Page Facebook et Instagram", "Facebook Page and Instagram")}</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-secondary">
              {tr(
                fr,
                "Connectez-vous avec le compte Facebook administrateur de la Page. Cochez la Page et son compte Instagram, puis acceptez toutes les autorisations.",
                "Log in with the Facebook account that administers the Page. Tick the Page and its Instagram account and accept every permission.",
              )}
            </p>
          </div>
          {data.isOwner ? (
            <Button loading={connect.isPending} disabled={!data.configured} onClick={() => connect.mutate()}>
              <Link2 className="size-4" />
              {data.accounts.length ? tr(fr, "Reconnecter", "Reconnect") : tr(fr, "Connecter", "Connect")}
            </Button>
          ) : null}
        </div>
        <div className="relative mt-5 grid gap-3">
          {data.accounts.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface-2/50 p-3">
              <span className="grid size-11 place-items-center rounded-full bg-[#1877f2] text-sm font-bold text-white">{initials(item.pageName)}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                  {item.pageName}
                  <PlatformBadge platform="facebook" />
                  {item.instagram ? (
                    <>
                      <PlatformBadge platform="instagram" />
                      <span className="font-normal text-ink-secondary">@{item.instagram.username ?? item.instagram.id}</span>
                    </>
                  ) : (
                    <span className="text-xs font-normal text-warning">{tr(fr, "· aucun Instagram relié", "· no Instagram linked")}</span>
                  )}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-secondary">
                  <span className={`size-2 rounded-full ${item.status === "active" ? "bg-good animate-[lh-pulse-ring_1.8s_ease-out_infinite]" : "bg-ink-muted"}`} />
                  {item.status === "active" ? tr(fr, "Actif : messages, commentaires et publications", "Active") : tr(fr, "En pause : rien n’est reçu", "Paused")}
                  {item.lastError ? ` · ${item.lastError}` : ""}
                </p>
              </div>
              {data.isOwner ? (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" loading={pause.isPending} onClick={() => pause.mutate({ id: item.id, status: item.status === "active" ? "paused" : "active" })}>
                    {item.status === "active" ? <PauseCircle className="size-4" /> : <PlayCircle className="size-4" />}
                    {item.status === "active" ? tr(fr, "Pause", "Pause") : tr(fr, "Activer", "Resume")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={remove.isPending}
                    onClick={() => {
                      if (window.confirm(tr(fr, `Déconnecter ${item.pageName} ?`, `Disconnect ${item.pageName}?`))) remove.mutate(item.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                    {tr(fr, "Déconnecter", "Disconnect")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {!data.accounts.length ? <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-ink-secondary">{tr(fr, "Aucun compte connecté.", "No account connected.")}</p> : null}
        </div>
      </section>

      {data.setup ? (
        <details className="group rounded-2xl border border-border bg-surface-1 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
            {tr(fr, "Réglages techniques de l’application Meta", "Meta app technical settings")}
            <span className="ml-2 text-xs font-normal text-ink-muted group-open:hidden">{tr(fr, "(afficher)", "(show)")}</span>
          </summary>
          <div className="mt-3 space-y-2">
            <CopyLine label={tr(fr, "URI de redirection OAuth valide (Facebook Login)", "Valid OAuth redirect URI (Facebook Login)")} value={data.setup.callbackUrl} />
            <CopyLine label={tr(fr, "URL de rappel du webhook (Messenger et Instagram)", "Webhook callback URL (Messenger and Instagram)")} value={data.setup.webhookUrl} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

/** How the post will look in the feed, updated as the person types. */
function FeedPreview({ fr, pageName, message, imageUrl, toInstagram }: { fr: boolean; pageName: string; message: string; imageUrl: string | null; toInstagram: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white text-[#050505] shadow-[0_18px_40px_-28px_rgba(15,23,42,.55)] dark:bg-[#18191a] dark:text-[#e4e6eb]">
      <div className="flex items-center gap-2.5 px-3.5 pt-3">
        <span className={`grid size-9 place-items-center rounded-full text-xs font-bold text-white ${toInstagram ? "bg-[linear-gradient(135deg,#f58529,#dd2a7b,#8134af)]" : "bg-[#1877f2]"}`}>{initials(pageName)}</span>
        <div className="leading-tight">
          <p className="text-[13px] font-semibold">{pageName}</p>
          <p className="flex items-center gap-1 text-[11px] text-[#65676b]">{tr(fr, "À l’instant", "Just now")} · <Globe2 className="size-3" /></p>
        </div>
      </div>
      <p className="whitespace-pre-wrap px-3.5 py-2.5 text-[13px] leading-5">
        {message.trim() || <span className="text-[#8a8d91]">{tr(fr, "Votre texte apparaîtra ici…", "Your text will appear here…")}</span>}
      </p>
      {imageUrl ? <img src={imageUrl} alt="" className="max-h-72 w-full object-cover" /> : null}
      <div className="flex items-center justify-around border-t border-black/10 px-2 py-1.5 text-[12px] font-semibold text-[#65676b] dark:border-white/10">
        <span className="inline-flex items-center gap-1.5"><ThumbsUp className="size-3.5" />{tr(fr, "J’aime", "Like")}</span>
        <span className="inline-flex items-center gap-1.5"><MessageCircle className="size-3.5" />{tr(fr, "Commenter", "Comment")}</span>
        <span className="inline-flex items-center gap-1.5"><Share2 className="size-3.5" />{tr(fr, "Partager", "Share")}</span>
      </div>
    </div>
  );
}

const STATUS: Record<Post["status"], { tone: string; icon: typeof Clock3 }> = {
  draft: { tone: "bg-amber-500/12 text-amber-700 dark:text-amber-300", icon: Wand2 },
  scheduled: { tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300", icon: CalendarClock },
  publishing: { tone: "bg-brand/12 text-brand", icon: RefreshCw },
  published: { tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  partial: { tone: "bg-orange-500/12 text-orange-700 dark:text-orange-300", icon: TriangleAlert },
  failed: { tone: "bg-critical/12 text-critical", icon: TriangleAlert },
};

function Posts({ orgSlug, fr, account }: { orgSlug: string; fr: boolean; account: Account }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"active" | "archived">("active");
  const [limit, setLimit] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const listQuery = useQuery({
    queryKey: ["social-posts", orgSlug, view, limit, search],
    queryFn: () =>
      get<PostList>(orgUrl(orgSlug, "social/posts"), { params: { archived: view === "archived" ? "1" : undefined, limit, search: search || undefined } }),
    refetchInterval: 20_000,
    placeholderData: (previous) => previous,
  });
  const posts = listQuery.data?.posts ?? [];
  const loading = listQuery.isLoading;
  const historyTotal = listQuery.data?.historyTotal ?? 0;
  const archivedTotal = listQuery.data?.archivedTotal ?? 0;
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [toFacebook, setToFacebook] = useState(true);
  const [toInstagram, setToInstagram] = useState(Boolean(account.instagram));
  const [later, setLater] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [panel, setPanel] = useState<null | "plan" | "ad">(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ["social-posts", orgSlug] });
    void queryClient.invalidateQueries({ queryKey: ["social", orgSlug] });
  };
  const create = useMutation({
    mutationFn: () =>
      post<{ posts: Post[] }>(orgUrl(orgSlug, "social/posts"), {
        message,
        imageUrl,
        linkUrl: linkUrl.trim() || null,
        toFacebook,
        toInstagram,
        scheduledAt: later && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }),
    onSuccess: (data) => {
      done();
      const first = data.posts.find((item) => item.message === message.trim());
      if (first?.status === "failed" || first?.status === "partial") toast.error(first.error ?? tr(fr, "Publication refusée.", "Post refused."));
      else toast.success(later ? tr(fr, "Publication programmée.", "Post scheduled.") : tr(fr, "Publié !", "Published!"));
      setMessage("");
      setImageUrl(null);
      setLinkUrl("");
      setLater(false);
      setScheduledAt("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const retry = useMutation({
    mutationFn: (id: string) => post<{ posts: Post[] }>(orgUrl(orgSlug, `social/posts/${id}/retry`), {}),
    onSuccess: done,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (input: string | { id: string; facebook: boolean }) =>
      del<{ posts: Post[] }>(orgUrl(orgSlug, `social/posts/${typeof input === "string" ? input : input.id}${typeof input !== "string" && input.facebook ? "?facebook=1" : ""}`)),
    onSuccess: (_data, input) => {
      done();
      setDeleting(null);
      if (typeof input !== "string") toast.success(input.facebook ? tr(fr, "Supprimée de LiteHubs et de Facebook.", "Deleted from LiteHubs and Facebook.") : tr(fr, "Retirée de LiteHubs.", "Removed from LiteHubs."));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const archive = useMutation({
    mutationFn: (input: { id: string; archived: boolean }) => post(orgUrl(orgSlug, `social/posts/${input.id}/archive`), { archived: input.archived }),
    onSuccess: (_data, input) => {
      done();
      toast.success(input.archived ? tr(fr, "Publication archivée.", "Post archived.") : tr(fr, "Publication restaurée.", "Post restored."));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const approve = useMutation({
    mutationFn: (ids: string[] | "all") => post<{ posts: Post[]; approved: number }>(orgUrl(orgSlug, "social/posts/approve"), { postIds: ids }),
    onSuccess: (data) => {
      done();
      toast.success(tr(fr, `${data.approved} publication(s) approuvée(s) : elles partiront aux dates prévues.`, `${data.approved} post(s) approved.`));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post<{ url: string }>(orgUrl(orgSlug, "social/images"), form, { headers: { "Content-Type": "multipart/form-data" } });
      setImageUrl(data.url);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };
  const instagramNeedsImage = toInstagram && !imageUrl;
  const canSend = (toFacebook || toInstagram) && (message.trim() || imageUrl) && !instagramNeedsImage && (!later || scheduledAt);
  const groups = useMemo(
    () =>
      [
        { key: "draft", title: tr(fr, "À valider", "To approve"), hint: tr(fr, "Rien n’est publié avant votre approbation.", "Nothing goes out before you approve."), items: posts.filter((item) => item.status === "draft") },
        { key: "scheduled", title: tr(fr, "Programmées", "Scheduled"), hint: tr(fr, "Publiées automatiquement à l’heure prévue.", "Published automatically on time."), items: posts.filter((item) => item.status === "scheduled" || item.status === "publishing") },
        {
          key: "history",
          title: view === "archived" ? tr(fr, "Archives", "Archive") : tr(fr, "Historique", "History"),
          hint: view === "archived" ? tr(fr, "Toujours en ligne sur Facebook / Instagram, masquées de la liste principale.", "Still online, hidden from the main list.") : "",
          items: posts.filter((item) => ["published", "partial", "failed"].includes(item.status)),
        },
      ].filter((group) => group.items.length),
    [posts, fr, view],
  );

  const statusLabel = (item: Post) =>
    ({
      draft: tr(fr, `${item.aiGenerated ? "Brouillon IA" : "Brouillon"} · ${when(item.scheduledAt, fr)}`, `${item.aiGenerated ? "AI draft" : "Draft"} · ${when(item.scheduledAt, fr)}`),
      scheduled: tr(fr, `Programmé · ${when(item.scheduledAt, fr)}`, `Scheduled · ${when(item.scheduledAt, fr)}`),
      publishing: tr(fr, "Publication…", "Publishing…"),
      published: tr(fr, `Publié · ${when(item.publishedAt ?? item.scheduledAt, fr)}`, `Published · ${when(item.publishedAt ?? item.scheduledAt, fr)}`),
      partial: tr(fr, "Publié en partie", "Partly published"),
      failed: tr(fr, "Échec", "Failed"),
    })[item.status];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            {
              key: "plan" as const,
              icon: Sparkles,
              title: tr(fr, "Plan de publications IA", "AI content plan"),
              text: tr(fr, "L’IA écrit la semaine avec vos produits et photos. Vous approuvez, LiteHubs publie.", "The AI writes your week; you approve, LiteHubs publishes."),
              gradient: "from-[#2a78d6] via-[#5b4bd8] to-[#c13584]",
            },
            {
              key: "ad" as const,
              icon: Megaphone,
              title: tr(fr, "Texte de publicité IA", "AI ad copy"),
              text: tr(fr, "Annonce, public cible et conseils prêts pour Meta Ads Manager.", "Ad, audience and tips ready for Meta Ads Manager."),
              gradient: "from-[#f58529] via-[#dd2a7b] to-[#8134af]",
            },
          ]
        ).map((card) => {
          const Icon = card.icon;
          const active = panel === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setPanel(active ? null : card.key)}
              className={`group relative overflow-hidden rounded-3xl bg-gradient-to-br ${card.gradient} p-[1.5px] text-left transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-26px_rgba(91,75,216,.8)] ${active ? "shadow-[0_22px_44px_-26px_rgba(91,75,216,.9)]" : ""}`}
            >
              <span className="flex h-full items-center gap-4 rounded-[calc(1.5rem-1.5px)] bg-surface-1 p-4">
                <span className={`grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${card.gradient} text-white shadow-lg transition duration-300 group-hover:scale-105 group-hover:rotate-3`}>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{card.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-secondary">{card.text}</span>
                </span>
                {active ? <X className="size-4 shrink-0 text-ink-secondary" /> : <ArrowRight className="size-4 shrink-0 text-ink-secondary transition group-hover:translate-x-1" />}
              </span>
            </button>
          );
        })}
      </div>
      {panel === "plan" ? (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          <ContentPlanForm orgSlug={orgSlug} fr={fr} hasInstagram={Boolean(account.instagram)} onDone={() => done()} onClose={() => setPanel(null)} />
        </div>
      ) : null}
      {panel === "ad" ? (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          <AdCopyForm orgSlug={orgSlug} fr={fr} onClose={() => setPanel(null)} />
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="h-fit space-y-4 rounded-3xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5 lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <Pencil className="size-4 text-brand" />
              {tr(fr, "Nouvelle publication", "New post")}
            </p>
            <span className="text-[11px] tabular-nums text-ink-muted">{message.length} / 5000</span>
          </div>
          <textarea
            value={message}
            maxLength={5000}
            rows={5}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={tr(fr, "Qu’avez-vous à partager aujourd’hui ?", "What do you want to share today?")}
            className="w-full resize-y rounded-2xl border border-border-strong bg-surface-2/40 px-4 py-3 text-sm leading-6 text-ink outline-none transition focus:border-brand focus:bg-surface-1 focus:ring-4 focus:ring-brand/10"
          />
          <div className="flex flex-wrap items-center gap-2">
            {imageUrl ? (
              <div className="relative">
                <img src={imageUrl} alt="" className="size-16 rounded-xl object-cover ring-1 ring-border" />
                <button type="button" onClick={() => setImageUrl(null)} className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-1 text-white" aria-label={tr(fr, "Retirer la photo", "Remove photo")}>
                  <X className="size-3" />
                </button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                <ImagePlus className="size-4" />
                {tr(fr, "Photo", "Photo")}
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = "";
              }}
            />
            <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-2.5">
              <Link2 className="size-4 shrink-0 text-ink-muted" />
              <input
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder={tr(fr, "Lien (facultatif) https://…", "Link (optional) https://…")}
                className="h-9 w-full bg-transparent text-sm text-ink outline-none"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setToFacebook(!toFacebook)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${toFacebook ? "border-[#1877f2] bg-[#1877f2] text-white" : "border-border text-ink-secondary"}`}
            >
              {toFacebook ? <Check className="size-3.5" /> : null}Facebook
            </button>
            <button
              type="button"
              disabled={!account.instagram}
              onClick={() => setToInstagram(!toInstagram)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${toInstagram ? "border-transparent bg-[linear-gradient(135deg,#f58529,#dd2a7b,#8134af)] text-white" : "border-border text-ink-secondary"}`}
            >
              {toInstagram ? <Check className="size-3.5" /> : null}Instagram
            </button>
            <label className="ml-auto inline-flex items-center gap-2 text-xs font-semibold text-ink-secondary">
              <input type="checkbox" checked={later} onChange={(event) => setLater(event.target.checked)} className="size-4 accent-brand" />
              <CalendarClock className="size-4" />
              {tr(fr, "Programmer", "Schedule")}
            </label>
          </div>
          {later ? (
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink" />
          ) : null}
          {instagramNeedsImage ? <p className="text-xs font-medium text-warning">{tr(fr, "Instagram exige une photo.", "Instagram requires a photo.")}</p> : null}
          <FeedPreview fr={fr} pageName={account.pageName} message={message} imageUrl={imageUrl} toInstagram={toInstagram && !toFacebook} />
          <Button className="w-full" loading={create.isPending} disabled={!canSend} onClick={() => create.mutate()}>
            <Send className="size-4" />
            {later ? tr(fr, "Programmer la publication", "Schedule post") : tr(fr, "Publier maintenant", "Publish now")}
          </Button>
        </section>

        <section className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-1 p-2">
            <div className="inline-flex rounded-xl bg-surface-2 p-1">
              {(["active", "archived"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setView(key);
                    setLimit(20);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${view === key ? "bg-surface-1 text-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`}
                >
                  {key === "active" ? tr(fr, "Publications", "Posts") : `${tr(fr, "Archives", "Archive")}${archivedTotal ? ` · ${archivedTotal}` : ""}`}
                </button>
              ))}
            </div>
            <div className="relative min-w-[10rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setLimit(20);
                }}
                placeholder={tr(fr, "Rechercher dans l’historique…", "Search history…")}
                className="h-9 w-full rounded-lg bg-transparent pl-8 pr-3 text-sm text-ink outline-none"
              />
            </div>
          </div>
          {loading ? (
            <SkeletonCard rows={4} />
          ) : !groups.length ? (
            <div className="relative overflow-hidden rounded-3xl border border-dashed border-border-strong bg-surface-1 p-8 text-center">
              <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_srgb,var(--brand)_12%,transparent),transparent_60%)]" />
              <span className="relative mx-auto grid size-14 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--brand),#c13584)] text-white shadow-lg animate-[lh-float_8s_ease-in-out_infinite]">
                <Heart className="size-6" />
              </span>
              <p className="relative mt-4 font-semibold text-ink">
                {view === "archived" ? tr(fr, "Aucune publication archivée", "No archived posts") : search ? tr(fr, "Aucun résultat", "No results") : tr(fr, "Votre première publication vous attend", "Your first post is waiting")}
              </p>
              <p className="relative mt-1 text-sm text-ink-secondary">
                {view === "archived"
                  ? tr(fr, "Archivez une publication ancienne pour alléger la liste : elle reste ici et en ligne.", "Archive old posts to keep the list light: they stay here and online.")
                  : tr(fr, "Écrivez-la à gauche, ou laissez l’IA préparer tout un plan.", "Write it on the left, or let the AI prepare a whole plan.")}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {group.title}
                      <span className="rounded-full bg-surface-3 px-2 text-[11px] font-bold text-ink-secondary">{group.items.length}</span>
                    </p>
                    {group.hint ? <p className="text-xs text-ink-muted">{group.hint}</p> : null}
                  </div>
                  {group.key === "draft" ? (
                    <Button size="sm" loading={approve.isPending && approve.variables === "all"} onClick={() => approve.mutate("all")}>
                      <Check className="size-4" />
                      {tr(fr, "Tout approuver", "Approve all")}
                    </Button>
                  ) : null}
                </div>
                <ol className="relative space-y-3 border-l-2 border-dashed border-border pl-5">
                  {group.items.map((item, index) => {
                    const status = STATUS[item.status];
                    const StatusIcon = status.icon;
                    return (
                      <li
                        key={item.id}
                        style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
                        className="relative animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
                      >
                        <span className={`absolute -left-[31px] top-4 grid size-5 place-items-center rounded-full ring-4 ring-page ${status.tone}`}>
                          <StatusIcon className="size-3" />
                        </span>
                        <article className={`group rounded-2xl border bg-surface-1 p-3.5 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-26px_rgba(15,23,42,.6)] ${item.status === "draft" ? "border-amber-400/40" : "border-border"}`}>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${status.tone}`}>{statusLabel(item)}</span>
                            {item.toFacebook ? <PlatformBadge platform="facebook" /> : null}
                            {item.toInstagram ? <PlatformBadge platform="instagram" /> : null}
                            {item.aiGenerated ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[linear-gradient(135deg,rgba(42,120,214,.12),rgba(193,53,132,.12))] px-2 py-0.5 font-semibold text-[#5b4bd8]">
                                <Sparkles className="size-3" />IA
                              </span>
                            ) : null}
                            {item.author ? <span className="text-ink-muted">· {item.author}</span> : null}
                          </div>
                          <div className="mt-2.5 flex gap-3">
                            {item.imageUrl ? <img src={item.imageUrl} alt="" className="size-20 shrink-0 rounded-xl object-cover ring-1 ring-border" /> : null}
                            <p className={`${item.status === "draft" ? "" : "line-clamp-4"} whitespace-pre-wrap text-sm leading-6 text-ink`}>{item.message || "—"}</p>
                          </div>
                          {item.error ? <p className="mt-2 rounded-lg bg-critical/8 px-2.5 py-1.5 text-xs text-critical">{item.error}</p> : null}
                          {editingId === item.id ? (
                            <PostEditor orgSlug={orgSlug} fr={fr} item={item} hasInstagram={Boolean(account.instagram)} onSaved={() => done()} onClose={() => setEditingId(null)} />
                          ) : null}
                          {editingId !== item.id && (item.status === "draft" || item.status === "scheduled") ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {item.status === "draft" ? (
                                <Button size="sm" loading={approve.isPending && Array.isArray(approve.variables) && approve.variables[0] === item.id} onClick={() => approve.mutate([item.id])}>
                                  <Check className="size-4" />
                                  {tr(fr, "Approuver", "Approve")}
                                </Button>
                              ) : null}
                              <Button size="sm" variant="outline" onClick={() => setEditingId(item.id)}>
                                <Pencil className="size-4" />
                                {tr(fr, "Modifier", "Edit")}
                              </Button>
                              <Button size="sm" variant="ghost" loading={remove.isPending && remove.variables === item.id} onClick={() => remove.mutate(item.id)}>
                                <Trash2 className="size-4" />
                                {item.status === "scheduled" ? tr(fr, "Annuler", "Cancel") : tr(fr, "Supprimer", "Delete")}
                              </Button>
                            </div>
                          ) : null}
                          {["published", "partial", "failed"].includes(item.status) ? (
                            deleting === item.id ? (
                              <div className="mt-3 space-y-2 rounded-xl border border-critical/30 bg-critical/5 p-3 text-xs">
                                <p className="font-semibold text-ink">{tr(fr, "Supprimer cette publication ?", "Delete this post?")}</p>
                                {item.toInstagram && item.instagramMediaId ? (
                                  <p className="text-ink-secondary">{tr(fr, "Instagram ne permet pas la suppression depuis LiteHubs : supprimez-la dans l’application Instagram si besoin.", "Instagram does not allow deleting from LiteHubs: remove it in the Instagram app if needed.")}</p>
                                ) : null}
                                <div className="flex flex-wrap gap-1.5">
                                  {item.facebookPostId ? (
                                    <Button size="sm" variant="destructive" loading={remove.isPending} onClick={() => remove.mutate({ id: item.id, facebook: true })}>
                                      <Trash2 className="size-4" />
                                      {tr(fr, "Supprimer aussi de Facebook", "Also delete from Facebook")}
                                    </Button>
                                  ) : null}
                                  <Button size="sm" variant="outline" loading={remove.isPending} onClick={() => remove.mutate({ id: item.id, facebook: false })}>
                                    {tr(fr, "Retirer de LiteHubs seulement", "Remove from LiteHubs only")}
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                                    {tr(fr, "Annuler", "Cancel")}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 flex flex-wrap gap-1.5 opacity-80 transition group-hover:opacity-100">
                                <Button size="sm" variant="ghost" loading={archive.isPending && archive.variables?.id === item.id} onClick={() => archive.mutate({ id: item.id, archived: !item.archivedAt })}>
                                  {item.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                                  {item.archivedAt ? tr(fr, "Restaurer", "Restore") : tr(fr, "Archiver", "Archive")}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setDeleting(item.id)}>
                                  <Trash2 className="size-4" />
                                  {tr(fr, "Supprimer", "Delete")}
                                </Button>
                              </div>
                            )
                          ) : null}
                          {item.status === "failed" || item.status === "partial" ? (
                            <div className="mt-3 flex gap-1.5">
                              <Button size="sm" variant="outline" loading={retry.isPending} onClick={() => retry.mutate(item.id)}>
                                <RefreshCw className="size-4" />
                                {tr(fr, "Réessayer", "Retry")}
                              </Button>

                            </div>
                          ) : null}
                        </article>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))
          )}
          {(() => {
            const shown = posts.filter((item) => ["published", "partial", "failed"].includes(item.status)).length;
            return shown < historyTotal ? (
              <div className="text-center">
                <Button variant="secondary" size="sm" loading={listQuery.isFetching} onClick={() => setLimit(limit + 20)}>
                  {tr(fr, `Voir plus (${historyTotal - shown} restantes)`, `Show more (${historyTotal - shown} left)`)}
                </Button>
              </div>
            ) : null;
          })()}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

function Comments({ orgSlug, fr }: { orgSlug: string; fr: boolean }) {
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const comments = useQuery({
    queryKey: ["social-comments", orgSlug, filter],
    queryFn: () => get<{ comments: Comment[] }>(orgUrl(orgSlug, "social/comments"), { params: { filter } }),
    refetchInterval: 20_000,
  });
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-border bg-surface-1 p-1">
          {(["todo", "all"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${filter === key ? "bg-ink text-ink-inverse shadow" : "text-ink-secondary hover:text-ink"}`}
            >
              {key === "todo" ? tr(fr, "À traiter", "To handle") : tr(fr, "Tous", "All")}
            </button>
          ))}
        </div>
        <p className="hidden text-xs text-ink-muted sm:block">{tr(fr, "Actualisé automatiquement", "Refreshed automatically")}</p>
      </div>
      {comments.isLoading ? (
        <SkeletonCard rows={4} />
      ) : !comments.data?.comments.length ? (
        <div className="rounded-3xl border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-good/12 text-good">
            <CheckCircle2 className="size-6" />
          </span>
          <p className="mt-4 font-semibold text-ink">{filter === "todo" ? tr(fr, "Tout est à jour", "All caught up") : tr(fr, "Aucun commentaire", "No comments")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{tr(fr, "Les nouveaux commentaires Facebook et Instagram apparaissent ici.", "New Facebook and Instagram comments appear here.")}</p>
        </div>
      ) : (
        comments.data.comments.map((item, index) => (
          <div key={item.id} style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }} className="animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
            <CommentCard orgSlug={orgSlug} fr={fr} comment={item} />
          </div>
        ))
      )}
    </div>
  );
}

function CommentCard({ orgSlug, fr, comment }: { orgSlug: string; fr: boolean; comment: Comment }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["social-comments", orgSlug] });
    void queryClient.invalidateQueries({ queryKey: ["social", orgSlug] });
  };
  const send = useMutation({
    mutationFn: () => post(orgUrl(orgSlug, `social/comments/${comment.id}/reply`), { body: reply }),
    onSuccess: () => {
      toast.success(tr(fr, "Réponse publiée.", "Reply posted."));
      setReply("");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const suggest = useMutation({
    mutationFn: () => post<{ suggestion: string }>(orgUrl(orgSlug, `social/comments/${comment.id}/suggest`), {}),
    onSuccess: (data) => setReply(data.suggestion),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const mark = useMutation({
    mutationFn: (done: boolean) => patch(orgUrl(orgSlug, `social/comments/${comment.id}`), { done }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const name = comment.author ?? tr(fr, "Un abonné", "A follower");
  return (
    <article className={`rounded-3xl border bg-surface-1 p-4 shadow-sm transition ${comment.done ? "border-border opacity-75" : "border-border hover:shadow-[0_16px_36px_-28px_rgba(15,23,42,.6)]"}`}>
      <div className="flex gap-3">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${
            comment.platform === "instagram" ? "bg-[linear-gradient(135deg,#f58529,#dd2a7b,#8134af)]" : "bg-[#1877f2]"
          }`}
        >
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="rounded-2xl rounded-tl-sm bg-surface-2 px-3.5 py-2.5">
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-ink">{name}</span>
              <PlatformBadge platform={comment.platform} />
              {comment.isReply ? <span className="text-ink-muted">{tr(fr, "réponse à un commentaire", "reply to a comment")}</span> : null}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{comment.body || "—"}</p>
          </div>
          <p className="mt-1 pl-2 text-[11px] text-ink-muted">{when(comment.receivedAt, fr)}</p>
          {comment.reply ? (
            <div className="ml-6 mt-2 rounded-2xl rounded-tl-sm border border-brand/20 bg-brand/6 px-3.5 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
                {tr(fr, "Notre réponse", "Our reply")}
                {comment.reply.by ? ` · ${comment.reply.by}` : ""}
              </p>
              <p className="mt-0.5 text-sm text-ink">{comment.reply.body}</p>
            </div>
          ) : null}
          {comment.replyError ? <p className="mt-1 text-xs text-critical">{comment.replyError}</p> : null}
          {!comment.reply ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-end gap-2 rounded-2xl border border-border-strong bg-surface-1 p-1.5 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
                <textarea
                  value={reply}
                  rows={2}
                  maxLength={2000}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder={tr(fr, "Répondre publiquement…", "Reply publicly…")}
                  className="min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none"
                />
                <Button size="sm" loading={send.isPending} disabled={!reply.trim()} onClick={() => send.mutate()}>
                  <Send className="size-4" />
                  <span className="hidden sm:inline">{tr(fr, "Répondre", "Reply")}</span>
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" loading={suggest.isPending} onClick={() => suggest.mutate()}>
                  <Sparkles className="size-4 text-[#5b4bd8]" />
                  {tr(fr, "Suggestion IA", "AI suggestion")}
                </Button>
                <Button size="sm" variant="ghost" loading={mark.isPending} onClick={() => mark.mutate(!comment.done)}>
                  {comment.done ? <Check className="size-4" /> : <CheckCircle2 className="size-4" />}
                  {comment.done ? tr(fr, "Remettre à traiter", "Mark to handle") : tr(fr, "Traité sans répondre", "Done, no reply")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
