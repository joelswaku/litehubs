import { env } from "./env";

/**
 * One image policy shared by Owner Management, Poultry, Pigs and Agriculture.
 */
export const storage = {
  cloudinary: env.cloudinary,
  maxUploadBytes: env.maxUploadBytes,
  allowedMimeTypes: new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
  ]),
  documentMimeTypes: new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/webm",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
  ]),
} as const;

export function isAllowedUploadMimeType(mimeType: string): boolean {
  return storage.allowedMimeTypes.has(mimeType.toLowerCase());
}

/** Company files may include contracts, reports and office documents. */
export function isAllowedDocumentMimeType(mimeType: string): boolean {
  return storage.documentMimeTypes.has(mimeType.toLowerCase());
}
