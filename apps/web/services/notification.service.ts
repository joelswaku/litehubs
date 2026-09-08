import { del, get, orgUrl, patch } from "@/lib/api";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";
export type NotificationTab = "all" | "unread" | "important" | "archived";

export interface NotificationItem {
  id: string;
  category: string;
  type: string;
  priority: NotificationPriority;
  title: string;
  message: string | null;
  actionUrl: string | null;
  entity: { type: string | null; id: string } | null;
  metadata: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  province: { id: string; name: string | null } | null;
  actor: { userId: string; fullName: string | null; email: string | null } | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface NotificationList {
  notifications: NotificationItem[];
  pagination: { limit: number; offset: number; total: number };
}

export interface CategoryPreference {
  category: string;
  inApp: boolean;
  email: boolean;
  minEmailSeverity: "info" | "warning" | "critical";
}

export interface NotificationPreferences {
  profile: {
    inAppEnabled: boolean;
    emailEnabled: boolean;
    smsEnabled: boolean;
    pushEnabled: boolean;
    digestFrequency: "none" | "daily" | "weekly";
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    preferredLanguage: "fr" | "en";
  };
  categories: CategoryPreference[];
}

export interface NotificationQuery {
  tab?: NotificationTab;
  category?: string;
  priority?: NotificationPriority;
  provinceId?: string;
  siteId?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

function queryString(query: NotificationQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "")
      params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

export const notificationsApi = {
  list: (orgSlug: string, query: NotificationQuery = {}) =>
    get<NotificationList>(orgUrl(orgSlug, `notifications${queryString(query)}`)),
  unreadCount: (orgSlug: string) =>
    get<{ unreadCount: number }>(orgUrl(orgSlug, "notifications/unread-count")),
  read: (orgSlug: string, notificationId: string) =>
    patch<{ notification: NotificationItem }>(
      orgUrl(orgSlug, `notifications/${notificationId}/read`),
    ),
  unread: (orgSlug: string, notificationId: string) =>
    patch<{ notification: NotificationItem }>(
      orgUrl(orgSlug, `notifications/${notificationId}/unread`),
    ),
  archive: (orgSlug: string, notificationId: string) =>
    patch<{ notification: NotificationItem }>(
      orgUrl(orgSlug, `notifications/${notificationId}/archive`),
    ),
  remove: (orgSlug: string, notificationId: string) =>
    del<void>(orgUrl(orgSlug, `notifications/${notificationId}`)),
  readAll: (orgSlug: string) =>
    patch<{ updated: number }>(orgUrl(orgSlug, "notifications/read-all")),
  archiveRead: (orgSlug: string) =>
    patch<{ updated: number }>(orgUrl(orgSlug, "notifications/archive-read")),
  preferences: (orgSlug: string) =>
    get<NotificationPreferences>(orgUrl(orgSlug, "notification-preferences")),
  updatePreferences: (
    orgSlug: string,
    body: Partial<NotificationPreferences["profile"]> & {
      categories?: CategoryPreference[];
    },
  ) => patch<NotificationPreferences>(orgUrl(orgSlug, "notification-preferences"), body),
};
