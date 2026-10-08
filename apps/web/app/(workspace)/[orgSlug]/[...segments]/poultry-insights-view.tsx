"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  Coins,
  Egg,
  Home,
  Info,
  ShieldAlert,
  ThermometerSun,
  Trash2,
  Trophy,
  Wheat,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError } from "@/lib/api";
import { poultryApi } from "@/lib/poultry-api";
import {
  formatBusinessDay,
  formatMoney,
  formatPercent,
  formatQuantity,
} from "@/lib/utils";

/* Shapes returned by GET /poultry/insights. */
type Warning = {
  flockId: string;
  flockName: string;
  code:
    | "water_drop"
    | "feed_drop"
    | "mortality_spike"
    | "temperature_out_of_range"
    | "humidity_out_of_range"
    | "ammonia_high"
    | "records_missing";
  severity: "medium" | "high" | "critical";
  date: string;
  observed: number | null;
  reference: number | null;
};
type FlockInsight = {
  id: string;
  code: string;
  name: string;
  status: string;
  isActive: boolean;
  productionType: string;
  breed: string | null;
  source: string | null;
  house: { id: string; code: string; name: string };
  site: { id: string; name: string };
  arrivalDate: string;
  closedAt: string | null;
  ageDays: number;
  ageWeek: number;
  birds: { initial: number; live: number; deaths: number; culls: number };
  indicators: {
    viabilityPercent: number | null;
    mortalityPercent: number | null;
    averageWeightG: number | null;
    weightDate: string | null;
    uniformityPercent: number | null;
    dailyGainG: number | null;
    feedKg: number | null;
    liveWeightKg: number | null;
    fcr: number | null;
    targetFcr: number | null;
    iep: number | null;
    totalEggs: number;
    eggsPerHenHoused: number | null;
    layingRatePercent: number | null;
    targetLayingRatePercent: number | null;
    feedPerEggG: number | null;
  };
  ambiance: {
    date: string;
    temperatureC: number | null;
    humidityPercent: number | null;
    ammoniaPpm: number | null;
    lightHours: number | null;
  } | null;
  finance: {
    currency: string;
    chicks: number | null;
    feed: number | null;
    unpricedFeedKg: number | null;
    other: Record<string, number>;
    total: number | null;
    perLiveBird: number | null;
    perKg: number | null;
    perEgg: number | null;
    revenue: number | null;
    margin: number | null;
  } | null;
  eggStock: {
    saleable: number;
    sold: number;
    inStock: number;
    downgraded: number;
  } | null;
  withdrawal: Array<{ product: string; until: string }>;
  forecast: {
    dailyFeedKg: number | null;
    feedNext7DaysKg: number | null;
    saleWeightG: number;
    daysToSaleWeight: number | null;
    saleDate: string | null;
    eggsNext7Days: number | null;
  } | null;
};
type HouseInsight = {
  id: string;
  code: string;
  name: string;
  site: { id: string; name: string };
  minDowntimeDays: number;
  status: "occupied" | "resting" | "needs_cleaning" | "ready" | "unused";
  currentFlock: { id: string; name: string } | null;
  lastFlockClosedOn: string | null;
  daysEmpty: number | null;
  daysRemaining: number | null;
  readyOn: string | null;
  cleaningDate: string | null;
  disinfectionDate: string | null;
};
type Insights = {
  date: string;
  currency: string;
  financeVisible: boolean;
  flocks: FlockInsight[];
  houses: HouseInsight[];
  warnings: Warning[];
  feedCover: Array<{
    site: { id: string; name: string | null };
    stockKg: number | null;
    dailyNeedKg: number | null;
    daysOfCover: number | null;
  }>;
};
type Cost = {
  id: string;
  costDate: string;
  category: string;
  description: string | null;
  amount: number;
};

const COST_CATEGORIES = [
  "labour",
  "energy",
  "litter",
  "health",
  "feed",
  "water",
  "transport",
  "slaughter",
  "equipment",
  "other",
] as const;

function costLabel(category: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    feed: ["Feed (outside stock)", "Aliment (hors stock)"],
    health: ["Vet & medicines", "Vétérinaire et médicaments"],
    labour: ["Labour", "Main-d’œuvre"],
    energy: ["Energy (power, gas, fuel)", "Énergie (courant, gaz, carburant)"],
    litter: ["Litter", "Litière"],
    water: ["Water", "Eau"],
    transport: ["Transport", "Transport"],
    slaughter: ["Slaughter", "Abattage"],
    equipment: ["Equipment", "Équipement"],
    other: ["Other", "Autre"],
  };
  const pair = labels[category];
  return pair ? (fr ? pair[1] : pair[0]) : category;
}

function warningText(warning: Warning, fr: boolean) {
  const o = warning.observed;
  const r = warning.reference;
  const drop = o != null && r ? Math.round(((r - o) / r) * 100) : null;
  switch (warning.code) {
    case "water_drop":
      return fr
        ? `Consommation d’eau en baisse de ${drop} % (${o} L contre ${r} L habituellement). Vérifiez les abreuvoirs, la chaleur et l’état des oiseaux : c’est souvent le premier signe d’une maladie.`
        : `Water intake down ${drop}% (${o} L vs ${r} L usually). Check drinkers, heat and bird health: it is often the first sign of disease.`;
    case "feed_drop":
      return fr
        ? `Consommation d’aliment en baisse de ${drop} % (${o} kg contre ${r} kg habituellement). Vérifiez les mangeoires et l’état des oiseaux.`
        : `Feed intake down ${drop}% (${o} kg vs ${r} kg usually). Check feeders and bird health.`;
    case "mortality_spike":
      return fr
        ? `${o} morts le ${formatBusinessDay(warning.date)}, contre ${r} par jour la semaine d’avant. Examinez les oiseaux et appelez le vétérinaire si cela continue.`
        : `${o} deaths on ${formatBusinessDay(warning.date)}, against ${r} per day the week before. Inspect the birds and call the vet if it continues.`;
    case "temperature_out_of_range":
      return fr
        ? `Température du bâtiment ${o} °C, hors de la plage du modèle (limite ${r} °C).`
        : `House temperature ${o} °C is outside the model range (limit ${r} °C).`;
    case "humidity_out_of_range":
      return fr
        ? `Humidité ${o} %, hors de la plage du modèle (limite ${r} %).`
        : `Humidity ${o}% is outside the model range (limit ${r}%).`;
    case "ammonia_high":
      return fr
        ? `Ammoniac ${o} ppm (limite ${r} ppm). Augmentez la ventilation et changez la litière humide.`
        : `Ammonia ${o} ppm (limit ${r} ppm). Increase ventilation and change wet litter.`;
    case "records_missing":
      return o == null
        ? fr
          ? "Aucune donnée journalière n’a encore été saisie : les problèmes ne peuvent pas être détectés."
          : "No daily data recorded yet: problems cannot be detected."
        : fr
          ? `Rien n’a été saisi depuis ${o} jours : les problèmes ne peuvent pas être détectés.`
          : `Nothing recorded for ${o} days: problems cannot be detected.`;
  }
}

function warningTitle(code: Warning["code"], fr: boolean) {
  const titles: Record<Warning["code"], [string, string]> = {
    water_drop: ["Water intake drop", "Baisse de l’eau"],
    feed_drop: ["Feed intake drop", "Baisse de l’aliment"],
    mortality_spike: ["Mortality spike", "Pic de mortalité"],
    temperature_out_of_range: ["Temperature", "Température"],
    humidity_out_of_range: ["Humidity", "Humidité"],
    ammonia_high: ["Ammonia", "Ammoniac"],
    records_missing: ["Missing data", "Données manquantes"],
  };
  return fr ? titles[code][1] : titles[code][0];
}

/** Reading of the European production index for broilers. */
function iepBand(iep: number | null) {
  if (iep == null) return null;
  if (iep >= 400) return { variant: "good" as const, fr: "Excellent", en: "Excellent" };
  if (iep >= 300) return { variant: "good" as const, fr: "Bon", en: "Good" };
  if (iep >= 250) return { variant: "warning" as const, fr: "Moyen", en: "Average" };
  return { variant: "critical" as const, fr: "Faible", en: "Weak" };
}

function Card({
  icon: Icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <Icon className="size-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
      {children}
    </th>
  );
}
function Td({
  children,
  strong,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={
        "whitespace-nowrap px-3 py-2.5 text-sm " +
        (strong ? "font-semibold text-ink" : "text-ink-secondary")
      }
    >
      {children}
    </td>
  );
}

const selectClass =
  "h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink";

export function PoultryInsightsView({
  orgSlug,
  fr,
  provinceId,
  productionType,
  canEditCosts,
}: {
  orgSlug: string;
  fr: boolean;
  provinceId?: string;
  productionType?: string;
  canEditCosts: boolean;
}) {
  const t = (en: string, french: string) => (fr ? french : en);
  const client = useQueryClient();
  const [view, setView] = useState<"active" | "closed" | "all">("all");
  const [costFlockId, setCostFlockId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const insights = useQuery({
    queryKey: ["poultry", orgSlug, "insights", provinceId ?? "", productionType ?? ""],
    queryFn: () =>
      poultryApi
        .insights<{ insights: Insights }>(orgSlug, {
          provinceId,
          productionType,
        })
        .then((response) => response.insights),
  });
  const data = insights.data;
  const flocks = data?.flocks ?? [];
  const chosenCostFlock = costFlockId || flocks[0]?.id || "";

  const costs = useQuery({
    queryKey: ["poultry", orgSlug, "flock-costs", chosenCostFlock],
    enabled: Boolean(data?.financeVisible && chosenCostFlock),
    queryFn: () =>
      poultryApi.flockCosts
        .list<{ costs: Cost[] }>(orgSlug, chosenCostFlock)
        .then((response) => response.costs),
  });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["poultry", orgSlug, "insights"] });
    client.invalidateQueries({
      queryKey: ["poultry", orgSlug, "flock-costs"],
    });
  };
  const errorText = (error: unknown) =>
    error instanceof ApiError ? error.message : t("Something went wrong", "Une erreur est survenue");

  const addCost = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      poultryApi.flockCosts.create(orgSlug, chosenCostFlock, body),
    onSuccess: () => {
      setMessage(t("Cost added.", "Dépense ajoutée."));
      refresh();
    },
    onError: (error) => setMessage(errorText(error)),
  });
  const removeCost = useMutation({
    mutationFn: (costId: string) =>
      poultryApi.flockCosts.remove(orgSlug, chosenCostFlock, costId),
    onSuccess: refresh,
    onError: (error) => setMessage(errorText(error)),
  });
  const sendAlerts = useMutation({
    mutationFn: () => poultryApi.evaluateAlerts(orgSlug),
    onSuccess: () =>
      setMessage(
        t(
          "Warnings sent to the alert centre.",
          "Alertes envoyées au centre d’alertes.",
        ),
      ),
    onError: (error) => setMessage(errorText(error)),
  });

  const shown = useMemo(
    () =>
      flocks.filter((flock) =>
        view === "all" ? true : view === "active" ? flock.isActive : !flock.isActive,
      ),
    [flocks, view],
  );
  const broilers = shown
    .filter((flock) => !["layer", "breeder"].includes(flock.productionType))
    .sort((a, b) => (b.indicators.iep ?? -1) - (a.indicators.iep ?? -1));
  const layers = shown.filter((flock) =>
    ["layer", "breeder"].includes(flock.productionType),
  );
  const byHouse = useMemo(() => {
    const groups = new Map<string, { name: string; values: number[] }>();
    for (const flock of flocks) {
      if (flock.indicators.iep == null) continue;
      const group = groups.get(flock.house.id) ?? { name: flock.house.name, values: [] };
      group.values.push(flock.indicators.iep);
      groups.set(flock.house.id, group);
    }
    return [...groups.values()]
      .map((group) => ({
        name: group.name,
        count: group.values.length,
        average: Math.round(group.values.reduce((a, b) => a + b, 0) / group.values.length),
        best: Math.max(...group.values),
      }))
      .sort((a, b) => b.average - a.average);
  }, [flocks]);

  if (insights.isPending)
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (insights.isError || !data)
    return (
      <ErrorState
        title={t("Could not load the cockpit", "Impossible de charger le pilotage")}
        onRetry={() => insights.refetch()}
      />
    );

  const active = flocks.filter((flock) => flock.isActive);
  const underWithdrawal = flocks.filter((flock) => flock.withdrawal.length);
  const money = (value: number | null | undefined) => formatMoney(value, data.currency);

  function submitCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage(t("Enter a valid amount.", "Saisissez un montant valide."));
      return;
    }
    addCost.mutate({
      costDate: String(form.get("costDate")),
      category: String(form.get("category")),
      description: String(form.get("description") ?? "").trim() || null,
      amount,
    });
    event.currentTarget.reset();
  }

  return (
    <div className="space-y-5">
      {message ? (
        <p className="rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-ink" role="status">
          {message}
        </p>
      ) : null}

      {/* 1. Early warnings */}
      <Card
        icon={BellRing}
        title={t("Early warnings", "Alertes précoces")}
        subtitle={t(
          "Each flock is compared with its own last days: a drop in water or feed, a jump in deaths or a bad climate often shows 1 to 3 days before a disease.",
          "Chaque lot est comparé à ses propres derniers jours : une baisse d’eau ou d’aliment, un pic de morts ou une mauvaise ambiance apparaît souvent 1 à 3 jours avant une maladie.",
        )}
        action={
          <Button
            size="sm"
            variant="outline"
            loading={sendAlerts.isPending}
            onClick={() => sendAlerts.mutate()}
          >
            {t("Send to alert centre", "Envoyer au centre d’alertes")}
          </Button>
        }
      >
        {data.warnings.length ? (
          <ul className="space-y-2">
            {data.warnings.map((warning, index) => (
              <li
                key={`${warning.flockId}-${warning.code}-${index}`}
                className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-surface-2/50 px-4 py-3"
              >
                <Badge
                  variant={
                    warning.severity === "critical"
                      ? "critical"
                      : warning.severity === "high"
                        ? "serious"
                        : "warning"
                  }
                >
                  {warningTitle(warning.code, fr)}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{warning.flockName}</p>
                  <p className="text-sm text-ink-secondary">{warningText(warning, fr)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={BellRing}
            title={t("No warning today", "Aucune alerte aujourd’hui")}
            description={t(
              "Water, feed, mortality and climate look normal for every running flock.",
              "L’eau, l’aliment, la mortalité et l’ambiance sont normales pour tous les lots en cours.",
            )}
          />
        )}
      </Card>

      {/* 2. Indicators and ranking */}
      <Card
        icon={Trophy}
        title={t("Flock comparison", "Comparaison des lots")}
        subtitle={t(
          "Broilers are ranked by the production index (IEP / EPEF) = viability % × weight kg ÷ (age days × FCR) × 100. Under 250 weak, 300 good, 400 excellent.",
          "Les lots de chair sont classés par l’indice de production (IEP / EPEF) = viabilité % × poids kg ÷ (âge jours × IC) × 100. Moins de 250 faible, 300 bon, 400 excellent.",
        )}
        action={
          <div className="flex gap-1 rounded-lg border border-border p-1">
            {(
              [
                ["all", t("All", "Tous")],
                ["active", t("Running", "En cours")],
                ["closed", t("Finished", "Terminés")],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                className={
                  "h-7 rounded-md px-2.5 text-xs font-medium " +
                  (view === value ? "bg-brand text-white" : "text-ink-secondary hover:bg-surface-2")
                }
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {broilers.length ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-border">
                <tr>
                  <Th>#</Th>
                  <Th>{t("Flock", "Lot")}</Th>
                  <Th>{t("House", "Bâtiment")}</Th>
                  <Th>{t("Age", "Âge")}</Th>
                  <Th>{t("Viability", "Viabilité")}</Th>
                  <Th>{t("Weight", "Poids")}</Th>
                  <Th>{t("Uniformity", "Homogénéité")}</Th>
                  <Th>{t("FCR", "IC")}</Th>
                  <Th>IEP</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {broilers.map((flock, index) => {
                  const band = iepBand(flock.indicators.iep);
                  return (
                    <tr key={flock.id}>
                      <Td>{index + 1}</Td>
                      <Td strong>
                        {flock.name}
                        {!flock.isActive ? (
                          <span className="ml-2 text-xs font-normal text-ink-tertiary">
                            {t("finished", "terminé")}
                          </span>
                        ) : null}
                      </Td>
                      <Td>{flock.house.name}</Td>
                      <Td>{t(`${flock.ageDays} d`, `${flock.ageDays} j`)}</Td>
                      <Td>{formatPercent(flock.indicators.viabilityPercent)}</Td>
                      <Td>{formatQuantity(flock.indicators.averageWeightG, "g", 0)}</Td>
                      <Td>{formatPercent(flock.indicators.uniformityPercent)}</Td>
                      <Td>
                        {formatQuantity(flock.indicators.fcr, null, 2)}
                        {flock.indicators.targetFcr ? (
                          <span className="ml-1 text-xs text-ink-tertiary">
                            / {flock.indicators.targetFcr}
                          </span>
                        ) : null}
                      </Td>
                      <Td strong>
                        {flock.indicators.iep ?? "—"}
                        {band ? (
                          <Badge variant={band.variant} className="ml-2">
                            {fr ? band.fr : band.en}
                          </Badge>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {layers.length ? (
          <div className="-mx-5 mt-4 overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-border">
                <tr>
                  <Th>{t("Laying flock", "Lot de ponte")}</Th>
                  <Th>{t("House", "Bâtiment")}</Th>
                  <Th>{t("Week", "Semaine")}</Th>
                  <Th>{t("Hens", "Poules")}</Th>
                  <Th>{t("Laying rate (7 d)", "Taux de ponte (7 j)")}</Th>
                  <Th>{t("Eggs per hen housed", "Œufs par poule départ")}</Th>
                  <Th>{t("Feed per egg", "Aliment par œuf")}</Th>
                  <Th>{t("Viability", "Viabilité")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {layers.map((flock) => {
                  const rate = flock.indicators.layingRatePercent;
                  const target = flock.indicators.targetLayingRatePercent;
                  return (
                    <tr key={flock.id}>
                      <Td strong>{flock.name}</Td>
                      <Td>{flock.house.name}</Td>
                      <Td>{flock.ageWeek}</Td>
                      <Td>{formatQuantity(flock.birds.live, null, 0)}</Td>
                      <Td strong>
                        {formatPercent(rate)}
                        {target != null ? (
                          <Badge
                            variant={rate != null && rate >= target ? "good" : "warning"}
                            className="ml-2"
                          >
                            {t("target", "objectif")} {formatPercent(target, 0)}
                          </Badge>
                        ) : null}
                      </Td>
                      <Td>{formatQuantity(flock.indicators.eggsPerHenHoused, null, 1)}</Td>
                      <Td>{formatQuantity(flock.indicators.feedPerEggG, "g", 0)}</Td>
                      <Td>{formatPercent(flock.indicators.viabilityPercent)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {!broilers.length && !layers.length ? (
          <EmptyState icon={Trophy} title={t("No flock to compare", "Aucun lot à comparer")} />
        ) : null}
        {byHouse.length > 1 ? (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
              {t("Average IEP by house", "IEP moyen par bâtiment")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {byHouse.map((house) => (
                <div key={house.name} className="rounded-xl border border-border px-4 py-3">
                  <p className="text-sm font-semibold text-ink">{house.name}</p>
                  <p className="text-sm text-ink-secondary">
                    {t("Average", "Moyenne")} {house.average} · {t("best", "meilleur")} {house.best} ·{" "}
                    {house.count} {t("flock(s)", "lot(s)")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {/* 3. Cost price and margin */}
      {data.financeVisible ? (
        <Card
          icon={Coins}
          title={t("Real-time cost price", "Coût de revient en temps réel")}
          subtitle={t(
            "Chicks + feed (stock cost or price per kg) + other costs, divided by live birds, kg produced or eggs. Revenue comes from delivered sales.",
            "Poussins + aliment (coût du stock ou prix au kg) + autres dépenses, divisés par les oiseaux vivants, les kg produits ou les œufs. Le chiffre d’affaires vient des ventes livrées.",
          )}
        >
          <div className="-mx-5 overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-border">
                <tr>
                  <Th>{t("Flock", "Lot")}</Th>
                  <Th>{t("Chicks", "Poussins")}</Th>
                  <Th>{t("Feed", "Aliment")}</Th>
                  <Th>{t("Other", "Autres")}</Th>
                  <Th>{t("Total", "Total")}</Th>
                  <Th>{t("Per bird", "Par oiseau")}</Th>
                  <Th>{t("Per kg / egg", "Par kg / œuf")}</Th>
                  <Th>{t("Revenue", "Ventes")}</Th>
                  <Th>{t("Margin", "Marge")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((flock) => {
                  const finance = flock.finance!;
                  const other = Object.values(finance.other).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={flock.id}>
                      <Td strong>
                        {flock.name}
                        {finance.unpricedFeedKg ? (
                          <span
                            className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-warning"
                            title={t(
                              "Feed without price: add the price per kg on feed records or a feed cost.",
                              "Aliment sans prix : ajoutez le prix au kg sur les distributions ou une dépense aliment.",
                            )}
                          >
                            <AlertTriangle className="size-3" />
                            {formatQuantity(finance.unpricedFeedKg, "kg", 0)} {t("unpriced", "sans prix")}
                          </span>
                        ) : null}
                      </Td>
                      <Td>{money(finance.chicks)}</Td>
                      <Td>{money(finance.feed)}</Td>
                      <Td>{money(other)}</Td>
                      <Td strong>{money(finance.total)}</Td>
                      <Td>{money(finance.perLiveBird)}</Td>
                      <Td>
                        {finance.perKg != null
                          ? `${money(finance.perKg)} / kg`
                          : finance.perEgg != null
                            ? `${formatMoney(finance.perEgg, data.currency)} / ${t("egg", "œuf")}`
                            : "—"}
                      </Td>
                      <Td>{money(finance.revenue)}</Td>
                      <Td strong>
                        <span className={(finance.margin ?? 0) < 0 ? "text-critical" : "text-good-ink dark:text-good"}>
                          {money(finance.margin)}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <Field label={t("Flock", "Lot")} htmlFor="cost-flock">
                <select
                  id="cost-flock"
                  className={selectClass}
                  value={chosenCostFlock}
                  onChange={(event) => setCostFlockId(event.target.value)}
                >
                  {flocks.map((flock) => (
                    <option key={flock.id} value={flock.id}>
                      {flock.name} · {flock.house.name}
                    </option>
                  ))}
                </select>
              </Field>
              {canEditCosts ? (
                <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={submitCost}>
                  <Field label={t("Date", "Date")} htmlFor="cost-date" required>
                    <Input id="cost-date" name="costDate" type="date" defaultValue={data.date} required />
                  </Field>
                  <Field label={t("Type of cost", "Type de dépense")} htmlFor="cost-category" required>
                    <select id="cost-category" name="category" className={selectClass}>
                      {COST_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {costLabel(category, fr)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`${t("Amount", "Montant")} (${data.currency})`} htmlFor="cost-amount" required>
                    <Input id="cost-amount" name="amount" type="number" min="0" step="0.01" required />
                  </Field>
                  <Field label={t("Description", "Description")} htmlFor="cost-description">
                    <Input id="cost-description" name="description" maxLength={300} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Button type="submit" size="sm" loading={addCost.isPending} disabled={!chosenCostFlock}>
                      {t("Add the cost", "Ajouter la dépense")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                {t("Other costs of this flock", "Autres dépenses de ce lot")}
              </p>
              {costs.data?.length ? (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {costs.data.map((cost) => (
                    <li key={cost.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="w-24 shrink-0 text-ink-tertiary">{formatBusinessDay(cost.costDate)}</span>
                      <span className="min-w-0 flex-1 text-ink">
                        {costLabel(cost.category, fr)}
                        {cost.description ? (
                          <span className="text-ink-secondary"> · {cost.description}</span>
                        ) : null}
                      </span>
                      <span className="font-semibold text-ink">{money(cost.amount)}</span>
                      {canEditCosts ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("Delete", "Supprimer")}
                          onClick={() => removeCost.mutate(cost.id)}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-secondary">
                  {costs.isPending
                    ? t("Loading…", "Chargement…")
                    : t("No other cost recorded.", "Aucune autre dépense enregistrée.")}
                </p>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {/* 4. Sanitary downtime */}
        <Card
          icon={Home}
          title={t("Sanitary downtime (vide sanitaire)", "Vide sanitaire des bâtiments")}
          subtitle={t(
            "After a flock leaves, the house is cleaned, disinfected and left empty. A new flock cannot be placed before the downtime ends.",
            "Après le départ d’un lot, le bâtiment est nettoyé, désinfecté puis laissé vide. Un nouveau lot ne peut pas être installé avant la fin du vide sanitaire.",
          )}
        >
          {data.houses.length ? (
            <ul className="space-y-2">
              {data.houses.map((house) => {
                const status = {
                  occupied: { variant: "info" as const, label: t("Occupied", "Occupé") },
                  resting: { variant: "warning" as const, label: t("Resting", "En vide sanitaire") },
                  needs_cleaning: { variant: "critical" as const, label: t("Cleaning not recorded", "Nettoyage non enregistré") },
                  ready: { variant: "good" as const, label: t("Ready", "Prêt") },
                  unused: { variant: "neutral" as const, label: t("Never used", "Jamais utilisé") },
                }[house.status];
                return (
                  <li key={house.id} className="rounded-xl border border-border px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{house.name}</span>
                      <span className="text-xs text-ink-tertiary">{house.site.name}</span>
                      <Badge variant={status.variant} className="ml-auto">{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-secondary">
                      {house.status === "occupied" && house.currentFlock
                        ? `${t("Current flock", "Lot en place")} : ${house.currentFlock.name}`
                        : house.lastFlockClosedOn
                          ? [
                              `${t("Empty for", "Vide depuis")} ${house.daysEmpty} ${t("d", "j")} / ${house.minDowntimeDays} ${t("d", "j")}`,
                              house.daysRemaining
                                ? `${t("ready on", "prêt le")} ${formatBusinessDay(house.readyOn!)}`
                                : null,
                              `${t("cleaning", "nettoyage")} ${house.cleaningDate ? formatBusinessDay(house.cleaningDate) : "✗"}`,
                              `${t("disinfection", "désinfection")} ${house.disinfectionDate ? formatBusinessDay(house.disinfectionDate) : "✗"}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : t("No flock has used this house yet.", "Aucun lot n’a encore utilisé ce bâtiment.")}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={Home} title={t("No house", "Aucun bâtiment")} />
          )}
        </Card>

        {/* 5. Food safety and egg stock */}
        <Card
          icon={ShieldAlert}
          title={t("Withdrawal periods and egg stock", "Délais d’attente et stock d’œufs")}
          subtitle={t(
            "Birds and eggs of a treated flock cannot be sold before the end of the withdrawal period: sales are blocked automatically.",
            "Les oiseaux et les œufs d’un lot traité ne peuvent pas être vendus avant la fin du délai d’attente : la vente est bloquée automatiquement.",
          )}
        >
          {underWithdrawal.length ? (
            <ul className="mb-4 space-y-2">
              {underWithdrawal.map((flock) => (
                <li key={flock.id} className="rounded-xl border border-critical/30 bg-critical/5 px-4 py-3 text-sm">
                  <span className="font-semibold text-ink">{flock.name}</span>
                  <span className="text-ink-secondary">
                    {" "}
                    — {t("sale blocked until", "vente bloquée jusqu’au")}{" "}
                    {formatBusinessDay(flock.withdrawal[0]!.until)} ({flock.withdrawal.map((item) => item.product).join(", ")})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 flex items-center gap-2 text-sm text-ink-secondary">
              <Info className="size-4" />
              {t("No flock is under a withdrawal period.", "Aucun lot n’est en délai d’attente.")}
            </p>
          )}
          {flocks.some((flock) => flock.eggStock) ? (
            <div className="-mx-5 overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-b border-border">
                  <tr>
                    <Th>{t("Flock", "Lot")}</Th>
                    <Th>{t("Saleable eggs", "Œufs vendables")}</Th>
                    <Th>{t("Delivered", "Livrés")}</Th>
                    <Th>{t("In stock", "En stock")}</Th>
                    <Th>{t("Downgraded", "Déclassés")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {flocks
                    .filter((flock) => flock.eggStock)
                    .map((flock) => (
                      <tr key={flock.id}>
                        <Td strong>{flock.name}</Td>
                        <Td>{formatQuantity(flock.eggStock!.saleable, null, 0)}</Td>
                        <Td>{formatQuantity(flock.eggStock!.sold, null, 0)}</Td>
                        <Td strong>
                          {formatQuantity(flock.eggStock!.inStock, null, 0)}
                          <span className="ml-1 text-xs font-normal text-ink-tertiary">
                            ({formatQuantity(flock.eggStock!.inStock / 30, null, 0)} {t("trays", "plateaux")})
                          </span>
                        </Td>
                        <Td>{formatQuantity(flock.eggStock!.downgraded, null, 0)}</Td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>

        {/* 6. Forecasts */}
        <Card
          icon={CalendarClock}
          title={t("Forecasts", "Prévisions")}
          subtitle={t(
            "Estimated from the last days: sale date at target weight, feed to plan and eggs to sell.",
            "Estimées à partir des derniers jours : date de vente au poids cible, aliment à prévoir et œufs à vendre.",
          )}
        >
          {active.length ? (
            <ul className="space-y-2">
              {active.map((flock) => {
                const forecast = flock.forecast!;
                const layer = ["layer", "breeder"].includes(flock.productionType);
                return (
                  <li key={flock.id} className="rounded-xl border border-border px-4 py-3 text-sm">
                    <p className="font-semibold text-ink">{flock.name}</p>
                    <p className="text-ink-secondary">
                      {layer
                        ? forecast.eggsNext7Days != null
                          ? `${t("About", "Environ")} ${formatQuantity(forecast.eggsNext7Days, null, 0)} ${t("eggs in the next 7 days", "œufs dans les 7 prochains jours")}`
                          : t("Record eggs to forecast production.", "Saisissez les œufs pour prévoir la production.")
                        : forecast.daysToSaleWeight === 0
                          ? t(
                              `Has reached the sale weight (${forecast.saleWeightG} g).`,
                              `A atteint le poids de vente (${forecast.saleWeightG} g).`,
                            )
                          : forecast.saleDate
                            ? `${t("Sale weight", "Poids de vente")} ${forecast.saleWeightG} g ${t("expected on", "prévu le")} ${formatBusinessDay(forecast.saleDate)} (${forecast.daysToSaleWeight} ${t("d", "j")})`
                            : t(
                                "Two weighings are needed to forecast the sale date.",
                                "Deux pesées sont nécessaires pour prévoir la date de vente.",
                              )}
                    </p>
                    <p className="text-ink-secondary">
                      {forecast.feedNext7DaysKg != null
                        ? `${t("Feed to plan for 7 days", "Aliment à prévoir pour 7 jours")} : ${formatQuantity(forecast.feedNext7DaysKg, "kg", 0)}`
                        : t("Record feed to forecast needs.", "Saisissez l’aliment pour prévoir les besoins.")}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={CalendarClock} title={t("No running flock", "Aucun lot en cours")} />
          )}
          {data.feedCover.some((site) => site.daysOfCover != null) ? (
            <div className="mt-4 space-y-1">
              {data.feedCover
                .filter((site) => site.daysOfCover != null)
                .map((site) => (
                  <p key={site.site.id} className="flex items-center gap-2 text-sm text-ink-secondary">
                    <Wheat className="size-4 text-brand" />
                    {site.site.name} : {formatQuantity(site.stockKg, "kg", 0)} {t("of feed in stock", "d’aliment en stock")} ≈{" "}
                    <span className={site.daysOfCover! < 7 ? "font-semibold text-critical" : "font-semibold text-ink"}>
                      {site.daysOfCover} {t("days", "jours")}
                    </span>
                  </p>
                ))}
            </div>
          ) : null}
        </Card>

        {/* 7. House ambiance */}
        <Card
          icon={ThermometerSun}
          title={t("House ambiance and lighting", "Ambiance et éclairage des bâtiments")}
          subtitle={t(
            "Last values recorded in the daily counts (temperature, humidity, ammonia, hours of light).",
            "Dernières valeurs saisies dans le comptage du jour (température, humidité, ammoniac, heures de lumière).",
          )}
        >
          {active.length ? (
            <div className="-mx-5 overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-b border-border">
                  <tr>
                    <Th>{t("Flock", "Lot")}</Th>
                    <Th>{t("Date", "Date")}</Th>
                    <Th>°C</Th>
                    <Th>{t("Humidity", "Humidité")}</Th>
                    <Th>{t("Ammonia", "Ammoniac")}</Th>
                    <Th>{t("Light", "Lumière")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {active.map((flock) => (
                    <tr key={flock.id}>
                      <Td strong>{flock.name}</Td>
                      <Td>{flock.ambiance ? formatBusinessDay(flock.ambiance.date) : "—"}</Td>
                      <Td>{formatQuantity(flock.ambiance?.temperatureC, null, 1)}</Td>
                      <Td>{formatPercent(flock.ambiance?.humidityPercent, 0)}</Td>
                      <Td>
                        <span className={(flock.ambiance?.ammoniaPpm ?? 0) >= 25 ? "font-semibold text-critical" : undefined}>
                          {formatQuantity(flock.ambiance?.ammoniaPpm, "ppm", 0)}
                        </span>
                      </Td>
                      <Td>{formatQuantity(flock.ambiance?.lightHours, "h", 1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ThermometerSun} title={t("No running flock", "Aucun lot en cours")} />
          )}
        </Card>
      </div>
      <p className="flex items-center gap-2 text-xs text-ink-tertiary">
        <Egg className="size-3.5" />
        {t(
          "All figures are calculated from the records entered by the team; nothing is typed twice.",
          "Tous les chiffres sont calculés à partir des données saisies par l’équipe ; rien n’est saisi deux fois.",
        )}
      </p>
    </div>
  );
}
