import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import {
  requireAnyPermission,
  requirePermission,
} from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./attendance.controller";
import {
  assignEmployeeSchema,
  attendanceParams,
  clockSchema,
  correctAttendanceSchema,
  createShiftSchema,
  listAttendanceQuery,
  organizationParams,
  shiftParams,
  updateShiftSchema,
} from "./attendance.validation";

export const attendanceRoutes = Router();

const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

attendanceRoutes.get(
  "/organizations/:orgSlug/shifts",
  ...inOrganization,
  requirePermission("shifts.read"),
  controller.listShifts,
);

attendanceRoutes.post(
  "/organizations/:orgSlug/shifts",
  ...inOrganization,
  requirePermission("shifts.create"),
  validate({ body: createShiftSchema }),
  controller.createShift,
);

attendanceRoutes.patch(
  "/organizations/:orgSlug/shifts/:shiftId",
  authenticate,
  validate({ params: shiftParams }),
  requireOrganization,
  requirePermission("shifts.update"),
  validate({ body: updateShiftSchema }),
  controller.updateShift,
);

attendanceRoutes.delete(
  "/organizations/:orgSlug/shifts/:shiftId",
  authenticate,
  validate({ params: shiftParams }),
  requireOrganization,
  requirePermission("shifts.delete"),
  controller.deleteShift,
);

attendanceRoutes.get(
  "/organizations/:orgSlug/shifts/:shiftId/assignments",
  authenticate,
  validate({ params: shiftParams }),
  requireOrganization,
  requirePermission("shifts.read"),
  controller.listAssignments,
);

attendanceRoutes.post(
  "/organizations/:orgSlug/shifts/:shiftId/assignments",
  authenticate,
  validate({ params: shiftParams }),
  requireOrganization,
  requirePermission("shifts.update"),
  validate({ body: assignEmployeeSchema }),
  controller.assignEmployee,
);

attendanceRoutes.get(
  "/organizations/:orgSlug/attendance",
  ...inOrganization,
  requirePermission("attendance.read"),
  validate({ query: listAttendanceQuery }),
  controller.listAttendance,
);

attendanceRoutes.post(
  "/organizations/:orgSlug/attendance/clock-in",
  ...inOrganization,
  requireAnyPermission("attendance.clock_self", "attendance.clock_others"),
  validate({ body: clockSchema }),
  controller.clockIn,
);

attendanceRoutes.post(
  "/organizations/:orgSlug/attendance/clock-out",
  ...inOrganization,
  requireAnyPermission("attendance.clock_self", "attendance.clock_others"),
  validate({ body: clockSchema }),
  controller.clockOut,
);

attendanceRoutes.patch(
  "/organizations/:orgSlug/attendance/:attendanceId",
  authenticate,
  validate({ params: attendanceParams }),
  requireOrganization,
  requirePermission("attendance.correct"),
  validate({ body: correctAttendanceSchema }),
  controller.correctAttendance,
);

attendanceRoutes.post(
  "/organizations/:orgSlug/attendance/:attendanceId/approve",
  authenticate,
  validate({ params: attendanceParams }),
  requireOrganization,
  requirePermission("attendance.approve"),
  controller.approveAttendance,
);
