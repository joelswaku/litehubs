"use client";

import { useQuery } from "@tanstack/react-query";
import { get, orgUrl } from "@/lib/api";
import { poultryApi } from "@/lib/poultry-api";
import { STALE_TIME } from "@/lib/constants";
import { can, canAny, isOwner } from "@/lib/permissions";
import { useSessionUser } from "@/stores/session-store";

/**
 * The dashboard's data.
 *
 * Each widget's query is `enabled` only when the caller holds the permission
 * for it. That is not a nicety — without it, a storekeeper's dashboard would
 * fire a request for the finance summary, take a 403, and React Query would
 * surface a failed query for a panel that is not even rendered. Gating on the
 * permission means the request is never made.
 *
 * Every hook takes the slug explicitly rather than reading the active
 * organization from the store. The URL is the authority on which workspace is
 * on screen, and during a switch the store lags it by one render — passing the
 * slug down makes a request-for-the-wrong-tenant structurally impossible.
 */

export interface PoultryOverview {
  period: { from: string | null; to: string | null };
  totals: {
    allFlocks: number;
    activeFlocks: number;
    initialBirds: number;
    mortalityCount: number;
    mortalityRatePercent: number;
    totalEggs: number;
    feedKg: number;
    waterLiters: number;
  };
  mortalityReview: unknown[];
}

export function usePoultryOverview(orgSlug: string) {
  const user = useSessionUser();
  return useQuery({
    queryKey: ["poultry-overview", orgSlug],
    queryFn: () => poultryApi.overview<{ overview: PoultryOverview }>(orgSlug),
    enabled: can(user, "poultry.flocks.read"),
    staleTime: STALE_TIME.live,
    select: (data) => data.overview,
  });
}

export interface PigOverview {
  totals: Record<string, number>;
}

export function usePigOverview(orgSlug: string) {
  const user = useSessionUser();
  return useQuery({
    queryKey: ["pig-overview", orgSlug],
    queryFn: () =>
      get<{ overview: PigOverview }>(orgUrl(orgSlug, "pigs/overview")),
    enabled: can(user, "pigs.animals.read"),
    staleTime: STALE_TIME.live,
    select: (data) => data.overview,
  });
}

export function useAgricultureOverview(orgSlug: string) {
  const user = useSessionUser();
  return useQuery({
    queryKey: ["agriculture-overview", orgSlug],
    queryFn: () =>
      get<{ overview: { totals: Record<string, number> } }>(
        orgUrl(orgSlug, "agriculture/overview"),
      ),
    enabled: can(user, "agriculture.farms.read"),
    staleTime: STALE_TIME.live,
    select: (data) => data.overview,
  });
}

export interface EmployeeSummary {
  id: string;
  employeeNumber: string;
  fullName: string;
  jobTitle: string;
  /** Normalised for dashboard and attendance consumers. */
  employmentStatus: string;
  departmentName?: string | null;
  siteName?: string | null;
  employment?: { status?: string | null };
  department?: { name?: string | null } | null;
  site?: { name?: string | null } | null;
}

type EmployeeApiRecord = Omit<
  Partial<EmployeeSummary>,
  "id" | "employeeNumber" | "fullName" | "jobTitle"
> & {
  id: string;
  employeeNumber: string;
  fullName: string;
  jobTitle: string;
};

export function useEmployees(orgSlug: string, limit = 100) {
  const user = useSessionUser();
  return useQuery({
    queryKey: ["employees", orgSlug, limit],
    queryFn: () =>
      get<{ employees: EmployeeApiRecord[] }>(
        orgUrl(orgSlug, `employees?limit=${limit}`),
      ),
    enabled: can(user, "employees.read"),
    staleTime: STALE_TIME.standard,
    select: (data): EmployeeSummary[] =>
      data.employees.map((employee) => ({
        ...employee,
        employmentStatus:
          employee.employment?.status ?? employee.employmentStatus ?? "",
        departmentName:
          employee.department?.name ?? employee.departmentName ?? null,
        siteName: employee.site?.name ?? employee.siteName ?? null,
      })),
  });
}

export interface WorkspaceTask {
  id: string;
  title?: string;
  status?: string;
  priority?: string;
  dueDate?: string | null;
  projectName?: string | null;
  blockedReason?: string | null;
}

export interface WorkspaceApproval {
  id: string;
  requestType?: string;
  status?: string;
  requestedAt?: string | null;
  requestedAmount?: number | null;
  title?: string | null;
}

export interface AttendanceSummary {
  id: string;
  workDate?: string;
  status?: string;
  clockInAt?: string | null;
  clockOutAt?: string | null;
  employee?: { fullName?: string };
}

export interface ManagementRecord {
  id: string;
  name?: string;
  code?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface OwnerDashboard {
  projects: {
    active: number;
    delayed: number;
    items: Array<{
      id: string;
      name?: string;
      status?: string;
      calculatedProgressPercent?: number;
      overdueTasks?: number;
    }>;
  };
  financials: {
    planned: number;
    spent: number;
    committed: number;
    available: number;
    utilizationPercent: number;
  };
  assets: {
    total: number;
    maintenanceDue: number;
    byStatus: Record<string, number>;
  };
  alerts: {
    maintenance: unknown[];
    pendingApprovals: WorkspaceApproval[];
    overdueTasks: WorkspaceTask[];
  };
  nextActions: WorkspaceTask[];
}

export function useOwnerDashboard(orgSlug: string) {
  const user = useSessionUser();
  return useQuery({
    queryKey: ["owner-dashboard", orgSlug],
    queryFn: () =>
      get<{ dashboard: OwnerDashboard }>(
        orgUrl(orgSlug, "owner-management/dashboard"),
      ),
    select: (data) => data.dashboard,
    enabled: isOwner(user) && can(user, "projects.read"),
    staleTime: STALE_TIME.standard,
  });
}

/** Work is scope-filtered by the API: a self-scoped employee receives only their assigned tasks. */
export function useTaskQueue(orgSlug: string) {
  const user = useSessionUser();
  return useQuery({
    queryKey: ["workspace-tasks", orgSlug],
    queryFn: () =>
      get<{ records: WorkspaceTask[] }>(
        orgUrl(orgSlug, "owner-management/tasks?limit=8"),
      ),
    select: (data) => data.records,
    enabled: can(user, "tasks.read"),
    staleTime: STALE_TIME.live,
  });
}

export function useApprovalQueue(orgSlug: string) {
  const user = useSessionUser();
  return useQuery({
    queryKey: ["workspace-approvals", orgSlug],
    queryFn: () =>
      get<{ records: WorkspaceApproval[] }>(
        orgUrl(orgSlug, "owner-management/approvals?limit=8"),
      ),
    select: (data) => data.records,
    enabled: can(user, "approvals.read"),
    staleTime: STALE_TIME.live,
  });
}

export function useAttendanceRecords(orgSlug: string) {
  const user = useSessionUser();
  return useQuery({
    queryKey: ["workspace-attendance", orgSlug],
    queryFn: () =>
      get<{ attendance: AttendanceSummary[] }>(orgUrl(orgSlug, "attendance")),
    select: (data) => data.attendance,
    enabled: can(user, "attendance.read"),
    staleTime: STALE_TIME.live,
  });
}

/** A small, permission-gated list for a specialist’s dashboard. */
export function useManagementRecords(
  orgSlug: string,
  resource: string,
  permission: string,
) {
  const user = useSessionUser();
  return useQuery({
    queryKey: ["workspace-management-records", orgSlug, resource],
    queryFn: () =>
      get<{ records: ManagementRecord[] }>(
        orgUrl(orgSlug, `owner-management/${resource}?limit=6`),
      ),
    select: (data) => data.records,
    enabled: can(user, permission),
    staleTime: STALE_TIME.standard,
  });
}

export interface WorkspaceProfile {
  organization: {
    id: string;
    slug: string;
    legalName: string;
    displayName: string;
    industryCode: string | null;
    currency: string;
    timezone: string;
    status: string;
    memberCount: number;
      /** Null until the owner completes first-time operational setup. */
      operationalServices: string[] | null;
      address: Record<string, string | null>;
    subscription: {
      planCode: string;
      status: string;
      seats: number;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
    } | null;
  };
}

export function useWorkspaceProfile(orgSlug: string) {
  return useQuery({
    queryKey: ["workspace-profile", orgSlug],
    queryFn: () => get<WorkspaceProfile>(`/organizations/${orgSlug}`),
    staleTime: STALE_TIME.reference,
    select: (data) => data.organization,
  });
}
