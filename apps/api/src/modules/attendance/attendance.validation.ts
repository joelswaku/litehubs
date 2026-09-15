import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const idSchema = z.string().uuid("Enter a valid identifier");
const workDateSchema = z.string().date("Use YYYY-MM-DD");
const timestampSchema = z.string().datetime({ offset: true });
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time such as 06:00");
const shiftCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  );
const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional();
const nonEmptyUpdate = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });

const weeklyScheduleDaySchema = z
  .object({
    day: z.coerce.number().int().min(1).max(7),
    enabled: z.boolean(),
    startsAt: timeSchema.optional(),
    endsAt: timeSchema.optional(),
    breakMinutes: z.coerce.number().int().min(0).max(720).default(0),
  })
  .superRefine((value, context) => {
    if (value.enabled && (!value.startsAt || !value.endsAt)) {
      context.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "Working days need a start and end time",
      });
    }
  });

const weeklyScheduleSchema = z
  .array(weeklyScheduleDaySchema)
  .length(7, "Provide one entry for every day of the week")
  .superRefine((days, context) => {
    const seen = new Set(days.map((day) => day.day));
    if (seen.size !== 7 || ![1, 2, 3, 4, 5, 6, 7].every((day) => seen.has(day))) {
      context.addIssue({
        code: "custom",
        message: "The weekly schedule must contain Monday through Sunday exactly once",
      });
    }
  });

export const organizationParams = z.object({
  orgSlug: organizationSlugSchema,
});

export const shiftParams = organizationParams.extend({
  shiftId: idSchema,
});

export const attendanceParams = organizationParams.extend({
  attendanceId: idSchema,
});

export const assignmentParams = shiftParams.extend({
  assignmentId: idSchema,
});

export const createShiftSchema = z.object({
  code: shiftCodeSchema,
  name: z.string().trim().min(2).max(150),
  siteId: idSchema,
  departmentId: idSchema.optional(),
  startsAt: timeSchema,
  endsAt: timeSchema,
  weeklySchedule: weeklyScheduleSchema.optional(),
  notes: optionalText(2_000),
});

export const updateShiftSchema = nonEmptyUpdate({
  code: shiftCodeSchema.optional(),
  name: z.string().trim().min(2).max(150).optional(),
  siteId: idSchema.optional(),
  departmentId: idSchema.nullable().optional(),
  startsAt: timeSchema.optional(),
  endsAt: timeSchema.optional(),
  weeklySchedule: weeklyScheduleSchema.optional(),
  isActive: z.boolean().optional(),
  notes: optionalText(2_000).nullable(),
});

export const assignEmployeeSchema = z
  .object({
    employeeId: idSchema,
    effectiveFrom: workDateSchema,
    effectiveTo: workDateSchema.optional(),
  })
  .refine(
    (value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    { message: "The assignment end date must be on or after the start date" },
  );

export const changeAssignmentSchema = z.object({
  targetShiftId: idSchema,
  effectiveFrom: workDateSchema,
});

export const scheduleExceptionSchema = z
  .object({
    workDate: workDateSchema,
    isWorking: z.boolean(),
    startsAt: timeSchema.optional(),
    endsAt: timeSchema.optional(),
    breakMinutes: z.coerce.number().int().min(0).max(720).default(0),
    note: optionalText(1_000).nullable(),
  })
  .superRefine((value, context) => {
    if (value.isWorking && (!value.startsAt || !value.endsAt)) {
      context.addIssue({ code: "custom", path: ["startsAt"], message: "Working exceptions need a start and end time" });
    }
    if (!value.isWorking && (value.startsAt || value.endsAt || value.breakMinutes !== 0)) {
      context.addIssue({ code: "custom", path: ["isWorking"], message: "A rest-day exception cannot contain work hours" });
    }
  });

export const exceptionParams = assignmentParams.extend({
  exceptionId: idSchema,
});
const employeeNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{5}$/, "Use the employee five-digit number, such as 10001");

export const clockSchema = z.object({
  employeeNumber: employeeNumberSchema,
  workDate: workDateSchema,
  occurredAt: timestampSchema.optional(),
  notes: optionalText(2_000),
});

export const listAttendanceQuery = z.object({
  workDate: workDateSchema.optional(),
  employeeId: idSchema.optional(),
});

export const correctAttendanceSchema = z.object({
  status: z.enum(["present", "late", "absent", "leave"]).optional(),
  clockInAt: timestampSchema.nullable().optional(),
  clockOutAt: timestampSchema.nullable().optional(),
  notes: optionalText(2_000).nullable(),
  correctionNote: z.string().trim().min(2).max(2_000),
});

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type AssignEmployeeInput = z.infer<typeof assignEmployeeSchema>;
export type ChangeAssignmentInput = z.infer<typeof changeAssignmentSchema>;
export type ScheduleExceptionInput = z.infer<typeof scheduleExceptionSchema>;
export type ClockInput = z.infer<typeof clockSchema>;
export type ListAttendanceInput = z.infer<typeof listAttendanceQuery>;
export type CorrectAttendanceInput = z.infer<typeof correctAttendanceSchema>;
