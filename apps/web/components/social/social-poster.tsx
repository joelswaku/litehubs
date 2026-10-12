"use client";
/**
 * « Affiche IA »: the manager picks real photos and a style; the AI composes a
 * branded poster (logo, headline, website, flag). The poster is saved in the
 * website images and, when opened from a draft, attached to that post.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Download, ImagePlus, Loader2, Palette, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, get, orgUrl, post } from "@/lib/api";

type Options = { images: { title: string; url: string }[]; logoUrl: string | null; website: string | null; enabled: boolean };
type Style = "nature" | "premium" | "collage" | "bold";
type Format = "portrait" | "square";

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const errorMessage = (error: unknown) =>
  (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
  (error instanceof Error ? error.message : "");
const inputClass = "h-10 w-full rounded-xl border border-border-strong bg-surface-1 px-3 text-sm text-ink";
const thumb = (url: string) => (/res\.cloudinary\.com\/.+\/upload\//.test(url) ? url.replace("/upload/", "/upload/c_fill,w_240,h_240,f_auto,q_auto/") : url);

const STYLES: { key: Style; fr: string; en: string; hint: string; swatch: string }[] = [
  { key: "nature", fr: "Nature", en: "Nature", hint: "Vert, lumière du jour, feuilles", swatch: "from-emerald-500 to-lime-400" },
  { key: "premium", fr: "Premium", en: "Premium", hint: "Vert profond et or, élégant", swatch: "from-emerald-900 to-amber-400" },
  { key: "collage", fr: "Collage", en: "Collage", hint: "Plusieurs photos côte à côte", swatch: "from-sky-500 to-emerald-500" },
  { key: "bold", fr: "Publicité", en: "Bold ad", hint: "Formes vert/jaune, très dynamique", swatch: "from-yellow-400 to-green-700" },
];

export function PosterStudio({
  orgSlug,
  fr,
  postId,
  defaultHeadline,
  onDone,
  onUse,
  onClose,
}: {
  orgSlug: string;
  fr: boolean;
  postId?: string;
  defaultHeadline?: string;
  onDone?: () => void;
  onUse?: (url: string) => void;
  onClose: () => void;
}) {
  const options = useQuery({ queryKey: ["social-poster-options", orgSlug], queryFn: () => get<Options>(orgUrl(orgSlug, "social/ai/poster")) });
  const [uploaded, setUploaded] = useState<{ title: string; url: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [headline, setHeadline] = useState(defaultHeadline ?? "");
  const [tagline, setTagline] = useState("Agriculture • Élevage • Développement");
  const [details, setDetails] = useState("");
  const [style, setStyle] = useState<Style>("nature");
  const [format, setFormat] = useState<Format>("portrait");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const images = [...uploaded, ...(options.data?.images ?? [])];
  const toggle = (url: string) =>
    setSelected((current) => (current.includes(url) ? current.filter((item) => item !== url) : current.length >= 4 ? current : [...current, url]));

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 4)) {
        const form = new FormData();
        form.append("file", file);
        const { data } = await api.post<{ url: string }>(orgUrl(orgSlug, "social/images"), form, { headers: { "Content-Type": "multipart/form-data" } });
        setUploaded((current) => [{ title: file.name, url: data.url }, ...current]);
        setSelected((current) => (current.length >= 4 ? current : [...current, data.url]));
      }
    } catch (error) {
      toast.error(errorMessage(error) || tr(fr, "Photo refusée.", "Photo refused."));
    } finally {
      setUploading(false);
    }
  };

  const create = useMutation({
    mutationFn: () =>
      post<{ poster: { url: string } }>(
        orgUrl(orgSlug, "social/ai/poster"),
        {
          imageUrls: selected,
          headline: headline.trim() || undefined,
          tagline: tagline.trim() || undefined,
          details: details.trim() || undefined,
          style,
          format,
          postId,
        },
        { timeout: 300_000 },
      ),
    onSuccess: (data) => {
      setResult(data.poster.url);
      onDone?.();
      toast.success(
        postId
          ? tr(fr, "Affiche créée et ajoutée à la publication.", "Poster created and attached to the post.")
          : tr(fr, "Affiche créée. Elle est aussi gardée dans les images du site.", "Poster created and saved in the website images."),
      );
    },
    onError: (error) => toast.error(errorMessage(error) || tr(fr, "La création a échoué.", "Creation failed.")),
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="flex max-h-[96dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-border bg-surface-1 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-[linear-gradient(135deg,rgba(16,185,129,.12),rgba(250,204,21,.12))] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-600 to-yellow-400 text-white shadow-lg">
              <Wand2 className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">{tr(fr, "Affiche IA", "AI poster")}</p>
              <p className="truncate text-xs text-ink-secondary">
                {tr(fr, "Vos vraies photos + votre logo → une affiche professionnelle", "Your real photos + your logo → a professional poster")}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-secondary hover:bg-surface-3" aria-label={tr(fr, "Fermer", "Close")}>
            <X className="size-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5 p-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-ink-secondary">
                  {tr(fr, "1. Choisissez 1 à 4 photos", "1. Pick 1 to 4 photos")} <span className="text-ink-muted">({selected.length}/4)</span>
                </p>
                <Button size="sm" variant="outline" loading={uploading} onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="size-4" />
                  {tr(fr, "Ajouter des photos", "Add photos")}
                </Button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => { void upload(event.target.files); event.currentTarget.value = ""; }} />
              </div>
              <div className="mt-2 grid max-h-64 grid-cols-4 gap-2 overflow-y-auto rounded-2xl border border-border p-2 sm:grid-cols-5">
                {options.isLoading ? (
                  <p className="col-span-full p-4 text-center text-xs text-ink-muted">{tr(fr, "Chargement des photos…", "Loading photos…")}</p>
                ) : images.length ? (
                  images.map((image) => {
                    const index = selected.indexOf(image.url);
                    return (
                      <button
                        key={image.url}
                        type="button"
                        title={image.title}
                        onClick={() => toggle(image.url)}
                        className={`relative aspect-square overflow-hidden rounded-xl ring-2 transition ${index >= 0 ? "ring-emerald-500" : "ring-transparent hover:ring-border-strong"}`}
                      >
                        <img src={thumb(image.url)} alt={image.title} className="size-full object-cover" loading="lazy" />
                        {index >= 0 ? (
                          <span className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-emerald-500 text-xs font-bold text-white shadow">{index + 1}</span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <p className="col-span-full p-4 text-center text-xs text-ink-muted">
                    {tr(fr, "Aucune photo pour l’instant : ajoutez vos photos.", "No photos yet: add your photos.")}
                  </p>
                )}
              </div>
              {!options.data?.logoUrl && options.data ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  {tr(fr, "Aucun logo dans les Paramètres : l’IA écrira seulement le nom de l’entreprise.", "No logo in Settings: the AI will only write the company name.")}
                </p>
              ) : null}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold text-ink-secondary">{tr(fr, "2. Textes de l’affiche", "2. Poster text")}</p>
              <input value={headline} maxLength={80} onChange={(event) => setHeadline(event.target.value)} placeholder={tr(fr, "Titre — ex. : Ensemble, cultivons l’avenir", "Headline")} className={inputClass} />
              <input value={tagline} maxLength={140} onChange={(event) => setTagline(event.target.value)} placeholder={tr(fr, "Sous-titre", "Tagline")} className={inputClass} />
              <input value={details} maxLength={300} onChange={(event) => setDetails(event.target.value)} placeholder={tr(fr, "Info (facultatif) — ex. : Poulets de chair disponibles · 8 500 FC", "Info (optional)")} className={inputClass} />
              <p className="text-xs text-ink-muted">
                {tr(fr, "Gardez des textes courts : l’IA écrit exactement ces mots. Le site web", "Keep text short. The website")}
                {options.data?.website ? ` (${options.data.website})` : ""} {tr(fr, "est ajouté en bas.", "is added at the bottom.")}
              </p>
            </div>

            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
                <Palette className="size-3.5" />
                {tr(fr, "3. Style et format", "3. Style and format")}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {STYLES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setStyle(item.key)}
                    className={`rounded-xl border p-2 text-left transition ${style === item.key ? "border-brand bg-brand/10" : "border-border hover:bg-surface-2"}`}
                  >
                    <span className={`block h-8 rounded-lg bg-gradient-to-br ${item.swatch}`} />
                    <span className="mt-1.5 block text-sm font-semibold text-ink">{fr ? item.fr : item.en}</span>
                    <span className="block text-[11px] leading-4 text-ink-muted">{item.hint}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                {(
                  [
                    ["portrait", tr(fr, "Portrait (Facebook / Instagram)", "Portrait")],
                    ["square", tr(fr, "Carré", "Square")],
                  ] as const
                ).map(([key, text]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFormat(key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${format === key ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary hover:bg-surface-2"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3 border-t border-border bg-surface-2/60 p-5 lg:border-l lg:border-t-0">
            <p className="text-xs font-semibold text-ink-secondary">{tr(fr, "Résultat", "Result")}</p>
            <div className={`relative grid flex-1 place-items-center overflow-hidden rounded-2xl border border-dashed border-border-strong bg-surface-1 ${format === "portrait" ? "min-h-[22rem]" : "min-h-[18rem]"}`}>
              {create.isPending ? (
                <div className="p-6 text-center">
                  <Loader2 className="mx-auto size-8 animate-spin text-brand" />
                  <p className="mt-3 text-sm font-semibold text-ink">{tr(fr, "L’IA crée votre affiche…", "The AI is creating your poster…")}</p>
                  <p className="mt-1 text-xs text-ink-muted">{tr(fr, "Cela prend de 30 secondes à 2 minutes. Gardez cette fenêtre ouverte.", "This takes 30 seconds to 2 minutes.")}</p>
                </div>
              ) : result ? (
                <img src={result} alt={tr(fr, "Affiche créée", "Created poster")} className="max-h-[60dvh] w-full object-contain" />
              ) : (
                <div className="p-6 text-center text-ink-muted">
                  <Sparkles className="mx-auto size-8" />
                  <p className="mt-2 text-sm">{tr(fr, "Votre affiche apparaîtra ici.", "Your poster will appear here.")}</p>
                </div>
              )}
            </div>
            {result ? (
              <div className="flex flex-wrap gap-2">
                {postId ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <Check className="size-3.5" />
                    {tr(fr, "Ajoutée à la publication", "Attached to the post")}
                  </span>
                ) : onUse ? (
                  <Button size="sm" onClick={() => { onUse(result); onClose(); }}>
                    <Check className="size-4" />
                    {tr(fr, "Utiliser pour une publication", "Use in a post")}
                  </Button>
                ) : null}
                <a href={result} target="_blank" rel="noreferrer" download className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-ink hover:bg-surface-3">
                  <Download className="size-3.5" />
                  {tr(fr, "Ouvrir / télécharger", "Open / download")}
                </a>
              </div>
            ) : null}
            <Button disabled={!selected.length || create.isPending || options.data?.enabled === false} loading={create.isPending} onClick={() => create.mutate()} className="bg-[linear-gradient(135deg,#047857,#ca8a04)] text-white hover:brightness-110">
              <Wand2 className="size-4" />
              {result ? tr(fr, "Créer une autre version", "Create another version") : tr(fr, "Créer l’affiche", "Create the poster")}
            </Button>
            <p className="text-[11px] leading-4 text-ink-muted">
              {tr(
                fr,
                "Vérifiez toujours l’orthographe et le logo avant d’approuver. Chaque affiche est une image IA payante (limite : 20 par heure).",
                "Always check spelling and logo before approving. Each poster is a paid AI image (limit 20 per hour).",
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
