import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./notifications.controller";
import {
  listNotificationsQuery,
  notificationParams,
  organizationParams,
  updateNotificationPreferencesBody,
} from "./notifications.validation";

export const notificationRoutes = Router();
const inside = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

// Every endpoint is recipient-scoped by the service; no browser supplied user
// id is ever accepted for inbox actions.
notificationRoutes.get(
  "/organizations/:orgSlug/notifications",
  ...inside,
  validate({ query: listNotificationsQuery }),
  controller.list,
);
notificationRoutes.get(
  "/organizations/:orgSlug/notifications/unread-count",
  ...inside,
  controller.unreadCount,
);
notificationRoutes.patch(
  "/organizations/:orgSlug/notifications/read-all",
  ...inside,
  controller.readAll,
);
notificationRoutes.patch(
  "/organizations/:orgSlug/notifications/archive-read",
  ...inside,
  controller.archiveRead,
);
notificationRoutes.get(
  "/organizations/:orgSlug/notification-preferences",
  ...inside,
  controller.preferences,
);
notificationRoutes.patch(
  "/organizations/:orgSlug/notification-preferences",
  ...inside,
  validate({ body: updateNotificationPreferencesBody }),
  controller.updatePreferences,
);
notificationRoutes.patch(
  "/organizations/:orgSlug/notifications/:notificationId/read",
  authenticate,
  validate({ params: notificationParams }),
  requireOrganization,
  controller.markRead,
);
notificationRoutes.patch(
  "/organizations/:orgSlug/notifications/:notificationId/unread",
  authenticate,
  validate({ params: notificationParams }),
  requireOrganization,
  controller.markUnread,
);
notificationRoutes.patch(
  "/organizations/:orgSlug/notifications/:notificationId/archive",
  authenticate,
  validate({ params: notificationParams }),
  requireOrganization,
  controller.archive,
);
notificationRoutes.delete(
  "/organizations/:orgSlug/notifications/:notificationId",
  authenticate,
  validate({ params: notificationParams }),
  requireOrganization,
  controller.remove,
);
