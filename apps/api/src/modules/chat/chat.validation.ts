import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const conversationParams = organizationParams.extend({ conversationId: id });
export const messageParams = organizationParams.extend({ messageId: id });

export const messagesQuery = z.object({
  after: z.string().datetime({ offset: true }).optional(),
  before: z.string().datetime({ offset: true }).optional(),
});
/** multipart/form-data: an optional file comes as "file". */
export const messageInput = z.object({
  body: z.string().max(5000).optional(),
  announcement: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
export const directionInput = z.object({ memberId: id.optional() });
export const pinInput = z.object({ pinned: z.boolean() });
export const chatAccessInput = z.object({
  settings: z
    .object({
      allowImages: z.boolean(),
      allowDocuments: z.boolean(),
      teamReadOnly: z.boolean(),
      directionLabel: z.string().trim().max(60).optional(),
      websiteChatEnabled: z.boolean().optional(),
      websiteAiEnabled: z.boolean().optional(),
      websiteWelcome: z.string().trim().max(500).nullable().optional(),
      websiteKnowledge: z.string().trim().max(6000).nullable().optional(),
    })
    .optional(),
  members: z
    .array(
      z.object({
        memberId: id,
        canModerate: z.boolean(),
        canReadDirection: z.boolean(),
        muted: z.boolean().default(false),
        blocked: z.boolean().default(false),
        noFiles: z.boolean().default(false),
        canWebsite: z.boolean().default(false),
      }),
    )
    .max(1000),
});

export type MessagesQuery = z.infer<typeof messagesQuery>;
export type MessageInput = z.infer<typeof messageInput>;
export type ChatAccessInput = z.infer<typeof chatAccessInput>;
export const directionLabelInput = z.object({ label: z.string().trim().min(1).max(60) });

/* Website chat */
export const visitorSessionParams = organizationParams.extend({ sessionId: id });
export const visitorReplyInput = z.object({ body: z.string().trim().min(1).max(2000) });
export const visitorUpdateInput = z
  .object({ mode: z.enum(["ai", "human"]).optional(), status: z.enum(["open", "closed"]).optional() })
  .refine((value) => value.mode || value.status, "Nothing to change");
const siteSlug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/, "Invalid site");
const token = z.string().regex(/^[A-Za-z0-9_-]{30,60}$/, "Invalid conversation");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);
export const publicSiteParams = z.object({ site: siteSlug });
export const publicSessionParams = publicSiteParams.extend({ token });
export const publicStartInput = z.object({
  name: optionalText(120),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  phone: optionalText(40),
  pageUrl: optionalText(500),
});
export const publicSendInput = z.object({ body: z.string().trim().min(1).max(2000) });
export const publicMessagesQuery = z.object({ after: z.string().datetime({ offset: true }).optional() });
export const publicHumanInput = z.object({
  name: optionalText(120),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  phone: optionalText(40),
});
