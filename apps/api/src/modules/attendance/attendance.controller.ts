import type { Request, RequestHandler } from "express";
import * as service from "./attendance.service";
import type {
  AssignEmployeeInput,
  ChangeAssignmentInput,
  ClockInput,
  CorrectAttendanceInput,
  CreateShiftInput,
  ListAttendanceInput,
  UpdateShiftInput,
  ScheduleExceptionInput,
} from "./attendance.validation";

function contextOf(req: Request): service.WorkforceContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}

function parameter(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export const listShifts: RequestHandler = async (req, res) => {
  res.json({ shifts: await service.listShifts(contextOf(req)) });
};

export const createShift: RequestHandler = async (req, res) => {
  const shift = await service.createShift(
    contextOf(req),
    req.body as CreateShiftInput,
  );
  res.status(201).json({ shift });
};

export const updateShift: RequestHandler = async (req, res) => {
  res.json({
    shift: await service.updateShift(
      contextOf(req),
      parameter(req, "shiftId"),
      req.body as UpdateShiftInput,
    ),
  });
};

export const deleteShift: RequestHandler = async (req, res) => {
  await service.deleteShift(contextOf(req), parameter(req, "shiftId"));
  res.status(204).send();
};

export const assignEmployee: RequestHandler = async (req, res) => {
  const assignment = await service.assignEmployee(
    contextOf(req),
    parameter(req, "shiftId"),
    req.body as AssignEmployeeInput,
  );
  res.status(201).json({ assignment });
};

export const changeAssignment: RequestHandler = async (req, res) => {
  res.json({
    assignment: await service.changeAssignment(
      contextOf(req),
      parameter(req, "shiftId"),
      parameter(req, "assignmentId"),
      req.body as ChangeAssignmentInput,
    ),
  });
};

export const listAssignments: RequestHandler = async (req, res) => {
  res.json({
    assignments: await service.listAssignments(
      contextOf(req),
      parameter(req, "shiftId"),
    ),
  });
};

export const listAssignmentExceptions: RequestHandler = async (req, res) => {
  res.json({
    exceptions: await service.listAssignmentExceptions(
      contextOf(req),
      parameter(req, "shiftId"),
      parameter(req, "assignmentId"),
    ),
  });
};

export const saveAssignmentException: RequestHandler = async (req, res) => {
  res.status(201).json({
    exception: await service.saveAssignmentException(
      contextOf(req),
      parameter(req, "shiftId"),
      parameter(req, "assignmentId"),
      req.body as ScheduleExceptionInput,
    ),
  });
};

export const deleteAssignmentException: RequestHandler = async (req, res) => {
  await service.deleteAssignmentException(
    contextOf(req),
    parameter(req, "shiftId"),
    parameter(req, "assignmentId"),
    parameter(req, "exceptionId"),
  );
  res.status(204).send();
};
export const clockIn: RequestHandler = async (req, res) => {
  const attendance = await service.clockIn(
    contextOf(req),
    req.body as ClockInput,
  );
  res.status(201).json({ attendance });
};

export const clockOut: RequestHandler = async (req, res) => {
  res.json({
    attendance: await service.clockOut(contextOf(req), req.body as ClockInput),
  });
};

export const listAttendance: RequestHandler = async (req, res) => {
  res.json({
    attendance: await service.listAttendance(
      contextOf(req),
      req.query as ListAttendanceInput,
    ),
  });
};

export const correctAttendance: RequestHandler = async (req, res) => {
  res.json({
    attendance: await service.correctAttendance(
      contextOf(req),
      parameter(req, "attendanceId"),
      req.body as CorrectAttendanceInput,
    ),
  });
};

export const approveAttendance: RequestHandler = async (req, res) => {
  res.json({
    attendance: await service.approveAttendance(
      contextOf(req),
      parameter(req, "attendanceId"),
    ),
  });
};
