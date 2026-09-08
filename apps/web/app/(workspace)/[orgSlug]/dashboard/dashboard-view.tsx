"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bird,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Factory,
  HeartPulse,
  Package,
  PiggyBank,
  ShieldCheck,
  Sprout,
  Users,
  WalletCards,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { CategoryChart } from "@/components/charts/category-chart";
import { Badge } from "@/components/ui/badge";
import { ActiveServicesBar, OperationalServiceSetup } from "@/components/dashboard/operational-service-setup";
import { can, canSeeModule, dashboardLayoutFor } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import {
  useAgricultureOverview,
  useApprovalQueue,
  useAttendanceRecords,
  useEmployees,
  useManagementRecords,
  useOwnerDashboard,
  usePigOverview,
  usePoultryOverview,
  useTaskQueue,
  useWorkspaceProfile,
  type ManagementRecord,
  type WorkspaceTask,
} from "@/hooks/useWorkspace";

export function DashboardView({ orgSlug }: { orgSlug: string }) {
  const { locale, t } = useLanguage();
  const user = useSessionUser();
  const layout = dashboardLayoutFor(user);
  const profile = useWorkspaceProfile(orgSlug);
  const [serviceSetupOpen, setServiceSetupOpen] = useState(false);
  const poultry = usePoultryOverview(orgSlug);
  const pigs = usePigOverview(orgSlug);
  const agriculture = useAgricultureOverview(orgSlug);
  const employees = useEmployees(orgSlug);
  const owner = useOwnerDashboard(orgSlug);
  const tasks = useTaskQueue(orgSlug);
  const approvals = useApprovalQueue(orgSlug);
  const attendance = useAttendanceRecords(orgSlug);
  const expenses = useManagementRecords(
    orgSlug,
    "expenses",
    "finance.expenses.read",
  );
  const inventory = useManagementRecords(
    orgSlug,
    "inventory-items",
    "inventory.items.read",
  );
  const assets = useManagementRecords(orgSlug, "assets", "equipment.read");
  const fr = locale === "fr";
  const number = new Intl.NumberFormat(fr ? "fr-FR" : "en-US");
  const money = new Intl.NumberFormat(fr ? "fr-FR" : "en-US", {
    style: "currency",
    currency: profile.data?.currency ?? "USD",
    maximumFractionDigits: 0,
  });
  const activeEmployees = (employees.data ?? []).filter(
    (employee) => employee.employmentStatus === "active",
  ).length;
  const byDepartment = Object.entries(
    (employees.data ?? []).reduce<Record<string, number>>(
      (counts, employee) => {
        const department = employee.departmentName ?? t("dashboard.unassigned");
        counts[department] = (counts[department] ?? 0) + 1;
        return counts;
      },
      {},
    ),
  )
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);
  const context: DashboardContext = {
    t,
    fr,
    locale,
    orgSlug,
    number,
    money,
    poultry: poultry.data?.totals,
    pigs: pigs.data?.totals,
    agriculture: agriculture.data?.totals,
    activeEmployees,
    employeeTotal: employees.data?.length ?? 0,
    owner: owner.data,
    tasks: tasks.data ?? [],
    approvals: approvals.data ?? [],
    attendance: attendance.data ?? [],
    expenses: expenses.data ?? [],
    inventory: inventory.data ?? [],
    assets: assets.data ?? [],
    byDepartment,
    user,
  };
  const trial =
    profile.data?.subscription?.status === "trialing"
      ? t("workspace.trialEnds", {
          date: profile.data.subscription.trialEndsAt
            ? new Date(
                profile.data.subscription.trialEndsAt,
              ).toLocaleDateString(fr ? "fr-FR" : "en-GB", {
                day: "numeric",
                month: "short",
              })
            : "…",
        })
      : undefined;

  return (
    <main className="mx-auto max-w-[1480px] space-y-6 p-4 sm:p-6 lg:p-8">
      <WorkspaceHero
        name={profile.data?.displayName ?? "LiteHubs"}
        subtitle={greetingFor(layout, fr)}
        layout={layout}
        trial={trial}
        orgSlug={orgSlug}
        fr={fr}
        showProjectLink={Boolean(owner.data)}
      />
      {user?.activeOrganization?.isOwner &&
      (profile.data?.operationalServices === null || serviceSetupOpen) ? (
        <OperationalServiceSetup
          orgSlug={orgSlug}
          fr={fr}
          initialServices={profile.data?.operationalServices ?? null}
          onSaved={() => setServiceSetupOpen(false)}
        />
      ) : user?.activeOrganization?.isOwner && profile.data?.operationalServices?.length ? (
        <ActiveServicesBar
          orgSlug={orgSlug}
          services={profile.data.operationalServices}
          fr={fr}
          onEdit={() => setServiceSetupOpen(true)}
        />
      ) : null}
      {layout === "executive" || layout === "manager" ? (
        <ExecutiveLayout {...context} />
      ) : null}
      {layout === "supervisor" ? <SupervisorLayout {...context} /> : null}
      {layout === "back_office" ? <BackOfficeLayout {...context} /> : null}
      {layout === "employee" ? <EmployeeLayout {...context} /> : null}
    </main>
  );
}

type DashboardContext = {
  t: (key: any, variables?: Record<string, string | number>) => string;
  fr: boolean;
  locale: string;
  orgSlug: string;
  number: Intl.NumberFormat;
  money: Intl.NumberFormat;
  poultry?: {
    activeFlocks: number;
    initialBirds: number;
    mortalityRatePercent: number;
    mortalityCount: number;
    totalEggs: number;
    feedKg: number;
    waterLiters: number;
  };
  pigs?: Record<string, number>;
  agriculture?: Record<string, number>;
  activeEmployees: number;
  employeeTotal: number;
  owner: any;
  tasks: WorkspaceTask[];
  approvals: any[];
  attendance: any[];
  expenses: ManagementRecord[];
  inventory: ManagementRecord[];
  assets: ManagementRecord[];
  byDepartment: { department: string; count: number }[];
  user: ReturnType<typeof useSessionUser>;
};

function ExecutiveLayout(data: DashboardContext) {
  const {
    fr,
    locale,
    orgSlug,
    number,
    money,
    poultry,
    pigs,
    agriculture,
    activeEmployees,
    employeeTotal,
    owner,
    tasks,
    approvals,
    byDepartment,
  } = data;
  const financials = owner?.financials;
  const actions = owner?.nextActions?.length ? owner.nextActions : tasks;
  const overdue =
    owner?.alerts?.overdueTasks?.length ?? tasks.filter(isOverdue).length;
  const pendingApprovals =
    owner?.alerts?.pendingApprovals?.length ?? approvals.length;
  const maintenanceDue = owner?.alerts?.maintenance?.length ?? 0;
  const productionCount =
    (poultry?.activeFlocks ?? 0) +
    (pigs?.activeAnimals ?? 0) +
    (agriculture?.activeFields ?? 0);
  const riskCount = overdue + pendingApprovals + maintenanceDue;

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <DashboardMetric
          label={copy(fr, "Active projects", "Projets actifs")}
          value={number.format(owner?.projects?.active ?? 0)}
          hint={
            owner?.projects?.delayed
              ? copy(
                  fr,
                  `${number.format(owner.projects.delayed)} delayed`,
                  `${number.format(owner.projects.delayed)} en retard`,
                )
              : copy(
                  fr,
                  "Portfolio under control",
                  "Portefeuille sous contrôle",
                )
          }
          icon={BriefcaseBusiness}
          tone="ocean"
        />
        <DashboardMetric
          label={copy(
            fr,
            "Available project budget",
            "Budget projet disponible",
          )}
          value={financials ? money.format(financials.available) : "—"}
          hint={
            financials
              ? copy(
                  fr,
                  `${financials.utilizationPercent}% of budget used`,
                  `${financials.utilizationPercent}% du budget utilisé`,
                )
              : copy(fr, "Finance access is limited", "Accès finance limité")
          }
          icon={WalletCards}
          tone="emerald"
        />
        <DashboardMetric
          label={copy(fr, "Live operations", "Opérations en activité")}
          value={number.format(productionCount)}
          hint={copy(
            fr,
            `${number.format(activeEmployees)} active employees`,
            `${number.format(activeEmployees)} employés actifs`,
          )}
          icon={HeartPulse}
          tone="violet"
        />
        <DashboardMetric
          label={copy(fr, "Items requiring attention", "Éléments à traiter")}
          value={number.format(riskCount)}
          hint={
            riskCount
              ? copy(
                  fr,
                  "Resolve priority work today",
                  "À résoudre en priorité aujourd’hui",
                )
              : copy(fr, "No urgent operational issue", "Aucun problème urgent")
          }
          icon={AlertTriangle}
          tone={riskCount ? "amber" : "slate"}
        />
      </motion.section>

      <section className="grid gap-5 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          eyebrow={copy(fr, "Decision queue", "File de décision")}
          title={copy(
            fr,
            "What needs your attention",
            "Ce qui nécessite votre attention",
          )}
          description={copy(
            fr,
            "Blocked, due and assigned work across your company.",
            "Travaux bloqués, à échéance et affectés dans toute l’entreprise.",
          )}
          icon={ClipboardList}
          action={
            <DashboardLink
              href={`/${orgSlug}/tasks`}
              label={copy(fr, "Open tasks", "Voir les tâches")}
            />
          }
        >
          <TaskList
            tasks={actions}
            empty={copy(
              fr,
              "Nothing requires action right now.",
              "Aucune action urgente pour le moment.",
            )}
            locale={locale}
            fr={fr}
            orgSlug={orgSlug}
          />
        </Panel>
        <Panel
          className="xl:col-span-5"
          eyebrow={copy(fr, "Operating picture", "Situation opérationnelle")}
          title={copy(fr, "Production at a glance", "Production en un regard")}
          description={copy(
            fr,
            "Key live indicators across livestock and agriculture.",
            "Les indicateurs essentiels pour l’élevage et l’agriculture.",
          )}
          icon={HeartPulse}
        >
          <div className="space-y-2.5 p-4 sm:p-5">
            <OperationalLine
              icon={Bird}
              label={copy(fr, "Poultry", "Aviculture")}
              value={number.format(poultry?.activeFlocks ?? 0)}
              hint={copy(
                fr,
                `${number.format(poultry?.initialBirds ?? 0)} birds · ${formatPercent(poultry?.mortalityRatePercent)} mortality`,
                `${number.format(poultry?.initialBirds ?? 0)} oiseaux · ${formatPercent(poultry?.mortalityRatePercent)} mortalité`,
              )}
              tone={
                (poultry?.mortalityRatePercent ?? 0) > 3 ? "critical" : "good"
              }
              status={
                (poultry?.mortalityRatePercent ?? 0) > 3
                  ? copy(fr, "Watch", "À surveiller")
                  : copy(fr, "Stable", "Stable")
              }
            />
            <OperationalLine
              icon={PiggyBank}
              label={copy(fr, "Pigs", "Porcs")}
              value={number.format(pigs?.activeAnimals ?? 0)}
              hint={copy(fr, "Active animals", "Animaux actifs")}
              tone="info"
              status={copy(fr, "Running", "En activité")}
            />
            <OperationalLine
              icon={Sprout}
              label={copy(fr, "Agriculture", "Agriculture")}
              value={number.format(agriculture?.activeFields ?? 0)}
              hint={copy(fr, "Fields in production", "Champs en production")}
              tone="good"
              status={copy(fr, "Growing", "En cours")}
            />
          </div>
          <div className="grid grid-cols-3 border-t border-border bg-surface-2/50">
            <CompactFact
              label={copy(fr, "Eggs", "Œufs")}
              value={number.format(poultry?.totalEggs ?? 0)}
            />
            <CompactFact
              label={copy(fr, "Feed", "Aliment")}
              value={`${number.format(poultry?.feedKg ?? 0)} kg`}
            />
            <CompactFact
              label={copy(fr, "Water", "Eau")}
              value={`${number.format(poultry?.waterLiters ?? 0)} L`}
            />
          </div>
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          eyebrow={copy(fr, "Financial control", "Contrôle financier")}
          title={copy(
            fr,
            "Project budget position",
            "Position budgétaire des projets",
          )}
          description={copy(
            fr,
            "Committed and spent values are derived from connected project records.",
            "Les montants engagés et dépensés proviennent des enregistrements projet reliés.",
          )}
          icon={WalletCards}
          action={
            owner ? (
              <DashboardLink
                href={`/${orgSlug}/projects`}
                label={copy(fr, "Project control centre", "Centre de pilotage")}
              />
            ) : undefined
          }
        >
          {financials ? (
            <FinancePosition financials={financials} money={money} fr={fr} />
          ) : (
            <Empty
              text={copy(
                fr,
                "No project finance summary is available for this access level.",
                "Aucun résumé financier de projet n’est disponible avec cet accès.",
              )}
            />
          )}
        </Panel>
        <Panel
          className="xl:col-span-5"
          eyebrow={copy(fr, "Controls", "Contrôles")}
          title={copy(fr, "Risk and approvals", "Risques et approbations")}
          description={copy(
            fr,
            "Stay ahead of delays, approvals and maintenance.",
            "Anticipez les retards, approbations et maintenances.",
          )}
          icon={ShieldCheck}
        >
          <div className="grid gap-2.5 p-4 sm:p-5">
            <ControlRow
              icon={Clock3}
              label={copy(fr, "Overdue tasks", "Tâches en retard")}
              value={number.format(overdue)}
              detail={
                overdue
                  ? copy(
                      fr,
                      "Review deadlines now",
                      "Vérifier les échéances maintenant",
                    )
                  : copy(fr, "No overdue task", "Aucune tâche en retard")
              }
              variant={overdue ? "critical" : "good"}
              href={`/${orgSlug}/tasks`}
            />
            <ControlRow
              icon={CheckCircle2}
              label={copy(fr, "Pending approvals", "Approbations en attente")}
              value={number.format(pendingApprovals)}
              detail={
                pendingApprovals
                  ? copy(fr, "A decision is needed", "Une décision est requise")
                  : copy(fr, "Nothing awaiting approval", "Rien à approuver")
              }
              variant={pendingApprovals ? "warning" : "good"}
              href={`/${orgSlug}/approvals`}
            />
            <ControlRow
              icon={Factory}
              label={copy(fr, "Maintenance alerts", "Alertes maintenance")}
              value={number.format(maintenanceDue)}
              detail={
                maintenanceDue
                  ? copy(
                      fr,
                      "Equipment needs attention",
                      "Des équipements nécessitent une action",
                    )
                  : copy(
                      fr,
                      "Equipment status is stable",
                      "État des équipements stable",
                    )
              }
              variant={maintenanceDue ? "warning" : "good"}
              href={`/${orgSlug}/maintenance`}
            />
          </div>
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          eyebrow={copy(fr, "Portfolio", "Portefeuille")}
          title={copy(
            fr,
            "Active project progress",
            "Avancement des projets actifs",
          )}
          description={copy(
            fr,
            "The current progress is calculated from live planning and task data.",
            "L’avancement actuel est calculé à partir de la planification et des tâches.",
          )}
          icon={BriefcaseBusiness}
          action={
            owner ? (
              <DashboardLink
                href={`/${orgSlug}/projects`}
                label={copy(fr, "All projects", "Tous les projets")}
              />
            ) : undefined
          }
        >
          <ProjectPortfolio
            projects={owner?.projects?.items ?? []}
            number={number}
            fr={fr}
          />
        </Panel>
        <Panel
          className="xl:col-span-5"
          eyebrow={copy(fr, "People", "Équipes")}
          title={copy(fr, "Workforce coverage", "Répartition des effectifs")}
          description={copy(
            fr,
            `${number.format(activeEmployees)} active of ${number.format(employeeTotal)} people on record.`,
            `${number.format(activeEmployees)} actifs sur ${number.format(employeeTotal)} personnes enregistrées.`,
          )}
          icon={Users}
        >
          {byDepartment.length ? (
            <CategoryChart
              title={copy(
                fr,
                "Employees by department",
                "Employés par département",
              )}
              description={copy(
                fr,
                "Active team distribution",
                "Répartition des équipes",
              )}
              data={byDepartment}
              labelKey="department"
              valueKey="count"
              height={176}
            />
          ) : (
            <Empty
              text={copy(
                fr,
                "Add employees and departments to see workforce coverage.",
                "Ajoutez des employés et départements pour voir la couverture des équipes.",
              )}
            />
          )}
        </Panel>
      </section>
    </>
  );
}

function SupervisorLayout(data: DashboardContext) {
  const {
    fr,
    locale,
    orgSlug,
    number,
    poultry,
    tasks,
    approvals,
    attendance,
    user,
  } = data;
  const areas = [
    canSeeModule(user, "poultry") ? copy(fr, "Poultry", "Aviculture") : null,
    canSeeModule(user, "pigs") ? copy(fr, "Pigs", "Porcs") : null,
    canSeeModule(user, "agriculture")
      ? copy(fr, "Agriculture", "Agriculture")
      : null,
  ].filter(Boolean) as string[];
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardMetric
          label={copy(fr, "My work queue", "Ma file de travail")}
          value={number.format(tasks.length)}
          hint={copy(
            fr,
            "Tasks assigned to you",
            "Tâches qui vous sont confiées",
          )}
          icon={ClipboardList}
          tone="ocean"
        />
        <DashboardMetric
          label={copy(fr, "Approvals", "Approbations")}
          value={number.format(approvals.length)}
          hint={copy(fr, "Items awaiting review", "Éléments à examiner")}
          icon={CheckCircle2}
          tone="violet"
        />
        <DashboardMetric
          label={copy(fr, "Active flocks", "Lots actifs")}
          value={number.format(poultry?.activeFlocks ?? 0)}
          hint={copy(fr, "Poultry production", "Production avicole")}
          icon={Bird}
          tone="emerald"
        />
        <DashboardMetric
          label={copy(fr, "Attendance records", "Présences enregistrées")}
          value={number.format(attendance.length)}
          hint={copy(fr, "Current work period", "Période de travail actuelle")}
          icon={Clock3}
          tone="slate"
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          eyebrow={copy(fr, "Execution", "Exécution")}
          title={copy(
            fr,
            "Today’s work queue",
            "Travail à traiter aujourd’hui",
          )}
          description={copy(
            fr,
            "Complete, update or raise blocked work quickly.",
            "Terminez, mettez à jour ou signalez rapidement les blocages.",
          )}
          icon={ClipboardList}
          action={
            <DashboardLink
              href={`/${orgSlug}/tasks`}
              label={copy(fr, "Open tasks", "Voir les tâches")}
            />
          }
        >
          <TaskList
            tasks={tasks}
            empty={copy(
              fr,
              "No task assigned right now.",
              "Aucune tâche ne vous est affectée pour le moment.",
            )}
            locale={locale}
            fr={fr}
            orgSlug={orgSlug}
          />
        </Panel>
        <Panel
          className="xl:col-span-5"
          eyebrow={copy(fr, "Review", "Contrôle")}
          title={copy(fr, "Approvals to review", "Approbations à examiner")}
          description={copy(
            fr,
            "Keep decisions moving for your team.",
            "Faites avancer les décisions de votre équipe.",
          )}
          icon={CheckCircle2}
        >
          <RecordList
            records={approvals}
            empty={copy(
              fr,
              "No approval is waiting.",
              "Aucune approbation en attente.",
            )}
          />
        </Panel>
      </section>
      <Panel
        eyebrow={copy(fr, "Daily operations", "Opérations quotidiennes")}
        title={copy(
          fr,
          "Your available production areas",
          "Vos zones de production disponibles",
        )}
        description={copy(
          fr,
          "Use the operational modules to record the day’s work.",
          "Utilisez les modules opérationnels pour enregistrer le travail du jour.",
        )}
        icon={Wheat}
      >
        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          {areas.map((area, index) => (
            <div
              key={area}
              className="rounded-2xl border border-border-strong/80 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--brand)_5%,var(--surface-2)),var(--surface-1))] p-4 shadow-[0_12px_26px_-24px_rgba(9,35,67,.44)] transition hover:-translate-y-px hover:border-brand/35"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-surface-1 text-brand">
                <span className="text-sm font-semibold">0{index + 1}</span>
              </span>
              <p className="mt-4 text-sm font-semibold text-ink">{area}</p>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">
                {copy(
                  fr,
                  "Records, checks and daily follow-up.",
                  "Saisies, contrôles et suivi quotidien.",
                )}
              </p>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

function BackOfficeLayout(data: DashboardContext) {
  const {
    fr,
    number,
    activeEmployees,
    employeeTotal,
    expenses,
    inventory,
    assets,
    user,
    byDepartment,
  } = data;
  const areas = [
    {
      visible: can(user, "employees.read"),
      label: copy(fr, "Active employees", "Employés actifs"),
      value: activeEmployees,
      icon: Users,
      hint: `${number.format(employeeTotal)} ${copy(fr, "on record", "enregistrés")}`,
    },
    {
      visible: can(user, "finance.expenses.read"),
      label: copy(fr, "Expense records", "Dépenses"),
      value: expenses.length,
      icon: WalletCards,
      hint: copy(fr, "Finance workspace", "Espace finance"),
    },
    {
      visible: can(user, "inventory.items.read"),
      label: copy(fr, "Inventory items", "Articles en stock"),
      value: inventory.length,
      icon: Package,
      hint: copy(fr, "Inventory workspace", "Espace inventaire"),
    },
    {
      visible: can(user, "security.read"),
      label: copy(fr, "Assets on record", "Actifs enregistrés"),
      value: assets.length,
      icon: ShieldCheck,
      hint: copy(fr, "Controlled assets", "Actifs contrôlés"),
    },
  ].filter((area) => area.visible);
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {areas.map((area, index) => (
          <DashboardMetric
            key={area.label}
            label={area.label}
            value={number.format(area.value)}
            icon={area.icon}
            hint={area.hint}
            tone={
              index === 0
                ? "ocean"
                : index === 1
                  ? "violet"
                  : index === 2
                    ? "emerald"
                    : "slate"
            }
          />
        ))}
      </section>
      <section className="grid gap-5 xl:grid-cols-3">
        <Panel
          eyebrow={copy(fr, "People", "Personnes")}
          title={copy(fr, "Department coverage", "Couverture par département")}
          description={copy(
            fr,
            "Where your recorded workforce is allocated.",
            "Où les effectifs enregistrés sont affectés.",
          )}
          icon={Users}
        >
          <RecordList
            records={
              data.user && can(user, "employees.read")
                ? byDepartment.map((item) => ({
                    id: item.department,
                    name: item.department,
                    status: number.format(item.count),
                  }))
                : []
            }
            empty={copy(
              fr,
              "No department allocation yet.",
              "Aucune affectation de département pour le moment.",
            )}
          />
        </Panel>
        <Panel
          eyebrow={copy(fr, "Stock", "Stock")}
          title={copy(fr, "Inventory follow-up", "Suivi de l’inventaire")}
          description={copy(
            fr,
            "Latest available inventory records.",
            "Derniers enregistrements de stock disponibles.",
          )}
          icon={Package}
        >
          <RecordList
            records={inventory}
            empty={copy(
              fr,
              "No inventory item yet.",
              "Aucun article d’inventaire pour le moment.",
            )}
          />
        </Panel>
        <Panel
          eyebrow={copy(fr, "Finance", "Finance")}
          title={copy(fr, "Recent expense records", "Dépenses récentes")}
          description={copy(
            fr,
            "Review the latest records in your permitted scope.",
            "Consultez les derniers enregistrements de votre périmètre autorisé.",
          )}
          icon={WalletCards}
        >
          <RecordList
            records={expenses}
            empty={copy(
              fr,
              "No expense record yet.",
              "Aucune dépense enregistrée pour le moment.",
            )}
          />
        </Panel>
      </section>
    </>
  );
}

function EmployeeLayout(data: DashboardContext) {
  const { fr, locale, orgSlug, number, tasks, attendance, user } = data;
  const openTasks = tasks.filter(
    (task) => !["completed", "cancelled"].includes(String(task.status)),
  ).length;
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-3">
        <DashboardMetric
          label={copy(fr, "My open tasks", "Mes tâches ouvertes")}
          value={number.format(openTasks)}
          icon={ClipboardList}
          hint={copy(fr, "Your current work queue", "Votre travail en cours")}
          tone="ocean"
        />
        <DashboardMetric
          label={copy(fr, "Attendance records", "Présences enregistrées")}
          value={number.format(attendance.length)}
          icon={Clock3}
          hint={copy(fr, "Your work history", "Votre historique de travail")}
          tone="violet"
        />
        <DashboardMetric
          label={copy(fr, "Daily work", "Travail quotidien")}
          value={can(user, "attendance.clock_self") ? "✓" : "—"}
          icon={CheckCircle2}
          hint={
            can(user, "attendance.clock_self")
              ? copy(fr, "Ready to record", "Prêt à enregistrer")
              : copy(
                  fr,
                  "Ask your manager for access",
                  "Demandez l’accès à votre responsable",
                )
          }
          tone="emerald"
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          eyebrow={copy(fr, "My priority", "Ma priorité")}
          title={copy(fr, "Work assigned to me", "Travail qui m’est affecté")}
          description={copy(
            fr,
            "Update your progress and add evidence as you complete work.",
            "Mettez à jour votre avancement et ajoutez les preuves au fur et à mesure.",
          )}
          icon={ClipboardList}
          action={
            <DashboardLink
              href={`/${orgSlug}/tasks`}
              label={copy(fr, "Open tasks", "Voir mes tâches")}
            />
          }
        >
          <TaskList
            tasks={tasks}
            empty={copy(
              fr,
              "No task assigned right now.",
              "Aucune tâche ne vous est affectée pour le moment.",
            )}
            locale={locale}
            fr={fr}
            orgSlug={orgSlug}
          />
        </Panel>
        <Panel
          className="xl:col-span-5"
          eyebrow={copy(fr, "Time", "Temps")}
          title={copy(fr, "Attendance history", "Historique de présence")}
          description={copy(
            fr,
            "Your most recent attendance activity.",
            "Vos activités de présence les plus récentes.",
          )}
          icon={Clock3}
        >
          <RecordList
            records={attendance}
            empty={copy(
              fr,
              "No attendance record yet.",
              "Aucune présence enregistrée pour le moment.",
            )}
          />
        </Panel>
      </section>
    </>
  );
}

function WorkspaceHero({
  name,
  subtitle,
  layout,
  trial,
  orgSlug,
  fr,
  showProjectLink,
}: {
  name: string;
  subtitle: string;
  layout: string;
  trial?: string;
  orgSlug: string;
  fr: boolean;
  showProjectLink: boolean;
}) {
  const today = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return (
    <section className="relative isolate overflow-hidden rounded-[1.7rem] bg-[#092b55] px-5 py-6 text-white shadow-[0_26px_65px_-32px_rgba(7,36,76,.85)] sm:px-7 sm:py-8 lg:px-9">
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_12%_-15%,rgba(86,183,235,.42),transparent_34%),radial-gradient(circle_at_87%_10%,rgba(44,190,157,.24),transparent_28%),linear-gradient(125deg,#092b55_0%,#104a84_52%,#0d3766_100%)]"
        aria-hidden
      />
      <div
        className="absolute -right-12 -top-24 size-80 rounded-full border border-white/10 bg-white/[0.045]"
        aria-hidden
      />
      <div
        className="absolute -bottom-32 right-[22%] size-72 rounded-full border border-white/10 bg-white/[0.035]"
        aria-hidden
      />
      <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-blue-100/90">
            <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1">
              {workspaceLabelFor(layout, fr)}
            </span>
            <span className="capitalize text-blue-100/75">{today}</span>
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            {name}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-50/85 sm:text-[15px]">
            {subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/${orgSlug}/tasks`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-medium text-white transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <ClipboardList className="size-4" aria-hidden />
            {copy(fr, "Tasks", "Tâches")}
          </Link>
          {showProjectLink ? (
            <Link
              href={`/${orgSlug}/projects`}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#0b3d73] shadow-sm transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <BriefcaseBusiness className="size-4" aria-hidden />
              {copy(fr, "Projects", "Projets")}
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          ) : null}
          <div className="hidden rounded-xl border border-white/15 bg-[#082b51]/30 px-3 py-2 text-xs backdrop-blur-sm sm:block">
            <p className="font-semibold capitalize text-white">
              {layout.replace(/_/g, " ")}
            </p>
            {trial ? <p className="mt-0.5 text-blue-100/80">{trial}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardMetric({
  label,
  value,
  hint,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: LucideIcon;
  tone?: "ocean" | "emerald" | "violet" | "amber" | "slate";
}) {
  const tones = {
    ocean:
      "border-brand/20 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--brand)_11%,var(--surface-1)),var(--surface-1))] text-brand",
    emerald:
      "border-[#2caf8c]/25 bg-[linear-gradient(135deg,rgba(44,175,140,.12),var(--surface-1))] text-[#198462]",
    violet:
      "border-[#7866d8]/22 bg-[linear-gradient(135deg,rgba(120,102,216,.12),var(--surface-1))] text-[#6655c2]",
    amber:
      "border-warning/35 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--warning)_14%,var(--surface-1)),var(--surface-1))] text-[#a96f09]",
    slate:
      "border-border bg-[linear-gradient(135deg,var(--surface-2),var(--surface-1))] text-ink-secondary",
  };
  const accents = {
    ocean: "bg-brand/75",
    emerald: "bg-[#2caf8c]/75",
    violet: "bg-[#7866d8]/75",
    amber: "bg-warning/80",
    slate: "bg-ink-muted/50",
  };
  return (
    <motion.article
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      className={`relative overflow-hidden rounded-2xl border p-4 ring-1 ring-black/[.018] shadow-[0_16px_36px_-28px_rgba(9,35,67,.55)] transition-shadow duration-200 hover:shadow-[0_22px_42px_-30px_rgba(9,35,67,.52)] ${tones[tone]}`}
    >
      <span className={`absolute inset-x-0 top-0 h-0.5 ${accents[tone]}`} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.11em] text-ink-secondary">
          {label}
        </p>
        <span className="grid size-9 place-items-center rounded-xl border border-white/60 bg-surface-1/85 shadow-sm dark:border-white/10 dark:bg-black/10">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-ink tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 truncate text-xs text-ink-secondary">{hint}</p>
    </motion.article>
  );
}

function Panel({
  eyebrow,
  title,
  description,
  icon: Icon,
  children,
  action,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 ring-1 ring-black/[.015] shadow-[0_18px_40px_-31px_rgba(9,35,67,.5)] ${className}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border-strong/75 bg-[linear-gradient(100deg,color-mix(in_srgb,var(--brand)_5%,var(--surface-1)),var(--surface-1)_56%)] px-4 py-4 sm:px-5">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/15 bg-brand-subtle text-brand shadow-sm">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="mt-0.5 text-base font-semibold tracking-[-0.02em] text-ink">
              {title}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
              {description}
            </p>
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function DashboardLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border-strong/80 bg-surface-1 px-2.5 text-xs font-semibold text-ink shadow-sm transition hover:border-brand/40 hover:bg-brand-subtle hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {label}
      <ChevronRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function FinancePosition({
  financials,
  money,
  fr,
}: {
  financials: {
    planned: number;
    spent: number;
    committed: number;
    available: number;
    utilizationPercent: number;
  };
  money: Intl.NumberFormat;
  fr: boolean;
}) {
  const utilization = Math.min(
    100,
    Math.max(0, Number(financials.utilizationPercent ?? 0)),
  );
  return (
    <div className="p-4 sm:p-5">
      <div className="rounded-2xl border border-brand/25 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--brand)_12%,var(--surface-1)),var(--surface-1)_62%)] p-4 shadow-[0_12px_28px_-25px_rgba(9,35,67,.45)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-ink-secondary">
              {copy(fr, "Planned project budget", "Budget projet prévu")}
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {money.format(financials.planned)}
            </p>
          </div>
          <Badge variant={utilization > 90 ? "serious" : "info"}>
            {utilization}% {copy(fr, "used", "utilisé")}
          </Badge>
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),#36b8aa)] transition-[width] duration-500"
            style={{ width: `${utilization}%` }}
          />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <FinanceFact
            label={copy(fr, "Spent", "Dépensé")}
            value={money.format(financials.spent)}
          />
          <FinanceFact
            label={copy(fr, "Committed", "Engagé")}
            value={money.format(financials.committed)}
          />
          <FinanceFact
            label={copy(fr, "Available", "Disponible")}
            value={money.format(financials.available)}
            strong
          />
        </div>
      </div>
    </div>
  );
}

function OperationalLine({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  status,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone: "good" | "info" | "critical";
  status: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-strong/75 bg-surface-2/80 px-3 py-3 shadow-[0_8px_20px_-20px_rgba(9,35,67,.45)]">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-1 text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="truncate text-xs text-ink-secondary">{hint}</p>
      </div>
      <div className="text-right">
        <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
        <Badge variant={tone} className="mt-1">
          {status}
        </Badge>
      </div>
    </div>
  );
}

function CompactFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-border-strong/70 px-3 py-3 last:border-r-0 sm:px-4">
      <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

function FinanceFact({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${strong ? "border-brand/30 bg-brand-subtle shadow-sm" : "border-border-strong/75 bg-surface-1 shadow-[0_8px_18px_-18px_rgba(9,35,67,.38)]"}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
        {label}
      </p>
      <p className="mt-1.5 text-base font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

function ControlRow({
  icon: Icon,
  label,
  value,
  detail,
  variant,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  variant: "good" | "warning" | "critical";
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-border-strong/75 bg-surface-2/80 px-3 py-3 shadow-[0_8px_20px_-20px_rgba(9,35,67,.45)] transition hover:-translate-y-px hover:border-brand/40 hover:bg-brand-subtle"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-1 text-ink-secondary group-hover:text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="truncate text-xs text-ink-secondary">{detail}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={variant}>{value}</Badge>
        <ChevronRight
          className="size-4 text-ink-muted group-hover:text-brand"
          aria-hidden
        />
      </div>
    </Link>
  );
}

function ProjectPortfolio({
  projects,
  number,
  fr,
}: {
  projects: Array<{
    id: string;
    name?: string;
    status?: string;
    calculatedProgressPercent?: number;
    overdueTasks?: number;
  }>;
  number: Intl.NumberFormat;
  fr: boolean;
}) {
  if (!projects.length)
    return (
      <Empty
        text={copy(
          fr,
          "No active project to track yet.",
          "Aucun projet actif à suivre pour le moment.",
        )}
      />
    );
  return (
    <div className="divide-y divide-border">
      {projects.slice(0, 5).map((project) => {
        const progress = Math.min(
          100,
          Math.max(0, Number(project.calculatedProgressPercent ?? 0)),
        );
        return (
          <div key={project.id} className="px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {project.name ?? project.id}
                </p>
                <p className="mt-1 text-xs text-ink-secondary">
                  {titleCase(project.status ?? "planning")}
                  {project.overdueTasks
                    ? ` · ${number.format(project.overdueTasks)} ${copy(fr, "overdue", "en retard")}`
                    : ""}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums text-ink">
                {number.format(progress)}%
              </p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskList({
  tasks,
  empty,
  locale,
  fr,
  orgSlug,
}: {
  tasks: WorkspaceTask[];
  empty: string;
  locale: string;
  fr: boolean;
  orgSlug: string;
}) {
  if (!tasks.length) return <Empty text={empty} />;
  return (
    <div className="divide-y divide-border">
      {tasks.slice(0, 6).map((task) => {
        const overdue = isOverdue(task);
        const status = labelStatus(task.status, fr);
        return (
          <Link
            key={task.id}
            href={`/${orgSlug}/tasks`}
            className="group flex items-center gap-3 px-4 py-3.5 transition hover:bg-brand-subtle/45 sm:px-5"
          >
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-xl ${overdue || task.status === "blocked" ? "bg-critical/10 text-critical" : "bg-brand-subtle text-brand"}`}
            >
              <ClipboardList className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-semibold text-ink">
                  {task.title ?? task.id}
                </p>
                {task.projectName ? (
                  <span className="hidden truncate text-xs text-ink-muted sm:inline">
                    · {task.projectName}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 truncate text-xs text-ink-secondary">
                {task.blockedReason
                  ? task.blockedReason
                  : task.dueDate
                    ? `${copy(fr, "Due", "Échéance")} ${dateText(task.dueDate, locale)}`
                    : copy(fr, "No due date", "Aucune échéance")}
              </p>
            </div>
            <div className="hidden text-right sm:block">
              <Badge
                variant={
                  overdue || task.status === "blocked"
                    ? "critical"
                    : task.status === "completed"
                      ? "good"
                      : "outline"
                }
              >
                {status}
              </Badge>
              <p className="mt-1 text-[11px] capitalize text-ink-muted">
                {titleCase(task.priority ?? "medium")}
              </p>
            </div>
            <ChevronRight
              className="size-4 shrink-0 text-ink-muted group-hover:text-brand"
              aria-hidden
            />
          </Link>
        );
      })}
    </div>
  );
}

function RecordList({
  records,
  empty,
}: {
  records: Array<Record<string, any>>;
  empty: string;
}) {
  return records.length ? (
    <div className="divide-y divide-border">
      {records.slice(0, 6).map((record, index) => (
        <div
          key={String(
            record.id ?? `${record.name ?? record.title ?? "record"}-${index}`,
          )}
          className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/75 sm:px-5"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-surface-2 text-ink-muted">
            <CheckCircle2 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">
              {String(
                record.name ??
                  record.title ??
                  record.requestType ??
                  record.employee?.fullName ??
                  record.id,
              )}
            </p>
            <p className="mt-1 truncate text-xs text-ink-secondary">
              {String(record.status ?? record.code ?? record.workDate ?? "—")}
            </p>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty text={empty} />
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="m-3 rounded-xl border border-dashed border-border-strong/80 bg-surface-2/45 p-8 text-center">
      <span className="mx-auto grid size-10 place-items-center rounded-xl bg-surface-2 text-ink-muted">
        <AlertTriangle className="size-4" aria-hidden />
      </span>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-secondary">
        {text}
      </p>
    </div>
  );
}

function copy(fr: boolean, english: string, french: string) {
  return fr ? french : english;
}
function titleCase(value: unknown) {
  return String(value ?? "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function dateText(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
        day: "numeric",
        month: "short",
      }).format(date);
}
function formatPercent(value: number | undefined) {
  return `${Number(value ?? 0).toFixed(2)}%`;
}
function isOverdue(task: WorkspaceTask) {
  if (!task.dueDate || ["completed", "cancelled"].includes(String(task.status)))
    return false;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  due.setHours(23, 59, 59, 999);
  return due < new Date();
}
function labelStatus(status: unknown, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    not_started: ["Not started", "Non commencé"],
    in_progress: ["In progress", "En cours"],
    blocked: ["Blocked", "Bloquée"],
    waiting_approval: ["Waiting approval", "En attente"],
    completed: ["Completed", "Terminée"],
    cancelled: ["Cancelled", "Annulée"],
  };
  const pair = labels[String(status)] ?? [titleCase(status), titleCase(status)];
  return fr ? pair[1] : pair[0];
}
function workspaceLabelFor(layout: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    executive: ["Executive control centre", "Centre de pilotage exécutif"],
    manager: ["Operations control centre", "Centre de pilotage opérationnel"],
    supervisor: ["Team operations", "Opérations d’équipe"],
    back_office: ["Operations workspace", "Espace opérations"],
    employee: ["My workspace", "Mon espace de travail"],
  };
  const label = labels[layout] ?? ["My workspace", "Mon espace de travail"];
  return fr ? label[1] : label[0];
}
function greetingFor(
  layout: ReturnType<typeof dashboardLayoutFor>,
  fr: boolean,
) {
  if (layout === "executive")
    return copy(
      fr,
      "A clear view of the work, money and risks that need a decision today.",
      "Une vue claire du travail, des budgets et des risques qui nécessitent une décision aujourd’hui.",
    );
  if (layout === "manager")
    return copy(
      fr,
      "Run your assigned operations with the next actions, people and production indicators in one place.",
      "Pilotez vos opérations avec les prochaines actions, les équipes et les indicateurs de production au même endroit.",
    );
  if (layout === "supervisor")
    return copy(
      fr,
      "Keep the team on track: record the work, resolve blockers and close today’s priorities.",
      "Gardez l’équipe sur la bonne voie : enregistrez le travail, résolvez les blocages et terminez les priorités du jour.",
    );
  if (layout === "back_office")
    return copy(
      fr,
      "Your operational workspace for accurate records, controlled resources and follow-up.",
      "Votre espace opérationnel pour des dossiers exacts, des ressources contrôlées et un suivi fiable.",
    );
  return copy(
    fr,
    "See your work, update progress and keep your daily activity on track.",
    "Consultez votre travail, mettez à jour votre avancement et suivez vos activités quotidiennes.",
  );
}
