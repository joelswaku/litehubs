"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenCheck,
  CheckCircle2,
  Download,
  Edit3,
  FileText,
  History,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { get, orgApiUrl, orgUrl, put } from "@/lib/api";
import { isOwner } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type RuleSection = {
  id: string;
  fr: string;
  en: string;
  summaryFr: string;
  summaryEn: string;
  rules: Array<{ fr: string; en: string }>;
};

const sections: RuleSection[] = [
  {
    id: "purpose",
    fr: "Objet, application et responsabilité",
    en: "Purpose, scope and accountability",
    summaryFr:
      "Ce règlement organise le travail, la protection des personnes, des animaux, des biens et de l’argent de Congo Omega.",
    summaryEn:
      "These rules organise Congo Omega work and protect people, animals, assets and company funds.",
    rules: [
      {
        fr: "Il s’applique à tout employé, manager, prestataire et visiteur lorsqu’il intervient pour Congo Omega.",
        en: "It applies to every employee, manager, contractor and visitor working for Congo Omega.",
      },
      {
        fr: "La loi applicable, les exigences vétérinaires, fiscales, sanitaires et de travail prévalent toujours sur ce règlement interne.",
        en: "Applicable law and veterinary, tax, health and labour requirements always take precedence over these internal rules.",
      },
      {
        fr: "Chaque personne est responsable de signaler un risque, une erreur, un incident ou une fraude sans attendre.",
        en: "Each person must promptly report a risk, mistake, incident or suspected fraud.",
      },
    ],
  },
  {
    id: "governance",
    fr: "Gouvernance, rôles et accès LiteHubs",
    en: "Governance, roles and LiteHubs access",
    summaryFr:
      "Chaque accès est donné pour une fonction, un site, une province ou un projet précis — jamais par commodité.",
    summaryEn:
      "Every access right is granted for a specific function, site, province or project — never for convenience.",
    rules: [
      {
        fr: "Le Owner contrôle les budgets, approbations, rôles, accès sensibles et décisions exceptionnelles.",
        en: "The Owner controls budgets, approvals, roles, sensitive access and exceptional decisions.",
      },
      {
        fr: "Un Project Manager ne travaille que sur les projets qui lui sont attribués ; il ne gère pas les dossiers RH privés ni le budget principal.",
        en: "A Project Manager works only on assigned projects; they do not manage private HR files or the main budget.",
      },
      {
        fr: "Les employés consultent uniquement leurs tâches, horaires, formations, documents et opérations autorisés.",
        en: "Employees see only their authorised tasks, schedules, training, documents and operations.",
      },
      {
        fr: "Les mots de passe, téléphones, adresses, contrats, permis et fiches de paie sont confidentiels. Les dossiers RH complets restent réservés au Owner et au responsable RH.",
        en: "Passwords, phones, addresses, contracts, licences and payslips are confidential. Full HR files remain restricted to the Owner and HR Officer.",
      },
    ],
  },
  {
    id: "people",
    fr: "Personnel, présence, formation et conduite",
    en: "People, attendance, training and conduct",
    summaryFr:
      "Le personnel est affecté à un site et travaille avec une identité, un horaire et des responsabilités clairs.",
    summaryEn:
      "Staff are assigned to a site and work with a clear identity, schedule and responsibilities.",
    rules: [
      {
        fr: "Toute arrivée et tout départ sont pointés avec le matricule personnel. Il est interdit de pointer pour une autre personne.",
        en: "Every arrival and departure is recorded with the personal employee number. Clocking in for another person is prohibited.",
      },
      {
        fr: "Une formation obligatoire doit être terminée avant l’exécution d’un travail qui l’exige, notamment en sécurité, biosécurité et conduite.",
        en: "Required training must be completed before performing work that requires it, especially safety, biosecurity and driving.",
      },
      {
        fr: "Les absences, accidents, conflits, actes dangereux et manquements sont signalés dans LiteHubs selon le circuit de supervision.",
        en: "Absences, accidents, conflicts, unsafe acts and breaches are reported in LiteHubs through the supervision process.",
      },
    ],
  },
  {
    id: "safety",
    fr: "Sécurité, biosécurité et bien-être animal",
    en: "Safety, biosecurity and animal welfare",
    summaryFr:
      "La protection de la vie, de la santé et des animaux passe avant la rapidité ou la production.",
    summaryEn:
      "Protection of life, health and animals takes priority over speed or production.",
    rules: [
      {
        fr: "Toute personne respecte les règles de tenue, lavage, désinfection, contrôle des visiteurs et circulation propres à chaque site.",
        en: "Everyone follows site rules for protective clothing, washing, disinfection, visitor control and movement.",
      },
      {
        fr: "Une mortalité inhabituelle, une maladie suspecte, une fuite, un incendie, un vol ou un danger immédiat est signalé immédiatement au responsable.",
        en: "Unusual mortality, suspected illness, a leak, fire, theft or immediate danger is reported to the manager immediately.",
      },
      {
        fr: "Les soins, vaccins, traitements et quarantaines sont enregistrés ; aucun produit vétérinaire ne peut être utilisé sans l’autorisation appropriée.",
        en: "Care, vaccines, treatments and quarantines are recorded; no veterinary product may be used without appropriate authorisation.",
      },
    ],
  },
  {
    id: "production",
    fr: "Production agricole, avicole et porcine",
    en: "Crop, poultry and pig production",
    summaryFr:
      "Les données de terrain servent à protéger les animaux et à calculer le coût réel, la production et le bénéfice.",
    summaryEn:
      "Field data protects animals and calculates real cost, production and profit.",
    rules: [
      {
        fr: "Les relevés de ponte, mortalité, aliment, eau, poids, santé, récolte et utilisation sont saisis le jour même par la personne autorisée.",
        en: "Eggs, mortality, feed, water, weight, health, harvest and usage records are entered the same day by the authorised person.",
      },
      {
        fr: "Un lot, un animal, un champ, une parcelle ou une récolte est créé une seule fois et peut être relié au projet qui l’a financé.",
        en: "A flock, animal, field, plot or harvest is created once and can be linked to the project that funded it.",
      },
      {
        fr: "Toute correction après validation doit être justifiée et reste visible dans le journal d’audit.",
        en: "Any correction after validation requires justification and remains visible in the audit log.",
      },
    ],
  },
  {
    id: "projects",
    fr: "Investissements, projets et bénéfices",
    en: "Investments, projects and benefits",
    summaryFr:
      "Un projet suit un investissement jusqu’à son résultat réel, pas seulement jusqu’à l’achat.",
    summaryEn:
      "A project follows an investment through to its real result, not just the purchase.",
    rules: [
      {
        fr: "Chaque projet doit avoir un objectif mesurable, un site, un responsable, un budget principal et une étape : Investissement, Mise en service, Exploitation ou Clôturé.",
        en: "Every project needs a measurable objective, site, owner, main budget and stage: Investment, Commissioning, Operation or Closed.",
      },
      {
        fr: "Le budget principal est unique. Les budgets de tâches ne l’augmentent pas : ils répartissent seulement ce qui est prévu.",
        en: "The main budget is unique. Task budgets do not increase it; they only allocate what is planned.",
      },
      {
        fr: "Une clôture exige les tâches importantes terminées, les preuves classées, les réceptions contrôlées et une évaluation du résultat attendu.",
        en: "Close-out requires key tasks completed, evidence filed, receipts controlled and the expected result evaluated.",
      },
    ],
  },
  {
    id: "purchasing",
    fr: "Achats, fournisseurs et réceptions",
    en: "Purchasing, suppliers and receiving",
    summaryFr:
      "Aucun achat ne doit contourner la décision, la preuve ou le contrôle de réception.",
    summaryEn:
      "No purchase may bypass decision, evidence or receiving control.",
    rules: [
      {
        fr: "La chaîne normale est : besoin → demande d’achat → approbation → bon de commande → réception → stock, actif ou ressource.",
        en: "The normal chain is: need → purchase request → approval → purchase order → receipt → stock, asset or resource.",
      },
      {
        fr: "Une demande en brouillon ne dépense rien ; un bon envoyé engage le budget ; une réception confirmée devient une dépense réelle.",
        en: "A draft request spends nothing; a sent order commits the budget; a confirmed receipt becomes real spending.",
      },
      {
        fr: "La réception précise les quantités acceptées, endommagées, refusées ou retournées, avec photo, facture ou bon de livraison lorsque disponible.",
        en: "A receipt records accepted, damaged, rejected or returned quantities, with photo, invoice or delivery note when available.",
      },
      {
        fr: "Un paiement fournisseur règle une réception ou une facture ; il ne réduit jamais le budget une seconde fois.",
        en: "A supplier payment settles a receipt or invoice; it never reduces the budget a second time.",
      },
    ],
  },
  {
    id: "stock",
    fr: "Stocks, entrepôts et provenderie",
    en: "Stock, warehouses and feed mill",
    summaryFr:
      "Chaque objet physique existe une seule fois dans le stock de l’entreprise, même s’il est financé par un projet.",
    summaryEn:
      "Each physical item exists once in company stock, even when funded by a project.",
    rules: [
      {
        fr: "Toute entrée, sortie, retour, transfert ou ajustement de stock est enregistré avec l’entrepôt, la date, la quantité, le motif et la personne responsable.",
        en: "Every stock receipt, issue, return, transfer or adjustment is recorded with warehouse, date, quantity, reason and responsible person.",
      },
      {
        fr: "Un transfert indique toujours le site et l’entrepôt de départ et d’arrivée. Aucun mouvement ne doit mélanger les provinces ou sites par erreur.",
        en: "A transfer always identifies origin and destination site and warehouse. No movement may mix provinces or sites by mistake.",
      },
      {
        fr: "La provenderie utilise uniquement des matières premières réellement disponibles ; la fabrication déduit les intrants et crée l’aliment fini traçable.",
        en: "The feed mill uses only physically available raw materials; production deducts inputs and creates traceable finished feed.",
      },
    ],
  },
  {
    id: "assets",
    fr: "Équipements, flotte et carburant",
    en: "Equipment, fleet and fuel",
    summaryFr:
      "Les actifs durables restent identifiés, entretenus et affectés à une personne ou un lieu connu.",
    summaryEn:
      "Durable assets remain identified, maintained and assigned to a known person or location.",
    rules: [
      {
        fr: "Tout équipement reçoit un numéro, une catégorie, un état, un site et un responsable. Les affectations et transferts restent dans son historique.",
        en: "Every asset receives a number, category, condition, site and responsible person. Assignments and transfers remain in its history.",
      },
      {
        fr: "Pour un véhicule ou engin motorisé, le conducteur remplit les contrôles avant départ et retour, compteur, carburant, destination et anomalies.",
        en: "For a vehicle or powered engine, the driver completes pre-trip and return checks, meter, fuel, destination and anomalies.",
      },
      {
        fr: "Un permis valide, un contrôle de sécurité et l’entretien requis sont obligatoires avant l’utilisation lorsqu’ils sont configurés pour l’engin.",
        en: "A valid licence, safety check and required maintenance are mandatory before use when configured for the asset.",
      },
    ],
  },
  {
    id: "money",
    fr: "Finance, ventes et rentabilité",
    en: "Finance, sales and profitability",
    summaryFr:
      "Le bénéfice, la trésorerie et le budget sont liés, mais ce ne sont pas la même chose.",
    summaryEn:
      "Profit, cash and budget are linked, but they are not the same thing.",
    rules: [
      {
        fr: "Les dépenses directes doivent avoir une catégorie, un montant, une date, une preuve et l’approbation requise avant de réduire le budget.",
        en: "Direct expenses need a category, amount, date, evidence and required approval before reducing the budget.",
      },
      {
        fr: "Une vente livrée devient une recette ; l’encaissement client suit séparément la trésorerie et la créance restante.",
        en: "A delivered sale becomes revenue; customer payment separately tracks cash and the remaining receivable.",
      },
      {
        fr: "Les prix, remises, factures, annulations et remboursements doivent être traçables et réservés aux personnes autorisées.",
        en: "Prices, discounts, invoices, cancellations and refunds must be traceable and restricted to authorised people.",
      },
    ],
  },
  {
    id: "records",
    fr: "Documents, données, audit et communication",
    en: "Documents, data, audit and communication",
    summaryFr:
      "Les données saisies dans LiteHubs constituent le dossier opérationnel de l’entreprise.",
    summaryEn:
      "Data entered in LiteHubs forms the company operational record.",
    rules: [
      {
        fr: "Les contrats, reçus, preuves, photos, permis et documents sont classés dans le bon dossier, sans créer de doublon.",
        en: "Contracts, receipts, evidence, photos, licences and documents are filed in the right folder without creating duplicates.",
      },
      {
        fr: "Les actions importantes — création, modification, décision, accès sensible ou annulation — restent enregistrées dans le journal d’audit.",
        en: "Important actions — creation, change, decision, sensitive access or cancellation — remain recorded in the audit log.",
      },
      {
        fr: "Les alertes SMS ou e-mail servent à protéger l’exploitation. Elles ne remplacent pas la décision ni l’intervention humaine.",
        en: "SMS and email alerts help protect operations. They do not replace human judgement or intervention.",
      },
    ],
  },
  {
    id: "enforcement",
    fr: "Contrôle, non-respect et amélioration",
    en: "Control, non-compliance and improvement",
    summaryFr:
      "Les règles sont contrôlées avec équité, preuves et droit d’explication.",
    summaryEn:
      "Rules are enforced fairly, with evidence and a right to explain.",
    rules: [
      {
        fr: "Toute irrégularité est vérifiée par le responsable compétent avant décision, sauf mesure urgente de sécurité ou de biosécurité.",
        en: "Any irregularity is checked by the responsible manager before a decision, except for urgent safety or biosecurity measures.",
      },
      {
        fr: "La fraude, la falsification, le vol, le partage d’accès, le pointage pour autrui ou le contournement d’approbation sont interdits.",
        en: "Fraud, falsification, theft, sharing access, clocking in for others or bypassing approval are prohibited.",
      },
      {
        fr: "Le Owner peut réviser ce règlement. Toute version nouvelle est communiquée et, si nécessaire, affectée comme formation obligatoire.",
        en: "The Owner may revise these rules. Every new version is communicated and, where needed, assigned as mandatory training.",
      },
    ],
  },
];

type CompanyRulesPolicy = {
  id: string;
  versionNumber: number;
  title: string;
  content: string;
  changeNote: string | null;
  status: "published" | "superseded";
  createdAt: string;
  createdByName: string | null;
};

function defaultRulebookText(fr: boolean) {
  return sections
    .map((section, index) => {
      const heading = `${index + 1}. ${fr ? section.fr : section.en}`;
      const summary = fr ? section.summaryFr : section.summaryEn;
      const rules = section.rules
        .map(
          (rule, ruleIndex) =>
            `${index + 1}.${ruleIndex + 1} ${fr ? rule.fr : rule.en}`,
        )
        .join("\n");
      return `${heading}\n${summary}\n\n${rules}`;
    })
    .join("\n\n");
}

function dateLabel(value: string, fr: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function publishedChapterCount(content: string | undefined) {
  if (!content) return sections.length;

  // A published policy is owner-authored, so its number of chapters must come
  // from its own numbered headings rather than from the starter rulebook.
  const count = Array.from(content.matchAll(/^\s*\d+\.\s+\S.+$/gm)).length;
  return count || sections.length;
}

export function CompanyRulesArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const canEdit = isOwner(user);
  const client = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const policy = useQuery({
    queryKey: ["company-rules", orgSlug],
    queryFn: () =>
      get<{ policy: CompanyRulesPolicy | null }>(
        orgUrl(orgSlug, "company-rules"),
      ).then((result) => result.policy),
  });
  const versions = useQuery({
    queryKey: ["company-rules-versions", orgSlug],
    queryFn: () =>
      get<{ versions: CompanyRulesPolicy[] }>(
        orgUrl(orgSlug, "company-rules/versions"),
      ).then((result) => result.versions),
    enabled: versionsOpen,
  });
  const publish = useMutation({
    mutationFn: (body: { title: string; content: string; changeNote?: string }) =>
      put<{ policy: CompanyRulesPolicy }>(orgUrl(orgSlug, "company-rules"), body),
    onSuccess: ({ policy: saved }) => {
      client.setQueryData(["company-rules", orgSlug], saved);
      void client.invalidateQueries({
        queryKey: ["company-rules-versions", orgSlug],
      });
      setEditorOpen(false);
    },
  });
  const current = policy.data;
  const title =
    current?.title ??
    (fr
      ? "Règlement général d’exploitation et de gestion"
      : "General operating and management rules");
  const editableContent = current?.content ?? defaultRulebookText(fr);
  const chapterCount = publishedChapterCount(current?.content);
  const downloadUrl = orgApiUrl(
    orgSlug,
    `company-rules/export.pdf?lang=${fr ? "fr" : "en"}`,
  );

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="overflow-hidden rounded-3xl border border-brand/20 bg-[radial-gradient(circle_at_88%_8%,color-mix(in_srgb,var(--brand)_18%,transparent),transparent_31%),linear-gradient(130deg,var(--surface-1),var(--surface-2))] p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-brand">
              <ShieldCheck className="size-4" /> Congo Omega · LiteHubs
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] text-ink sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-secondary">
              {fr
                ? "Le cadre commun de l’entreprise : personnes, production, projets, achats, stocks, équipement, finance, documents et sécurité."
                : "The shared company framework: people, production, projects, procurement, stock, equipment, finance, documents and safety."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <Button onClick={() => setEditorOpen(true)}>
                <Edit3 />
                {fr ? "Modifier le règlement" : "Edit rules"}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setVersionsOpen(true)}>
              <History />
              {fr ? "Versions" : "Versions"}
            </Button>
            <a
              href={downloadUrl}
              download
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-brand/35 bg-brand px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Download className="size-4" />
              {fr ? "Télécharger le PDF officiel" : "Download official PDF"}
            </a>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <StatusCard icon={BookOpenCheck} label={fr ? "Version interne" : "Internal version"} value={current ? `v${current.versionNumber}` : "1.0"} />
          <StatusCard icon={FileText} label={fr ? "Chapitres" : "Chapters"} value={String(chapterCount)} />
          <StatusCard icon={CheckCircle2} label={fr ? "Application" : "Applies to"} value={fr ? "Toute l’entreprise" : "Whole company"} />
        </div>
        {current ? (
          <p className="mt-4 text-xs text-ink-secondary">
            {fr ? "Dernière version" : "Latest version"} · {dateLabel(current.createdAt, fr)}
            {current.createdByName
              ? ` · ${fr ? "par" : "by"} ${current.createdByName}`
              : ""}
            {current.changeNote ? ` · ${current.changeNote}` : ""}
          </p>
        ) : null}
      </header>

      <section className="rounded-2xl border border-warning/25 bg-warning/8 p-4 text-sm leading-6 text-ink-secondary">
        <strong className="text-ink">{fr ? "Important : " : "Important: "}</strong>
        {fr
          ? "ce règlement est le cadre interne de Congo Omega. Il doit être complété par la validation d’un juriste local pour les obligations légales en République démocratique du Congo."
          : "these rules are Congo Omega’s internal framework. They must be complemented by local legal review for statutory obligations in the Democratic Republic of the Congo."}
      </section>

      {current ? (
        <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm sm:p-7">
          <p className="text-sm font-semibold text-ink">{fr ? "Règlement publié" : "Published rules"}</p>
          <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-ink-secondary">
            {current.content}
          </pre>
        </section>
      ) : (
        <>
          <nav className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm" aria-label={fr ? "Chapitres du règlement" : "Rule chapters"}>
            <p className="text-sm font-semibold text-ink">{fr ? "Accès rapide" : "Quick access"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sections.map((section, index) => (
                <a key={section.id} href={`#${section.id}`} className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-brand/35 hover:text-brand">
                  {index + 1}. {fr ? section.fr : section.en}
                </a>
              ))}
            </div>
          </nav>

          <section className="grid gap-4 xl:grid-cols-2">
            {sections.map((section, index) => (
              <article id={section.id} key={section.id} className="scroll-mt-6 rounded-2xl border border-border bg-surface-1 p-5 shadow-sm sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-sm font-bold text-brand">{index + 1}</span>
                  <div>
                    <h2 className="text-lg font-semibold text-ink">{fr ? section.fr : section.en}</h2>
                    <p className="mt-1 text-sm leading-6 text-ink-secondary">{fr ? section.summaryFr : section.summaryEn}</p>
                  </div>
                </div>
                <ol className="mt-5 space-y-3">
                  {section.rules.map((rule, ruleIndex) => (
                    <li key={rule.fr} className="flex gap-3 rounded-xl border border-border bg-surface-2 p-3 text-sm leading-6 text-ink-secondary">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                      <span><strong className="mr-1 text-ink">{index + 1}.{ruleIndex + 1}</strong>{fr ? rule.fr : rule.en}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </section>
        </>
      )}
      {editorOpen && canEdit ? (
        <RulesEditor
          fr={fr}
          policy={current}
          defaultContent={editableContent}
          pending={publish.isPending}
          error={publish.error}
          onClose={() => setEditorOpen(false)}
          onSave={(body) => publish.mutate(body)}
        />
      ) : null}
      {versionsOpen ? (
        <RulesVersions
          fr={fr}
          current={current}
          versions={versions.data ?? []}
          loading={versions.isLoading}
          error={versions.error}
          onClose={() => setVersionsOpen(false)}
        />
      ) : null}
    </main>
  );
}

function RulesEditor({
  fr,
  policy,
  defaultContent,
  pending,
  error,
  onClose,
  onSave,
}: {
  fr: boolean;
  policy: CompanyRulesPolicy | null | undefined;
  defaultContent: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (body: { title: string; content: string; changeNote?: string }) => void;
}) {
  return (
    <Dialog title={fr ? "Modifier le règlement" : "Edit rules"} onClose={onClose} wide>
      <p className="text-sm leading-6 text-ink-secondary">
        {fr
          ? "L’enregistrement publie une nouvelle version. Les versions précédentes restent intactes dans l’historique."
          : "Saving publishes a new version. Earlier versions remain unchanged in the history."}
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const title = String(data.get("title") ?? "").trim();
          const content = String(data.get("content") ?? "").trim();
          const changeNote = String(data.get("changeNote") ?? "").trim();
          if (!title || !content) return;
          onSave({ title, content, changeNote: changeNote || undefined });
        }}
      >
        <Field label={fr ? "Titre" : "Title"} required>
          <Input name="title" required minLength={4} maxLength={180} defaultValue={policy?.title ?? (fr ? "Règlement général d’exploitation et de gestion" : "General operating and management rules")} />
        </Field>
        <Field label={fr ? "Texte du règlement" : "Rulebook text"} required hint={fr ? "Conservez des titres et des paragraphes courts pour une lecture facile sur téléphone." : "Keep headings and paragraphs short for easy phone reading."}>
          <Textarea name="content" required minLength={80} maxLength={100000} rows={24} defaultValue={defaultContent} className="min-h-[46dvh] font-sans leading-6" />
        </Field>
        <Field label={fr ? "Motif de cette version" : "Reason for this version"} hint={fr ? "Exemple : ajout des règles de flotte et carburant." : "Example: added fleet and fuel rules."}>
          <Input name="changeNote" maxLength={600} defaultValue={policy ? "" : (fr ? "Première version officielle" : "First official version")} />
        </Field>
        {error ? <p className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">{error instanceof Error ? error.message : (fr ? "Impossible d’enregistrer le règlement." : "Could not save the rules.")}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>{fr ? "Annuler" : "Cancel"}</Button>
          <Button type="submit" disabled={pending}>{pending ? (fr ? "Publication…" : "Publishing…") : (fr ? "Publier la nouvelle version" : "Publish new version")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function RulesVersions({ fr, current, versions, loading, error, onClose }: { fr: boolean; current: CompanyRulesPolicy | null | undefined; versions: CompanyRulesPolicy[]; loading: boolean; error: unknown; onClose: () => void }) {
  return (
    <Dialog title={fr ? "Historique du règlement" : "Rulebook history"} onClose={onClose}>
      {loading ? <p className="text-sm text-ink-secondary">{fr ? "Chargement…" : "Loading…"}</p> : null}
      {error ? <p className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">{error instanceof Error ? error.message : (fr ? "Impossible de charger l’historique." : "Could not load history.")}</p> : null}
      {!loading && !error && !versions.length ? <p className="text-sm leading-6 text-ink-secondary">{fr ? "Aucune version enregistrée. Le règlement de base reste visible ; le propriétaire peut publier la première version." : "No saved version yet. The base rules remain visible; the owner can publish the first version."}</p> : null}
      <div className="mt-4 max-h-[55dvh] space-y-3 overflow-y-auto pr-1">
        {versions.map((version) => (
          <article key={version.id} className="rounded-xl border border-border bg-surface-2 p-4">
            <div className="flex items-center justify-between gap-3"><p className="font-semibold text-ink">v{version.versionNumber} {version.id === current?.id ? `· ${fr ? "Actuelle" : "Current"}` : ""}</p><span className="text-xs text-ink-muted">{dateLabel(version.createdAt, fr)}</span></div>
            <p className="mt-2 text-sm text-ink-secondary">{version.changeNote || (fr ? "Aucun motif renseigné." : "No change note.")}</p>
            <p className="mt-2 text-xs text-ink-muted">{version.createdByName ? `${fr ? "Publié par" : "Published by"} ${version.createdByName}` : "—"}</p>
          </article>
        ))}
      </div>
    </Dialog>
  );
}

function Dialog({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><div className={`max-h-[92dvh] w-full overflow-y-auto rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6 ${wide ? "max-w-5xl" : "max-w-2xl"}`}><div className="flex items-start justify-between gap-4"><h2 className="text-xl font-semibold text-ink">{title}</h2><Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" /></Button></div><div className="mt-4">{children}</div></div></div>;
}

function StatusCard({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-surface-1/80 p-4 shadow-sm"><Icon className="size-4 text-brand" /><p className="mt-3 text-xs text-ink-secondary">{label}</p><p className="mt-1 text-base font-semibold text-ink">{value}</p></div>;
}
