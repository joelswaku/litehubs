import type { Request, RequestHandler } from "express";
import * as service from "./appointments.service";
import type {
  AppointmentCallMessageInput, AppointmentDeskInput,
  AppointmentServiceInput,
  AppointmentSiteSettingsInput,
  CallNextInput,
  CreateStaffAppointmentInput,
  ListAppointmentsInput, ListCallMessagesInput,
  ListDesksInput,
  PublicBookingInput,
  PublicBookingSlotsInput,
  PublicCheckInInput,
  UpdateAppointmentStatusInput,
} from "./appointments.validation";

function context(req: Request): service.AppointmentContext {
  return {
    organizationId: req.organization!.id,
    organizationSlug: req.organization!.slug,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export const list: RequestHandler = async (req, res) =>
  res.json(await service.listAppointments(context(req), req.query as unknown as ListAppointmentsInput));
export const summary: RequestHandler = async (req, res) =>
  res.json({ summary: await service.summary(context(req)) });
export const settings: RequestHandler = async (req, res) =>
  res.json({ settings: await service.listSiteSettings(context(req)) });
export const saveSettings: RequestHandler = async (req, res) =>
  res.json({ setting: await service.saveSiteSettings(context(req), req.body as AppointmentSiteSettingsInput) });
export const services: RequestHandler = async (req, res) =>
  res.json({ services: await service.listServices(context(req), typeof req.query.siteId === "string" ? req.query.siteId : undefined) });
export const createService: RequestHandler = async (req, res) =>
  res.status(201).json({ service: await service.saveService(context(req), req.body as AppointmentServiceInput) });
export const callMessages: RequestHandler = async (req, res) =>
  res.json({ messages: await service.listCallMessages(context(req), req.query as unknown as ListCallMessagesInput) });
export const createCallMessage: RequestHandler = async (req, res) =>
  res.status(201).json({ message: await service.saveCallMessage(context(req), req.body as AppointmentCallMessageInput) });
export const updateCallMessage: RequestHandler = async (req, res) =>
  res.json({ message: await service.saveCallMessage(context(req), req.body as AppointmentCallMessageInput, param(req, "messageTemplateId")) });
export const deactivateCallMessage: RequestHandler = async (req, res) =>
  res.json({ message: await service.deactivateCallMessage(context(req), param(req, "messageTemplateId")) });
export const desks: RequestHandler = async (req, res) =>
  res.json({ desks: await service.listDesks(context(req), req.query as unknown as ListDesksInput) });
export const createDesk: RequestHandler = async (req, res) =>
  res.status(201).json({ desk: await service.saveDesk(context(req), req.body as AppointmentDeskInput) });
export const updateDesk: RequestHandler = async (req, res) =>
  res.json({ desk: await service.saveDesk(context(req), req.body as AppointmentDeskInput, param(req, "deskId")) });
export const deactivateDesk: RequestHandler = async (req, res) =>
  res.json({ desk: await service.deactivateDesk(context(req), param(req, "deskId")) });
export const releaseDesk: RequestHandler = async (req, res) =>
  res.json({ desk: await service.releaseDesk(context(req), param(req, "deskId")) });
export const updateService: RequestHandler = async (req, res) =>
  res.json({ service: await service.saveService(context(req), req.body as AppointmentServiceInput, param(req, "serviceId")) });
export const deactivateService: RequestHandler = async (req, res) =>
  res.json({ service: await service.deactivateService(context(req), param(req, "serviceId")) });
export const create: RequestHandler = async (req, res) =>
  res.status(201).json({ appointment: await service.createStaffAppointment(context(req), req.body as CreateStaffAppointmentInput) });
export const checkIn: RequestHandler = async (req, res) =>
  res.json({ appointment: await service.checkInStaffAppointment(context(req), param(req, "appointmentId")) });
export const updateStatus: RequestHandler = async (req, res) =>
  res.json({ appointment: await service.updateStatus(context(req), param(req, "appointmentId"), req.body as UpdateAppointmentStatusInput) });
export const callNext: RequestHandler = async (req, res) =>
  res.json(await service.completeAndCallNext(context(req), req.body as CallNextInput));

export const publicDirectory: RequestHandler = async (_req, res) =>
  res.json({ sites: await service.publicBookingDirectory() });
export const publicSites: RequestHandler = async (req, res) =>
  res.json({ sites: await service.publicCatalog(param(req, "orgSlug")) });
export const publicSite: RequestHandler = async (req, res) =>
  res.json(await service.publicSiteCatalog(param(req, "orgSlug"), param(req, "siteCode"), String(req.query.mode) === "checkin" ? "checkin" : "booking"));
export const publicSlots: RequestHandler = async (req, res) =>
  res.json(await service.publicAvailableSlots(param(req, "orgSlug"), param(req, "siteCode"), req.query as unknown as PublicBookingSlotsInput));
export const publicBook: RequestHandler = async (req, res) =>
  res.status(201).json(await service.publicBook(param(req, "orgSlug"), req.body as PublicBookingInput));
export const publicCheckIn: RequestHandler = async (req, res) =>
  res.status(201).json(await service.publicCheckIn(param(req, "orgSlug"), param(req, "siteCode"), req.body as PublicCheckInInput));
export const publicQueue: RequestHandler = async (req, res) =>
  res.json(await service.publicQueueDisplay(param(req, "orgSlug"), param(req, "siteCode")));
export const publicIdleVideo: RequestHandler = async (req, res) => {
  const video = await service.publicIdleDisplayVideo(param(req, "orgSlug"), param(req, "siteCode"));
  const total = video.buffer.length;
  const safeFileName = video.fileName.replace(/[\r\n"]/g, "");
  const range = req.headers.range;

  res.type(video.mimeType);
  res.setHeader("Content-Disposition", "inline; filename=" + String.fromCharCode(34) + safeFileName + String.fromCharCode(34));
  // TV browsers request media in byte ranges. Serving ranges lets playback begin
  // immediately and keeps seeking reliable without exposing the private file URL.
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    if (!match) {
      res.status(416).setHeader("Content-Range", "bytes */" + total).end();
      return;
    }
    const requestedStart = match[1] ? Number(match[1]) : 0;
    const requestedEnd = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isSafeInteger(requestedStart) || !Number.isSafeInteger(requestedEnd) || requestedStart < 0 || requestedStart >= total || requestedEnd < requestedStart) {
      res.status(416).setHeader("Content-Range", "bytes */" + total).end();
      return;
    }
    const end = Math.min(requestedEnd, total - 1);
    const chunk = video.buffer.subarray(requestedStart, end + 1);
    res.status(206);
    res.setHeader("Content-Range", "bytes " + requestedStart + "-" + end + "/" + total);
    res.setHeader("Content-Length", String(chunk.length));
    res.end(chunk);
    return;
  }

  res.setHeader("Content-Length", String(total));
  res.end(video.buffer);
};
