import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const code = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,62}$/, "Use lowercase letters, numbers and underscores");
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || undefined).optional();
/** Empty optional contact fields must become undefined before email/phone validation. */
const optionalContact = (schema: z.ZodString) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );
const optionalEmail = optionalContact(z.string().trim().email("Use a valid email address").max(255));
const optionalPhone = optionalContact(z.string().trim().min(5, "Enter a valid phone number").max(80));
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const preferredLanguage = z.enum(["fr", "en"]).default("fr");

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const appointmentParams = organizationParams.extend({ appointmentId: id });
export const appointmentServiceParams = organizationParams.extend({ serviceId: id });
export const appointmentDeskParams = organizationParams.extend({ deskId: id });
export const appointmentCallMessageParams = organizationParams.extend({ messageTemplateId: id });
export const listDesksQuery = z.object({
  siteId: id.optional(),
});
export const listCallMessagesQuery = z.object({
  siteId: id.optional(),
});

export const publicSiteParams = z.object({
  orgSlug: organizationSlugSchema,
  siteCode: code,
});
export const publicBookingSlotsQuery = z.object({
  date: z.string().date(),
  serviceId: id,
});

export const listAppointmentsQuery = z.object({
  siteId: id.optional(),
  status: z.enum(["scheduled", "checked_in", "waiting", "called", "serving", "completed", "cancelled", "no_show"]).optional(),
  date: z.string().date().optional(),
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const appointmentSiteSettingsInput = z.object({
  siteId: id,
  publicBookingEnabled: z.boolean().default(false),
  qrCheckinEnabled: z.boolean().default(false),
  queueDisplayEnabled: z.boolean().default(false),
  bookingOpensAt: time.default("08:00"),
  bookingClosesAt: time.default("17:00"),
  slotIntervalMinutes: z.coerce.number().int().min(5).max(240).default(30),
  defaultServiceMinutes: z.coerce.number().int().min(5).max(480).default(20),
  welcomeMessage: z.string().trim().max(1000).transform((value) => value || undefined).optional(),
  queueCallMessage: z.string().trim().max(500).transform((value) => value || undefined).optional(),
  idleDisplayTitle: optionalText(120),
  idleDisplayMessage: optionalText(600),
  idleDisplayDocumentId: id.nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.bookingClosesAt <= value.bookingOpensAt)
    ctx.addIssue({ code: "custom", path: ["bookingClosesAt"], message: "Closing time must be later than opening time" });
});

export const appointmentServiceInput = z.object({
  siteId: id,
  code,
  name: text(160),
  description: optionalText(1000),
  durationMinutes: z.coerce.number().int().min(5).max(480).default(20),
  allowsOnlineBooking: z.boolean().default(true),
  allowsQrCheckin: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const appointmentDeskInput = z.object({
  siteId: id,
  code,
  name: text(160),
  isActive: z.boolean().default(true),
});

export const appointmentCallMessageInput = z.object({
  siteId: id,
  title: text(100),
  content: text(500),
  isActive: z.boolean().default(true),
});

export const createStaffAppointmentInput = z.object({
  siteId: id,
  serviceId: id.nullable().optional(),
  visitorName: text(180),
  visitorEmail: optionalEmail.nullable().optional(),
  visitorPhone: optionalPhone.nullable().optional(),
  reason: optionalText(2000),
  scheduledAt: z.string().datetime({ offset: true }),
  assignedMemberId: id.nullable().optional(),
}).superRefine((value, ctx) => {
  if (!value.visitorEmail && !value.visitorPhone)
    ctx.addIssue({ code: "custom", path: ["visitorEmail"], message: "Enter an email address or phone number" });
});

export const updateAppointmentStatusInput = z.object({
  status: z.enum(["scheduled", "waiting", "called", "serving", "completed", "cancelled", "no_show"]),
  deskId: id.optional(),
  note: optionalText(1000),
});

export const callNextInput = z.object({
  siteId: id,
  deskId: id,
  messageTemplateId: id.optional(),
});

export const publicBookingInput = z.object({
  siteCode: code,
  serviceId: id,
  visitorName: text(180),
  visitorEmail: optionalEmail.nullable().optional(),
  visitorPhone: optionalPhone.nullable().optional(),
  reason: optionalText(2000),
  scheduledAt: z.string().datetime({ offset: true }),
  preferredLanguage,
}).superRefine((value, ctx) => {
  if (!value.visitorEmail && !value.visitorPhone)
    ctx.addIssue({ code: "custom", path: ["visitorEmail"], message: "Enter an email address or phone number" });
});

export const publicCheckInInput = z.object({
  token: id,
  serviceId: id,
  visitorName: text(180),
  visitorEmail: z.string().trim().email("Use a valid email address").max(255),
  visitorPhone: optionalPhone.nullable().optional(),
  reason: text(1000),
  preferredLanguage,
});

export type ListAppointmentsInput = z.infer<typeof listAppointmentsQuery>;
export type AppointmentSiteSettingsInput = z.infer<typeof appointmentSiteSettingsInput>;
export type AppointmentServiceInput = z.infer<typeof appointmentServiceInput>;
export type AppointmentDeskInput = z.infer<typeof appointmentDeskInput>;
export type AppointmentCallMessageInput = z.infer<typeof appointmentCallMessageInput>;
export type ListDesksInput = z.infer<typeof listDesksQuery>;
export type ListCallMessagesInput = z.infer<typeof listCallMessagesQuery>;
export type CreateStaffAppointmentInput = z.infer<typeof createStaffAppointmentInput>;
export type UpdateAppointmentStatusInput = z.infer<typeof updateAppointmentStatusInput>;
export type CallNextInput = z.infer<typeof callNextInput>;
export type PublicBookingInput = z.infer<typeof publicBookingInput>;
export type PublicBookingSlotsInput = z.infer<typeof publicBookingSlotsQuery>;
export type PublicCheckInInput = z.infer<typeof publicCheckInInput>;

