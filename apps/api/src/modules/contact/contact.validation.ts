import { z } from "zod";

const compactOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
    .optional();

export const createContactRequestBody = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(255),
  phone: compactOptional(40),
  companyName: compactOptional(180),
  category: z
    .enum(["general", "access", "technical", "billing", "demo", "other"])
    .default("general"),
  subject: z.string().trim().min(3).max(180),
  message: z.string().trim().min(20).max(4_000),
  preferredLanguage: z.enum(["fr", "en"]).default("fr"),
});

export const listContactRequestsQuery = z.object({
  status: z.enum(["new", "in_progress", "resolved", "closed"]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const contactRequestParams = z.object({
  id: z.string().uuid(),
});

export const updateContactRequestBody = z.object({
  status: z.enum(["new", "in_progress", "resolved", "closed"]),
  adminNote: z.string().trim().max(4_000).nullable().optional(),
});

export type CreateContactRequestInput = z.infer<
  typeof createContactRequestBody
>;
export type ListContactRequestsInput = z.infer<typeof listContactRequestsQuery>;
export type UpdateContactRequestInput = z.infer<
  typeof updateContactRequestBody
>;
