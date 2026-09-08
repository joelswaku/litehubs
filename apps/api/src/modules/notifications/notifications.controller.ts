import type { Request, RequestHandler } from "express";
import * as service from "./notifications.service";
import type {
  ListNotificationsInput,
  UpdateNotificationPreferencesInput,
} from "./notifications.validation";

function context(req: Request): service.NotificationContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
  };
}
function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export const list: RequestHandler = async (req, res) =>
  res.json(
    await service.listNotifications(
      context(req),
      req.query as unknown as ListNotificationsInput,
    ),
  );
export const unreadCount: RequestHandler = async (req, res) =>
  res.json(await service.unreadCount(context(req)));
export const markRead: RequestHandler = async (req, res) =>
  res.json({ notification: await service.markNotificationRead(context(req), param(req, "notificationId")) });
export const markUnread: RequestHandler = async (req, res) =>
  res.json({ notification: await service.markNotificationUnread(context(req), param(req, "notificationId")) });
export const archive: RequestHandler = async (req, res) =>
  res.json({ notification: await service.archiveNotification(context(req), param(req, "notificationId")) });
export const readAll: RequestHandler = async (req, res) =>
  res.json(await service.markAllRead(context(req)));
export const archiveRead: RequestHandler = async (req, res) =>
  res.json(await service.archiveReadNotifications(context(req)));
export const remove: RequestHandler = async (req, res) => {
  await service.deleteNotification(context(req), param(req, "notificationId"));
  res.status(204).send();
};
export const preferences: RequestHandler = async (req, res) =>
  res.json(await service.getNotificationPreferences(context(req)));
export const updatePreferences: RequestHandler = async (req, res) =>
  res.json(await service.updateNotificationPreferences(context(req), req.body as UpdateNotificationPreferencesInput));
