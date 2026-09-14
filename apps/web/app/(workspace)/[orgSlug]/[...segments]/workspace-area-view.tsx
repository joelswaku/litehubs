"use client";

import { ArrowLeft, CircleDashed, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { WORKSPACE_NAV } from "@/lib/navigation";
import { canAccessEmployeeDirectory, canAny, isOwner } from "@/lib/permissions";
import { navTranslationKey } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { PoultryArea } from "./poultry-area";
import { PigsArea } from "./pigs-area";
import { AlertsArea } from "./alerts-area";
import { ApprovalsControlArea } from "./approvals-control-area";
import { DailyWorkArea } from "./daily-work-area";
import { DisciplineArea } from "./discipline-area";
import { PerformanceArea } from "./performance-area";
import { PayrollArea } from "./payroll-area";
import { AgricultureArea } from "./agriculture-area";
import { VeterinaryArea } from "./veterinary-area";
import { ProjectsArea } from "./projects-area";
import { AttendanceArea } from "./attendance-area";
import { MembersArea } from "./members-area";
import { LocationsArea } from "./locations-area";
import { EmployeesArea } from "./employees-area";
import { LeaveArea } from "./leave-area";
import { TrainingArea } from "./training-area";
import { MyTrainingsArea } from "./my-trainings-area";
import { OperationsArea, type OperationsAreaKind } from "./operations-area";
import { IncidentsArea } from "./incidents-area";
import { SecurityArea } from "./security-area";
import { DocumentsArea } from "./documents-area";
import { MyAccountArea } from "./my-account-area";
import { ContractsArea } from "./contracts-area";
import { AuditArea } from "./audit-area";
import { NotificationsArea } from "./notifications-area";
import { ReportsArea } from "./reports-area";
import { SalesFinanceArea } from "./sales-finance-area";
import { AppointmentsArea } from "./appointments-area";
import { CareersArea } from "./careers-area";

export function WorkspaceAreaView({
  orgSlug,
  path,
}: {
  orgSlug: string;
  path: string;
}) {
  const { t } = useLanguage();
  const user = useSessionUser();
  // Preserve the historic French singular URL while the canonical route remains
  // /appointments. Old bookmarks must not fall through to the generic screen.
  const canonicalPath = ["/appointment", "/appointement", "/rendez-vous"].includes(path)
    ? "/appointments"
    : path;
  const item = WORKSPACE_NAV.flatMap((group) => group.items).find(
    (entry) => entry.path === canonicalPath,
  );
  const allowed =
    (!item?.ownerOnly || isOwner(user)) &&
    (!item?.peopleDirectoryOnly || canAccessEmployeeDirectory(user)) &&
    (!item?.permission ||
      canAny(
        user,
        ...(Array.isArray(item.permission)
          ? item.permission
          : [item.permission]),
      ));
  const title = item
    ? t(navTranslationKey(item.label))
    : canonicalPath.split("/").filter(Boolean).join(" · ");

  if (!allowed)
    return (
      <main className="grid min-h-[60dvh] place-items-center p-6">
        <div className="max-w-md text-center">
          <ShieldCheck className="mx-auto size-9 text-ink-muted" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold text-ink">
            {t("workspace.nothingYet")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            {t("workspace.nothingYetDescription")}
          </p>
        </div>
      </main>
    );

  if (path === "/poultry") return <PoultryArea orgSlug={orgSlug} />;
  if (path === "/pigs") return <PigsArea orgSlug={orgSlug} />;
  if (path === "/agriculture") return <AgricultureArea orgSlug={orgSlug} />;
  if (path === "/veterinary") return <VeterinaryArea orgSlug={orgSlug} />;
  if (path === "/projects") return <ProjectsArea orgSlug={orgSlug} />;
  if (path === "/reports") return <ReportsArea orgSlug={orgSlug} />;
  if (["/sales", "/customers", "/invoices", "/finance", "/finance/cash"].includes(path))
    return <SalesFinanceArea orgSlug={orgSlug} area={path === "/finance/cash" ? "finance" : path.slice(1) as "sales" | "customers" | "invoices" | "finance"} />;
  if (path === "/alerts") return <AlertsArea orgSlug={orgSlug} />;
  if (path === "/notifications") return <NotificationsArea orgSlug={orgSlug} />;
  if (canonicalPath === "/appointments") return <AppointmentsArea orgSlug={orgSlug} />;
  if (path === "/careers") return <CareersArea orgSlug={orgSlug} />;
  if (path === "/incidents") return <IncidentsArea orgSlug={orgSlug} />;
  if (path === "/security") return <SecurityArea orgSlug={orgSlug} />;
  if (path === "/documents") return <DocumentsArea orgSlug={orgSlug} />;
  if (path === "/approvals") return <ApprovalsControlArea orgSlug={orgSlug} />;
  if (path === "/daily-work") return <DailyWorkArea orgSlug={orgSlug} />;
  // Attendance and shifts share one screen: a supervisor signs off yesterday's
  // hours and rosters tomorrow in the same sitting.
  if (path === "/attendance") return <AttendanceArea orgSlug={orgSlug} />;
  if (path === "/shifts")
    return <AttendanceArea orgSlug={orgSlug} initialTab="roster" />;
  if (path === "/settings") return <MembersArea orgSlug={orgSlug} />;
  if (path === "/settings/sites") return <LocationsArea orgSlug={orgSlug} />;
  if (path === "/my-account") return <MyAccountArea orgSlug={orgSlug} />;
  if (path === "/my-contracts") return <MyAccountArea orgSlug={orgSlug} initialSection="contracts" />;
  if (path === "/employees") return <EmployeesArea orgSlug={orgSlug} />;
  if (path === "/leave") return <LeaveArea orgSlug={orgSlug} />;
  if (path === "/training") return <TrainingArea orgSlug={orgSlug} />;
  if (path === "/my-trainings") return <MyTrainingsArea orgSlug={orgSlug} />;
  if (path.startsWith("/my-trainings/"))
    return <MyTrainingsArea orgSlug={orgSlug} assignmentId={path.slice("/my-trainings/".length)} />;
  if (path === "/contracts") return <ContractsArea orgSlug={orgSlug} />;
  if (path === "/audit") return <AuditArea orgSlug={orgSlug} />;
  if (path === "/performance") return <PerformanceArea orgSlug={orgSlug} />;
  if (path === "/payroll") return <PayrollArea orgSlug={orgSlug} />;
  if (path === "/disciplinary-actions")
    return <DisciplineArea orgSlug={orgSlug} />;
  if (
    [
      "/tasks",
      "/inventory",
      "/procurement",
      "/suppliers",
      "/equipment",
      "/maintenance",
    ].includes(path)
  )
    return (
      <OperationsArea
        orgSlug={orgSlug}
        area={path.slice(1) as OperationsAreaKind}
      />
    );

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      <Link
        href={`/${orgSlug}/dashboard`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("workspace.dashboard")}
      </Link>
      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-[0_18px_40px_-32px_rgba(11,11,11,.55)]">
        <div className="bg-[linear-gradient(125deg,#0d366b_0%,#2a78d6_100%)] px-5 py-7 text-white sm:px-7">
          <CircleDashed className="size-6 text-blue-100" aria-hidden />
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">
            {title}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-blue-50/90">
            {t("area.description")}
          </p>
        </div>
        <div className="p-5 sm:p-7">
          <h2 className="text-sm font-semibold text-ink">
            {t("area.readyTitle")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
            {t("area.readyDescription")}
          </p>
        </div>
      </section>
    </main>
  );
}
