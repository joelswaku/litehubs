import { del, get, orgUrl, patch, post } from "./api";

/**
 * Shifts, rosters and attendance.
 *
 * Route construction lives here rather than in the screens, for the same reason
 * the poultry and agriculture clients exist: a workspace-scoped URL assembled by
 * hand is a tenant bug waiting to happen, and `orgUrl` is the only thing that
 * guarantees the slug lands in the right position.
 */

export type AttendanceQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

function base(orgSlug: string, path: string): string {
  return orgUrl(orgSlug, path);
}

function queryString(query?: AttendanceQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export interface Shift {
  id: string;
  code: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  provinceId?: string | null;
  provinceName?: string | null;
  siteId?: string | null;
  siteName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  notes?: string | null;
  province?: { id?: string; name?: string | null } | null;
  site?: { id?: string; name?: string | null } | null;
}

export interface AttendanceEmployee {
  id: string;
  employeeNumber: string;
  fullName: string;
  jobTitle?: string | null;
}

/** The API returns the person as an object; legacy flat fields remain optional while old records are migrated. */
export interface ShiftAssignment {
  id: string;
  shiftId: string;
  employee?: AttendanceEmployee | null;
  employeeId?: string;
  employeeName?: string | null;
  employeeNumber?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface AttendanceRecord {
  id: string;
  employee?: AttendanceEmployee | null;
  employeeId?: string;
  employeeName?: string | null;
  employeeNumber?: string | null;
  workDate: string;
  status: string;
  clockInAt?: string | null;
  clockOutAt?: string | null;
  workedHours?: number | string | null;
  overtimeHours?: number | string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  approval?: { approvedAt?: string | null; approvedByName?: string | null } | null;
  notes?: string | null;
  shift?: { id: string; code?: string | null; name?: string | null } | null;
  shiftId?: string | null;
  shiftName?: string | null;
}

export const attendanceApi = {
  /* -------------------------------------------------------------- shifts -- */
  listShifts<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "shifts"));
  },
  createShift<T>(orgSlug: string, body: Record<string, unknown>) {
    return post<T>(base(orgSlug, "shifts"), body);
  },
  updateShift<T>(
    orgSlug: string,
    shiftId: string,
    body: Record<string, unknown>,
  ) {
    return patch<T>(base(orgSlug, `shifts/${shiftId}`), body);
  },
  removeShift<T>(orgSlug: string, shiftId: string) {
    return del<T>(base(orgSlug, `shifts/${shiftId}`));
  },

  /* ---------------------------------------------------------- the roster -- */
  listAssignments<T>(orgSlug: string, shiftId: string) {
    return get<T>(base(orgSlug, `shifts/${shiftId}/assignments`));
  },
  /**
   * Puts an employee on a shift from a date.
   *
   * `effectiveFrom` is required by the API and `effectiveTo` is optional — an
   * open-ended assignment is the normal case, and the pair is validated so the
   * end cannot precede the start.
   */
  assignEmployee<T>(
    orgSlug: string,
    shiftId: string,
    body: { employeeId: string; effectiveFrom: string; effectiveTo?: string },
  ) {
    return post<T>(base(orgSlug, `shifts/${shiftId}/assignments`), body);
  },

  /* ---------------------------------------------------------- attendance -- */
  listAttendance<T>(orgSlug: string, query?: AttendanceQuery) {
    return get<T>(base(orgSlug, `attendance${queryString(query)}`));
  },
  clockIn<T>(orgSlug: string, body: Record<string, unknown>) {
    return post<T>(base(orgSlug, "attendance/clock-in"), body);
  },
  clockOut<T>(orgSlug: string, body: Record<string, unknown>) {
    return post<T>(base(orgSlug, "attendance/clock-out"), body);
  },
  correct<T>(
    orgSlug: string,
    attendanceId: string,
    body: Record<string, unknown>,
  ) {
    return patch<T>(base(orgSlug, `attendance/${attendanceId}`), body);
  },
  /**
   * Signs off a day's record. Behind `attendance.approve`, which is deliberately
   * separate from `attendance.correct` — the person who fixes a time entry
   * should not be the one who approves it.
   */
  approve<T>(orgSlug: string, attendanceId: string) {
    return post<T>(base(orgSlug, `attendance/${attendanceId}/approve`), {});
  },
};
