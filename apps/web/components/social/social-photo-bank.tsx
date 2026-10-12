"use client";
/**
 * Banque photos of the social pages: drop many photos at once, tag a batch as
 * an event or a finished poster with its date, and keep the special days the
 * AI plans for. The AI uses never-published photos first.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, Check, Images, Loader2, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, del, get, orgUrl, post, put } from "@/lib/api";

type Kind = "normal" | "event" | "poster";
type Photo = {
  id: string;
  url: string;
  kind: Kind;
  eventName: string | null;
  eventDate: string | null;
  description: string | null;
  originalName: string | null;
  publishedCount: number;
  lastPublishedAt: string | null;
  reserved: boolean;
};
type SpecialDay = { id: string; name: string; month: number; day: number; year: number | null };
type Bank = { photos: Photo[]; specialDays: SpecialDay[] };

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const errorMessage = (error: unknown) =>
  (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
  (error instanceof Error ? error.message : "");
const inputClass = "h-9 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink";
const thumb = (url: string) => (/res\.cloudinary\.com\/.+\/upload\//.test(url) ? url.replace("/upload/", "/upload/c_fill,w_320,h_320,f_auto,q_auto/") : url);
const shortDate = (iso: string, fr: boolean) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "short" });

function KindFields({ fr, kind, setKind, name, setName, date, setDate }: { fr: boolean; kind: Kind; setKind: (kind: Kind) => void; name: string; setName: (v: string) => void; date: string; setDate: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["normal", tr(fr, "Normale", "Normal")],
            ["event", tr(fr, "Événement", "Event")],
            ["poster", tr(fr, "Affiche prête", "Ready poster")],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            type="button"
            onClick={() => setKind(key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${kind === key ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary hover:bg-surface-2"}`}
          >
            {text}
          </button>
        ))}
      </div>
      {kind !== "normal" ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={tr(fr, "Nom — ex. : Salon agricole Kinshasa", "Name — e.g. Farm fair")} className={inputClass} />
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </div>
      ) : null}
      <p className="text-[11px] leading-4 text-ink-muted">
        {kind === "normal"
          ? tr(fr, "L’IA l’utilise librement, en commençant par les photos jamais publiées.", "The AI uses it freely, never-published photos first.")
          : kind === "event"
            ? tr(fr, "Gardée pour cet événement : l’IA l’utilise seulement à cette date (avec une affiche IA si vous le choisissez).", "Kept for this event: used only on that date.")
            : tr(fr, "Affiche déjà faite : publiée telle quelle à cette date, l’IA écrit seulement le texte.", "Finished poster: published as it is on that date.")}
      </p>
    </div>
  );
}

export function PhotoBank({ orgSlug, fr, onClose }: { orgSlug: string; fr: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const key = ["social-photos", orgSlug];
  const bank = useQuery({ queryKey: key, queryFn: () => get<Bank>(orgUrl(orgSlug, "social/photos")) });
  const [kind, setKind] = useState<Kind>("normal");
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<"all" | "new" | "used" | "event">("all");
  const [editing, setEditing] = useState<Photo | null>(null);
  const [dayName, setDayName] = useState("");
  const [dayDate, setDayDate] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (data: Bank) => client.setQueryData(key, data);

  const upload = async (picked: File[]) => {
    if (!picked.length) return;
    if (picked.length > 20) toast.info(tr(fr, "20 photos au maximum à la fois : les 20 premières sont envoyées.", "Up to 20 photos at once."));
    if (kind !== "normal" && !eventDate) {
      toast.error(tr(fr, "Choisissez d’abord la date de l’événement.", "Pick the event date first."));
      return;
    }
    setUploading(true);
    try {
      const list = picked.slice(0, 20);
      // Several small requests: a phone connection rarely carries 20 photos in one go.
      for (let start = 0; start < list.length; start += 5) {
        const form = new FormData();
        list.slice(start, start + 5).forEach((file) => form.append("files", file));
        form.append("kind", kind);
        if (kind !== "normal") {
          form.append("eventName", eventName);
          form.append("eventDate", eventDate);
        }
        const { data } = await api.post<Bank>(orgUrl(orgSlug, "social/photos"), form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 180_000 });
        set(data);
      }
      toast.success(tr(fr, `${list.length} photo(s) ajoutée(s).`, `${list.length} photo(s) added.`));
    } catch (error) {
      toast.error(errorMessage(error) || tr(fr, "Envoi refusé.", "Upload refused."));
    } finally {
      setUploading(false);
    }
  };

  const save = useMutation({
    mutationFn: (photo: Photo) => put<Bank>(orgUrl(orgSlug, `social/photos/${photo.id}`), { kind: photo.kind, eventName: photo.eventName, eventDate: photo.eventDate }),
    onSuccess: (data) => {
      set(data);
      setEditing(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del<Bank>(orgUrl(orgSlug, `social/photos/${id}`)),
    onSuccess: set,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const addDay = useMutation({
    mutationFn: () => post<Bank>(orgUrl(orgSlug, "social/special-days"), { name: dayName, date: dayDate, everyYear: true }),
    onSuccess: (data) => {
      set(data);
      setDayName("");
      setDayDate("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const removeDay = useMutation({
    mutationFn: (id: string) => del<Bank>(orgUrl(orgSlug, `social/special-days/${id}`)),
    onSuccess: set,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const photos = bank.data?.photos ?? [];
  const counts = {
    all: photos.length,
    new: photos.filter((photo) => photo.kind === "normal" && !photo.publishedCount && !photo.reserved).length,
    used: photos.filter((photo) => photo.publishedCount > 0).length,
    event: photos.filter((photo) => photo.kind !== "normal").length,
  };
  const shown = photos.filter((photo) =>
    filter === "all" ? true : filter === "new" ? photo.kind === "normal" && !photo.publishedCount && !photo.reserved : filter === "used" ? photo.publishedCount > 0 : photo.kind !== "normal",
  );

  return (
    <section className="space-y-4 rounded-3xl border border-emerald-500/30 bg-[linear-gradient(140deg,rgba(16,185,129,.08),transparent_55%),var(--surface-1)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <Images className="size-4 text-emerald-600" />
            {tr(fr, "Banque photos", "Photo bank")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {tr(
              fr,
              "Déposez vos photos ici, c’est tout. L’IA les regarde, écrit les textes et publie d’abord les photos jamais publiées.",
              "Drop your photos here. The AI looks at them, writes the posts and publishes never-used photos first.",
            )}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-secondary hover:bg-surface-3" aria-label={tr(fr, "Fermer", "Close")}>
          <X className="size-4" />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <div className="space-y-3 rounded-2xl border border-dashed border-emerald-500/40 bg-surface-1 p-3">
            <KindFields fr={fr} kind={kind} setKind={setKind} name={eventName} setName={setEventName} date={eventDate} setDate={setEventDate} />
            <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" loading={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" />
              {uploading ? tr(fr, "Envoi des photos…", "Uploading…") : tr(fr, "Ajouter des photos (jusqu’à 20 à la fois)", "Add photos (up to 20 at once)")}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.currentTarget.value = "";
                void upload(files);
              }}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", tr(fr, "Toutes", "All")],
                ["new", tr(fr, "Jamais publiées", "Never published")],
                ["used", tr(fr, "Déjà publiées", "Published")],
                ["event", tr(fr, "Événements / affiches", "Events / posters")],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filter === value ? "bg-ink text-surface-1" : "bg-surface-3 text-ink-secondary hover:bg-surface-2"}`}
              >
                {text} <span className="opacity-70">{counts[value]}</span>
              </button>
            ))}
          </div>

          {bank.isLoading ? (
            <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-ink-muted" /></div>
          ) : shown.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
              {shown.map((photo) => (
                <figure key={photo.id} className="group relative overflow-hidden rounded-xl bg-surface-3 ring-1 ring-border">
                  <img src={thumb(photo.url)} alt={photo.description ?? ""} title={photo.description ?? photo.originalName ?? ""} loading="lazy" className="aspect-square w-full object-cover" />
                  <span
                    className={`absolute left-1.5 top-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full px-2 py-0.5 text-[10px] font-bold shadow ${
                      photo.kind === "poster"
                        ? "bg-fuchsia-600 text-white"
                        : photo.kind === "event"
                          ? "bg-amber-400 text-amber-950"
                          : photo.reserved
                            ? "bg-sky-500 text-white"
                            : photo.publishedCount
                              ? "bg-black/60 text-white"
                              : "bg-emerald-500 text-white"
                    }`}
                  >
                    {photo.kind === "poster"
                      ? `${tr(fr, "Affiche", "Poster")} · ${photo.eventDate ? shortDate(photo.eventDate, fr) : ""}`
                      : photo.kind === "event"
                        ? `${photo.eventName || tr(fr, "Événement", "Event")} · ${photo.eventDate ? shortDate(photo.eventDate, fr) : ""}`
                        : photo.reserved
                          ? tr(fr, "Prévue", "Planned")
                          : photo.publishedCount
                            ? `${tr(fr, "Publiée", "Published")} ${photo.lastPublishedAt ? shortDate(photo.lastPublishedAt, fr) : ""}`
                            : tr(fr, "Nouvelle", "New")}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                    <button type="button" onClick={() => setEditing(photo)} className="grid size-7 place-items-center rounded-lg bg-white/90 text-slate-800" aria-label={tr(fr, "Modifier", "Edit")}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(tr(fr, "Retirer cette photo de la banque ?", "Remove this photo?"))) remove.mutate(photo.id);
                      }}
                      className="grid size-7 place-items-center rounded-lg bg-white/90 text-critical"
                      aria-label={tr(fr, "Supprimer", "Delete")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </figure>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
              {tr(fr, "Aucune photo ici pour l’instant.", "No photos here yet.")}
            </p>
          )}

          {editing ? (
            <div className="space-y-3 rounded-2xl border border-border bg-surface-1 p-3">
              <div className="flex items-center gap-3">
                <img src={thumb(editing.url)} alt="" className="size-14 rounded-lg object-cover" />
                <p className="min-w-0 flex-1 text-xs leading-5 text-ink-secondary">
                  {editing.description ?? tr(fr, "L’IA décrira cette photo au prochain plan.", "The AI will describe this photo at the next plan.")}
                </p>
              </div>
              <KindFields
                fr={fr}
                kind={editing.kind}
                setKind={(next) => setEditing({ ...editing, kind: next })}
                name={editing.eventName ?? ""}
                setName={(next) => setEditing({ ...editing, eventName: next })}
                date={editing.eventDate ?? ""}
                setDate={(next) => setEditing({ ...editing, eventDate: next || null })}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{tr(fr, "Annuler", "Cancel")}</Button>
                <Button size="sm" loading={save.isPending} disabled={editing.kind !== "normal" && !editing.eventDate} onClick={() => save.mutate(editing)}>
                  <Check className="size-4" />
                  {tr(fr, "Enregistrer", "Save")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="h-fit space-y-3 rounded-2xl border border-border bg-surface-1 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <CalendarHeart className="size-4 text-rose-500" />
            {tr(fr, "Jours spéciaux", "Special days")}
          </p>
          <p className="text-[11px] leading-4 text-ink-muted">
            {tr(fr, "Chaque année, l’IA prévoit une publication ces jours-là (avec une affiche IA si vous le choisissez dans le plan).", "Each year, the AI plans a post on these days.")}
          </p>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {(bank.data?.specialDays ?? []).map((day) => (
              <li key={day.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="w-16 shrink-0 text-xs font-semibold text-rose-600">{new Date(2024, day.month - 1, day.day).toLocaleDateString(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "short" })}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{day.name}</span>
                <button type="button" onClick={() => removeDay.mutate(day.id)} className="rounded p-1 text-ink-muted hover:bg-surface-3 hover:text-critical" aria-label={tr(fr, "Retirer", "Remove")}>
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t border-border pt-3">
            <input value={dayName} maxLength={120} onChange={(event) => setDayName(event.target.value)} placeholder={tr(fr, "Ex. : Anniversaire Congo Omega", "E.g. company anniversary")} className={inputClass} />
            <div className="flex gap-2">
              <input type="date" value={dayDate} onChange={(event) => setDayDate(event.target.value)} className={inputClass} />
              <Button size="sm" loading={addDay.isPending} disabled={dayName.trim().length < 2 || !dayDate} onClick={() => addDay.mutate()}>
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
