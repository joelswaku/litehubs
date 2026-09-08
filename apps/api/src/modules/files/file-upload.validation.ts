import { z } from "zod";
import { agricultureResources } from "../agriculture/agriculture.validation";
import { organizationSlugSchema } from "../organization/organization.validation";
import {
  ownerManagementResources,
  type OwnerManagementResource,
} from "../owner-management/owner-management.validation";
import { pigResources } from "../pigs/pig.validation";
import { poultryResources } from "../poultry/poultry.validation";

const id = z.string().uuid("Enter a valid identifier");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const attachmentModules = [
  "owner-management",
  "poultry",
  "pigs",
  "agriculture",
] as const;
export type AttachmentModule = (typeof attachmentModules)[number];
export type AttachmentResource =
  | OwnerManagementResource
  | (typeof poultryResources)[number]
  | (typeof pigResources)[number]
  | (typeof agricultureResources)[number];

const resourcesByModule: Record<AttachmentModule, readonly string[]> = {
  "owner-management": ownerManagementResources.filter(
    (resource) =>
      ![
        "documents",
        "incidents",
        "security-visitors",
        "security-asset-movements",
        "security-keys",
        "security-key-handovers",
      ].includes(resource),
  ),
  poultry: poultryResources,
  pigs: pigResources,
  agriculture: agricultureResources,
};

export function isAttachmentTarget(module: string, resource: string): boolean {
  return (
    attachmentModules.includes(module as AttachmentModule) &&
    resourcesByModule[module as AttachmentModule].includes(resource)
  );
}
export const attachmentTargetParams = z
  .object({
    orgSlug: organizationSlugSchema,
    module: z.enum(attachmentModules),
    resource: z.string().trim().min(1).max(80),
    recordId: id,
  })
  .superRefine((value, context) => {
    if (!resourcesByModule[value.module].includes(value.resource)) {
      context.addIssue({
        code: "custom",
        path: ["resource"],
        message: "That record type does not support image attachments",
      });
    }
  });

export const attachmentImageParams = z.object({
  orgSlug: organizationSlugSchema,
  imageId: id,
});
export const attachmentStoredFileParams = z.object({
  orgSlug: organizationSlugSchema,
  fileId: id,
});
export const attachmentUploadBody = z.object({
  title: text(200).optional(),
  categoryId: id.optional(),
  imageType: text(80).optional(),
  altText: text(500).optional(),
});

export type AttachmentTarget = z.infer<typeof attachmentTargetParams>;
export type AttachmentUploadInput = z.infer<typeof attachmentUploadBody>;
