import cron from "node-cron";
import { logger } from "../../config/logger";
import {
  deliverPendingEmailsForOrganization,
  runScheduledNotificationRemindersForOrganization,
  scheduledOrganizationIds,
} from "./notifications.service";

let scheduled = false;

async function forEachOrganization(
  label: string,
  work: (organizationId: string) => Promise<unknown>,
) {
  try {
    const organizationIds = await scheduledOrganizationIds();
    for (const organizationId of organizationIds) {
      try {
        await work(organizationId);
      } catch (error) {
        logger.error({ err: error, organizationId, label }, "Notification scheduled work failed");
      }
    }
  } catch (error) {
    logger.error({ err: error, label }, "Notification scheduler could not enumerate organizations");
  }
}

/** Safe to call more than once in hot reload: only one pair of jobs is added. */
export function startNotificationScheduler(): void {
  if (scheduled) return;
  scheduled = true;
  // Email delivery is intentionally separate from request handlers. A slow SMTP
  // relay must never slow down a training assignment, task save or approval.
  cron.schedule("*/5 * * * *", () => {
    void forEachOrganization("email_delivery", deliverPendingEmailsForOrganization);
  });
  // Daily reminders are deduplicated per recipient and date by the service.
  cron.schedule("10 6 * * *", () => {
    void forEachOrganization("daily_reminders", runScheduledNotificationRemindersForOrganization);
  });
  logger.info("Notification scheduler started");
}
