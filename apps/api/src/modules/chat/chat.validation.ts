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
      }),
    )
    .max(1000),
});

export type MessagesQuery = z.infer<typeof messagesQuery>;
export type MessageInput = z.infer<typeof messageInput>;
export type ChatAccessInput = z.infer<typeof chatAccessInput>;
export const directionLabelInput = z.object({ label: z.string().trim().min(1).max(60) });
