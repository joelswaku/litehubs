import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requireOwner, requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./appointments.controller";
import {
  appointmentParams,
  appointmentCallMessageInput,
  appointmentCallMessageParams,
  appointmentDeskInput,
  appointmentDeskParams,
  appointmentServiceInput,
  appointmentServiceParams,
  appointmentSiteSettingsInput,
  callNextInput,
  createStaffAppointmentInput,
  listAppointmentsQuery,
  listCallMessagesQuery,
  listDesksQuery,
  organizationParams,
  publicBookingInput,
  publicBookingSlotsQuery,
  publicCheckInInput,
  publicSiteParams,
  updateAppointmentStatusInput,
} from "./appointments.validation";

export const appointmentRoutes = Router();
const inside = [authenticate, validate({ params: organizationParams }), requireOrganization] as const;

const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "APPOINTMENT_RATE_LIMITED", message: "Too many appointment requests. Please try again later." } },
});

appointmentRoutes.get("/public/appointments/sites", controller.publicDirectory);
appointmentRoutes.get("/public/organizations/:orgSlug/appointments/sites",
  validate({ params: organizationParams }), controller.publicSites);
appointmentRoutes.get("/public/organizations/:orgSlug/appointments/sites/:siteCode/slots",
  validate({ params: publicSiteParams, query: publicBookingSlotsQuery }), controller.publicSlots);
appointmentRoutes.get("/public/organizations/:orgSlug/appointments/sites/:siteCode",
  validate({ params: publicSiteParams }), controller.publicSite);
appointmentRoutes.post("/public/organizations/:orgSlug/appointments/book",
  publicWriteLimiter, validate({ params: organizationParams, body: publicBookingInput }), controller.publicBook);
appointmentRoutes.post("/public/organizations/:orgSlug/appointments/sites/:siteCode/check-in",
  publicWriteLimiter, validate({ params: publicSiteParams, body: publicCheckInInput }), controller.publicCheckIn);
appointmentRoutes.get("/public/organizations/:orgSlug/appointments/sites/:siteCode/queue",
  validate({ params: publicSiteParams }), controller.publicQueue);
appointmentRoutes.get("/public/organizations/:orgSlug/appointments/sites/:siteCode/idle-video",
  validate({ params: publicSiteParams }), controller.publicIdleVideo);

appointmentRoutes.get("/organizations/:orgSlug/appointments", ...inside,
  requirePermission("appointments.read"), validate({ query: listAppointmentsQuery }), controller.list);
appointmentRoutes.get("/organizations/:orgSlug/appointments/summary", ...inside,
  requirePermission("appointments.read"), controller.summary);
appointmentRoutes.get("/organizations/:orgSlug/appointments/settings", ...inside,
  requirePermission("appointments.read"), controller.settings);
appointmentRoutes.put("/organizations/:orgSlug/appointments/settings", ...inside,
  requireOwner, validate({ body: appointmentSiteSettingsInput }), controller.saveSettings);
appointmentRoutes.get("/organizations/:orgSlug/appointments/services", ...inside,
  requirePermission("appointments.read"), controller.services);
appointmentRoutes.post("/organizations/:orgSlug/appointments/services", ...inside,
  requirePermission("appointments.create"), validate({ body: appointmentServiceInput }), controller.createService);
appointmentRoutes.patch("/organizations/:orgSlug/appointments/services/:serviceId",
  authenticate, validate({ params: appointmentServiceParams, body: appointmentServiceInput }), requireOrganization,
  requirePermission("appointments.update"), controller.updateService);
appointmentRoutes.delete("/organizations/:orgSlug/appointments/services/:serviceId",
  authenticate, validate({ params: appointmentServiceParams }), requireOrganization,
  requirePermission("appointments.update"), controller.deactivateService);
appointmentRoutes.get("/organizations/:orgSlug/appointments/call-messages", ...inside,
  requirePermission("appointments.read"), validate({ query: listCallMessagesQuery }), controller.callMessages);
appointmentRoutes.post("/organizations/:orgSlug/appointments/call-messages", ...inside,
  requireOwner, validate({ body: appointmentCallMessageInput }), controller.createCallMessage);
appointmentRoutes.patch("/organizations/:orgSlug/appointments/call-messages/:messageTemplateId",
  authenticate, validate({ params: appointmentCallMessageParams, body: appointmentCallMessageInput }), requireOrganization,
  requireOwner, controller.updateCallMessage);
appointmentRoutes.delete("/organizations/:orgSlug/appointments/call-messages/:messageTemplateId",
  authenticate, validate({ params: appointmentCallMessageParams }), requireOrganization,
  requireOwner, controller.deactivateCallMessage);

appointmentRoutes.get("/organizations/:orgSlug/appointments/desks", ...inside,
  requirePermission("appointments.read"), validate({ query: listDesksQuery }), controller.desks);
appointmentRoutes.post("/organizations/:orgSlug/appointments/desks", ...inside,
  requirePermission("appointments.create"), validate({ body: appointmentDeskInput }), controller.createDesk);
appointmentRoutes.patch("/organizations/:orgSlug/appointments/desks/:deskId",
  authenticate, validate({ params: appointmentDeskParams, body: appointmentDeskInput }), requireOrganization,
  requirePermission("appointments.update"), controller.updateDesk);
appointmentRoutes.delete("/organizations/:orgSlug/appointments/desks/:deskId",
  authenticate, validate({ params: appointmentDeskParams }), requireOrganization,
  requirePermission("appointments.update"), controller.deactivateDesk);
appointmentRoutes.post("/organizations/:orgSlug/appointments/desks/:deskId/release",
  authenticate, validate({ params: appointmentDeskParams }), requireOrganization,
  requirePermission("appointments.update"), controller.releaseDesk);
appointmentRoutes.post("/organizations/:orgSlug/appointments", ...inside,
  requirePermission("appointments.create"), validate({ body: createStaffAppointmentInput }), controller.create);
appointmentRoutes.post("/organizations/:orgSlug/appointments/:appointmentId/check-in",
  authenticate, validate({ params: appointmentParams }), requireOrganization, requirePermission("appointments.update"), controller.checkIn);
appointmentRoutes.patch("/organizations/:orgSlug/appointments/:appointmentId/status",
  authenticate, validate({ params: appointmentParams, body: updateAppointmentStatusInput }), requireOrganization,
  requirePermission("appointments.update"), controller.updateStatus);
appointmentRoutes.post("/organizations/:orgSlug/appointments/queue/call-next", ...inside,
  requirePermission("appointments.update"), validate({ body: callNextInput }), controller.callNext);
