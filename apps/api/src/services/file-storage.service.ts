import { Blob } from "node:buffer";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  storage,
  isAllowedDocumentMimeType,
  isAllowedUploadMimeType,
} from "../config/storage";
import { BadRequestError, ServiceUnavailableError } from "../utils/errors";

export interface ImageToStore {
  organizationId: string;
  module: string;
  resource: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface StoredImage {
  provider: "cloudinary";
  storageKey: string;
  publicId: string;
  url: string;
  bytes: number;
  mimeType: string;
  width: number | null;
  height: number | null;
}

interface CloudinaryResponse {
  public_id?: unknown;
  secure_url?: unknown;
  bytes?: unknown;
  width?: unknown;
  height?: unknown;
  error?: { message?: unknown };
}

function cloudinarySettings() {
  if (!storage.cloudinary.enabled) {
    throw new ServiceUnavailableError(
      "Image uploads are not configured. Add the Cloudinary settings to .env and restart the API.",
      {
        required: [
          "CLOUDINARY_CLOUD_NAME",
          "CLOUDINARY_API_KEY",
          "CLOUDINARY_API_SECRET",
        ],
      },
    );
  }
  return {
    cloudName: storage.cloudinary.cloudName!,
    apiKey: storage.cloudinary.apiKey!,
    apiSecret: storage.cloudinary.apiSecret!,
    folder: storage.cloudinary.folder,
  };
}

function safeSegment(value: string, maximum = 80): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, maximum);
  return normalized || "image";
}

function signature(
  values: Record<string, string | number | undefined>,
  secret: string,
): string {
  const toSign = Object.entries(values)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1")
    .update(toSign + secret)
    .digest("hex");
}

function valueText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new ServiceUnavailableError(`Cloudinary did not return ${label}`);
  }
  return value;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasExpectedImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg")
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  if (mimeType === "image/png")
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/gif")
    return (
      buffer
        .subarray(0, 6)
        .toString("ascii")
        .match(/^GIF8[79]a$/) !== null
    );
  if (mimeType === "image/webp")
    return (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    return (
      buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
      ["heic", "heix", "hevc", "hevx", "mif1"].includes(brand)
    );
  }
  return false;
}

async function cloudinaryBody(response: Response): Promise<CloudinaryResponse> {
  try {
    return (await response.json()) as CloudinaryResponse;
  } catch {
    return {};
  }
}

/** The API signs the upload, so Cloudinary credentials never reach a browser. */
export async function storeImage(image: ImageToStore): Promise<StoredImage> {
  const settings = cloudinarySettings();
  if (
    !isAllowedUploadMimeType(image.mimeType) ||
    !hasExpectedImageSignature(image.buffer, image.mimeType)
  ) {
    throw new BadRequestError(
      "Upload a real JPEG, PNG, WebP, GIF, HEIC, or HEIF image",
    );
  }
  if (image.buffer.length === 0)
    throw new BadRequestError("The uploaded image is empty");
  if (image.buffer.length > storage.maxUploadBytes) {
    throw new BadRequestError(
      "The uploaded image is larger than the allowed limit",
      {
        maxUploadBytes: storage.maxUploadBytes,
      },
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const extension = path
    .extname(image.originalName)
    .replace(/[^a-zA-Z0-9.]/g, "");
  const basename = safeSegment(path.basename(image.originalName, extension));
  const folder = [
    settings.folder,
    safeSegment(image.organizationId, 50),
    safeSegment(image.module, 40),
    safeSegment(image.resource, 40),
  ].join("/");
  const publicId = `${basename}-${randomUUID()}`;
  const form = new FormData();
  const uploadBytes = Uint8Array.from(image.buffer);
  form.set(
    "file",
    new Blob([uploadBytes], { type: image.mimeType }),
    path.basename(image.originalName),
  );
  form.set("api_key", settings.apiKey);
  form.set("timestamp", String(timestamp));
  form.set("folder", folder);
  form.set("public_id", publicId);
  form.set(
    "signature",
    signature(
      {
        folder,
        public_id: publicId,
        timestamp,
        use_filename: "false",
        unique_filename: "false",
      },
      settings.apiSecret,
    ),
  );
  form.set("use_filename", "false");
  form.set("unique_filename", "false");

  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(settings.cloudName)}/image/upload`,
      { method: "POST", body: form },
    );
  } catch {
    throw new ServiceUnavailableError(
      "Cloudinary could not be reached. Try the upload again.",
    );
  }
  const payload = await cloudinaryBody(response);
  if (!response.ok) {
    throw new ServiceUnavailableError("Cloudinary rejected the image", {
      provider: "cloudinary",
      reason:
        typeof payload.error?.message === "string"
          ? payload.error.message
          : undefined,
    });
  }
  const returnedPublicId = valueText(payload.public_id, "an image identifier");
  return {
    provider: "cloudinary",
    storageKey: returnedPublicId,
    publicId: returnedPublicId,
    url: valueText(payload.secure_url, "a secure image URL"),
    bytes: numberOrNull(payload.bytes) ?? image.buffer.length,
    mimeType: image.mimeType,
    width: numberOrNull(payload.width),
    height: numberOrNull(payload.height),
  };
}

export async function deleteStoredImage(input: {
  provider: string | null;
  publicId: string | null;
}): Promise<void> {
  if (input.provider !== "cloudinary" || !input.publicId) return;
  const settings = cloudinarySettings();
  const timestamp = Math.floor(Date.now() / 1000);
  const form = new FormData();
  form.set("public_id", input.publicId);
  form.set("timestamp", String(timestamp));
  form.set("api_key", settings.apiKey);
  form.set(
    "signature",
    signature({ public_id: input.publicId, timestamp }, settings.apiSecret),
  );
  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(settings.cloudName)}/image/destroy`,
      { method: "POST", body: form },
    );
  } catch {
    throw new ServiceUnavailableError(
      "Cloudinary could not be reached. The image was not deleted.",
    );
  }
  if (!response.ok) {
    throw new ServiceUnavailableError(
      "Cloudinary could not delete the image. The image link was kept.",
    );
  }
}

export interface PrivateDocumentToStore {
  organizationId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface StoredPrivateDocument {
  storagePath: string;
  bytes: number;
  mimeType: string;
  checksumSha256: string;
}

const privateDocumentRoot = path.resolve(
  process.cwd(),
  "storage",
  "company-documents",
);

function privateDocumentFile(storagePath: string): string {
  const normal = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(privateDocumentRoot, normal);
  if (!resolved.startsWith(privateDocumentRoot + path.sep))
    throw new BadRequestError("Invalid document storage path");
  return resolved;
}

/** Stores company documents privately on the LiteHubs server. They are never
 * served as public URLs: preview/download always checks tenant permissions. */
export async function storePrivateDocument(
  document: PrivateDocumentToStore,
): Promise<StoredPrivateDocument> {
  if (!isAllowedDocumentMimeType(document.mimeType))
    throw new BadRequestError(
      "Upload a PDF, Word, Excel, CSV, text file, supported image, MP4, or WebM video",
    );
  if (!document.buffer.length)
    throw new BadRequestError("The uploaded document is empty");
  if (document.buffer.length > storage.maxUploadBytes)
    throw new BadRequestError(
      "The uploaded document is larger than the allowed limit",
      {
        maxUploadBytes: storage.maxUploadBytes,
      },
    );

  const extension = path
    .extname(document.originalName)
    .replace(/[^a-zA-Z0-9.]/g, "")
    .slice(0, 12);
  const storagePath = [
    "organizations",
    document.organizationId,
    "documents",
    `${randomUUID()}${extension}`,
  ].join("/");
  const file = privateDocumentFile(storagePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, document.buffer, { flag: "wx" });
  return {
    storagePath,
    bytes: document.buffer.length,
    mimeType: document.mimeType,
    checksumSha256: createHash("sha256").update(document.buffer).digest("hex"),
  };
}

export async function readPrivateDocument(
  storagePath: string,
): Promise<Buffer> {
  try {
    return await readFile(privateDocumentFile(storagePath));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new BadRequestError(
        "The stored document file is no longer available",
      );
    throw error;
  }
}

export async function deletePrivateDocument(
  storagePath: string,
): Promise<void> {
  try {
    await unlink(privateDocumentFile(storagePath));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
