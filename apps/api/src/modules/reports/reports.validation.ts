import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const day = z.string().date("Use YYYY-MM-DD");
export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const reportQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  provinceId: id.optional(),
  siteId: id.optional(),
  lang: z.enum(["fr", "en"]).optional(),
}).superRefine((value, context) => {
  if (value.from && value.to && value.to < value.from)
    context.addIssue({ code: "custom", path: ["to"], message: "End date cannot be before start date" });
});
export type ReportQuery = z.infer<typeof reportQuery>;