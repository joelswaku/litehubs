"use client";
/**
 * Display screens management: create a TV screen, choose what it shows
 * (poultry, pigs, crops, videos) and copy its secret link to open on the TV.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bird, CalendarClock, Copy, ExternalLink, Film, MonitorPlay, Pencil, PiggyBank, Plus, RefreshCw, Sprout, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import { ApiError, del, get, orgUrl, post, put } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

type Section = "poultry" | "pigs" | "agriculture" | "appointments";
type Display = {
  id: string;
  name: string;
  siteId: string | null;
  siteName: string | null;
  token: string;
  sections: Section[];
  rotateSeconds: number;
  videoDocumentIds: string[];
  videosBetween: boolean;
  message: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
};
type Overview = { displays: Display[]; videos: { id: string; title: string; sizeBytes: number }[]; sites: { id: string; name: string; code: string }[] };

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const failed = (error: unknown, fr: boolean) => (error instanceof ApiError ? error.message : tr(fr, "L’action a échoué.", "The action failed."));
const SECTIONS: { key: Section; fr: string; en: string; icon: typeof Bird }[] = [
  { key: "poultry", fr: "Volaille", en: "Poultry", icon: Bird },
  { key: "pigs", fr: "Porcs", en: "Pigs", icon: PiggyBank },
  { key: "agriculture", fr: "Agriculture", en: "Crops", icon: Sprout },
  { key: "appointments", fr: "Rendez-vous", en: "Appointments", icon: CalendarClock },
];
const screenUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/display/${token}`;

function online(lastSeenAt: string | null) {
  return lastSeenAt ? Date.now() - new Date(lastSeenAt).getTime() < 75 * 60_000 : false;
}

function DisplayForm({ orgSlug, fr, data, initial, onClose }: { orgSlug: string; fr: boolean; data: Overview; initial: Display | null; onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [siteId, setSiteId] = useState(initial?.siteId ?? "");
  const [sections, setSections] = useState<Section[]>(initial?.sections ?? ["poultry", "pigs", "agriculture"]);
  const [rotateSeconds, setRotateSeconds] = useState(initial?.rotateSeconds ?? 20);
  const [videos, setVideos] = useState<string[]>(initial?.videoDocumentIds ?? []);
  const [videosBetween, setVideosBetween] = useState(initial?.videosBetween ?? false);
  const [message, setMessage] = useState(initial?.message ?? "");
  const save = useMutation({
    mutationFn: () => {
      const body = { name, siteId: siteId || null, sections, rotateSeconds, videoDocumentIds: videos, videosBetween, message: message.trim() || null };
      return initial ? put<Overview>(orgUrl(orgSlug, `displays/${initial.id}`), body) : post<Overview>(orgUrl(orgSlug, "displays"), body);
    },
    onSuccess: (next) => {
      client.setQueryData(["displays", orgSlug], next);
      toast.success(initial ? tr(fr, "Écran mis à jour.", "Screen updated.") : tr(fr, "Écran créé : copiez son lien sur la TV.", "Screen created: open its link on the TV."));
      onClose();
    },
    onError: (error) => toast.error(failed(error, fr)),
  });
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border bg-surface-1 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <p className="text-lg font-semibold text-ink">{initial ? tr(fr, "Modifier l’écran", "Edit screen") : tr(fr, "Nouvel écran", "New screen")}</p>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-secondary hover:bg-surface-3" aria-label={tr(fr, "Fermer", "Close")}>
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink-secondary">
              {tr(fr, "Nom de l’écran", "Screen name")}
              <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={tr(fr, "Ex. : TV bureau Kinshasa", "E.g. office TV")} className="mt-1 h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink" />
            </label>
            <label className="text-xs font-semibold text-ink-secondary">
              {tr(fr, "Site affiché", "Site shown")}
              <select value={siteId} onChange={(event) => setSiteId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink">
                <option value="">{tr(fr, "Tous les sites", "All sites")}</option>
                {data.sites.map((site) => (
                  <option key={site.id} value={site.id}>{site.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <p className="text-xs font-semibold text-ink-secondary">{tr(fr, "Tableaux à afficher", "Boards to show")}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {tr(fr, "Rendez-vous : la file d’attente se met à jour en direct (toutes les 5 s) ; un ticket appelé s’affiche en grand avec un son. Choisissez le site de l’accueil ci-dessus.", "Appointments: the queue updates live; a called ticket is shown full screen with a chime.")}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SECTIONS.map((section) => {
                const Icon = section.icon;
                const active = sections.includes(section.key);
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setSections(toggle(sections, section.key))}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${active ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary hover:bg-surface-2"}`}
                  >
                    <Icon className="size-4" />
                    {fr ? section.fr : section.en}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block text-xs font-semibold text-ink-secondary">
            {tr(fr, `Changer de tableau toutes les ${rotateSeconds} secondes`, `Change board every ${rotateSeconds} seconds`)}
            <input type="range" min={8} max={120} step={1} value={rotateSeconds} onChange={(event) => setRotateSeconds(Number(event.target.value))} className="mt-2 w-full accent-brand" />
          </label>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
              <Film className="size-3.5" />
              {tr(fr, "Vidéos de l’entreprise", "Company videos")}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {tr(fr, "Jouées quand il n’y a aucune statistique à montrer. Importez vos vidéos MP4 ou WebM dans Documents.", "Played when there are no statistics. Upload MP4 or WebM videos in Documents.")}
            </p>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {data.videos.length ? (
                data.videos.map((video) => (
                  <label key={video.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-2">
                    <input type="checkbox" className="size-4 accent-brand" checked={videos.includes(video.id)} onChange={() => setVideos(toggle(videos, video.id))} />
                    <span className="truncate">{video.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-ink-muted">{(video.sizeBytes / 1_048_576).toFixed(1)} Mo</span>
                  </label>
                ))
              ) : (
                <p className="px-2 py-3 text-xs text-ink-muted">{tr(fr, "Aucune vidéo dans Documents pour l’instant.", "No video in Documents yet.")}</p>
              )}
            </div>
            <label className={`mt-2 flex items-center gap-2 text-sm text-ink ${videos.length ? "" : "opacity-50"}`}>
              <input type="checkbox" className="size-4 accent-brand" disabled={!videos.length} checked={videosBetween} onChange={(event) => setVideosBetween(event.target.checked)} />
              {tr(fr, "Passer aussi une vidéo après chaque tour des tableaux", "Also play a video after each round of boards")}
            </label>
          </div>
          <label className="block text-xs font-semibold text-ink-secondary">
            {tr(fr, "Message défilant (facultatif)", "Scrolling message (optional)")}
            <input value={message} maxLength={200} onChange={(event) => setMessage(event.target.value)} placeholder={tr(fr, "Ex. : Sécurité d’abord — portez vos équipements de protection.", "E.g. Safety first.")} className="mt-1 h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-2 px-5 py-4">
          <Button variant="secondary" onClick={onClose}>{tr(fr, "Annuler", "Cancel")}</Button>
          <Button loading={save.isPending} disabled={name.trim().length < 2 || (!sections.length && !videos.length)} onClick={() => save.mutate()}>
            {initial ? tr(fr, "Enregistrer", "Save") : tr(fr, "Créer l’écran", "Create screen")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DisplaysArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale.startsWith("fr");
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["displays", orgSlug], queryFn: () => get<Overview>(orgUrl(orgSlug, "displays")), refetchInterval: 60_000 });
  const [editing, setEditing] = useState<Display | null | "new">(null);
  const update = (next: Overview) => client.setQueryData(["displays", orgSlug], next);
  const regenerate = useMutation({
    mutationFn: (id: string) => post<Overview>(orgUrl(orgSlug, `displays/${id}/regenerate`), {}),
    onSuccess: (next) => {
      update(next);
      toast.success(tr(fr, "Nouveau lien créé : l’ancien ne fonctionne plus.", "New link created: the old one stops working."));
    },
    onError: (error) => toast.error(failed(error, fr)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del<Overview>(orgUrl(orgSlug, `displays/${id}`)),
    onSuccess: update,
    onError: (error) => toast.error(failed(error, fr)),
  });
  const toggleActive = useMutation({
    mutationFn: (display: Display) =>
      put<Overview>(orgUrl(orgSlug, `displays/${display.id}`), {
        name: display.name,
        siteId: display.siteId,
        sections: display.sections,
        rotateSeconds: display.rotateSeconds,
        videoDocumentIds: display.videoDocumentIds,
        videosBetween: display.videosBetween,
        message: display.message,
        isActive: !display.isActive,
      }),
    onSuccess: update,
    onError: (error) => toast.error(failed(error, fr)),
  });

  if (query.isLoading) return <div className="p-4 sm:p-6"><SkeletonCard rows={5} /></div>;
  if (query.isError || !query.data)
    return <div className="p-4 sm:p-6"><ErrorState title={tr(fr, "Écrans indisponibles", "Screens unavailable")} description={failed(query.error, fr)} onRetry={() => void query.refetch()} /></div>;
  const data = query.data;
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 p-3 sm:p-6">
      <header className="relative isolate overflow-hidden rounded-[28px] border border-white/10 bg-[#071433] px-5 py-6 text-white sm:px-8 sm:py-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-20 -top-24 size-80 rounded-full bg-[#1d4aa8]/60 blur-3xl animate-[lh-float_18s_ease-in-out_infinite]" />
          <div className="absolute -right-10 bottom-[-6rem] size-80 rounded-full bg-amber-400/25 blur-3xl animate-[lh-float_22s_ease-in-out_infinite_reverse]" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.18em] text-amber-200">
              <MonitorPlay className="size-3.5" />
              {tr(fr, "Écrans d’affichage", "Display screens")}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">{tr(fr, "La ferme en direct, sur chaque écran.", "The farm, live on every screen.")}</h1>
            <p className="mt-2 text-sm leading-6 text-white/70">
              {tr(
                fr,
                "Volaille, porcs et cultures façon tableau d’aéroport, mis à jour chaque heure. Sans statistique, l’écran passe vos vidéos. Ouvrez le lien de l’écran sur la TV : aucune connexion LiteHubs n’est nécessaire.",
                "Poultry, pigs and crops like an airport board, refreshed every hour. Without statistics the screen plays your videos. Open the screen's link on the TV: no LiteHubs login needed.",
              )}
            </p>
          </div>
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {tr(fr, "Nouvel écran", "New screen")}
          </Button>
        </div>
      </header>

      {data.displays.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.displays.map((display) => {
            const live = online(display.lastSeenAt);
            return (
              <article key={display.id} className={`flex flex-col rounded-3xl border bg-surface-1 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-28px_rgba(15,23,42,.6)] ${display.isActive ? "border-border" : "border-dashed border-border opacity-70"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-ink">{display.name}</p>
                    <p className="text-xs text-ink-secondary">{display.siteName ?? tr(fr, "Tous les sites", "All sites")}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${!display.isActive ? "bg-surface-3 text-ink-secondary" : live ? "bg-good/12 text-good" : "bg-warning/12 text-warning"}`}>
                    <span className={`size-1.5 rounded-full ${!display.isActive ? "bg-ink-muted" : live ? "bg-good animate-[lh-pulse-ring_1.8s_ease-out_infinite]" : "bg-warning"}`} />
                    {!display.isActive ? tr(fr, "Désactivé", "Disabled") : live ? tr(fr, "En ligne", "Online") : tr(fr, "Pas encore ouvert", "Not opened yet")}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {SECTIONS.filter((section) => display.sections.includes(section.key)).map((section) => {
                    const Icon = section.icon;
                    return (
                      <span key={section.key} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">
                        <Icon className="size-3.5" />
                        {fr ? section.fr : section.en}
                      </span>
                    );
                  })}
                  {display.videoDocumentIds.length ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-600 dark:text-violet-300">
                      <Film className="size-3.5" />
                      {display.videoDocumentIds.length} {tr(fr, "vidéo(s)", "video(s)")}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-secondary">{display.rotateSeconds} s</span>
                </div>
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{screenUrl(display.token)}</p>
                  <Button size="icon-sm" variant="ghost" title={tr(fr, "Copier le lien", "Copy link")} onClick={() => void navigator.clipboard.writeText(screenUrl(display.token)).then(() => toast.success(tr(fr, "Lien copié", "Link copied")))}>
                    <Copy className="size-4" />
                  </Button>
                  <a href={`/display/${display.token}`} target="_blank" rel="noreferrer" title={tr(fr, "Ouvrir l’écran", "Open screen")} className="grid size-8 place-items-center rounded-lg text-ink-secondary hover:bg-surface-3 hover:text-ink">
                    <ExternalLink className="size-4" />
                  </a>
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                  <Button size="sm" variant="outline" onClick={() => setEditing(display)}>
                    <Pencil className="size-4" />
                    {tr(fr, "Modifier", "Edit")}
                  </Button>
                  <Button size="sm" variant="ghost" loading={toggleActive.isPending && toggleActive.variables?.id === display.id} onClick={() => toggleActive.mutate(display)}>
                    {display.isActive ? tr(fr, "Désactiver", "Disable") : tr(fr, "Activer", "Enable")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={tr(fr, "Nouveau lien secret (l’ancien cesse de fonctionner)", "New secret link")}
                    onClick={() => {
                      if (window.confirm(tr(fr, "Créer un nouveau lien ? L’écran actuel devra être rouvert avec le nouveau lien.", "Create a new link? The current screen must be reopened with it."))) regenerate.mutate(display.id);
                    }}
                  >
                    <RefreshCw className="size-4" />
                    {tr(fr, "Nouveau lien", "New link")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(tr(fr, `Supprimer l’écran « ${display.name} » ?`, `Delete screen “${display.name}”?`))) remove.mutate(display.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-[#071433] text-amber-300 shadow-lg animate-[lh-float_8s_ease-in-out_infinite]">
            <MonitorPlay className="size-7" />
          </span>
          <p className="mt-4 text-lg font-semibold text-ink">{tr(fr, "Aucun écran pour l’instant", "No screen yet")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{tr(fr, "Créez un écran, puis ouvrez son lien sur la TV du bureau ou de la ferme.", "Create a screen, then open its link on the office or farm TV.")}</p>
          <Button className="mt-4" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {tr(fr, "Créer un écran", "Create a screen")}
          </Button>
        </div>
      )}
      {editing ? <DisplayForm orgSlug={orgSlug} fr={fr} data={data} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
