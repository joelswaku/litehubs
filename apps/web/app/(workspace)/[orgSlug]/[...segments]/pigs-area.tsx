"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  Beef,
  Check,
  ChevronRight,
  ClipboardList,
  HeartPulse,
  PiggyBank,
  Plus,
  Scale,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Truck,
  Wheat,
  X,
} from "lucide-react";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { ApiError, get, orgUrl } from "@/lib/api";
import { PIG_RESOURCES, pigsApi, type PigResource } from "@/lib/pigs-api";
import { can } from "@/lib/permissions";
import { formatBusinessDay, formatQuantity } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Area = "foundation" | "daily" | "breeding" | "health";
type Item = Record<string, unknown> & {
  id: string;
  name?: string | null;
  code?: string | null;
  pen?: Place | null;
  site?: Place | null;
  province?: Place | null;
};
type Place = { id: string; name?: string | null; code?: string | null };
type Site = {
  id: string;
  name: string;
  code?: string | null;
  province?: Place | null;
};
type Editor = { resource: PigResource; item?: Item };

const resourcePermission: Record<PigResource, string> = {
  pens: "pens",
  groups: "groups",
  animals: "animals",
  "daily-records": "daily_records",
  feed: "feed",
  water: "water",
  weights: "weights",
  movements: "movements",
  mortality: "mortality",
  losses: "losses",
  breeding: "breeding",
  pregnancies: "pregnancies",
  farrowing: "farrowing",
  piglets: "piglets",
  health: "health",
  vaccinations: "vaccinations",
  treatments: "treatments",
  quarantine: "quarantine",
  veterinary: "veterinary",
};
const areaResources: Record<Area, PigResource[]> = {
  foundation: ["pens", "groups", "animals"],
  daily: [
    "daily-records",
    "feed",
    "water",
    "weights",
    "movements",
    "mortality",
    "losses",
  ],
  breeding: ["breeding", "pregnancies", "farrowing", "piglets"],
  health: ["health", "vaccinations", "treatments", "quarantine", "veterinary"],
};
const areaName = (area: Area, fr: boolean) =>
  fr
    ? (
        {
          foundation: "Fondation",
          daily: "Quotidien",
          breeding: "Reproduction",
          health: "Santé",
        } satisfies Record<Area, string>
      )[area]
    : (
        {
          foundation: "Foundation",
          daily: "Daily operations",
          breeding: "Breeding",
          health: "Health",
        } satisfies Record<Area, string>
      )[area];
const areaDescription = (area: Area, fr: boolean) =>
  fr
    ? (
        {
          foundation: "Enclos, groupes et animaux",
          daily: "Suivi quotidien",
          breeding: "Cycle de reproduction",
          health: "Soins et prévention",
        } satisfies Record<Area, string>
      )[area]
    : (
        {
          foundation: "Pens, groups and animals",
          daily: "Daily tracking",
          breeding: "Breeding cycle",
          health: "Care and prevention",
        } satisfies Record<Area, string>
      )[area];
const resourceLabel: Record<PigResource, string> = {
  pens: "Pens",
  groups: "Groups",
  animals: "Animals",
  "daily-records": "Daily counts",
  feed: "Feed",
  water: "Water",
  weights: "Weights",
  movements: "Movements",
  mortality: "Mortality",
  losses: "Losses",
  breeding: "Breeding",
  pregnancies: "Pregnancies",
  farrowing: "Farrowing",
  piglets: "Piglets",
  health: "Health events",
  vaccinations: "Vaccinations",
  treatments: "Treatments",
  quarantine: "Quarantine",
  veterinary: "Veterinary visits",
};

const resourceName = (resource: PigResource, fr: boolean) =>
  fr
    ? (
        {
          pens: "Enclos",
          groups: "Groupes",
          animals: "Animaux",
          "daily-records": "Comptages quotidiens",
          feed: "Aliment",
          water: "Eau",
          weights: "Pesées",
          movements: "Mouvements",
          mortality: "Mortalité",
          losses: "Pertes",
          breeding: "Reproduction",
          pregnancies: "Gestations",
          farrowing: "Mises bas",
          piglets: "Porcelets",
          health: "Événements de santé",
          vaccinations: "Vaccinations",
          treatments: "Traitements",
          quarantine: "Quarantaine",
          veterinary: "Visites vétérinaires",
        } satisfies Record<PigResource, string>
      )[resource]
    : resourceLabel[resource];
const fieldText = (value: string, fr: boolean) => {
  if (!fr) return value;
  const labels: Record<string, string> = {
    "Site / farm": "Site / ferme",
    "Select a site": "Sélectionner un site",
    "Pen code": "Code de l enclos",
    "Pen name": "Nom de l enclos",
    "Pen type": "Type d enclos",
    Capacity: "Capacité",
    Pen: "Enclos",
    "Select a pen": "Sélectionner un enclos",
    "Group (optional)": "Groupe (facultatif)",
    "No group": "Aucun groupe",
    "Group code": "Code du groupe",
    "Group name": "Nom du groupe",
    "Production stage": "Stade de production",
    "Breed / strain": "Race / souche",
    Breed: "Race",
    Sex: "Sexe",
    "Arrival date": "Date d arrivée",
    "Starting count": "Effectif de départ",
    "Closed date": "Date de clôture",
    "Animal number": "Numéro de l animal",
    Name: "Nom",
    "Ear tag": "Boucle d oreille",
    "Animal type": "Type d animal",
    "Birth date": "Date de naissance",
    "Supplier / source": "Fournisseur / source",
    "Removal date": "Date de sortie",
    "Animal (optional)": "Animal (facultatif)",
    "Select an animal": "Sélectionner un animal",
    "No individual animal": "Aucun animal individuel",
    Animal: "Animal",
    "Sow / gilt": "Truie / cochette",
    Sow: "Truie",
    "Boar (optional)": "Verrat (facultatif)",
    "Breeding record (optional)": "Enregistrement de reproduction (facultatif)",
    "No linked breeding record": "Aucun enregistrement de reproduction lié",
    "Pregnancy record (optional)": "Enregistrement de gestation (facultatif)",
    "No linked pregnancy record": "Aucun enregistrement de gestation lié",
    "Record date": "Date de saisie",
    "Breeding date": "Date de reproduction",
    "Pregnancy confirmation date": "Date de confirmation de gestation",
    "Farrowing date": "Date de mise bas",
    "Piglet record date": "Date d’enregistrement des porcelets",
    "Feed date": "Date de distribution",
    "Water record date": "Date de relevé d’eau",
    "Movement date": "Date du mouvement",
    "Mortality date": "Date de mortalité",
    "Loss date": "Date de perte",
    "Vaccination date": "Date de vaccination",
    "Treatment date": "Date du traitement",
    "Quarantine start date": "Début de la quarantaine",
    "Veterinary visit date": "Date de visite vétérinaire",
    "Linked farrowing (optional)": "Mise bas liée (facultatif)",
    "No recorded farrowing": "Aucune mise bas enregistrée",
    "Opening count": "Effectif à l ouverture",
    Births: "Naissances",
    "Purchases in": "Achats entrants",
    "Transfers in": "Transferts entrants",
    "Transfers out": "Transferts sortants",
    Culls: "Réformes",
    Mortality: "Mortalité",
    "Physical closing count": "Effectif physique de clôture",
    "Feed name": "Nom de l aliment",
    "Feed stage": "Phase de l aliment",
    "Quantity (kg)": "Quantité (kg)",
    "Bag count": "Nombre de sacs",
    "Batch number": "Numéro de lot",
    "Water (L)": "Eau (L)",
    "Water source": "Source d eau",
    "Sample size": "Taille de l échantillon",
    "Average weight (kg)": "Poids moyen (kg)",
    "Minimum weight (kg)": "Poids minimum (kg)",
    "Maximum weight (kg)": "Poids maximum (kg)",
    "Body condition (1–5)": "État corporel (1–5)",
    "Source pen": "Enclos de départ",
    "Select source pen": "Sélectionner l enclos de départ",
    "Destination pen": "Enclos de destination",
    "Select destination pen": "Sélectionner l enclos de destination",
    "Movement type": "Type de mouvement",
    "Head count": "Nombre de têtes",
    Reference: "Référence",
    Reason: "Motif",
    Deaths: "Décès",
    Cause: "Cause",
    "Suspected cause": "Cause présumée",
    "Confirmed diagnosis": "Diagnostic confirmé",
    "Post-mortem": "Autopsie",
    Disposal: "Méthode d élimination",
    Veterinarian: "Vétérinaire",
    "Loss type": "Type de perte",
    Quantity: "Quantité",
    Unit: "Unité",
    Description: "Description",
    Method: "Méthode",
    Status: "Statut",
    "Expected farrowing date": "Date prévue de mise bas",
    "Confirmation method": "Méthode de confirmation",
    "Total born": "Total nés",
    "Live born": "Nés vivants",
    Stillborn: "Mort-nés",
    Mummified: "Momifiés",
    "Fostered in": "Adoptés entrants",
    "Fostered out": "Adoptés sortants",
    "Assistance required": "Assistance requise",
    "Farrowing record ID (optional)": "Identifiant de mise bas (facultatif)",
    Piglets: "Porcelets",
    Females: "Femelles",
    Males: "Mâles",
    "Unknown sex": "Sexe inconnu",
    "Average birth weight (kg)": "Poids moyen à la naissance (kg)",
    "Event type": "Type d événement",
    Severity: "Gravité",
    "Animals affected": "Animaux affectés",
    Diagnosis: "Diagnostic",
    Vaccine: "Vaccin",
    Manufacturer: "Fabricant",
    Batch: "Lot",
    Dose: "Dose",
    Route: "Voie d administration",
    "Next due": "Prochaine échéance",
    "Administered by": "Administré par",
    Product: "Produit",
    Dosage: "Posologie",
    "End date": "Date de fin",
    "Withdrawal end": "Fin du délai d attente",
    "Prescribed by": "Prescrit par",
    "Clearance notes": "Notes de libération",
    "Visit type": "Type de visite",
    Recommendations: "Recommandations",
    "Follow-up date": "Date de suivi",
    Notes: "Notes",
  };
  return labels[value] ?? value;
};
const choiceText = (value: string, fr: boolean) => {
  if (!fr) return title(value);
  const values: Record<string, string> = {
    gestation: "Gestation",
    farrowing: "Mise bas",
    nursery: "Maternité",
    weaner: "Post-sevrage",
    grower: "Croissance",
    finisher: "Finition",
    boar: "Verrat",
    gilt: "Cochette",
    quarantine: "Quarantaine",
    hospital: "Infirmerie",
    holding: "Attente",
    other: "Autre",
    suckling: "Allaitement",
    breeding: "Reproduction",
    replacement: "Renouvellement",
    mixed: "Mixte",
    female: "Femelle",
    male: "Mâle",
    unknown: "Inconnu",
    active: "Actif",
    closed: "Clôturé",
    sold: "Vendu",
    transferred: "Transféré",
    depleted: "Épuisé",
    sow: "Truie",
    barrow: "Porc castré",
    piglet: "Porcelet",
    pregnant: "Gestante",
    lactating: "Allaitante",
    quarantined: "En quarantaine",
    deceased: "Décédé",
    culled: "Réformé",
    creep: "Pré-démarrage",
    starter: "Démarrage",
    lactation: "Lactation",
    medicated: "Médicamenté",
    internal: "Interne",
    purchase: "Achat",
    sale: "Vente",
    transfer: "Transfert",
    return: "Retour",
    disease: "Maladie",
    injury: "Blessure",
    crushing: "Écrasement",
    starvation: "Famine",
    heat_stress: "Stress thermique",
    respiratory: "Respiratoire",
    digestive: "Digestif",
    reproductive: "Reproductif",
    management: "Gestion",
    not_done: "Non effectuée",
    pending: "En attente",
    done: "Effectuée",
    burial: "Enterrement",
    incineration: "Incinération",
    composting: "Compostage",
    rendering: "Équarrissage",
    pig_missing: "Porc manquant",
    feed_spoilage: "Aliment avarié",
    equipment_damage: "Dommage matériel",
    theft: "Vol",
    medication_waste: "Gaspillage de médicaments",
    natural: "Naturelle",
    artificial_insemination: "Insémination artificielle",
    embryo_transfer: "Transfert d embryon",
    planned: "Planifié",
    completed: "Terminé",
    failed: "Échec",
    cancelled: "Annulé",
    observation: "Observation",
    ultrasound: "Échographie",
    blood_test: "Analyse sanguine",
    suspected: "Suspectée",
    confirmed: "Confirmée",
    aborted: "Avortée",
    lost: "Perdue",
    weaned: "Sevré",
    released: "Libéré",
    extended: "Prolongé",
    routine: "Routine",
    emergency: "Urgence",
    diagnostic: "Diagnostic",
    follow_up: "Suivi",
    advisory: "Conseil",
    low: "Faible",
    medium: "Moyen",
    high: "Élevé",
    critical: "Critique",
    open: "Ouvert",
    monitoring: "Surveillance",
    resolved: "Résolu",
    lameness: "Boiterie",
  };
  return values[value] ?? title(value);
};
const detailLabel = (key: string, fr: boolean) => {
  const labels: Record<string, string> = {
    siteId: "Site / farm",
    penId: "Pen",
    groupId: "Group (optional)",
    animalId: "Animal",
    fromPenId: "Source pen",
    toPenId: "Destination pen",
    femaleAnimalId: "Sow / gilt",
    maleAnimalId: "Boar (optional)",
    sowAnimalId: "Sow",
    breedingId: "Breeding record (optional)",
    pregnancyId: "Pregnancy record (optional)",
    farrowingId: "Farrowing record ID (optional)",
    averageWeightKg: "Average weight (kg)",
    minimumWeightKg: "Minimum weight (kg)",
    maximumWeightKg: "Maximum weight (kg)",
    averageBirthWeightKg: "Average birth weight (kg)",
    volumeLiters: "Water (L)",
    quantityKg: "Quantity (kg)",
    bodyConditionScore: "Body condition (1–5)",
    nextDueDate: "Next due",
    followUpDate: "Follow-up date",
    withdrawalEndDate: "Withdrawal end",
    expectedFarrowingDate: "Expected farrowing date",
    clearanceNotes: "Clearance notes",
    sourceName: "Supplier / source",
    veterinarianName: "Veterinarian",
    administeredBy: "Administered by",
    prescribedBy: "Prescribed by",
    referenceNumber: "Reference",
    batchNumber: "Batch number",
    animalNumber: "Animal number",
    earTag: "Ear tag",
    productionStage: "Production stage",
    penType: "Pen type",
    animalType: "Animal type",
    initialCount: "Starting count",
    closingCount: "Physical closing count",
    openingCount: "Opening count",
    birthsCount: "Births",
    purchasesCount: "Purchases in",
    transfersInCount: "Transfers in",
    transfersOutCount: "Transfers out",
    cullsCount: "Culls",
    mortalityCount: "Mortality",
    headCount: "Head count",
    deathCount: "Deaths",
    totalBornCount: "Total born",
    liveBornCount: "Live born",
    stillbornCount: "Stillborn",
    mummifiedCount: "Mummified",
    fosteredInCount: "Fostered in",
    fosteredOutCount: "Fostered out",
    pigletCount: "Piglets",
    femaleCount: "Females",
    maleCount: "Males",
    unknownSexCount: "Unknown sex",
    animalsAffected: "Animals affected",
    eventType: "Event type",
    visitType: "Visit type",
    feedName: "Feed name",
    feedStage: "Feed stage",
    causeCategory: "Cause",
    lossType: "Loss type",
    breedingMethod: "Method",
    confirmationMethod: "Confirmation method",
    postmortemStatus: "Post-mortem",
    disposalMethod: "Disposal",
    administrationRoute: "Route",
    removedAt: "Removal date",
    closedAt: "Closed date",
    arrivalDate: "Arrival date",
    birthDate: "Birth date",
    recordDate: "Record date",
    feedDate: "Record date",
    waterDate: "Record date",
    movementDate: "Record date",
    mortalityDate: "Record date",
    lossDate: "Record date",
    breedingDate: "Record date",
    confirmedDate: "Record date",
    farrowingDate: "Record date",
    vaccinationDate: "Record date",
    treatmentDate: "Record date",
    startDate: "Record date",
    endDate: "End date",
    visitDate: "Record date",
  };
  const fallback = key
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
  return fieldText(labels[key] ?? fallback, fr);
};
function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
function ago(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
function title(value?: unknown) {
  return String(value ?? "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function number(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function dateValue(value: unknown) {
  return typeof value === "string" && value.length >= 10
    ? value.slice(0, 10)
    : "";
}
function optional(form: FormData, key: string) {
  const value = String(form.get(key) ?? "").trim();
  return value || null;
}
function optionalNumber(form: FormData, key: string) {
  const value = String(form.get(key) ?? "").trim();
  return value === "" ? null : number(value);
}
function requiredNumber(form: FormData, key: string) {
  return number(form.get(key));
}
function clearValue(value: unknown) {
  return value == null ? "" : String(value);
}

export function PigsArea({ orgSlug }: { orgSlug: string }) {
  const user = useSessionUser();
  const { locale } = useLanguage();
  const client = useQueryClient();
  const [area, setArea] = useState<Area>("foundation");
  const [resource, setResource] = useState<PigResource>("pens");
  const [siteId, setSiteId] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<{
    resource: PigResource;
    id: string;
  } | null>(null);
  const fr = locale === "fr";
  const canDo = (
    item: PigResource,
    action: "create" | "read" | "update" | "delete",
  ) => can(user, `pigs.${resourcePermission[item]}.${action}`);

  const sites = useQuery({
    queryKey: ["pig-sites", orgSlug],
    queryFn: () => get<{ sites: Site[] }>(orgUrl(orgSlug, "sites")),
    enabled: can(user, "sites.read"),
    select: (data) => data.sites,
  });
  const overview = useQuery({
    queryKey: ["pig-overview", orgSlug, siteId],
    queryFn: () =>
      pigsApi.overview<{ overview: Record<string, unknown> }>(orgSlug, {
        siteId: siteId || undefined,
      }),
    enabled: canDo("pens", "read") || canDo("animals", "read"),
    select: (data) => data.overview,
  });
  const recordQueries = useQueries({
    queries: PIG_RESOURCES.map((item) => ({
      queryKey: ["pigs", orgSlug, item, siteId],
      queryFn: () =>
        pigsApi.list<{ records: Item[] }>(orgSlug, item, {
          siteId: siteId || undefined,
          from: !["pens", "groups", "animals"].includes(item)
            ? ago(90)
            : undefined,
        }),
      enabled: canDo(item, "read"),
      select: (data: { records: Item[] }) => data.records,
    })),
  });
  const records = (item: PigResource) =>
    (recordQueries[PIG_RESOURCES.indexOf(item)]?.data as Item[] | undefined) ??
    [];
  const pens = records("pens");
  const groups = records("groups");
  const animals = records("animals");
  const selectedRecord = useQuery({
    queryKey: ["pig-record", orgSlug, selected?.resource, selected?.id],
    queryFn: () =>
      pigsApi.get<{ record: Item }>(orgSlug, selected!.resource, selected!.id),
    enabled: Boolean(selected) && canDo(selected!.resource, "read"),
    select: (data) => data.record,
  });

  useEffect(() => {
    if (!areaResources[area].includes(resource))
      setResource(areaResources[area][0] ?? "pens");
  }, [area, resource]);
  useEffect(() => {
    if (selected && selected.resource !== resource) setSelected(null);
  }, [resource, selected]);
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["pigs", orgSlug] });
    client.invalidateQueries({ queryKey: ["pig-overview", orgSlug] });
  };
  const save = useMutation({
    mutationFn: ({
      resource: item,
      record,
      body,
    }: {
      resource: PigResource;
      record?: Item;
      body: Record<string, unknown>;
    }) =>
      record
        ? pigsApi.update(orgSlug, item, record.id, body)
        : pigsApi.create(orgSlug, item, body),
    onSuccess: () => {
      setEditor(null);
      setSelected(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: ({
      resource: item,
      id,
    }: {
      resource: PigResource;
      id: string;
    }) => pigsApi.remove(orgSlug, item, id),
    onSuccess: () => {
      setSelected(null);
      refresh();
    },
  });
  const allError = [
    overview.error,
    ...recordQueries.map((query) => query.error),
    selectedRecord.error,
    save.error,
    remove.error,
  ].find(Boolean);
  const message =
    allError instanceof ApiError
      ? allError.message
      : allError
        ? fr
          ? "Une action n’a pas pu être enregistrée."
          : "An action could not be saved."
        : null;
  const items = records(resource);
  const visibleResources = areaResources[area].filter((item) =>
    canDo(item, "read"),
  );

  if (!PIG_RESOURCES.some((item) => canDo(item, "read")))
    return (
      <main className="grid min-h-[60dvh] place-items-center p-6">
        <EmptyState
          title={fr ? "Aucun accès aux porcs" : "No Pig access"}
          description={
            fr
              ? "Votre rôle ne contient pas de permission de lecture pour l’élevage porcin."
              : "Your role does not include a Pig read permission."
          }
        />
      </main>
    );

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="relative overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_88%_16%,rgba(251,191,36,.25),transparent_23%),radial-gradient(circle_at_72%_96%,rgba(251,113,133,.2),transparent_36%),linear-gradient(122deg,#3f1d2e_0%,#7f1d1d_48%,#7c2d12_100%)] px-5 py-7 text-white sm:px-7 sm:py-8">
        <PiggyBank
          className="absolute -right-4 -top-3 size-40 rotate-12 text-white/[.06]"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-amber-100">
              <span className="size-2 rounded-full bg-amber-300 shadow-[0_0_16px_rgba(253,230,138,.95)]" />
              {fr ? "Pilotage porcin" : "Pig operations"}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              {fr ? "Élevage porcin" : "Pig farm"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-amber-50/90">
              {fr
                ? "Enclos, animaux, reproduction, santé et opérations quotidiennes dans un même espace contrôlé."
                : "Pens, animals, breeding, health and daily operations in one controlled workspace."}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {sites.data?.length ? (
              <label className="grid gap-1 text-xs font-medium text-amber-100">
                <span>{fr ? "Site / ferme" : "Site / farm"}</span>
                <select
                  value={siteId}
                  onChange={(event) => setSiteId(event.target.value)}
                  className="h-9 min-w-48 rounded-md border border-white/20 bg-white/10 px-3 text-sm text-white outline-none"
                >
                  <option value="" className="bg-surface-1 text-ink">
                    {fr ? "Tous les sites" : "All sites"}
                  </option>
                  {sites.data.map((site) => (
                    <option key={site.id} value={site.id} className="bg-surface-1 text-ink">
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button
              size="sm"
              className="border-white/20 bg-white text-rose-900 hover:bg-amber-50"
              disabled={!canDo("pens", "create")}
              onClick={() => setEditor({ resource: "pens" })}
            >
              <Plus />
              {fr ? "Ajouter un enclos" : "Add pen"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              disabled={!canDo("animals", "create")}
              onClick={() => setEditor({ resource: "animals" })}
            >
              <Plus />
              {fr ? "Ajouter un animal" : "Add animal"}
            </Button>
          </div>
        </div>
        <div className="relative mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label={fr ? "Enclos" : "Pens"}
            value={number(overview.data?.pens)}
            icon={Beef}
          />
          <Metric
            label={fr ? "Animaux actifs" : "Active animals"}
            value={number(overview.data?.activeAnimals)}
            icon={PiggyBank}
          />
          <Metric
            label={fr ? "Gestations confirmées" : "Confirmed pregnancies"}
            value={number(overview.data?.confirmedPregnancies)}
            icon={HeartPulse}
          />
          <Metric
            label={fr ? "Aliment · 30 jours" : "Feed · 30 days"}
            value={formatQuantity(
              number(overview.data?.feedKgLast30Days),
              "kg",
            )}
            icon={Wheat}
          />
        </div>
      </section>
      {message ? (
        <p
          role="alert"
          className="rounded-lg border border-critical/35 bg-critical/10 px-3 py-2 text-sm text-critical"
        >
          {message}
        </p>
      ) : null}
      <section className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="sticky top-6 h-fit overflow-hidden rounded-3xl border border-border-strong bg-surface-1 shadow-[0_18px_42px_-30px_rgba(15,23,42,.5)] dark:border-border dark:shadow-[0_18px_42px_-30px_rgba(0,0,0,.9)]">
          <div className="border-b border-border-strong bg-[radial-gradient(circle_at_90%_0%,rgba(251,191,36,.16),transparent_38%),linear-gradient(135deg,var(--surface-2),var(--brand-subtle))] px-4 py-4 dark:border-border">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                  {fr ? "Espaces de travail" : "Work areas"}
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {areaName(area, fr)}
                </p>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {areaDescription(area, fr)}
                </p>
              </div>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-subtle text-brand">
                <PiggyBank className="size-4" />
              </span>
            </div>
          </div>
          <nav
            className="grid gap-2 border-b border-border-strong bg-surface-1 px-3 py-3 dark:border-border"
            aria-label={fr ? "Espaces de l’élevage porcin" : "Pig farm areas"}
          >
            {(["foundation", "daily", "breeding", "health"] as Area[]).map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={area === item}
                  onClick={() => setArea(item)}
                  className={`flex min-h-12 items-center gap-2.5 rounded-xl border px-3 text-left text-sm font-semibold transition ${area === item ? "border-brand/35 bg-brand-subtle text-brand shadow-[0_8px_18px_-15px_rgba(42,120,214,.8)]" : "border-border bg-surface-1 text-ink-secondary shadow-[0_4px_10px_-9px_rgba(15,23,42,.38)] hover:border-brand/35 hover:bg-surface-2 hover:text-ink dark:border-border"}`}
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${area === item ? "bg-brand" : "bg-ink-muted/45"}`}
                  />
                  <span className="truncate">{areaName(item, fr)}</span>
                </button>
              ),
            )}
          </nav>
          <div className="bg-surface-1 px-3 py-4">
            <div className="flex items-center justify-between gap-2 px-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-muted">
                  {fr ? "Registres" : "Records"}
                </p>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {areaDescription(area, fr)}
                </p>
              </div>
              <Badge variant="neutral">
                {visibleResources.reduce(
                  (total, item) => total + records(item).length,
                  0,
                )}
              </Badge>
            </div>
            <div className="mt-3 space-y-2">
              {visibleResources.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-current={resource === item ? "page" : undefined}
                  onClick={() => setResource(item)}
                  className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left text-sm transition ${resource === item ? "border-brand/35 bg-brand text-white shadow-[0_10px_22px_-16px_rgba(42,120,214,.95)]" : "border-border bg-surface-1 text-ink-secondary shadow-[0_4px_10px_-9px_rgba(15,23,42,.38)] hover:border-brand/35 hover:bg-surface-2 hover:text-ink dark:border-border"}`}
                >
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-lg ${resource === item ? "bg-white/15 text-white" : "bg-surface-2 text-ink-muted group-hover:bg-surface-1"}`}
                  >
                    <ClipboardList className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {resourceName(item, fr)}
                  </span>
                  <Badge
                    variant="neutral"
                    className={
                      resource === item
                        ? "border-white/20 bg-white/15 text-white"
                        : "shrink-0"
                    }
                  >
                    {records(item).length}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        </aside>{" "}
        <section className="overflow-hidden rounded-3xl border border-border-strong bg-surface-1 shadow-[0_18px_42px_-30px_rgba(15,23,42,.5)] dark:border-border dark:shadow-[0_18px_42px_-30px_rgba(0,0,0,.9)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong bg-[linear-gradient(115deg,var(--brand-subtle),transparent_58%)] px-5 py-4 dark:border-border">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                {area === "foundation"
                  ? fr
                    ? "Configuration"
                    : "Setup"
                  : area === "daily"
                    ? fr
                      ? "Enregistrements"
                      : "Field records"
                    : area === "breeding"
                      ? fr
                        ? "Cycle de reproduction"
                        : "Breeding cycle"
                      : fr
                        ? "Soins et contrôle"
                        : "Care and control"}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-ink">
                {resourceName(resource, fr)}
              </h2>
            </div>
            {canDo(resource, "create") ? (
              <Button size="sm" onClick={() => setEditor({ resource })}>
                <Plus />
                {fr ? "Ajouter" : "Add"} {resourceName(resource, fr)}
              </Button>
            ) : null}
          </div>
          {recordQueries[PIG_RESOURCES.indexOf(resource)]?.isPending ? (
            <SkeletonCard rows={5} />
          ) : recordQueries[PIG_RESOURCES.indexOf(resource)]?.isError ? (
            <ErrorState
              title={
                fr
                  ? "Impossible de charger les données"
                  : "Could not load records"
              }
              onRetry={() =>
                recordQueries[PIG_RESOURCES.indexOf(resource)]?.refetch()
              }
            />
          ) : items.length ? (
            <RecordList
              fr={fr}
              resource={resource}
              items={items}
              canUpdate={canDo(resource, "update")}
              canDelete={canDo(resource, "delete")}
              onView={(id) => setSelected({ resource, id })}
              onEdit={(item) => setEditor({ resource, item })}
              onDelete={(id) => {
                if (
                  window.confirm(
                    fr
                      ? "Supprimer définitivement cet enregistrement ?"
                      : "Delete this record permanently?",
                  )
                )
                  remove.mutate({ resource, id });
              }}
            />
          ) : (
            <EmptyState
              title={fr ? "Aucun enregistrement" : "No records yet"}
              description={
                fr
                  ? "Ajoutez le premier enregistrement pour cette zone."
                  : "Add the first record for this area."
              }
              action={
                canDo(resource, "create")
                  ? {
                      label: fr ? "Ajouter" : "Add record",
                      onClick: () => setEditor({ resource }),
                    }
                  : undefined
              }
            />
          )}
        </section>
        <aside className="sticky top-6 h-fit overflow-hidden rounded-3xl border border-border-strong bg-surface-1 shadow-[0_18px_42px_-30px_rgba(15,23,42,.5)] dark:border-border dark:shadow-[0_18px_42px_-30px_rgba(0,0,0,.9)]">
          <div className="border-b border-border-strong bg-[linear-gradient(115deg,var(--brand-subtle),transparent_65%)] px-5 py-4 dark:border-border">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {fr ? "Détails contrôlés" : "Verified details"}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-ink">
              {selected
                ? resourceName(selected.resource, fr)
                : fr
                  ? "Sélectionnez un élément"
                  : "Select a record"}
            </h2>
          </div>
          {selected ? (
            selectedRecord.isPending ? (
              <SkeletonCard rows={6} />
            ) : selectedRecord.isError ? (
              <ErrorState
                title={fr ? "Détails indisponibles" : "Could not load details"}
                onRetry={() => selectedRecord.refetch()}
              />
            ) : selectedRecord.data ? (
              <RecordDetail item={selectedRecord.data} fr={fr} />
            ) : null
          ) : (
            <EmptyState
              title={fr ? "Aucun élément sélectionné" : "Nothing selected"}
              description={
                fr
                  ? "Ouvrez un enregistrement pour consulter les informations complètes."
                  : "Open a record to inspect the full information."
              }
            />
          )}
        </aside>
      </section>
      {editor ? (
        <RecordEditor
          editor={editor}
          sites={sites.data ?? []}
          pens={pens}
          groups={groups}
          animals={animals}
          farrowings={records("farrowing")}
          busy={save.isPending}
          onClose={() => setEditor(null)}
          onSave={(body) =>
            save.mutate({
              resource: editor.resource,
              record: editor.item,
              body,
            })
          }
        />
      ) : null}
    </main>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof PiggyBank;
}) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/[.1] p-4 shadow-lg shadow-black/10">
      <Icon className="size-4 text-amber-200" />
      <p className="mt-4 text-2xl font-semibold tracking-[-.03em]">{value}</p>
      <p className="mt-1 text-xs font-medium text-amber-100">{label}</p>
    </div>
  );
}

function RecordList({
  fr,
  resource,
  items,
  canUpdate,
  canDelete,
  onView,
  onEdit,
  onDelete,
}: {
  fr: boolean;
  resource: PigResource;
  items: Item[];
  canUpdate: boolean;
  canDelete: boolean;
  onView: (id: string) => void;
  onEdit: (item: Item) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-2 p-3">
      {items.map((item) => {
        const date = firstDate(item);
        return (
          <div
            key={item.id}
            className="group flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-strong bg-surface-1 px-4 py-3.5 shadow-[0_10px_24px_-24px_rgba(15,23,42,.7)] transition hover:border-brand/35 hover:bg-surface-2/65 dark:border-border"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-ink">
                {primary(item, resource, fr)}
              </p>
              <p className="mt-1 truncate text-xs text-ink-secondary">
                {secondary(item, resource, fr)}
                {date ? ` · ${formatBusinessDay(date)}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => onView(item.id)}>
                {fr ? "Voir" : "View"}
              </Button>
              {canUpdate ? (
                <Button size="sm" variant="ghost" onClick={() => onEdit(item)}>
                  {fr ? "Modifier" : "Edit"}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={
                    fr ? "Supprimer l’enregistrement" : "Delete record"
                  }
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 className="size-4 text-critical" />
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function primary(item: Item, resource: PigResource, fr: boolean) {
  const keys: Partial<Record<PigResource, string[]>> = {
    pens: ["name", "code"],
    groups: ["name", "code"],
    animals: ["animalNumber", "name", "earTag"],
    feed: ["feedName"],
    movements: ["movementType"],
    health: ["eventType", "diagnosis"],
    vaccinations: ["vaccineName"],
    treatments: ["productName"],
    veterinary: ["veterinarianName", "visitType"],
    losses: ["lossType"],
    mortality: ["causeCategory"],
    breeding: ["breedingMethod"],
    pregnancies: ["status"],
    farrowing: ["totalBornCount"],
    piglets: ["pigletCount"],
    quarantine: ["reason"],
    weights: ["averageWeightKg"],
    water: ["volumeLiters"],
    "daily-records": ["closingCount", "openingCount"],
  };
  for (const key of keys[resource] ?? []) {
    const value = item[key];
    if (value !== null && value !== undefined && value !== "")
      return key.includes("Count") ||
        key.includes("Kg") ||
        key.includes("Liters")
        ? `${value}`
        : choiceText(String(value), fr);
  }
  return resourceName(resource, fr);
}
function secondary(item: Item, resource: PigResource, fr: boolean) {
  const pen = item.pen?.name ?? item.penName;
  if (pen) return `${pen}`;
  if (resource === "animals")
    return [item.animalType, item.sex, item.breed]
      .filter(Boolean)
      .map((value) => choiceText(String(value), fr))
      .join(" · ");
  if (item.status) return choiceText(String(item.status), fr);
  return item.notes ? String(item.notes) : "—";
}
function firstDate(item: Item) {
  for (const key of [
    "recordDate",
    "feedDate",
    "waterDate",
    "movementDate",
    "mortalityDate",
    "lossDate",
    "breedingDate",
    "confirmedDate",
    "farrowingDate",
    "vaccinationDate",
    "treatmentDate",
    "startDate",
    "visitDate",
    "arrivalDate",
  ])
    if (typeof item[key] === "string") return String(item[key]);
  return null;
}
function detailValue(key: string, value: unknown, fr: boolean) {
  if (typeof value === "boolean")
    return value ? (fr ? "Oui" : "Yes") : fr ? "Non" : "No";
  const enumFields = new Set([
    "penType",
    "productionStage",
    "sex",
    "animalType",
    "status",
    "feedStage",
    "movementType",
    "causeCategory",
    "postmortemStatus",
    "disposalMethod",
    "lossType",
    "breedingMethod",
    "confirmationMethod",
    "eventType",
    "severity",
    "visitType",
  ]);
  return enumFields.has(key) ? choiceText(String(value), fr) : String(value);
}
function RecordDetail({ item, fr }: { item: Item; fr: boolean }) {
  const entries = Object.entries(item).filter(
    ([key, value]) =>
      ![
        "id",
        "organizationId",
        "createdAt",
        "updatedAt",
        "recordedByUserId",
        "notes",
      ].includes(key) &&
      value !== null &&
      value !== undefined &&
      typeof value !== "object",
  );
  return (
    <div className="space-y-3 p-5">
      <dl className="grid gap-3">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="flex justify-between gap-4 border-b border-border pb-2 text-sm"
          >
            <dt className="text-ink-secondary">{detailLabel(key, fr)}</dt>
            <dd className="max-w-[55%] text-right font-medium text-ink">
              {detailValue(key, value, fr)}
            </dd>
          </div>
        ))}
      </dl>
      {item.notes ? (
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-muted">
            {fr ? "Notes" : "Notes"}
          </p>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">
            {String(item.notes)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
function RecordEditor({
  editor,
  sites,
  pens,
  groups,
  animals,
  farrowings,
  busy,
  onClose,
  onSave,
}: {
  editor: Editor;
  sites: Site[];
  pens: Item[];
  groups: Item[];
  animals: Item[];
  farrowings: Item[];
  busy: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const { resource, item } = editor;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(buildBody(resource, new FormData(event.currentTarget)));
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm">
      <div className="mx-auto my-5 w-full max-w-4xl rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {item
                ? fr
                  ? "Modification"
                  : "Correction"
                : fr
                  ? "Nouvel enregistrement"
                  : "New record"}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {item ? (fr ? "Modifier" : "Edit") : fr ? "Ajouter" : "Add"}{" "}
              {resourceName(resource, fr)}
            </h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X />
            {fr ? "Fermer" : "Close"}
          </Button>
        </div>
        <form className="mt-6" onSubmit={submit}>
          <PigFields
            resource={resource}
            item={item}
            sites={sites}
            pens={pens}
            groups={groups}
            animals={animals}
            farrowings={farrowings}
          />
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {fr ? "Annuler" : "Cancel"}
            </Button>
            <Button type="submit" loading={busy}>
              <Check />
              {fr ? "Enregistrer" : "Save record"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
function PigFields({
  resource,
  item,
  sites,
  pens,
  groups,
  animals,
  farrowings,
}: {
  resource: PigResource;
  item?: Item;
  sites: Site[];
  pens: Item[];
  groups: Item[];
  animals: Item[];
  farrowings: Item[];
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const penFields = resource !== "pens" && resource !== "movements";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {resource === "pens" ? (
          <>
            <SelectField
              name="siteId"
              label="Site / farm"
              value={clearValue(item?.siteId)}
              required
            >
              <option value="">{fieldText("Select a site", fr)}</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </SelectField>
            <TextField
              name="code"
              label="Pen code"
              value={item?.code}
              required
            />
            <TextField
              name="name"
              label="Pen name"
              value={item?.name}
              required
            />
            <Choice
              name="penType"
              label="Pen type"
              value={item?.penType}
              values={[
                "gestation",
                "farrowing",
                "nursery",
                "weaner",
                "grower",
                "finisher",
                "boar",
                "gilt",
                "quarantine",
                "hospital",
                "holding",
                "other",
              ]}
            />
            <NumberField
              name="capacity"
              label="Capacity"
              value={item?.capacity}
              required
              integer
            />
          </>
        ) : null}
        {resource === "groups" ? (
          <>
            <PenSelect pens={pens} value={item?.penId} />
            <TextField
              name="code"
              label="Group code"
              value={item?.code}
              required
            />
            <TextField
              name="name"
              label="Group name"
              value={item?.name}
              required
            />
            <Choice
              name="productionStage"
              label="Production stage"
              value={item?.productionStage}
              values={[
                "suckling",
                "weaner",
                "grower",
                "finisher",
                "breeding",
                "replacement",
                "quarantine",
                "other",
              ]}
            />
            <TextField
              name="breed"
              label="Breed / strain"
              value={item?.breed}
            />
            <Choice
              name="sex"
              label="Sex"
              value={item?.sex}
              values={["mixed", "female", "male", "unknown"]}
            />
            <TextField
              name="arrivalDate"
              label="Arrival date"
              type="date"
              value={dateValue(item?.arrivalDate)}
            />
            <NumberField
              name="initialCount"
              label="Starting count"
              value={item?.initialCount}
              required
              integer
            />
            <Choice
              name="status"
              label="Status"
              value={item?.status}
              values={["active", "closed", "sold", "transferred", "depleted"]}
            />
            <TextField
              name="closedAt"
              label="Closed date"
              type="date"
              value={dateValue(item?.closedAt)}
            />
          </>
        ) : null}
        {resource === "animals" ? (
          <>
            <PenSelect pens={pens} value={item?.penId} />
            <GroupSelect groups={groups} value={item?.groupId} />
            <TextField
              name="animalNumber"
              label="Animal number"
              value={item?.animalNumber}
              required
            />
            <TextField name="name" label="Name" value={item?.name} />
            <TextField name="earTag" label="Ear tag" value={item?.earTag} />
            <Choice
              name="sex"
              label="Sex"
              value={item?.sex}
              values={["female", "male", "unknown"]}
            />
            <Choice
              name="animalType"
              label="Animal type"
              value={item?.animalType}
              values={[
                "sow",
                "boar",
                "gilt",
                "barrow",
                "piglet",
                "grower",
                "finisher",
                "other",
              ]}
            />
            <TextField name="breed" label="Breed" value={item?.breed} />
            <TextField
              name="birthDate"
              label="Birth date"
              type="date"
              value={dateValue(item?.birthDate)}
            />
            <TextField
              name="arrivalDate"
              label="Arrival date"
              type="date"
              value={dateValue(item?.arrivalDate)}
            />
            <TextField
              name="sourceName"
              label="Supplier / source"
              value={item?.sourceName}
            />
            <Choice
              name="status"
              label="Status"
              value={item?.status}
              values={[
                "active",
                "pregnant",
                "lactating",
                "quarantined",
                "sold",
                "deceased",
                "culled",
                "transferred",
              ]}
            />
            <TextField
              name="removedAt"
              label="Removal date"
              type="date"
              value={dateValue(item?.removedAt)}
            />
          </>
        ) : null}
        {penFields ? (
          <ReferenceFields
            resource={resource}
            item={item}
            pens={pens}
            groups={groups}
            animals={animals}
            farrowings={farrowings}
          />
        ) : null}
        <EventFields
          resource={resource}
          item={item}
          pens={pens}
          groups={groups}
          animals={animals}
        />
      </div>
      <Field label={fieldText("Notes", fr)} htmlFor="pig-notes">
        <Textarea name="notes" defaultValue={clearValue(item?.notes)} />
      </Field>
    </div>
  );
}

function ReferenceFields({
  resource,
  item,
  pens,
  groups,
  animals,
  farrowings,
}: {
  resource: PigResource;
  item?: Item;
  pens: Item[];
  groups: Item[];
  animals: Item[];
  farrowings: Item[];
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  if (["breeding", "pregnancies", "farrowing"].includes(resource))
    return (
      <>
        <PenSelect pens={pens} value={item?.penId} />
        <AnimalSelect
          name={resource === "breeding" ? "femaleAnimalId" : "sowAnimalId"}
          label={resource === "breeding" ? "Sow / gilt" : "Sow"}
          animals={animals.filter((animal) => animal.sex === "female")}
          value={
            resource === "breeding" ? item?.femaleAnimalId : item?.sowAnimalId
          }
          required
        />
        {resource === "breeding" ? (
          <AnimalSelect
            name="maleAnimalId"
            label="Boar (optional)"
            animals={animals.filter((animal) => animal.sex === "male")}
            value={item?.maleAnimalId}
          />
        ) : null}
        {resource === "pregnancies" ? (
          <SelectField
            name="breedingId"
            label="Breeding record (optional)"
            value={clearValue(item?.breedingId)}
          >
            <option value="">
              {fieldText("No linked breeding record", fr)}
            </option>
          </SelectField>
        ) : null}
        {resource === "farrowing" ? (
          <SelectField
            name="pregnancyId"
            label="Pregnancy record (optional)"
            value={clearValue(item?.pregnancyId)}
          >
            <option value="">
              {fieldText("No linked pregnancy record", fr)}
            </option>
          </SelectField>
        ) : null}
      </>
    );
  return (
    <>
      <PenSelect pens={pens} value={item?.penId} />
      <GroupSelect groups={groups} value={item?.groupId} />
      <AnimalSelect
        name="animalId"
        label="Animal (optional)"
        animals={animals}
        value={item?.animalId}
      />
      {resource === "piglets" ? (
        <FarrowingSelect farrowings={farrowings} value={item?.farrowingId} />
      ) : null}
    </>
  );
}
function EventFields({
  resource,
  item,
  pens,
  groups,
  animals,
}: {
  resource: PigResource;
  item?: Item;
  pens: Item[];
  groups: Item[];
  animals: Item[];
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const recordDate =
    resource === "feed"
      ? "feedDate"
      : resource === "water"
        ? "waterDate"
        : resource === "movements"
          ? "movementDate"
          : resource === "mortality"
            ? "mortalityDate"
            : resource === "losses"
              ? "lossDate"
              : resource === "breeding"
                ? "breedingDate"
                : resource === "pregnancies"
                  ? "confirmedDate"
                  : resource === "farrowing"
                    ? "farrowingDate"
                    : resource === "vaccinations"
                      ? "vaccinationDate"
                      : resource === "treatments"
                        ? "treatmentDate"
                        : resource === "quarantine"
                          ? "startDate"
                          : resource === "veterinary"
                            ? "visitDate"
                            : "recordDate";
  if (["pens", "groups", "animals"].includes(resource)) return null;
  if (resource === "daily-records")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <NumberField
          name="openingCount"
          label="Opening count"
          value={item?.openingCount}
          integer
        />
        <NumberField
          name="birthsCount"
          label="Births"
          value={item?.birthsCount ?? 0}
          integer
        />
        <NumberField
          name="purchasesCount"
          label="Purchases in"
          value={item?.purchasesCount ?? 0}
          integer
        />
        <NumberField
          name="transfersInCount"
          label="Transfers in"
          value={item?.transfersInCount ?? 0}
          integer
        />
        <NumberField
          name="transfersOutCount"
          label="Transfers out"
          value={item?.transfersOutCount ?? 0}
          integer
        />
        <NumberField
          name="cullsCount"
          label="Culls"
          value={item?.cullsCount ?? 0}
          integer
        />
        <NumberField
          name="mortalityCount"
          label="Mortality"
          value={item?.mortalityCount ?? 0}
          integer
        />
        <NumberField
          name="closingCount"
          label="Physical closing count"
          value={item?.closingCount}
          integer
        />
      </>
    );
  if (resource === "feed")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <TextField
          name="feedName"
          label="Feed name"
          value={item?.feedName}
          required
        />
        <Choice
          name="feedStage"
          label="Feed stage"
          value={item?.feedStage}
          values={[
            "creep",
            "starter",
            "weaner",
            "grower",
            "finisher",
            "gestation",
            "lactation",
            "boar",
            "medicated",
            "other",
          ]}
        />
        <NumberField
          name="quantityKg"
          label="Quantity (kg)"
          value={item?.quantityKg}
          required
        />
        <NumberField name="bagCount" label="Bag count" value={item?.bagCount} />
        <TextField
          name="batchNumber"
          label="Batch number"
          value={item?.batchNumber}
        />
      </>
    );
  if (resource === "water")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <NumberField
          name="volumeLiters"
          label="Water (L)"
          value={item?.volumeLiters}
          required
        />
        <TextField
          name="sourceName"
          label="Water source"
          value={item?.sourceName}
        />
      </>
    );
  if (resource === "weights")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <NumberField
          name="sampleSize"
          label="Sample size"
          value={item?.sampleSize}
          required
          integer
        />
        <NumberField
          name="averageWeightKg"
          label="Average weight (kg)"
          value={item?.averageWeightKg}
          required
        />
        <NumberField
          name="minimumWeightKg"
          label="Minimum weight (kg)"
          value={item?.minimumWeightKg}
        />
        <NumberField
          name="maximumWeightKg"
          label="Maximum weight (kg)"
          value={item?.maximumWeightKg}
        />
        <NumberField
          name="bodyConditionScore"
          label="Body condition (1–5)"
          value={item?.bodyConditionScore}
        />
      </>
    );
  if (resource === "movements")
    return (
      <>
        <AnimalSelect
          name="animalId"
          label="Animal"
          animals={animals}
          value={item?.animalId}
        />
        <GroupSelect groups={groups} value={item?.groupId} />
        <SelectField
          name="fromPenId"
          label="Source pen"
          value={clearValue(item?.fromPenId)}
          required
        >
          <option value="">{fieldText("Select source pen", fr)}</option>
          {pens.map((pen) => (
            <option key={pen.id} value={pen.id}>
              {String(pen.name ?? pen.code)}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="toPenId"
          label="Destination pen"
          value={clearValue(item?.toPenId)}
          required
        >
          <option value="">{fieldText("Select destination pen", fr)}</option>
          {pens.map((pen) => (
            <option key={pen.id} value={pen.id}>
              {String(pen.name ?? pen.code)}
            </option>
          ))}
        </SelectField>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <Choice
          name="movementType"
          label="Movement type"
          value={item?.movementType}
          values={[
            "internal",
            "purchase",
            "sale",
            "transfer",
            "quarantine",
            "hospital",
            "return",
            "other",
          ]}
        />
        <NumberField
          name="headCount"
          label="Head count"
          value={item?.headCount}
          required
          integer
        />
        <TextField
          name="referenceNumber"
          label="Reference"
          value={item?.referenceNumber}
        />
        <TextField name="reason" label="Reason" value={item?.reason} />
      </>
    );
  if (resource === "mortality")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <NumberField
          name="deathCount"
          label="Deaths"
          value={item?.deathCount}
          required
          integer
        />
        <Choice
          name="causeCategory"
          label="Cause"
          value={item?.causeCategory}
          values={[
            "unknown",
            "disease",
            "injury",
            "crushing",
            "starvation",
            "heat_stress",
            "respiratory",
            "digestive",
            "reproductive",
            "management",
            "other",
          ]}
        />
        <TextField
          name="suspectedCause"
          label="Suspected cause"
          value={item?.suspectedCause}
        />
        <TextField
          name="confirmedDiagnosis"
          label="Confirmed diagnosis"
          value={item?.confirmedDiagnosis}
        />
        <Choice
          name="postmortemStatus"
          label="Post-mortem"
          value={item?.postmortemStatus}
          values={["not_done", "pending", "done"]}
        />
        <Choice
          name="disposalMethod"
          label="Disposal"
          value={item?.disposalMethod}
          values={[
            "burial",
            "incineration",
            "composting",
            "rendering",
            "other",
          ]}
        />
        <TextField
          name="veterinarianName"
          label="Veterinarian"
          value={item?.veterinarianName}
        />
      </>
    );
  if (resource === "losses")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <Choice
          name="lossType"
          label="Loss type"
          value={item?.lossType}
          values={[
            "pig_missing",
            "feed_spoilage",
            "equipment_damage",
            "theft",
            "medication_waste",
            "other",
          ]}
        />
        <NumberField
          name="quantity"
          label="Quantity"
          value={item?.quantity}
          required
        />
        <TextField
          name="unit"
          label="Unit"
          value={item?.unit ?? "count"}
          required
        />
        <TextField
          name="description"
          label="Description"
          value={item?.description}
          required
        />
      </>
    );
  if (resource === "breeding")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <Choice
          name="breedingMethod"
          label="Method"
          value={item?.breedingMethod}
          values={[
            "natural",
            "artificial_insemination",
            "embryo_transfer",
            "other",
          ]}
        />
        <Choice
          name="status"
          label="Status"
          value={item?.status}
          values={["planned", "completed", "failed", "cancelled"]}
        />
        <TextField
          name="expectedFarrowingDate"
          label="Expected farrowing date"
          type="date"
          value={dateValue(item?.expectedFarrowingDate)}
        />
      </>
    );
  if (resource === "pregnancies")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <Choice
          name="confirmationMethod"
          label="Confirmation method"
          value={item?.confirmationMethod}
          values={["observation", "ultrasound", "blood_test", "other"]}
        />
        <Choice
          name="status"
          label="Status"
          value={item?.status}
          values={[
            "suspected",
            "confirmed",
            "aborted",
            "farrowed",
            "lost",
            "closed",
          ]}
        />
        <TextField
          name="expectedFarrowingDate"
          label="Expected farrowing date"
          type="date"
          value={dateValue(item?.expectedFarrowingDate)}
        />
      </>
    );
  if (resource === "farrowing")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <NumberField
          name="totalBornCount"
          label="Total born"
          value={item?.totalBornCount}
          required
          integer
        />
        <NumberField
          name="liveBornCount"
          label="Live born"
          value={item?.liveBornCount}
          required
          integer
        />
        <NumberField
          name="stillbornCount"
          label="Stillborn"
          value={item?.stillbornCount ?? 0}
          integer
        />
        <NumberField
          name="mummifiedCount"
          label="Mummified"
          value={item?.mummifiedCount ?? 0}
          integer
        />
        <NumberField
          name="fosteredInCount"
          label="Fostered in"
          value={item?.fosteredInCount ?? 0}
          integer
        />
        <NumberField
          name="fosteredOutCount"
          label="Fostered out"
          value={item?.fosteredOutCount ?? 0}
          integer
        />
        <CheckField
          name="assistanceRequired"
          label="Assistance required"
          checked={Boolean(item?.assistanceRequired)}
        />
      </>
    );
  if (resource === "piglets")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <NumberField
          name="pigletCount"
          label="Piglets"
          value={item?.pigletCount}
          required
          integer
        />
        <NumberField
          name="femaleCount"
          label="Females"
          value={item?.femaleCount ?? 0}
          integer
        />
        <NumberField
          name="maleCount"
          label="Males"
          value={item?.maleCount ?? 0}
          integer
        />
        <NumberField
          name="unknownSexCount"
          label="Unknown sex"
          value={item?.unknownSexCount ?? 0}
          integer
        />
        <NumberField
          name="averageBirthWeightKg"
          label="Average birth weight (kg)"
          value={item?.averageBirthWeightKg}
        />
        <Choice
          name="status"
          label="Status"
          value={item?.status}
          values={["active", "weaned", "sold", "deceased", "transferred"]}
        />
      </>
    );
  if (resource === "health")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <Choice
          name="eventType"
          label="Event type"
          value={item?.eventType}
          values={[
            "observation",
            "suspected_disease",
            "confirmed_disease",
            "outbreak",
            "injury",
            "lameness",
            "reproductive",
            "other",
          ]}
        />
        <Choice
          name="severity"
          label="Severity"
          value={item?.severity}
          values={["low", "medium", "high", "critical"]}
        />
        <NumberField
          name="animalsAffected"
          label="Animals affected"
          value={item?.animalsAffected ?? 0}
          integer
        />
        <TextField name="diagnosis" label="Diagnosis" value={item?.diagnosis} />
        <TextField
          name="veterinarianName"
          label="Veterinarian"
          value={item?.veterinarianName}
        />
        <Choice
          name="status"
          label="Status"
          value={item?.status}
          values={["open", "monitoring", "resolved"]}
        />
      </>
    );
  if (resource === "vaccinations")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <TextField
          name="vaccineName"
          label="Vaccine"
          value={item?.vaccineName}
          required
        />
        <TextField
          name="manufacturer"
          label="Manufacturer"
          value={item?.manufacturer}
        />
        <TextField name="batchNumber" label="Batch" value={item?.batchNumber} />
        <TextField name="dose" label="Dose" value={item?.dose} />
        <TextField
          name="administrationRoute"
          label="Route"
          value={item?.administrationRoute}
        />
        <TextField
          name="nextDueDate"
          label="Next due"
          type="date"
          value={dateValue(item?.nextDueDate)}
        />
        <TextField
          name="administeredBy"
          label="Administered by"
          value={item?.administeredBy}
        />
      </>
    );
  if (resource === "treatments")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <TextField
          name="productName"
          label="Product"
          value={item?.productName}
          required
        />
        <TextField name="reason" label="Reason" value={item?.reason} required />
        <TextField name="dosage" label="Dosage" value={item?.dosage} />
        <TextField
          name="administrationRoute"
          label="Route"
          value={item?.administrationRoute}
        />
        <TextField
          name="endDate"
          label="End date"
          type="date"
          value={dateValue(item?.endDate)}
        />
        <TextField
          name="withdrawalEndDate"
          label="Withdrawal end"
          type="date"
          value={dateValue(item?.withdrawalEndDate)}
        />
        <TextField
          name="prescribedBy"
          label="Prescribed by"
          value={item?.prescribedBy}
        />
      </>
    );
  if (resource === "quarantine")
    return (
      <>
        <DateField name={recordDate} value={item?.[recordDate]} />
        <TextField
          name="endDate"
          label="End date"
          type="date"
          value={dateValue(item?.endDate)}
        />
        <TextField name="reason" label="Reason" value={item?.reason} required />
        <Choice
          name="status"
          label="Status"
          value={item?.status}
          values={["active", "released", "extended", "cancelled"]}
        />
        <TextField
          name="clearanceNotes"
          label="Clearance notes"
          value={item?.clearanceNotes}
        />
      </>
    );
  return (
    <>
      <DateField name={recordDate} value={item?.[recordDate]} />
      <Choice
        name="visitType"
        label="Visit type"
        value={item?.visitType}
        values={[
          "routine",
          "emergency",
          "diagnostic",
          "follow_up",
          "advisory",
          "other",
        ]}
      />
      <TextField
        name="veterinarianName"
        label="Veterinarian"
        value={item?.veterinarianName}
        required
      />
      <TextField name="diagnosis" label="Diagnosis" value={item?.diagnosis} />
      <TextField
        name="recommendations"
        label="Recommendations"
        value={item?.recommendations}
      />
      <TextField
        name="followUpDate"
        label="Follow-up date"
        type="date"
        value={dateValue(item?.followUpDate)}
      />
      <Choice
        name="status"
        label="Status"
        value={item?.status}
        values={["open", "monitoring", "closed"]}
      />
    </>
  );
}

function buildBody(
  resource: PigResource,
  form: FormData,
): Record<string, unknown> {
  const notes = optional(form, "notes");
  const reference = {
    penId: optional(form, "penId"),
    groupId: optional(form, "groupId"),
    animalId: optional(form, "animalId"),
  };
  if (resource === "pens")
    return {
      siteId: String(form.get("siteId")),
      code: String(form.get("code")),
      name: String(form.get("name")),
      penType: String(form.get("penType")),
      capacity: requiredNumber(form, "capacity"),
      notes,
    };
  if (resource === "groups")
    return {
      penId: String(form.get("penId")),
      code: String(form.get("code")),
      name: String(form.get("name")),
      productionStage: String(form.get("productionStage")),
      breed: optional(form, "breed"),
      sex: String(form.get("sex")),
      arrivalDate: optional(form, "arrivalDate"),
      initialCount: requiredNumber(form, "initialCount"),
      status: String(form.get("status")),
      closedAt: optional(form, "closedAt"),
      notes,
    };
  if (resource === "animals")
    return {
      penId: String(form.get("penId")),
      groupId: optional(form, "groupId"),
      animalNumber: String(form.get("animalNumber")),
      name: optional(form, "name"),
      earTag: optional(form, "earTag"),
      sex: String(form.get("sex")),
      animalType: String(form.get("animalType")),
      breed: optional(form, "breed"),
      birthDate: optional(form, "birthDate"),
      arrivalDate: optional(form, "arrivalDate"),
      sourceName: optional(form, "sourceName"),
      status: String(form.get("status")),
      removedAt: optional(form, "removedAt"),
      notes,
    };
  if (resource === "daily-records")
    return {
      ...reference,
      recordDate: String(form.get("recordDate")),
      openingCount: optionalNumber(form, "openingCount"),
      birthsCount: requiredNumber(form, "birthsCount"),
      purchasesCount: requiredNumber(form, "purchasesCount"),
      transfersInCount: requiredNumber(form, "transfersInCount"),
      transfersOutCount: requiredNumber(form, "transfersOutCount"),
      cullsCount: requiredNumber(form, "cullsCount"),
      mortalityCount: requiredNumber(form, "mortalityCount"),
      closingCount: optionalNumber(form, "closingCount"),
      notes,
    };
  if (resource === "feed")
    return {
      penId: String(form.get("penId")),
      groupId: optional(form, "groupId"),
      feedDate: String(form.get("feedDate")),
      feedName: String(form.get("feedName")),
      feedStage: String(form.get("feedStage")),
      quantityKg: requiredNumber(form, "quantityKg"),
      bagCount: optionalNumber(form, "bagCount"),
      batchNumber: optional(form, "batchNumber"),
      notes,
    };
  if (resource === "water")
    return {
      penId: String(form.get("penId")),
      groupId: optional(form, "groupId"),
      waterDate: String(form.get("waterDate")),
      volumeLiters: requiredNumber(form, "volumeLiters"),
      sourceName: optional(form, "sourceName"),
      notes,
    };
  if (resource === "weights")
    return {
      ...reference,
      recordDate: String(form.get("recordDate")),
      sampleSize: requiredNumber(form, "sampleSize"),
      averageWeightKg: requiredNumber(form, "averageWeightKg"),
      minimumWeightKg: optionalNumber(form, "minimumWeightKg"),
      maximumWeightKg: optionalNumber(form, "maximumWeightKg"),
      bodyConditionScore: optionalNumber(form, "bodyConditionScore"),
      notes,
    };
  if (resource === "movements")
    return {
      movementDate: String(form.get("movementDate")),
      animalId: optional(form, "animalId"),
      groupId: optional(form, "groupId"),
      fromPenId: String(form.get("fromPenId")),
      toPenId: String(form.get("toPenId")),
      movementType: String(form.get("movementType")),
      headCount: requiredNumber(form, "headCount"),
      reason: optional(form, "reason"),
      referenceNumber: optional(form, "referenceNumber"),
      notes,
    };
  if (resource === "mortality")
    return {
      ...reference,
      mortalityDate: String(form.get("mortalityDate")),
      deathCount: requiredNumber(form, "deathCount"),
      causeCategory: String(form.get("causeCategory")),
      suspectedCause: optional(form, "suspectedCause"),
      confirmedDiagnosis: optional(form, "confirmedDiagnosis"),
      postmortemStatus: String(form.get("postmortemStatus")),
      disposalMethod: String(form.get("disposalMethod")),
      veterinarianName: optional(form, "veterinarianName"),
      notes,
    };
  if (resource === "losses")
    return {
      penId: String(form.get("penId")),
      lossDate: String(form.get("lossDate")),
      lossType: String(form.get("lossType")),
      quantity: requiredNumber(form, "quantity"),
      unit: String(form.get("unit")),
      description: String(form.get("description")),
      notes,
    };
  if (resource === "breeding")
    return {
      penId: String(form.get("penId")),
      femaleAnimalId: String(form.get("femaleAnimalId")),
      maleAnimalId: optional(form, "maleAnimalId"),
      breedingDate: String(form.get("breedingDate")),
      breedingMethod: String(form.get("breedingMethod")),
      status: String(form.get("status")),
      expectedFarrowingDate: optional(form, "expectedFarrowingDate"),
      notes,
    };
  if (resource === "pregnancies")
    return {
      penId: String(form.get("penId")),
      sowAnimalId: String(form.get("sowAnimalId")),
      breedingId: optional(form, "breedingId"),
      confirmedDate: String(form.get("confirmedDate")),
      confirmationMethod: String(form.get("confirmationMethod")),
      expectedFarrowingDate: optional(form, "expectedFarrowingDate"),
      status: String(form.get("status")),
      notes,
    };
  if (resource === "farrowing")
    return {
      penId: String(form.get("penId")),
      sowAnimalId: String(form.get("sowAnimalId")),
      pregnancyId: optional(form, "pregnancyId"),
      farrowingDate: String(form.get("farrowingDate")),
      totalBornCount: requiredNumber(form, "totalBornCount"),
      liveBornCount: requiredNumber(form, "liveBornCount"),
      stillbornCount: requiredNumber(form, "stillbornCount"),
      mummifiedCount: requiredNumber(form, "mummifiedCount"),
      fosteredInCount: requiredNumber(form, "fosteredInCount"),
      fosteredOutCount: requiredNumber(form, "fosteredOutCount"),
      assistanceRequired: form.get("assistanceRequired") === "on",
      notes,
    };
  if (resource === "piglets")
    return {
      penId: String(form.get("penId")),
      groupId: optional(form, "groupId"),
      farrowingId: optional(form, "farrowingId"),
      recordDate: String(form.get("recordDate")),
      pigletCount: requiredNumber(form, "pigletCount"),
      femaleCount: requiredNumber(form, "femaleCount"),
      maleCount: requiredNumber(form, "maleCount"),
      unknownSexCount: requiredNumber(form, "unknownSexCount"),
      averageBirthWeightKg: optionalNumber(form, "averageBirthWeightKg"),
      status: String(form.get("status")),
      notes,
    };
  if (resource === "health")
    return {
      ...reference,
      recordDate: String(form.get("recordDate")),
      eventType: String(form.get("eventType")),
      severity: String(form.get("severity")),
      animalsAffected: requiredNumber(form, "animalsAffected"),
      diagnosis: optional(form, "diagnosis"),
      veterinarianName: optional(form, "veterinarianName"),
      status: String(form.get("status")),
      notes,
    };
  if (resource === "vaccinations")
    return {
      ...reference,
      vaccinationDate: String(form.get("vaccinationDate")),
      vaccineName: String(form.get("vaccineName")),
      manufacturer: optional(form, "manufacturer"),
      batchNumber: optional(form, "batchNumber"),
      dose: optional(form, "dose"),
      administrationRoute: optional(form, "administrationRoute"),
      nextDueDate: optional(form, "nextDueDate"),
      administeredBy: optional(form, "administeredBy"),
      notes,
    };
  if (resource === "treatments")
    return {
      ...reference,
      treatmentDate: String(form.get("treatmentDate")),
      productName: String(form.get("productName")),
      reason: String(form.get("reason")),
      dosage: optional(form, "dosage"),
      administrationRoute: optional(form, "administrationRoute"),
      endDate: optional(form, "endDate"),
      withdrawalEndDate: optional(form, "withdrawalEndDate"),
      prescribedBy: optional(form, "prescribedBy"),
      notes,
    };
  if (resource === "quarantine")
    return {
      ...reference,
      startDate: String(form.get("startDate")),
      endDate: optional(form, "endDate"),
      reason: String(form.get("reason")),
      status: String(form.get("status")),
      clearanceNotes: optional(form, "clearanceNotes"),
      notes,
    };
  return {
    ...reference,
    visitDate: String(form.get("visitDate")),
    visitType: String(form.get("visitType")),
    veterinarianName: String(form.get("veterinarianName")),
    diagnosis: optional(form, "diagnosis"),
    recommendations: optional(form, "recommendations"),
    followUpDate: optional(form, "followUpDate"),
    status: String(form.get("status")),
    notes,
  };
}

function TextField({
  name,
  label,
  value,
  required,
  type = "text",
}: {
  name: string;
  label: string;
  value?: unknown;
  required?: boolean;
  type?: string;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  return (
    <Field label={fieldText(label, fr)} htmlFor={name} required={required}>
      <Input
        name={name}
        type={type}
        defaultValue={value == null ? "" : String(value)}
        required={required}
      />
    </Field>
  );
}
function NumberField({
  name,
  label,
  value,
  required,
  integer,
}: {
  name: string;
  label: string;
  value?: unknown;
  required?: boolean;
  integer?: boolean;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  return (
    <Field label={fieldText(label, fr)} htmlFor={name} required={required}>
      <Input
        name={name}
        type="number"
        min="0"
        step={integer ? "1" : "0.01"}
        defaultValue={value == null ? "" : String(value)}
        required={required}
      />
    </Field>
  );
}
function DateField({ name, value }: { name: string; value?: unknown }) {
  const labels: Record<string, string> = {
    breedingDate: "Breeding date",
    confirmedDate: "Pregnancy confirmation date",
    farrowingDate: "Farrowing date",
    feedDate: "Feed date",
    waterDate: "Water record date",
    movementDate: "Movement date",
    mortalityDate: "Mortality date",
    lossDate: "Loss date",
    vaccinationDate: "Vaccination date",
    treatmentDate: "Treatment date",
    startDate: "Quarantine start date",
    visitDate: "Veterinary visit date",
  };
  return (
    <TextField
      name={name}
      label={
        labels[name] ??
        (name === "recordDate" ? "Piglet record date" : "Record date")
      }
      type="date"
      value={dateValue(value) || today()}
      required
    />
  );
}
function Choice({
  name,
  label,
  value,
  values,
}: {
  name: string;
  label: string;
  value?: unknown;
  values: string[];
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  return (
    <SelectField
      name={name}
      label={label}
      value={clearValue(value || values[0])}
    >
      {values.map((option) => (
        <option key={option} value={option}>
          {choiceText(option, fr)}
        </option>
      ))}
    </SelectField>
  );
}
function SelectField({
  name,
  label,
  value,
  children,
  required,
}: {
  name: string;
  label: string;
  value?: string;
  children: ReactNode;
  required?: boolean;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  return (
    <Field label={fieldText(label, fr)} htmlFor={name} required={required}>
      <select
        name={name}
        defaultValue={value ?? ""}
        required={required}
        className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
      >
        {children}
      </select>
    </Field>
  );
}
function PenSelect({ pens, value }: { pens: Item[]; value?: unknown }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  return (
    <SelectField name="penId" label="Pen" value={clearValue(value)} required>
      <option value="">{fieldText("Select a pen", fr)}</option>
      {pens.map((pen) => (
        <option key={pen.id} value={pen.id}>
          {String(pen.name ?? pen.code)}
        </option>
      ))}
    </SelectField>
  );
}
function GroupSelect({ groups, value }: { groups: Item[]; value?: unknown }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  return (
    <SelectField
      name="groupId"
      label="Group (optional)"
      value={clearValue(value)}
    >
      <option value="">{fieldText("No group", fr)}</option>
      {groups.map((group) => (
        <option key={group.id} value={group.id}>
          {String(group.name ?? group.code)}
        </option>
      ))}
    </SelectField>
  );
}
function AnimalSelect({
  name,
  label,
  animals,
  value,
  required,
}: {
  name: string;
  label: string;
  animals: Item[];
  value?: unknown;
  required?: boolean;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  return (
    <SelectField
      name={name}
      label={label}
      value={clearValue(value)}
      required={required}
    >
      <option value="">
        {required
          ? fieldText("Select an animal", fr)
          : fieldText("No individual animal", fr)}
      </option>
      {animals.map((animal) => (
        <option key={animal.id} value={animal.id}>
          {String(animal.animalNumber ?? animal.earTag ?? animal.name)}
        </option>
      ))}
    </SelectField>
  );
}
function FarrowingSelect({
  farrowings,
  value,
}: {
  farrowings: Item[];
  value?: unknown;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  return (
    <SelectField
      name="farrowingId"
      label="Linked farrowing (optional)"
      value={clearValue(value)}
    >
      <option value="">{fieldText("No recorded farrowing", fr)}</option>
      {farrowings.map((farrowing) => {
        const date = firstDate(farrowing);
        const count =
          farrowing.totalBornCount == null
            ? null
            : String(farrowing.totalBornCount);
        return (
          <option key={farrowing.id} value={farrowing.id}>
            {fr
              ? `Mise bas${date ? ` · ${formatBusinessDay(date)}` : ""}${count ? ` · ${count} nés` : ""}`
              : `Farrowing${date ? ` · ${formatBusinessDay(date)}` : ""}${count ? ` · ${count} born` : ""}`}
          </option>
        );
      })}
    </SelectField>
  );
}
function CheckField({
  name,
  label,
  checked,
}: {
  name: string;
  label: string;
  checked: boolean;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  return (
    <label className="flex h-9 items-center gap-2 text-sm text-ink-secondary">
      <input name={name} type="checkbox" defaultChecked={checked} />
      {fieldText(label, fr)}
    </label>
  );
}
