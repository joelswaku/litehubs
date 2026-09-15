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
  assignmentParams,
  changeAssignmentSchema,
  attendanceParams,
  clockSchema,
  correctAttendanceSchema,
  exceptionParams,
  scheduleExceptionSchema,
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

attendanceRoutes.post(
  "/organizations/:orgSlug/shifts/:shiftId/assignments/:assignmentId/change",
  authenticate,
  validate({ params: assignmentParams }),
  requireOrganization,
  requirePermission("shifts.update"),
  validate({ body: changeAssignmentSchema }),
  controller.changeAssignment,
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
  "/organizations/:orgSlug/shifts/:shiftId/assignments/:assignmentId/exceptions",
  authenticate,
  validate({ params: assignmentParams }),
  requireOrganization,
  requirePermission("shifts.read"),
  controller.listAssignmentExceptions,
);

attendanceRoutes.post(
  "/organizations/:orgSlug/shifts/:shiftId/assignments/:assignmentId/exceptions",
  authenticate,
  validate({ params: assignmentParams }),
  requireOrganization,
  requirePermission("shifts.update"),
  validate({ body: scheduleExceptionSchema }),
  controller.saveAssignmentException,
);

attendanceRoutes.delete(
  "/organizations/:orgSlug/shifts/:shiftId/assignments/:assignmentId/exceptions/:exceptionId",
  authenticate,
  validate({ params: exceptionParams }),
  requireOrganization,
  requirePermission("shifts.update"),
  controller.deleteAssignmentException,
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
