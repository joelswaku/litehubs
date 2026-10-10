import cron from "node-cron";
import { logger } from "../../config/logger";
import {
  deliverPendingEmailsForOrganization,
  runScheduledNotificationRemindersForOrganization,
  scheduledOrganizationIds,
} from "./notifications.service";
import {
  runNutritionMonitoringForOrganization,
  sendNutritionExecutiveSummaryForOrganization,
} from "../owner-management/feed-nutrition.service";
import { closeExpiredJobsForOrganization } from "../careers/careers.service";
import { sendPendingTrackingLinksForOrganization } from "../careers/candidate-portal.service";
import { checkMailboxesForOrganization } from "../mail/mail.service";
import { publishDuePostsForOrganization } from "../social/social.service";

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

/** Safe to call more than once in hot reload: only one group of jobs is added. */
export function startNotificationScheduler(): void {
  if (scheduled) return;
  scheduled = true;
  cron.schedule("*/5 * * * *", () => {
    void forEachOrganization("email_delivery", deliverPendingEmailsForOrganization);
  });
  cron.schedule(
    "10 6 * * *",
    () => {
      void forEachOrganization(
        "daily_reminders",
        runScheduledNotificationRemindersForOrganization,
      );
    },
    { timezone: "Africa/Kinshasa" },
  );
  // A vacancy remains available through its displayed deadline, then is closed
  // before the next working day in both the public portal and the HR register.
  cron.schedule(
    "5 0 * * *",
    () => {
      void forEachOrganization(
        "career_expiry",
        closeExpiredJobsForOrganization,
      );
    },
    { timezone: "Africa/Kinshasa" },
  );
  // Applicants received before the Espace candidat existed get their personal
  // link automatically, in small batches to respect e-mail and SMS limits.
  cron.schedule("*/10 * * * *", () => {
    void forEachOrganization("career_tracking_links", sendPendingTrackingLinksForOrganization);
  });
  // Company mailboxes: unread counters and a notification for new e-mail.
  cron.schedule("*/3 * * * *", () => {
    void forEachOrganization("mailbox_check", checkMailboxesForOrganization);
  });
  // Scheduled Facebook / Instagram posts.
  cron.schedule("* * * * *", () => {
    void forEachOrganization("social_posts", publishDuePostsForOrganization);
  });
  // Farm health, ration and feed-autonomy checks run before the day starts.
  cron.schedule("0 6 * * *", () => {
    void forEachOrganization("nutrition_monitoring", runNutritionMonitoringForOrganization);
  }, { timezone: "Africa/Kinshasa" });
  // Delivery, production and feed information stays in one actionable owner summary.
  cron.schedule("30 18 * * *", () => {
    void forEachOrganization("nutrition_executive_summary", sendNutritionExecutiveSummaryForOrganization);
  }, { timezone: "Africa/Kinshasa" });
  logger.info("Notification scheduler started");
}
