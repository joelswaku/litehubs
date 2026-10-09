import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a valid server name");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
    .optional();

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const mailboxParams = organizationParams.extend({ mailboxId: id });
export const messageParams = mailboxParams.extend({
  uid: z.coerce.number().int().positive(),
});
export const attachmentParams = messageParams.extend({
  index: z.coerce.number().int().min(0).max(200),
});

export const mailboxInput = z.object({
  emailAddress: z.string().trim().toLowerCase().email("Enter a valid e-mail address").max(255),
  displayName: optionalText(120),
  username: optionalText(255),
  password: z.string().min(1).max(500).optional(),
  imapHost: host.default("imap.hostinger.com"),
  imapPort: z.coerce.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  smtpHost: host.default("smtp.hostinger.com"),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(465),
  smtpSecure: z.boolean().default(true),
  signature: optionalText(2000),
  status: z.enum(["active", "disabled"]).optional(),
  memberIds: z.array(id).max(200).default([]),
});

export const folderQuery = z.object({
  folder: z.string().trim().min(1).max(300).default("INBOX"),
});
export const messageListQuery = folderQuery.extend({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  search: optionalText(200),
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const messageFlagsInput = z.object({
  folder: z.string().trim().min(1).max(300).default("INBOX"),
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
});
export const messageMoveInput = z.object({
  folder: z.string().trim().min(1).max(300).default("INBOX"),
  target: z.enum(["trash", "archive", "inbox", "junk"]),
});

const addressList = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(/[,;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .refine(
    (list) => list.every((item) => /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(item.replace(/^.*<(.+)>$/, "$1"))),
    "One of the addresses is not valid",
  );

/** multipart/form-data: attachments are sent as files. */
export const sendInput = z.object({
  to: addressList.refine((list) => list.length > 0, "Add at least one recipient"),
  cc: addressList,
  bcc: addressList,
  subject: z.string().trim().max(500).default(""),
  body: z.string().max(200_000).default(""),
  replyToUid: z.coerce.number().int().positive().optional(),
  replyFolder: z.string().trim().max(300).optional(),
  forwardAttachments: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const aiDraftInput = z.object({
  mode: z.enum(["reply", "forward", "new", "improve"]).default("reply"),
  uid: z.coerce.number().int().positive().optional(),
  folder: z.string().trim().max(300).optional(),
  instructions: optionalText(1500),
  currentDraft: optionalText(8000),
  tone: z.enum(["professional", "friendly", "formal", "short"]).default("professional"),
  language: z.enum(["auto", "fr", "en"]).default("auto"),
});

export type AiDraftInput = z.infer<typeof aiDraftInput>;
export type MailboxInput = z.infer<typeof mailboxInput>;
export type MessageListQuery = z.infer<typeof messageListQuery>;
export type MessageFlagsInput = z.infer<typeof messageFlagsInput>;
export type MessageMoveInput = z.infer<typeof messageMoveInput>;
export type SendInput = z.infer<typeof sendInput>;
