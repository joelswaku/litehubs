"use client";
/**
 * AI tools of the social page:
 *  - ContentPlanForm: the AI writes several posts as drafts with dates;
 *    nothing is published before a manager approves them.
 *  - AdCopyForm: ad texts and an audience suggestion to paste into Meta Ads
 *    Manager; nothing is published or paid from LiteHubs.
 *  - PostEditor: edit a draft or scheduled post (text, photo, date, networks).
 */
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, Copy, ImagePlus, Megaphone, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, orgUrl, patch, post } from "@/lib/api";

export type SocialPost = {
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
};
type PostList = { posts: SocialPost[] };

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const errorMessage = (error: unknown) =>
  (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
  (error instanceof Error ? error.message : "");
const inputClass = "h-9 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink";
const areaClass = "w-full rounded-xl border border-border-strong bg-surface-1 px-3 py-2 text-sm text-ink";
const labelClass = "mb-1 block text-xs font-semibold text-ink-secondary";

/** ISO date → value for <input type="datetime-local"> in the browser's zone. */
export function toLocalInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
const tomorrow = () => {
  const date = new Date(Date.now() + 86_400_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export function ContentPlanForm({
  orgSlug,
  fr,
  hasInstagram,
  onDone,
  onClose,
}: {
  orgSlug: string;
  fr: boolean;
  hasInstagram: boolean;
  onDone: (data: PostList) => void;
  onClose: () => void;
}) {
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(3);
  const [startDate, setStartDate] = useState(tomorrow());
  const [everyDays, setEveryDays] = useState(2);
  const [time, setTime] = useState("09:00");
  const [tone, setTone] = useState("friendly");
  const [toFacebook, setToFacebook] = useState(true);
  const [toInstagram, setToInstagram] = useState(hasInstagram);
  const generate = useMutation({
    mutationFn: () =>
      post<PostList & { created: number }>(orgUrl(orgSlug, "social/ai/plan"), {
        brief,
        count,
        startDate,
        everyDays,
        time,
        tone,
        toFacebook,
        toInstagram,
        timeZoneOffsetMinutes: new Date(`${startDate}T${time}`).getTimezoneOffset(),
      }),
    onSuccess: (data) => {
      onDone(data);
      toast.success(
        tr(fr, `${data.created} brouillon(s) prêts : relisez-les puis approuvez.`, `${data.created} draft(s) ready: review, then approve.`),
      );
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <section className="space-y-3 rounded-2xl border border-brand/30 bg-[linear-gradient(140deg,rgba(20,184,166,.08),transparent_55%),var(--surface-1)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-semibold text-ink">
            <Sparkles className="size-4 text-brand" />
            {tr(fr, "Plan de publications IA", "AI content plan")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {tr(
              fr,
              "L’IA rédige les publications avec vos produits et vos photos. Elles restent en brouillon : vous les relisez, puis « Approuver » les publie automatiquement aux dates prévues.",
              "The AI writes the posts using your products and photos. They stay drafts: review them, then “Approve” publishes them automatically on their dates.",
            )}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-secondary hover:bg-surface-3" aria-label={tr(fr, "Fermer", "Close")}>
          <X className="size-4" />
        </button>
      </div>
      <div>
        <label className={labelClass} htmlFor="plan-brief">
          {tr(fr, "Sujet de la campagne", "Campaign topic")}
        </label>
        <textarea
          id="plan-brief"
          rows={4}
          maxLength={2000}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          className={areaClass}
          placeholder={tr(
            fr,
            "Ex. : Poulets de chair disponibles cette semaine à Kinshasa, livraison possible. Mettre en avant la qualité de l’élevage et la fraîcheur. Commandes par message privé.",
            "E.g. broiler chickens available this week, delivery possible. Orders by private message.",
          )}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="plan-count">{tr(fr, "Nombre de publications", "Number of posts")}</label>
          <select id="plan-count" value={count} onChange={(event) => setCount(Number(event.target.value))} className={inputClass}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="plan-start">{tr(fr, "Première publication", "First post")}</label>
          <input id="plan-start" type="date" value={startDate} min={tomorrow()} onChange={(event) => setStartDate(event.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="plan-time">{tr(fr, "Heure", "Time")}</label>
          <input id="plan-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="plan-every">{tr(fr, "Rythme", "Frequency")}</label>
          <select id="plan-every" value={everyDays} onChange={(event) => setEveryDays(Number(event.target.value))} className={inputClass}>
            <option value={1}>{tr(fr, "Chaque jour", "Every day")}</option>
            <option value={2}>{tr(fr, "Tous les 2 jours", "Every 2 days")}</option>
            <option value={3}>{tr(fr, "Tous les 3 jours", "Every 3 days")}</option>
            <option value={7}>{tr(fr, "Chaque semaine", "Every week")}</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="plan-tone">{tr(fr, "Ton", "Tone")}</label>
          <select id="plan-tone" value={tone} onChange={(event) => setTone(event.target.value)} className={inputClass}>
            <option value="friendly">{tr(fr, "Chaleureux", "Friendly")}</option>
            <option value="professional">{tr(fr, "Professionnel", "Professional")}</option>
            <option value="promotional">{tr(fr, "Commercial (vente)", "Promotional")}</option>
            <option value="educational">{tr(fr, "Conseils / éducatif", "Educational")}</option>
          </select>
        </div>
        <div className="flex items-end gap-3 pb-1.5 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={toFacebook} onChange={(event) => setToFacebook(event.target.checked)} />
            Facebook
          </label>
          <label className={`inline-flex items-center gap-2 ${hasInstagram ? "" : "opacity-50"}`}>
            <input type="checkbox" disabled={!hasInstagram} checked={toInstagram} onChange={(event) => setToInstagram(event.target.checked)} />
            Instagram
          </label>
        </div>
      </div>
      <p className="text-xs leading-5 text-ink-muted">
        {tr(
          fr,
          "Photos : l’IA choisit parmi les photos de vos produits de la boutique et de la médiathèque du site. Une publication sans photo ne part que sur Facebook.",
          "Photos: the AI picks from your shop products and website media. A post without a photo goes to Facebook only.",
        )}
      </p>
      <Button className="w-full" loading={generate.isPending} disabled={brief.trim().length < 5 || (!toFacebook && !toInstagram)} onClick={() => generate.mutate()}>
        <Sparkles className="size-4" />
        {generate.isPending ? tr(fr, "L’IA rédige…", "Writing…") : tr(fr, `Préparer ${count} publication(s)`, `Prepare ${count} post(s)`)}
      </Button>
    </section>
  );
}

type AdCopy = {
  variants: { headline: string; primaryText: string; description: string }[];
  audience: { locations: string; ageRange: string; interests: string[]; notes: string };
  callToAction: string;
  tips: string[];
};

function CopyButton({ value, fr }: { value: string; fr: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => toast.success(tr(fr, "Copié", "Copied")));
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-ink-secondary hover:bg-surface-2"
    >
      <Copy className="size-3" />
      {tr(fr, "Copier", "Copy")}
    </button>
  );
}

export function AdCopyForm({ orgSlug, fr, onClose }: { orgSlug: string; fr: boolean; onClose: () => void }) {
  const [brief, setBrief] = useState("");
  const [objective, setObjective] = useState("messages");
  const [audienceHint, setAudienceHint] = useState("");
  const generate = useMutation({
    mutationFn: () => post<AdCopy>(orgUrl(orgSlug, "social/ai/ad"), { brief, objective, audienceHint }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const result = generate.data;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-semibold text-ink">
            <Megaphone className="size-4 text-brand" />
            {tr(fr, "Texte de publicité IA", "AI ad copy")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {tr(
              fr,
              "L’IA prépare l’annonce et le public conseillé. Vous la lancez ensuite vous-même dans Meta Ads Manager, avec votre budget : rien n’est payé depuis LiteHubs.",
              "The AI prepares the ad and suggested audience. You then launch it yourself in Meta Ads Manager with your budget: nothing is paid from LiteHubs.",
            )}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-secondary hover:bg-surface-3" aria-label={tr(fr, "Fermer", "Close")}>
          <X className="size-4" />
        </button>
      </div>
      <div>
        <label className={labelClass} htmlFor="ad-brief">{tr(fr, "Que voulez-vous promouvoir ?", "What do you want to promote?")}</label>
        <textarea
          id="ad-brief"
          rows={3}
          maxLength={2000}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          className={areaClass}
          placeholder={tr(fr, "Ex. : Œufs frais en plateau de 30, livraison à Kinshasa, commandes sur Messenger ou WhatsApp.", "E.g. fresh eggs, trays of 30, delivery in Kinshasa.")}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="ad-objective">{tr(fr, "Objectif", "Objective")}</label>
          <select id="ad-objective" value={objective} onChange={(event) => setObjective(event.target.value)} className={inputClass}>
            <option value="messages">{tr(fr, "Recevoir des messages", "Get messages")}</option>
            <option value="sales">{tr(fr, "Vendre", "Sales")}</option>
            <option value="traffic">{tr(fr, "Visites du site / boutique", "Website traffic")}</option>
            <option value="awareness">{tr(fr, "Faire connaître la marque", "Awareness")}</option>
            <option value="leads">{tr(fr, "Collecter des contacts", "Leads")}</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="ad-audience">{tr(fr, "Public visé (facultatif)", "Target audience (optional)")}</label>
          <input id="ad-audience" value={audienceHint} maxLength={500} onChange={(event) => setAudienceHint(event.target.value)} className={inputClass} placeholder={tr(fr, "Ex. : restaurants et familles de Kinshasa", "E.g. restaurants and families")} />
        </div>
      </div>
      <Button className="w-full" loading={generate.isPending} disabled={brief.trim().length < 5} onClick={() => generate.mutate()}>
        <Sparkles className="size-4" />
        {result ? tr(fr, "Proposer d’autres textes", "Suggest other texts") : tr(fr, "Préparer l’annonce", "Prepare the ad")}
      </Button>
      {result ? (
        <div className="space-y-3 border-t border-border pt-3">
          {result.variants.map((variant, index) => (
            <article key={index} className="space-y-2 rounded-xl border border-border bg-surface-2/40 p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{tr(fr, `Variante ${index + 1}`, `Variant ${index + 1}`)}</p>
              {(
                [
                  [tr(fr, "Titre", "Headline"), variant.headline],
                  [tr(fr, "Texte principal", "Primary text"), variant.primaryText],
                  [tr(fr, "Description", "Description"), variant.description],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-ink-secondary">{label}</p>
                    <p className="whitespace-pre-wrap text-ink">{value}</p>
                  </div>
                  <CopyButton value={value} fr={fr} />
                </div>
              ))}
            </article>
          ))}
          <div className="rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold text-ink">{tr(fr, "Public conseillé", "Suggested audience")}</p>
            <ul className="mt-1 space-y-0.5 text-ink-secondary">
              <li>{tr(fr, "Lieux", "Locations")} : {result.audience.locations}</li>
              <li>{tr(fr, "Âge", "Age")} : {result.audience.ageRange}</li>
              <li>{tr(fr, "Centres d’intérêt", "Interests")} : {result.audience.interests.join(", ")}</li>
              {result.audience.notes ? <li>{result.audience.notes}</li> : null}
            </ul>
            <p className="mt-2 text-ink-secondary">
              {tr(fr, "Bouton conseillé", "Suggested button")} : <b className="text-ink">{result.callToAction}</b>
            </p>
          </div>
          {result.tips.length ? (
            <div className="rounded-xl border border-border p-3 text-sm">
              <p className="font-semibold text-ink">{tr(fr, "Conseils", "Tips")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-secondary">
                {result.tips.map((tip, index) => (
                  <li key={index}>{tip}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <a
            href="https://adsmanager.facebook.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
          >
            {tr(fr, "Ouvrir Meta Ads Manager →", "Open Meta Ads Manager →")}
          </a>
        </div>
      ) : null}
    </section>
  );
}

export function PostEditor({
  orgSlug,
  fr,
  item,
  hasInstagram,
  onSaved,
  onClose,
}: {
  orgSlug: string;
  fr: boolean;
  item: SocialPost;
  hasInstagram: boolean;
  onSaved: (data: PostList) => void;
  onClose: () => void;
}) {
  const [message, setMessage] = useState(item.message);
  const [imageUrl, setImageUrl] = useState(item.imageUrl);
  const [toFacebook, setToFacebook] = useState(item.toFacebook);
  const [toInstagram, setToInstagram] = useState(item.toInstagram);
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(item.scheduledAt));
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: () =>
      patch<PostList>(orgUrl(orgSlug, `social/posts/${item.id}`), {
        message,
        imageUrl,
        toFacebook,
        toInstagram,
        scheduledAt: new Date(scheduledAt).toISOString(),
      }),
    onSuccess: (data) => {
      onSaved(data);
      toast.success(tr(fr, "Publication modifiée.", "Post updated."));
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post<{ url: string }>(orgUrl(orgSlug, "social/images"), form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImageUrl(data.url);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <textarea rows={7} maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} className={areaClass} />
      {imageUrl ? (
        <div className="relative w-fit">
          <img src={imageUrl} alt="" className="max-h-40 rounded-lg object-cover" />
          <button
            type="button"
            onClick={() => {
              setImageUrl(null);
              setToInstagram(false);
            }}
            className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
            aria-label={tr(fr, "Retirer la photo", "Remove photo")}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
          <ImagePlus className="size-4" />
          {imageUrl ? tr(fr, "Changer la photo", "Change photo") : tr(fr, "Ajouter une photo", "Add photo")}
        </Button>
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
        <label className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-4 text-ink-secondary" />
          <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="h-8 rounded-lg border border-border-strong bg-surface-1 px-2 text-sm text-ink" />
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={toFacebook} onChange={(event) => setToFacebook(event.target.checked)} />
          Facebook
        </label>
        <label className={`inline-flex items-center gap-1.5 ${hasInstagram && imageUrl ? "" : "opacity-50"}`}>
          <input type="checkbox" disabled={!hasInstagram || !imageUrl} checked={toInstagram} onChange={(event) => setToInstagram(event.target.checked)} />
          Instagram
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          {tr(fr, "Annuler", "Cancel")}
        </Button>
        <Button size="sm" loading={save.isPending} disabled={(!toFacebook && !toInstagram) || (!message.trim() && !imageUrl) || !scheduledAt} onClick={() => save.mutate()}>
          {tr(fr, "Enregistrer", "Save")}
        </Button>
      </div>
    </div>
  );
}
