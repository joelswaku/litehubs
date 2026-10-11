"use client";
/**
 * What a queue TV shows while nobody waits: company videos, farm statistics
 * and a scrolling message — the same options as a display screen.
 */
import { Bird, Film, PiggyBank, Sprout } from "lucide-react";

export type IdleSection = "poultry" | "pigs" | "agriculture";
export type IdleScreenValue = {
  siteId: string | null;
  sections: IdleSection[];
  videoDocumentIds: string[];
  rotateSeconds: number;
  videosBetween: boolean;
  message: string;
};
export type IdleVideo = { id: string; title: string; sizeBytes: number };

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const SECTIONS: { key: IdleSection; fr: string; en: string; icon: typeof Bird }[] = [
  { key: "poultry", fr: "Volaille", en: "Poultry", icon: Bird },
  { key: "pigs", fr: "Porcs", en: "Pigs", icon: PiggyBank },
  { key: "agriculture", fr: "Agriculture", en: "Crops", icon: Sprout },
];
const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

export function IdleScreenFields({
  fr,
  value,
  onChange,
  videos,
  sites,
}: {
  fr: boolean;
  value: IdleScreenValue;
  onChange: (next: IdleScreenValue) => void;
  videos: IdleVideo[];
  sites: { id: string; name: string }[];
}) {
  const set = (patch: Partial<IdleScreenValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-5">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
          <Film className="size-3.5" />
          {tr(fr, "Vidéos", "Videos")}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {tr(fr, "Cochez une ou plusieurs vidéos. Importez vos vidéos MP4 ou WebM dans Documents.", "Tick one or more videos. Upload MP4 or WebM videos in Documents.")}
        </p>
        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border bg-surface-1 p-2">
          {videos.length ? (
            videos.map((video) => (
              <label key={video.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="size-4 accent-brand"
                  checked={value.videoDocumentIds.includes(video.id)}
                  onChange={() => set({ videoDocumentIds: toggle(value.videoDocumentIds, video.id) })}
                />
                <span className="truncate">{video.title}</span>
                <span className="ml-auto shrink-0 text-xs text-ink-muted">{(video.sizeBytes / 1_048_576).toFixed(1)} Mo</span>
              </label>
            ))
          ) : (
            <p className="px-2 py-3 text-xs text-ink-muted">{tr(fr, "Aucune vidéo dans Documents pour l’instant.", "No video in Documents yet.")}</p>
          )}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-ink-secondary">{tr(fr, "Statistiques (facultatif)", "Statistics (optional)")}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {tr(fr, "Les tableaux de la ferme passent entre les vidéos. Mis à jour chaque heure.", "Farm boards play between videos. Updated every hour.")}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const active = value.sections.includes(section.key);
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => set({ sections: toggle(value.sections, section.key) })}
                className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${active ? "border-brand bg-brand/10 text-brand" : "border-border bg-surface-1 text-ink-secondary hover:bg-surface-2"}`}
              >
                <Icon className="size-4" />
                {fr ? section.fr : section.en}
              </button>
            );
          })}
        </div>
        {value.sections.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink-secondary">
              {tr(fr, "Statistiques du site", "Statistics of site")}
              <select
                value={value.siteId ?? ""}
                onChange={(event) => set({ siteId: event.target.value || null })}
                className="mt-1 h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="">{tr(fr, "Tous les sites", "All sites")}</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>{site.name}</option>
                ))}
              </select>
            </label>
            <label className={`flex items-center gap-2 self-end pb-2 text-sm text-ink ${value.videoDocumentIds.length ? "" : "opacity-50"}`}>
              <input
                type="checkbox"
                className="size-4 accent-brand"
                disabled={!value.videoDocumentIds.length}
                checked={value.videosBetween}
                onChange={(event) => set({ videosBetween: event.target.checked })}
              />
              {tr(fr, "Passer une vidéo après chaque tour des tableaux", "Play a video after each round of boards")}
            </label>
          </div>
        ) : null}
      </div>
      <label className="block text-xs font-semibold text-ink-secondary">
        {tr(fr, `Vitesse : changer toutes les ${value.rotateSeconds} secondes`, `Speed: change every ${value.rotateSeconds} seconds`)}
        <input
          type="range"
          min={8}
          max={120}
          step={1}
          value={value.rotateSeconds}
          onChange={(event) => set({ rotateSeconds: Number(event.target.value) })}
          className="mt-2 w-full accent-brand"
        />
      </label>
      <label className="block text-xs font-semibold text-ink-secondary">
        {tr(fr, "Message défilant (facultatif)", "Scrolling message (optional)")}
        <input
          value={value.message}
          maxLength={200}
          onChange={(event) => set({ message: event.target.value })}
          placeholder={tr(fr, "Ex. : Bienvenue chez Congo Omega — présentez-vous à l’accueil.", "E.g. Welcome — please come to reception.")}
          className="mt-1 h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
        />
      </label>
    </div>
  );
}
