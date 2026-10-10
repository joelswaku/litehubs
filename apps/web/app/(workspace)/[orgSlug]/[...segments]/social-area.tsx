"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  ImagePlus,
  Link2,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { api, del, get, orgUrl, patch, post } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

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
};

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const errorMessage = (error: unknown) =>
  (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
  (error instanceof Error ? error.message : "");
const when = (value: string, fr: boolean) =>
  new Date(value).toLocaleString(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function PlatformBadge({ platform }: { platform: "facebook" | "instagram" | "website" }) {
  const style =
    platform === "facebook"
      ? "bg-[#1877f2]/10 text-[#1877f2]"
      : platform === "instagram"
        ? "bg-[#d62976]/10 text-[#d62976]"
        : "bg-brand/10 text-brand";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style}`}>
      {platform === "facebook" ? "Facebook" : platform === "instagram" ? "Instagram" : "Site"}
    </span>
  );
}

export function SocialArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const [tab, setTab] = useState<"posts" | "comments" | "accounts">("posts");
  const overview = useQuery({
    queryKey: ["social", orgSlug],
    queryFn: () => get<Overview>(orgUrl(orgSlug, "social")),
    refetchInterval: 30_000,
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
      <div className="p-4 sm:p-6">
        <SkeletonCard rows={6} />
      </div>
    );
  if (overview.isError || !overview.data)
    return (
      <div className="p-4 sm:p-6">
        <ErrorState title={tr(fr, "Réseaux sociaux indisponibles", "Social media unavailable")} description={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />
      </div>
    );
  const data = overview.data;
  const connected = data.accounts.some((item) => item.status === "active");
  const current = !connected ? "accounts" : tab;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
          <Share2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-ink">{tr(fr, "Réseaux sociaux", "Social media")}</h1>
          <p className="text-sm text-ink-secondary">
            {tr(
              fr,
              "Publiez sur Facebook et Instagram et répondez aux commentaires. Les messages privés arrivent dans Chat → Clients.",
              "Post to Facebook and Instagram and answer comments. Private messages arrive in Chat → Customers.",
            )}
          </p>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-1 p-1">
        {(
          [
            { key: "posts", label: tr(fr, "Publications", "Posts"), count: data.scheduledPosts },
            { key: "comments", label: tr(fr, "Commentaires", "Comments"), count: data.pendingComments },
            { key: "accounts", label: tr(fr, "Comptes", "Accounts"), count: 0 },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={!connected && item.key !== "accounts"}
            onClick={() => setTab(item.key)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${
              current === item.key ? "bg-brand/10 text-brand" : "text-ink-secondary hover:bg-surface-2"
            }`}
          >
            {item.label}
            {item.count ? <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-ink">{item.count}</span> : null}
          </button>
        ))}
      </nav>

      {current === "accounts" ? <Accounts orgSlug={orgSlug} fr={fr} data={data} /> : null}
      {current === "posts" ? <Posts orgSlug={orgSlug} fr={fr} account={data.accounts.find((item) => item.status === "active")!} /> : null}
      {current === "comments" ? <Comments orgSlug={orgSlug} fr={fr} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="truncate font-mono text-xs text-ink">{value}</p>
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        title="Copier"
        onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success("Copié"))}
      >
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
    mutationFn: (input: { id: string; status: "active" | "paused" }) =>
      patch<Overview>(orgUrl(orgSlug, `social/accounts/${input.id}`), { status: input.status }),
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
        <section className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-ink">
          <p className="font-semibold">{tr(fr, "Étape 1 : l’application Meta n’est pas encore configurée", "Step 1: the Meta app is not configured yet")}</p>
          <p className="mt-1 text-ink-secondary">
            {tr(
              fr,
              "Ajoutez META_APP_ID, META_APP_SECRET et META_WEBHOOK_VERIFY_TOKEN dans les variables Railway de l’API, puis redéployez. Le guide pas à pas explique où les trouver.",
              "Add META_APP_ID, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN to the API's Railway variables, then redeploy.",
            )}
          </p>
        </section>
      ) : null}

      {data.setup ? (
        <section className="space-y-2 rounded-2xl border border-border bg-surface-1 p-4">
          <p className="text-sm font-semibold text-ink">{tr(fr, "Adresses à coller dans l’application Meta", "Addresses to paste in the Meta app")}</p>
          <CopyLine label={tr(fr, "URI de redirection OAuth valide (Facebook Login)", "Valid OAuth redirect URI (Facebook Login)")} value={data.setup.callbackUrl} />
          <CopyLine label={tr(fr, "URL de rappel du webhook (Messenger et Instagram)", "Webhook callback URL (Messenger and Instagram)")} value={data.setup.webhookUrl} />
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{tr(fr, "Page Facebook et Instagram", "Facebook Page and Instagram")}</p>
            <p className="text-xs text-ink-secondary">
              {tr(
                fr,
                "Connectez-vous avec le compte Facebook administrateur de la Page. Cochez la Page Congo Omega et son compte Instagram, puis acceptez toutes les autorisations.",
                "Log in with the Facebook account that administers the Page. Tick the Page and its Instagram account and accept every permission.",
              )}
            </p>
          </div>
          {data.isOwner ? (
            <Button loading={connect.isPending} disabled={!data.configured} onClick={() => connect.mutate()}>
              <Link2 className="size-4" />
              {data.accounts.length ? tr(fr, "Reconnecter", "Reconnect") : tr(fr, "Connecter Facebook et Instagram", "Connect Facebook and Instagram")}
            </Button>
          ) : null}
        </div>
        <div className="mt-3 divide-y divide-border">
          {data.accounts.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                  <PlatformBadge platform="facebook" />
                  {item.pageName}
                  {item.instagram ? (
                    <>
                      <PlatformBadge platform="instagram" />@{item.instagram.username ?? item.instagram.id}
                    </>
                  ) : (
                    <span className="text-xs text-warning">{tr(fr, "· aucun Instagram relié à cette Page", "· no Instagram linked to this Page")}</span>
                  )}
                </p>
                <p className="text-xs text-ink-secondary">
                  {item.status === "active" ? tr(fr, "Actif : messages, commentaires et publications", "Active") : tr(fr, "En pause : rien n’est reçu", "Paused")}
                  {item.lastError ? ` · ${item.lastError}` : ""}
                </p>
              </div>
              {data.isOwner ? (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={pause.isPending}
                    onClick={() => pause.mutate({ id: item.id, status: item.status === "active" ? "paused" : "active" })}
                  >
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
          {!data.accounts.length ? (
            <p className="py-3 text-sm text-ink-secondary">{tr(fr, "Aucun compte connecté.", "No account connected.")}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

function Posts({ orgSlug, fr, account }: { orgSlug: string; fr: boolean; account: Account }) {
  const queryClient = useQueryClient();
  const posts = useQuery({
    queryKey: ["social-posts", orgSlug],
    queryFn: () => get<{ posts: Post[] }>(orgUrl(orgSlug, "social/posts")),
    refetchInterval: 20_000,
  });
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [toFacebook, setToFacebook] = useState(true);
  const [toInstagram, setToInstagram] = useState(Boolean(account.instagram));
  const [later, setLater] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const done = (data: { posts: Post[] }) => {
    queryClient.setQueryData(["social-posts", orgSlug], data);
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
      done(data);
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
    mutationFn: (id: string) => del<{ posts: Post[] }>(orgUrl(orgSlug, `social/posts/${id}`)),
    onSuccess: done,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post<{ url: string }>(orgUrl(orgSlug, "social/images"), form);
      setImageUrl(data.url);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };
  const instagramNeedsImage = toInstagram && !imageUrl;
  const canSend = (toFacebook || toInstagram) && (message.trim() || imageUrl) && !instagramNeedsImage && (!later || scheduledAt);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <section className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
        <p className="font-semibold text-ink">{tr(fr, "Nouvelle publication", "New post")}</p>
        <textarea
          value={message}
          maxLength={5000}
          rows={5}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={tr(fr, "Écrivez votre publication…", "Write your post…")}
          className="w-full rounded-xl border border-border-strong bg-surface-1 px-3 py-2 text-sm text-ink"
        />
        {imageUrl ? (
          <div className="relative overflow-hidden rounded-xl border border-border">
            <img src={imageUrl} alt="" className="max-h-64 w-full object-cover" />
            <button
              type="button"
              onClick={() => setImageUrl(null)}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
              aria-label={tr(fr, "Retirer la photo", "Remove photo")}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-4" />
            {tr(fr, "Ajouter une photo", "Add a photo")}
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
        <input
          value={linkUrl}
          onChange={(event) => setLinkUrl(event.target.value)}
          placeholder={tr(fr, "Lien (facultatif) : https://congoomega.com/…", "Link (optional): https://…")}
          className="h-9 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
        />
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={toFacebook} onChange={(event) => setToFacebook(event.target.checked)} />
            <PlatformBadge platform="facebook" />
          </label>
          <label className={`inline-flex items-center gap-2 ${account.instagram ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              disabled={!account.instagram}
              checked={toInstagram}
              onChange={(event) => setToInstagram(event.target.checked)}
            />
            <PlatformBadge platform="instagram" />
          </label>
        </div>
        {instagramNeedsImage ? (
          <p className="text-xs text-warning">{tr(fr, "Instagram exige une photo.", "Instagram requires a photo.")}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={later} onChange={(event) => setLater(event.target.checked)} />
            <CalendarClock className="size-4 text-ink-secondary" />
            {tr(fr, "Programmer", "Schedule")}
          </label>
          {later ? (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              className="h-9 rounded-lg border border-border-strong bg-surface-1 px-2 text-sm text-ink"
            />
          ) : null}
        </div>
        <Button className="w-full" loading={create.isPending} disabled={!canSend} onClick={() => create.mutate()}>
          <Send className="size-4" />
          {later ? tr(fr, "Programmer la publication", "Schedule post") : tr(fr, "Publier maintenant", "Publish now")}
        </Button>
      </section>

      <section className="space-y-2">
        {posts.isLoading ? (
          <SkeletonCard rows={4} />
        ) : !posts.data?.posts.length ? (
          <EmptyState icon={Share2} title={tr(fr, "Aucune publication pour l’instant", "No posts yet")} />
        ) : (
          posts.data.posts.map((item) => (
            <article key={item.id} className="rounded-2xl border border-border bg-surface-1 p-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {item.toFacebook ? <PlatformBadge platform="facebook" /> : null}
                {item.toInstagram ? <PlatformBadge platform="instagram" /> : null}
                <span
                  className={`font-semibold ${
                    item.status === "published"
                      ? "text-good"
                      : item.status === "failed" || item.status === "partial"
                        ? "text-critical"
                        : "text-ink-secondary"
                  }`}
                >
                  {
                    {
                      draft: tr(fr, "Brouillon", "Draft"),
                      scheduled: tr(fr, `Programmé · ${when(item.scheduledAt, fr)}`, `Scheduled · ${when(item.scheduledAt, fr)}`),
                      publishing: tr(fr, "Publication…", "Publishing…"),
                      published: tr(fr, `Publié · ${when(item.publishedAt ?? item.scheduledAt, fr)}`, `Published`),
                      partial: tr(fr, "Publié en partie", "Partly published"),
                      failed: tr(fr, "Échec", "Failed"),
                    }[item.status]
                  }
                </span>
                {item.author ? <span className="text-ink-muted">· {item.author}</span> : null}
              </div>
              <div className="mt-2 flex gap-3">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                ) : null}
                <p className="line-clamp-4 whitespace-pre-wrap text-sm text-ink">{item.message || "—"}</p>
              </div>
              {item.error ? <p className="mt-2 text-xs text-critical">{item.error}</p> : null}
              {item.status === "failed" || item.status === "partial" || item.status === "scheduled" ? (
                <div className="mt-2 flex gap-1.5">
                  {item.status !== "scheduled" ? (
                    <Button size="sm" variant="outline" loading={retry.isPending} onClick={() => retry.mutate(item.id)}>
                      <RefreshCw className="size-4" />
                      {tr(fr, "Réessayer", "Retry")}
                    </Button>
                  ) : null}
                  {item.status !== "partial" ? (
                    <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(item.id)}>
                      <Trash2 className="size-4" />
                      {item.status === "scheduled" ? tr(fr, "Annuler", "Cancel") : tr(fr, "Supprimer", "Delete")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))
        )}
      </section>
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
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(["todo", "all"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`h-8 rounded-full border px-3 text-xs font-semibold ${filter === key ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary"}`}
          >
            {key === "todo" ? tr(fr, "À traiter", "To handle") : tr(fr, "Tous", "All")}
          </button>
        ))}
      </div>
      {comments.isLoading ? (
        <SkeletonCard rows={4} />
      ) : !comments.data?.comments.length ? (
        <EmptyState
          icon={MessageCircle}
          title={filter === "todo" ? tr(fr, "Aucun commentaire à traiter", "Nothing to handle") : tr(fr, "Aucun commentaire", "No comments")}
          description={tr(fr, "Les nouveaux commentaires Facebook et Instagram apparaissent ici.", "New Facebook and Instagram comments appear here.")}
        />
      ) : (
        comments.data.comments.map((item) => <CommentCard key={item.id} orgSlug={orgSlug} fr={fr} comment={item} />)
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
  return (
    <article className={`rounded-2xl border bg-surface-1 p-3 ${comment.done ? "border-border opacity-80" : "border-brand/30"}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-secondary">
        <PlatformBadge platform={comment.platform} />
        <span className="font-semibold text-ink">{comment.author ?? tr(fr, "Un abonné", "A follower")}</span>
        <span>· {when(comment.receivedAt, fr)}</span>
        {comment.isReply ? <span>· {tr(fr, "réponse à un commentaire", "reply to a comment")}</span> : null}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">{comment.body || "—"}</p>
      {comment.reply ? (
        <p className="mt-2 rounded-lg bg-brand/5 px-3 py-2 text-sm text-ink">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-brand">
            {tr(fr, "Notre réponse", "Our reply")}
            {comment.reply.by ? ` · ${comment.reply.by}` : ""}
          </span>
          {comment.reply.body}
        </p>
      ) : null}
      {comment.replyError ? <p className="mt-1 text-xs text-critical">{comment.replyError}</p> : null}
      {!comment.reply ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={reply}
            rows={2}
            maxLength={2000}
            onChange={(event) => setReply(event.target.value)}
            placeholder={tr(fr, "Répondre publiquement…", "Reply publicly…")}
            className="w-full rounded-xl border border-border-strong bg-surface-1 px-3 py-2 text-sm text-ink"
          />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" loading={send.isPending} disabled={!reply.trim()} onClick={() => send.mutate()}>
              <Send className="size-4" />
              {tr(fr, "Répondre", "Reply")}
            </Button>
            <Button size="sm" variant="outline" loading={suggest.isPending} onClick={() => suggest.mutate()}>
              <Sparkles className="size-4" />
              {tr(fr, "Suggestion IA", "AI suggestion")}
            </Button>
            <Button size="sm" variant="ghost" loading={mark.isPending} onClick={() => mark.mutate(!comment.done)}>
              {comment.done ? <Check className="size-4" /> : <CheckCircle2 className="size-4" />}
              {comment.done ? tr(fr, "Remettre à traiter", "Mark to handle") : tr(fr, "Traité sans répondre", "Done, no reply")}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
