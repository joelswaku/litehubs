"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudSun, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, get, orgUrl } from "@/lib/api";
import { poultryApi } from "@/lib/poultry-api";
import { can } from "@/lib/permissions";
import { useSessionUser } from "@/stores/session-store";
import { useLanguage } from "@/providers/language-provider";

type Model = { id: string; name: string; code: string; productionType: string };
type Province = { id: string; name: string; code: string };
type Climate = {
  id: string;
  code: string;
  name: string;
  province?: { id: string; name: string } | null;
  countryCode: string;
  climateClass: string;
  season?: string | null;
  temperatureC?: number | null;
  humidityPercent?: number | null;
  waterAdjustmentPercent: number;
  feedAdjustmentPercent: number;
  operationalNote?: string | null;
  isActive: boolean;
};
type VaccineSchedule = {
  id: string;
  dayAge: number;
  vaccineName: string;
  dose?: string | null;
  administrationRoute?: string | null;
  notes?: string | null;
  isRequired: boolean;
};
type Dialog =
  | { kind: "climate"; item?: Climate }
  | { kind: "schedule"; model: Model; item?: VaccineSchedule }
  | null;

const climates = [
  "hot_humid",
  "hot_dry",
  "temperate",
  "cool",
  "highland",
  "other",
];
const readable = (value: string | null | undefined) =>
  value
    ? value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "—";
const codeFor = (value: string, prefix: string) => {
  const part = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (part ? `${prefix}_${part}` : `${prefix}_new`).slice(0, 63);
};
const text = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();
const optional = (form: FormData, name: string) => text(form, name) || null;
const number = (form: FormData, name: string, fallback = 0) => {
  const parsed = Number(text(form, name));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const optionalNumber = (form: FormData, name: string) =>
  text(form, name) === "" ? null : number(form, name);
const tx = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const message = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "The request could not be completed.";

export function PoultryConfigurationTools({
  orgSlug,
  models,
}: {
  orgSlug: string;
  models: Model[];
}) {
  const user = useSessionUser();
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const tr = (english: string, french: string) => (fr ? french : english);
  const client = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const selectedModel =
    models.find((model) => model.id === modelId) ?? models[0] ?? null;
  const climateProfiles = useQuery({
    queryKey: ["poultry-setup-climates", orgSlug],
    queryFn: () =>
      poultryApi.climateProfiles.list<{ climateProfiles: Climate[] }>(orgSlug),
    enabled: can(user, "poultry.climate_profiles.read"),
    select: (data) => data.climateProfiles,
  });
  const provinces = useQuery({
    queryKey: ["poultry-configuration-provinces", orgSlug],
    queryFn: () => get<{ provinces: Province[] }>(orgUrl(orgSlug, "provinces")),
    enabled: can(user, "sites.read"),
    select: (data) => data.provinces,
  });
  const schedules = useQuery({
    queryKey: ["poultry-vaccine-schedules", orgSlug, selectedModel?.id],
    queryFn: () =>
      poultryApi.performanceModels.vaccineSchedules.list<{
        vaccineSchedules: VaccineSchedule[];
      }>(orgSlug, selectedModel!.id),
    enabled:
      Boolean(selectedModel) && can(user, "poultry.performance_models.read"),
    select: (data) => data.vaccineSchedules,
  });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["poultry"] });
    client.invalidateQueries({ queryKey: ["poultry-setup-climates", orgSlug] });
    client.invalidateQueries({ queryKey: ["poultry-setup-models", orgSlug] });
    client.invalidateQueries({
      queryKey: ["poultry-vaccine-schedules", orgSlug],
    });
    client.invalidateQueries({ queryKey: ["poultry-performance", orgSlug] });
  };
  const climateSave = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: Record<string, unknown>;
    }) =>
      id
        ? poultryApi.climateProfiles.update(orgSlug, id, body)
        : poultryApi.climateProfiles.create(orgSlug, body),
    onSuccess: () => {
      setDialog(null);
      refresh();
    },
  });
  const climateDelete = useMutation({
    mutationFn: (id: string) => poultryApi.climateProfiles.remove(orgSlug, id),
    onSuccess: refresh,
  });
  const scheduleSave = useMutation({
    mutationFn: ({
      model,
      id,
      body,
    }: {
      model: Model;
      id?: string;
      body: Record<string, unknown>;
    }) =>
      id
        ? poultryApi.performanceModels.vaccineSchedules.update(
            orgSlug,
            model.id,
            id,
            body,
          )
        : poultryApi.performanceModels.vaccineSchedules.create(
            orgSlug,
            model.id,
            body,
          ),
    onSuccess: () => {
      setDialog(null);
      refresh();
    },
  });
  const scheduleDelete = useMutation({
    mutationFn: ({ model, id }: { model: Model; id: string }) =>
      poultryApi.performanceModels.vaccineSchedules.remove(
        orgSlug,
        model.id,
        id,
      ),
    onSuccess: refresh,
  });
  const error = [
    climateSave.error,
    climateDelete.error,
    scheduleSave.error,
    scheduleDelete.error,
  ].find(Boolean);
  const writeClimate =
    can(user, "poultry.climate_profiles.create") ||
    can(user, "poultry.climate_profiles.update");
  const deleteClimate = can(user, "poultry.climate_profiles.delete");
  const writeSchedule = can(user, "poultry.performance_models.update");

  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
              {tr("Climate & region", "Climat et region")}
            </p>
            <h2 className="mt-1 text-base font-semibold text-ink">
              {tr(
                "Climate adjustment profiles",
                "Profils d ajustement climatique",
              )}
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {tr(
                "Attach regional conditions to a performance model. The calculation then adjusts water and feed expectations without changing the core standard.",
                "Associez les conditions regionales a un modele de performance. Le calcul ajuste ensuite les besoins en eau et en aliment sans modifier le standard de base.",
              )}
            </p>
          </div>
          {can(user, "poultry.climate_profiles.create") ? (
            <Button size="sm" onClick={() => setDialog({ kind: "climate" })}>
              <Plus />
              {tr("Add profile", "Ajouter un profil")}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="mt-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
            {message(error)}
          </p>
        ) : null}
        {climateProfiles.isPending ? (
          <Skeleton className="mt-4 h-40" />
        ) : climateProfiles.isError ? (
          <ErrorState
            title={tr(
              "Could not load climate profiles",
              "Impossible de charger les profils climatiques",
            )}
            description={message(climateProfiles.error)}
            onRetry={() => climateProfiles.refetch()}
          />
        ) : climateProfiles.data?.length ? (
          <div className="mt-4 space-y-3">
            {climateProfiles.data.map((item) => (
              <article
                key={item.id}
                className="rounded-xl border border-border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {item.name}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {item.province?.name ?? item.countryCode} ·{" "}
                      {readable(item.climateClass)}
                      {item.season ? ` · ${item.season}` : ""}
                    </p>
                  </div>
                  <Badge variant={item.isActive ? "good" : "neutral"}>
                    {item.isActive
                      ? tr("Active", "Actif")
                      : tr("Inactive", "Inactif")}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-secondary">
                  <p>
                    {tr("Water", "Eau")} :{" "}
                    <span className="font-medium text-ink">
                      {item.waterAdjustmentPercent > 0 ? "+" : ""}
                      {item.waterAdjustmentPercent}%
                    </span>
                  </p>
                  <p>
                    {tr("Feed", "Aliment")} :{" "}
                    <span className="font-medium text-ink">
                      {item.feedAdjustmentPercent > 0 ? "+" : ""}
                      {item.feedAdjustmentPercent}%
                    </span>
                  </p>
                </div>
                {writeClimate || deleteClimate ? (
                  <div className="mt-3 flex justify-end gap-1">
                    {can(user, "poultry.climate_profiles.update") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDialog({ kind: "climate", item })}
                      >
                        <Pencil />
                        {tr("Edit", "Modifier")}
                      </Button>
                    ) : null}
                    {deleteClimate ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={climateDelete.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete ${item.name}?`))
                            climateDelete.mutate(item.id);
                        }}
                      >
                        <Trash2 />
                        {tr("Delete", "Supprimer")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={tr(
              "No climate profile configured.",
              "Aucun profil climatique configure.",
            )}
            description={tr(
              "Create a profile for local heat, humidity and seasonal operating conditions.",
              "Creez un profil pour la chaleur, humidite et les conditions saisonnieres locales.",
            )}
            icon={CloudSun}
            action={
              can(user, "poultry.climate_profiles.create")
                ? {
                    label: "Add profile",
                    onClick: () => setDialog({ kind: "climate" }),
                  }
                : undefined
            }
          />
        )}
      </section>
      <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
              {tr("Health plan", "Plan sanitaire")}
            </p>
            <h2 className="mt-1 text-base font-semibold text-ink">
              {tr("Model vaccine schedules", "Calendriers vaccinaux du modele")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {tr(
                "These schedules drive due-vaccine information for flocks using this performance model. They do not replace the actual vaccination records.",
                "Ces calendriers indiquent les vaccins a effectuer pour les lots utilisant ce modele. Ils ne remplacent pas les enregistrements de vaccination reels.",
              )}
            </p>
          </div>
          {selectedModel && writeSchedule ? (
            <Button
              size="sm"
              onClick={() =>
                setDialog({ kind: "schedule", model: selectedModel })
              }
            >
              <Plus />
              {tr("Add vaccine", "Ajouter un vaccin")}
            </Button>
          ) : null}
        </div>
        {models.length ? (
          <>
            <label className="mt-4 grid gap-1 text-xs font-medium text-ink-secondary">
              <span>{tr("Performance model", "Modele de performance")}</span>
              <select
                value={selectedModel?.id ?? ""}
                onChange={(event) => setModelId(event.target.value)}
                className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                {models.map((model) => (
                  <option value={model.id} key={model.id}>
                    {model.name} · {readable(model.productionType)}
                  </option>
                ))}
              </select>
            </label>
            {schedules.isPending ? (
              <Skeleton className="mt-4 h-40" />
            ) : schedules.isError ? (
              <ErrorState
                title="Could not load vaccine schedule"
                description={message(schedules.error)}
                onRetry={() => schedules.refetch()}
              />
            ) : schedules.data?.length ? (
              <div className="mt-4 space-y-3">
                {schedules.data.map((item) => (
                  <article
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {item.vaccineName}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {tr("Day", "Jour")} {item.dayAge}
                        {item.dose ? ` · ${item.dose}` : ""}
                        {item.administrationRoute
                          ? ` · ${item.administrationRoute}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={item.isRequired ? "warning" : "neutral"}>
                        {item.isRequired
                          ? tr("Required", "Obligatoire")
                          : tr("Optional", "Optionnel")}
                      </Badge>
                      {writeSchedule ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDialog({
                              kind: "schedule",
                              model: selectedModel!,
                              item,
                            })
                          }
                        >
                          <Pencil />
                          {tr("Edit", "Modifier")}
                        </Button>
                      ) : null}
                      {writeSchedule ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={scheduleDelete.isPending}
                          onClick={() => {
                            if (window.confirm(`Delete ${item.vaccineName}?`))
                              scheduleDelete.mutate({
                                model: selectedModel!,
                                id: item.id,
                              });
                          }}
                        >
                          <Trash2 />
                          {tr("Delete", "Supprimer")}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title={tr(
                  "No vaccine schedule configured.",
                  "Aucun calendrier vaccinal configure.",
                )}
                description={tr(
                  "Add vaccine requirements by bird age for this model.",
                  "Ajoutez les besoins vaccinaux par age des oiseaux pour ce modele.",
                )}
                icon={ShieldCheck}
                action={
                  writeSchedule
                    ? {
                        label: "Add vaccine",
                        onClick: () =>
                          setDialog({
                            kind: "schedule",
                            model: selectedModel!,
                          }),
                      }
                    : undefined
                }
              />
            )}
          </>
        ) : (
          <EmptyState
            title={tr(
              "Create a performance model first.",
              "Creez d abord un modele de performance.",
            )}
            description={tr(
              "A vaccine schedule belongs to a broiler, layer or breeder model.",
              "Un calendrier vaccinal appartient a un modele broiler, pondeuse ou reproducteur.",
            )}
            icon={ShieldCheck}
          />
        )}
      </section>
      {dialog ? (
        <DialogBox
          title={
            dialog.kind === "climate"
              ? dialog.item
                ? tr("Edit climate profile", "Modifier le profil climatique")
                : tr("Add climate profile", "Ajouter un profil climatique")
              : dialog.item
                ? tr("Edit vaccine schedule", "Modifier le calendrier vaccinal")
                : tr("Add vaccine schedule", "Ajouter un calendrier vaccinal")
          }
          onClose={() => setDialog(null)}
        >
          {dialog.kind === "climate" ? (
            <ClimateForm
              item={dialog.item}
              provinces={provinces.data ?? []}
              busy={climateSave.isPending}
              onSubmit={(body) =>
                climateSave.mutate({ id: dialog.item?.id, body })
              }
            />
          ) : (
            <ScheduleForm
              item={dialog.item}
              busy={scheduleSave.isPending}
              onSubmit={(body) =>
                scheduleSave.mutate({
                  model: dialog.model,
                  id: dialog.item?.id,
                  body,
                })
              }
            />
          )}
        </DialogBox>
      ) : null}
    </section>
  );
}

function DialogBox({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const fr = useLanguage().locale === "fr";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-xl font-semibold text-ink">{title}</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X />
            {fr ? "Fermer" : "Close"}
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Select({
  name,
  value,
  children,
}: {
  name: string;
  value?: string | null;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
    >
      {children}
    </select>
  );
}
function OptionalNumber({
  name,
  label,
  value,
  hint,
}: {
  name: string;
  label: string;
  value?: number | null;
  hint?: string;
}) {
  return (
    <Field label={label} htmlFor={name} hint={hint}>
      <Input name={name} type="number" step="0.01" defaultValue={value ?? ""} />
    </Field>
  );
}
function ClimateForm({
  item,
  provinces,
  busy,
  onSubmit,
}: {
  item?: Climate;
  provinces: Province[];
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const fr = useLanguage().locale === "fr";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = text(form, "name");
    onSubmit({
      code: text(form, "code") || codeFor(name, "climate"),
      name,
      provinceId: text(form, "provinceId") || null,
      countryCode: (text(form, "countryCode") || "CD").toUpperCase(),
      climateClass: text(form, "climateClass"),
      season: optional(form, "season"),
      temperatureC: optionalNumber(form, "temperatureC"),
      humidityPercent: optionalNumber(form, "humidityPercent"),
      waterAdjustmentPercent: number(form, "waterAdjustmentPercent"),
      feedAdjustmentPercent: number(form, "feedAdjustmentPercent"),
      operationalNote: optional(form, "operationalNote"),
      isActive: form.get("isActive") === "on",
    });
  }
  return (
    <form className="mt-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={tx(fr, "Profile name", "Nom du profil")}
          htmlFor="climate-name"
          required
        >
          <Input name="name" defaultValue={item?.name} required />
        </Field>
        <Field
          label={tx(fr, "Code", "Code")}
          htmlFor="climate-code"
          hint="Generated when left blank."
        >
          <Input name="code" defaultValue={item?.code} />
        </Field>
        <Field
          label={tx(fr, "Province", "Province")}
          htmlFor="climate-province"
        >
          <Select name="provinceId" value={item?.province?.id}>
            <option value="">All provinces / country standard</option>
            {provinces.map((province) => (
              <option value={province.id} key={province.id}>
                {province.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tx(fr, "Country", "Pays")} htmlFor="climate-country">
          <Input
            name="countryCode"
            maxLength={2}
            defaultValue={item?.countryCode ?? "CD"}
          />
        </Field>
        <Field
          label={tx(fr, "Climate class", "Type de climat")}
          htmlFor="climate-class"
        >
          <Select name="climateClass" value={item?.climateClass ?? "other"}>
            {climates.map((climate) => (
              <option value={climate} key={climate}>
                {readable(climate)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tx(fr, "Season", "Saison")} htmlFor="climate-season">
          <Input
            name="season"
            defaultValue={item?.season ?? ""}
            placeholder="e.g. rainy season"
          />
        </Field>
        <OptionalNumber
          name="temperatureC"
          label={tx(
            fr,
            "Typical temperature (°C)",
            "Temperature habituelle (C)",
          )}
          value={item?.temperatureC}
        />
        <OptionalNumber
          name="humidityPercent"
          label={tx(fr, "Humidity (%)", "Humidite (%)")}
          value={item?.humidityPercent}
        />
        <OptionalNumber
          name="waterAdjustmentPercent"
          label={tx(fr, "Water adjustment (%)", "Ajustement eau (%)")}
          value={item?.waterAdjustmentPercent ?? 0}
          hint="Use + for higher water needs, − for lower."
        />
        <OptionalNumber
          name="feedAdjustmentPercent"
          label={tx(fr, "Feed adjustment (%)", "Ajustement aliment (%)")}
          value={item?.feedAdjustmentPercent ?? 0}
        />
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
        <input
          name="isActive"
          type="checkbox"
          defaultChecked={item?.isActive ?? true}
        />
        {tx(fr, "Active profile", "Profil actif")}
      </label>
      <Field
        label={tx(fr, "Operating note", "Note exploitation")}
        htmlFor="climate-note"
        className="mt-4"
      >
        <Textarea
          name="operationalNote"
          defaultValue={item?.operationalNote ?? ""}
        />
      </Field>
      <div className="mt-6 flex justify-end">
        <Button type="submit" loading={busy}>
          {tx(fr, "Save profile", "Enregistrer le profil")}
        </Button>
      </div>
    </form>
  );
}
function ScheduleForm({
  item,
  busy,
  onSubmit,
}: {
  item?: VaccineSchedule;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const fr = useLanguage().locale === "fr";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      dayAge: number(form, "dayAge"),
      vaccineName: text(form, "vaccineName"),
      dose: optional(form, "dose"),
      administrationRoute: optional(form, "administrationRoute"),
      notes: optional(form, "notes"),
      isRequired: form.get("isRequired") === "on",
    });
  }
  return (
    <form className="mt-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={tx(fr, "Bird age (days)", "Age oiseaux (jours)")}
          htmlFor="schedule-day"
          required
        >
          <Input
            name="dayAge"
            type="number"
            min="0"
            step="1"
            defaultValue={item?.dayAge}
            required
          />
        </Field>
        <Field
          label={tx(fr, "Vaccine name", "Nom vaccin")}
          htmlFor="schedule-name"
          required
        >
          <Input name="vaccineName" defaultValue={item?.vaccineName} required />
        </Field>
        <Field label={tx(fr, "Dose", "Dose")} htmlFor="schedule-dose">
          <Input name="dose" defaultValue={item?.dose ?? ""} />
        </Field>
        <Field
          label={tx(fr, "Administration route", "Voie administration")}
          htmlFor="schedule-route"
        >
          <Input
            name="administrationRoute"
            defaultValue={item?.administrationRoute ?? ""}
          />
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
        <input
          name="isRequired"
          type="checkbox"
          defaultChecked={item?.isRequired ?? true}
        />
        {tx(fr, "Required vaccine", "Vaccin obligatoire")}
      </label>
      <Field
        label={tx(fr, "Notes", "Notes")}
        htmlFor="schedule-notes"
        className="mt-4"
      >
        <Textarea name="notes" defaultValue={item?.notes ?? ""} />
      </Field>
      <div className="mt-6 flex justify-end">
        <Button type="submit" loading={busy}>
          {tx(fr, "Save schedule", "Enregistrer calendrier")}
        </Button>
      </div>
    </form>
  );
}
