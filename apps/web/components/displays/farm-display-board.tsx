"use client";
/**
 * Farm statistics screen, styled like an airport departures board.
 *
 * Boards (poultry, pigs, crops) rotate page by page.  Figures are fetched
 * again every hour.  When there is nothing to show — or between boards when
 * the manager chose it — the company videos play.  Built for a TV: large
 * type, high contrast, no interaction needed (one click for full screen).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { API_PREFIX } from "@/lib/constants";

type Status = "ok" | "mortality" | "quarantine";
type Poultry = {
  totals: { flocks: number; birds: number; eggsToday: number; deathsToday: number; feedTodayKg: number; alerts: number };
  rows: { code: string; name: string; kind: string | null; house: string; site: string; ageDays: number | null; alive: number; deathsToday: number; deaths7d: number; eggsToday: number; eggs7d: number; feedTodayKg: number; waterTodayL: number; status: Status }[];
};
type Pigs = {
  totals: { pens: number; heads: number; pregnancies: number; deaths7d: number; feedTodayKg: number; alerts: number };
  rows: { code: string; name: string; type: string | null; site: string; capacity: number | null; heads: number; pregnancies: number; deaths7d: number; feedTodayKg: number; status: Status }[];
};
type Crops = {
  totals: { plantings: number; areaHa: number; harvestSoon: number; harvested30d: number; late: number };
  rows: { code: string; name: string; crop: string; field: string; site: string; areaHa: number; plantedOn: string | null; expectedHarvest: string | null; daysToHarvest: number | null; harvested: number; unit: string; status: string; late: boolean }[];
};
type Payload = {
  display: { name: string; company: string; logoUrl: string | null; site: string | null; sections: string[]; rotateSeconds: number; videosBetween: boolean; message: string | null; videos: { id: string; title: string }[] };
  generatedAt: string;
  poultry: Poultry | null;
  pigs: Pigs | null;
  agriculture: Crops | null;
};
type Slide = { kind: "poultry"; page: number; pages: number } | { kind: "pigs"; page: number; pages: number } | { kind: "agriculture"; page: number; pages: number } | { kind: "video"; index: number };

const ROWS_PER_PAGE = 9;
const HOUR = 60 * 60 * 1000;
const fmt = (value: number, digits = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value);
const pagesOf = (count: number) => Math.max(1, Math.ceil(count / ROWS_PER_PAGE));
const KIND: Record<string, string> = { broiler: "Chair", layer: "Pondeuse", layers: "Pondeuse", breeder: "Reproducteur", mixed: "Mixte" };

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="text-right leading-none">
      <p className="font-mono text-[clamp(1.8rem,3.4vw,3.6rem)] font-bold tabular-nums tracking-tight text-amber-300">
        {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        <span className="text-[0.55em] text-amber-300/70">:{String(now.getSeconds()).padStart(2, "0")}</span>
      </p>
      <p className="mt-1 text-[clamp(.8rem,1.1vw,1.15rem)] font-semibold capitalize text-white/70">
        {now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </p>
    </div>
  );
}

function StatusCell({ status, text }: { status: "ok" | "warn" | "alert"; text: string }) {
  const tone = status === "ok" ? "text-emerald-300" : status === "warn" ? "text-amber-300" : "text-red-400 animate-pulse";
  return <span className={`font-bold ${tone}`}>{text}</span>;
}

function Kpi({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[.06] px-4 py-3">
      <p className="text-[clamp(.7rem,.9vw,1rem)] font-semibold uppercase tracking-[.14em] text-sky-200/70">{label}</p>
      <p className={`mt-1 font-mono text-[clamp(1.4rem,2.4vw,2.6rem)] font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

/** One airport-style table: header row, zebra rows, fixed columns. */
function Board({ columns, rows }: { columns: { label: string; className?: string; w?: number }[]; rows: React.ReactNode[][] }) {
  const template = columns.map((column) => `minmax(0, ${column.w ?? 1}fr)`).join(" ");
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <div className="grid bg-[#0b1f4d] px-5 py-3 text-[clamp(.75rem,1vw,1.05rem)] font-bold uppercase tracking-[.12em] text-sky-200" style={{ gridTemplateColumns: template }}>
        {columns.map((column) => (
          <span key={column.label} className={`truncate pr-6 ${column.className ?? ""}`}>{column.label}</span>
        ))}
      </div>
      {rows.map((cells, index) => (
        <div
          key={index}
          style={{ gridTemplateColumns: template, animationDelay: `${index * 70}ms` }}
          className={`grid items-center px-5 py-[clamp(.55rem,1.15vh,1rem)] text-[clamp(.95rem,1.55vw,1.75rem)] font-semibold text-white animate-in fade-in slide-in-from-right-4 duration-500 fill-mode-both ${index % 2 ? "bg-[#163a8a]" : "bg-[#1d4aa8]"}`}
        >
          {cells.map((cell, cellIndex) => (
            <span key={cellIndex} className={`truncate pr-6 ${columns[cellIndex]?.className ?? ""}`}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function FarmDisplayBoard({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ["farm-display", token],
    queryFn: () => get<Payload>(`/public/displays/${token}`),
    refetchInterval: HOUR,
    refetchIntervalInBackground: true,
    retry: true,
    retryDelay: 30_000,
  });
  const data = query.data;
  const slides = useMemo<Slide[]>(() => {
    if (!data) return [];
    const boards: Slide[] = [];
    const add = (kind: "poultry" | "pigs" | "agriculture", count: number) => {
      for (let page = 0; page < pagesOf(count); page += 1) boards.push({ kind, page, pages: pagesOf(count) } as Slide);
    };
    if (data.poultry?.rows.length) add("poultry", data.poultry.rows.length);
    if (data.pigs?.rows.length) add("pigs", data.pigs.rows.length);
    if (data.agriculture?.rows.length) add("agriculture", data.agriculture.rows.length);
    const videos = data.display.videos.map((_, index) => ({ kind: "video", index }) as Slide);
    if (!boards.length) return videos;
    if (!data.display.videosBetween || !videos.length) return boards;
    // One video after each full round of boards, taking turns.
    return [...boards, { kind: "video", index: -1 } as Slide];
  }, [data]);
  const [position, setPosition] = useState(0);
  const [videoTurn, setVideoTurn] = useState(0);
  const slide = slides.length ? slides[position % slides.length] : null;
  const advance = () => {
    if (slide?.kind === "video") setVideoTurn((turn) => turn + 1);
    setPosition((current) => (current + 1) % Math.max(1, slides.length));
  };
  // Boards change on a timer; videos change when they end.
  useEffect(() => {
    if (!slide || slide.kind === "video" || !data) return;
    const timer = window.setTimeout(advance, data.display.rotateSeconds * 1000);
    return () => window.clearTimeout(timer);
  });
  const [fullscreenHint, setFullscreenHint] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setFullscreenHint(false), 8000);
    return () => window.clearTimeout(timer);
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);

  if (query.isLoading)
    return (
      <main className="grid min-h-dvh place-items-center bg-[#071433] text-white">
        <p className="animate-pulse text-2xl font-semibold tracking-wide text-sky-200">Chargement du tableau…</p>
      </main>
    );
  if (!data)
    return (
      <main className="grid min-h-dvh place-items-center bg-[#071433] p-10 text-center text-white">
        <div>
          <p className="text-3xl font-bold">Écran indisponible</p>
          <p className="mt-3 text-lg text-white/70">Ce lien a été désactivé ou remplacé. Demandez le nouveau lien au responsable LiteHubs.</p>
        </div>
      </main>
    );

  const { display } = data;
  const updated = new Date(data.generatedAt);
  const next = new Date(updated.getTime() + HOUR);
  const videoIndex = slide?.kind === "video" ? (slide.index >= 0 ? slide.index : videoTurn % Math.max(1, display.videos.length)) : -1;
  const video = videoIndex >= 0 ? display.videos[videoIndex] : null;
  const videoUrl = video ? `${API_PREFIX}/public/displays/${token}/videos/${video.id}` : null;

  let title = "";
  let subtitle = "";
  let kpis: React.ReactNode = null;
  let board: React.ReactNode = null;
  if (slide?.kind === "poultry" && data.poultry) {
    const { totals, rows } = data.poultry;
    title = "Volaille";
    subtitle = "Lots en cours";
    kpis = (
      <>
        <Kpi label="Lots actifs" value={fmt(totals.flocks)} />
        <Kpi label="Oiseaux" value={fmt(totals.birds)} />
        <Kpi label="Œufs aujourd’hui" value={fmt(totals.eggsToday)} tone="text-amber-300" />
        <Kpi label="Mortalité aujourd’hui" value={fmt(totals.deathsToday)} tone={totals.deathsToday ? "text-red-400" : "text-emerald-300"} />
        <Kpi label="Aliment aujourd’hui" value={`${fmt(totals.feedTodayKg)} kg`} />
      </>
    );
    board = (
      <Board
        columns={[{ label: "Lot", w: 0.9 }, { label: "Bâtiment", w: 2 }, { label: "Type", w: 1.1 }, { label: "Âge", className: "text-right", w: 0.7 }, { label: "Effectif", className: "text-right", w: 1 }, { label: "Œufs jour", className: "text-right", w: 1 }, { label: "Morts 7 j", className: "text-right", w: 1 }, { label: "Statut", w: 1.6 }]}
        rows={rows.slice(slide.page * ROWS_PER_PAGE, (slide.page + 1) * ROWS_PER_PAGE).map((row) => [
          <span key="c" className="font-mono text-amber-200">{row.code.replace(/_/g, "-").toUpperCase()}</span>,
          `${row.house} · ${row.site}`,
          (row.kind && KIND[row.kind]) || row.kind || "—",
          row.ageDays === null ? "—" : `${row.ageDays} j`,
          fmt(row.alive),
          row.eggsToday ? fmt(row.eggsToday) : "—",
          fmt(row.deaths7d),
          row.status === "quarantine" ? <StatusCell key="s" status="warn" text="Quarantaine" /> : row.status === "mortality" ? <StatusCell key="s" status="alert" text="Mortalité élevée" /> : <StatusCell key="s" status="ok" text="En règle" />,
        ])}
      />
    );
  } else if (slide?.kind === "pigs" && data.pigs) {
    const { totals, rows } = data.pigs;
    title = "Porcs";
    subtitle = "Loges occupées";
    kpis = (
      <>
        <Kpi label="Loges" value={fmt(totals.pens)} />
        <Kpi label="Têtes" value={fmt(totals.heads)} />
        <Kpi label="Gestations" value={fmt(totals.pregnancies)} tone="text-pink-300" />
        <Kpi label="Mortalité 7 j" value={fmt(totals.deaths7d)} tone={totals.deaths7d ? "text-red-400" : "text-emerald-300"} />
        <Kpi label="Aliment aujourd’hui" value={`${fmt(totals.feedTodayKg)} kg`} />
      </>
    );
    board = (
      <Board
        columns={[{ label: "Loge", w: 0.9 }, { label: "Nom", w: 1.8 }, { label: "Site", w: 1.2 }, { label: "Têtes", className: "text-right", w: 0.8 }, { label: "Capacité", className: "text-right", w: 0.9 }, { label: "Gestations", className: "text-right", w: 1 }, { label: "Morts 7 j", className: "text-right", w: 0.9 }, { label: "Statut", w: 1.4 }]}
        rows={rows.slice(slide.page * ROWS_PER_PAGE, (slide.page + 1) * ROWS_PER_PAGE).map((row) => [
          <span key="c" className="font-mono text-amber-200">{row.code.replace(/_/g, "-").toUpperCase()}</span>,
          row.name,
          row.site,
          fmt(row.heads),
          row.capacity === null ? "—" : fmt(row.capacity),
          fmt(row.pregnancies),
          fmt(row.deaths7d),
          row.status === "quarantine" ? <StatusCell key="s" status="warn" text="Quarantaine" /> : row.status === "mortality" ? <StatusCell key="s" status="alert" text="Mortalité" /> : <StatusCell key="s" status="ok" text="En règle" />,
        ])}
      />
    );
  } else if (slide?.kind === "agriculture" && data.agriculture) {
    const { totals, rows } = data.agriculture;
    title = "Agriculture";
    subtitle = "Cultures en cours";
    kpis = (
      <>
        <Kpi label="Cultures" value={fmt(totals.plantings)} />
        <Kpi label="Surface" value={`${fmt(totals.areaHa, 1)} ha`} />
        <Kpi label="Récolte ≤ 14 j" value={fmt(totals.harvestSoon)} tone="text-amber-300" />
        <Kpi label="Récolté 30 j" value={fmt(totals.harvested30d)} tone="text-emerald-300" />
        <Kpi label="En retard" value={fmt(totals.late)} tone={totals.late ? "text-red-400" : "text-white"} />
      </>
    );
    board = (
      <Board
        columns={[{ label: "Culture", w: 1.1 }, { label: "Champ", w: 1.8 }, { label: "Surface", className: "text-right", w: 0.9 }, { label: "Semé le", w: 0.9 }, { label: "Récolte prévue", w: 1.1 }, { label: "Dans", className: "text-right", w: 0.9 }, { label: "Récolté", className: "text-right", w: 1 }, { label: "Statut", w: 1.5 }]}
        rows={rows.slice(slide.page * ROWS_PER_PAGE, (slide.page + 1) * ROWS_PER_PAGE).map((row) => [
          <span key="c" className="text-amber-200">{row.crop}</span>,
          `${row.field} · ${row.site}`,
          `${fmt(row.areaHa, 2)} ha`,
          row.plantedOn ? new Date(row.plantedOn).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—",
          row.expectedHarvest ? new Date(row.expectedHarvest).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—",
          row.daysToHarvest === null ? "—" : row.daysToHarvest < 0 ? `${-row.daysToHarvest} j retard` : `${row.daysToHarvest} j`,
          row.harvested ? `${fmt(row.harvested)} ${row.unit}` : "—",
          row.late ? <StatusCell key="s" status="alert" text="En retard" /> : row.status === "harvesting" ? <StatusCell key="s" status="warn" text="En récolte" /> : row.daysToHarvest !== null && row.daysToHarvest <= 14 ? <StatusCell key="s" status="warn" text="Récolte proche" /> : <StatusCell key="s" status="ok" text={row.status === "planned" ? "Planifiée" : "En croissance"} />,
        ])}
      />
    );
  }

  return (
    <main
      className="relative flex h-dvh flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,#12307a,#071433_60%)] text-white"
      onClick={() => {
        if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      }}
    >
      <header className="flex items-center justify-between gap-6 border-b-4 border-amber-400/80 bg-[#0a1a44] px-[3vw] py-[1.6vh]">
        <div className="flex min-w-0 items-center gap-4">
          {display.logoUrl ? (
            <img src={display.logoUrl} alt="" className="h-[clamp(2.5rem,5vh,4.5rem)] w-auto rounded-lg bg-white/95 p-1" />
          ) : (
            <span className="grid size-[clamp(2.5rem,5vh,4.5rem)] place-items-center rounded-xl bg-amber-400 text-xl font-black text-[#0a1a44]">
              {display.company.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[clamp(1.2rem,2.2vw,2.4rem)] font-black uppercase tracking-[.06em]">{display.company}</p>
            <p className="truncate text-[clamp(.8rem,1.1vw,1.2rem)] font-semibold text-sky-200/80">
              {display.name}
              {display.site ? ` · ${display.site}` : ""}
            </p>
          </div>
        </div>
        <Clock />
      </header>

      <section className="relative flex min-h-0 flex-1 flex-col px-[3vw] py-[2.2vh]">
        {slide && slide.kind !== "video" ? (
          <div key={`${slide.kind}-${slide.page}`} className="flex min-h-0 flex-1 flex-col gap-[2vh]">
            <div className="flex flex-wrap items-end justify-between gap-4 animate-in fade-in slide-in-from-left-4 duration-500">
              <div>
                <p className="text-[clamp(.8rem,1vw,1.1rem)] font-bold uppercase tracking-[.3em] text-amber-300">{subtitle}</p>
                <h1 className="text-[clamp(2rem,4vw,4.4rem)] font-black uppercase leading-none tracking-tight">{title}</h1>
              </div>
              <p className="text-[clamp(.8rem,1vw,1.1rem)] font-semibold text-white/60">
                Page {slide.page + 1} / {slide.pages}
              </p>
            </div>
            <div className="grid grid-cols-5 gap-3">{kpis}</div>
            <div className="min-h-0 flex-1">{board}</div>
          </div>
        ) : videoUrl ? (
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-3xl bg-black">
            <video
              key={`${videoUrl}-${position}`}
              ref={videoRef}
              src={videoUrl}
              autoPlay
              muted
              playsInline
              onEnded={advance}
              onError={() => window.setTimeout(advance, 3000)}
              loop={slides.length === 1}
              className="h-full w-full object-contain"
            />
            <p className="absolute left-5 top-4 rounded-full bg-black/50 px-4 py-1.5 text-sm font-semibold text-white/80">{video?.title}</p>
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <p className="text-[clamp(2rem,4vw,4rem)] font-black uppercase tracking-tight">Bienvenue</p>
              <p className="mt-3 text-[clamp(1rem,1.6vw,1.6rem)] text-white/70">Aucune donnée à afficher pour le moment.</p>
            </div>
          </div>
        )}
      </section>

      <footer className="flex items-center gap-6 border-t border-white/10 bg-[#0a1a44] px-[3vw] py-[1.2vh] text-[clamp(.75rem,1vw,1.1rem)]">
        <span className="shrink-0 font-semibold text-sky-200/80">
          Mis à jour à {updated.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · prochaine mise à jour {next.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <div className="relative min-w-0 flex-1 overflow-hidden whitespace-nowrap">
          {display.message ? (
            <span className="inline-block animate-[lh-ticker_30s_linear_infinite] pl-[100%] font-semibold text-amber-200">{display.message}</span>
          ) : null}
        </div>
        <span className="flex shrink-0 gap-1.5">
          {slides.map((_, index) => (
            <span key={index} className={`h-2 rounded-full transition-all duration-500 ${index === position % Math.max(1, slides.length) ? "w-6 bg-amber-400" : "w-2 bg-white/30"}`} />
          ))}
        </span>
      </footer>
      {slide && slide.kind !== "video" ? (
        <div key={`bar-${position}`} className="absolute bottom-0 left-0 h-1 bg-amber-400" style={{ animation: `lh-progress ${display.rotateSeconds}s linear forwards` }} />
      ) : null}
      {fullscreenHint ? (
        <p className="pointer-events-none absolute right-6 top-28 rounded-full bg-black/60 px-4 py-2 text-sm text-white/80 animate-in fade-in">Cliquez pour afficher en plein écran</p>
      ) : null}
    </main>
  );
}
