import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Enter a valid identifier");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time in HH:MM format");

export const notificationCategories = [
  "general", "alert", "escalation", "approval", "task", "project",
  "leave", "payroll", "training", "invitation", "maintenance",
  "inventory", "procurement", "finance", "document", "contract",
  "attendance", "schedule", "discipline", "incident", "security",
  "poultry", "pigs", "agriculture", "veterinary", "report",
] as const;
export const notificationPriorities = ["low", "normal", "high", "urgent"] as const;

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const notificationParams = organizationParams.extend({ notificationId: id });

export const listNotificationsQuery = z.object({
  tab: z.enum(["all", "unread", "important", "archived"]).default("all"),
  category: z.enum(notificationCategories).optional(),
  priority: z.enum(notificationPriorities).optional(),
  provinceId: id.optional(),
  siteId: id.optional(),
  search: z.string().trim().min(1).max(160).optional(),
  from: date.optional(),
  to: date.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
}).superRefine((value, context) => {
  if (value.from && value.to && value.to < value.from)
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "End date must not be before start date",
    });
});

const categoryPreference = z.object({
  category: z.enum(notificationCategories),
  inApp: z.boolean(),
  email: z.boolean(),
  minEmailSeverity: z.enum(["info", "warning", "critical"]),
});

export const updateNotificationPreferencesBody = z
  .object({
    inAppEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    digestFrequency: z.enum(["none", "daily", "weekly"]).optional(),
    quietHoursStart: time.nullable().optional(),
    quietHoursEnd: time.nullable().optional(),
    preferredLanguage: z.enum(["fr", "en"]).optional(),
    categories: z.array(categoryPreference).max(notificationCategories.length).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one preference to update",
  });

export type ListNotificationsInput = z.infer<typeof listNotificationsQuery>;
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesBody
>;
