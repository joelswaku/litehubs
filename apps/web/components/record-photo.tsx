"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageIcon, Loader2 } from "lucide-react";
import { ApiError, api, get, orgApiUrl, orgUrl } from "@/lib/api";

/**
 * One main photo per owner-management record (stock item, project material…),
 * stored through the shared private images API. Uploading replaces the
 * previous main photo, so a record never shows two competing pictures.
 */

export const RECORD_PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";

type ImageRow = Record<string, unknown>;

export type PhotoResource = "inventory-items" | "materials" | "assets";

const photoType: Record<PhotoResource, string> = {
  assets: "equipment_photo",
  "inventory-items": "inventory_item_photo",
  materials: "project_material_photo",
};

const str = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

function isMainPhoto(image: ImageRow, resource: PhotoResource) {
  return (
    str(image.documentType) === photoType[resource] ||
    str(image.title).endsWith(" · photo")
  );
}

export function recordPhotoKey(
  orgSlug: string,
  resource: PhotoResource,
  recordId: string,
) {
  return ["record-photo", orgSlug, resource, recordId] as const;
}

/** The main photo of a record, or null. Missing permission reads as "no photo". */
export function useRecordPhoto(
  orgSlug: string,
  resource: PhotoResource,
  recordId: string | null | undefined,
) {
  return useQuery({
    queryKey: recordPhotoKey(orgSlug, resource, recordId ?? ""),
    enabled: Boolean(recordId),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      try {
        const data = await get<{ images: ImageRow[] }>(
          orgUrl(orgSlug, `images/owner-management/${resource}/${recordId}`),
        );
        const photo = data.images.find((image) =>
          isMainPhoto(image, resource),
        );
        return photo
          ? {
              id: str(photo.id),
              url: orgApiUrl(orgSlug, `files/${str(photo.id)}/preview`),
              alt: str(photo.altText),
            }
          : null;
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 403 || error.status === 404)
        )
          return null;
        throw error;
      }
    },
  });
}

/** Uploads a new main photo and removes the older one(s). */
export async function replaceRecordPhoto(
  orgSlug: string,
  resource: PhotoResource,
  recordId: string,
  file: File,
  name: string,
) {
  const path = orgUrl(orgSlug, `images/owner-management/${resource}/${recordId}`);
  const current = await get<{ images: ImageRow[] }>(path);
  const form = new FormData();
  form.set("file", file);
  form.set("title", `${name || "Photo"} · photo`);
  form.set("altText", name || "Photo");
  form.set("imageType", photoType[resource]);
  await api.post(path, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  await Promise.all(
    current.images
      .filter((image) => isMainPhoto(image, resource))
      .map((image) => api.delete(orgUrl(orgSlug, `images/${str(image.id)}`))),
  );
}

/**
 * Square thumbnail. With `editable`, clicking it opens the file picker and
 * replaces the photo; otherwise it is a plain picture.
 */
export function RecordPhoto({
  orgSlug,
  resource,
  recordId,
  name,
  fallback,
  editable = false,
  fr,
  className = "size-14",
}: {
  orgSlug: string;
  resource: PhotoResource;
  recordId: string;
  name: string;
  /** Shown when the record has no photo of its own (e.g. the stock item's). */
  fallback?: { resource: PhotoResource; recordId: string } | null;
  editable?: boolean;
  fr: boolean;
  className?: string;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const own = useRecordPhoto(orgSlug, resource, recordId);
  const inherited = useRecordPhoto(
    orgSlug,
    fallback?.resource ?? resource,
    own.data || !fallback ? null : fallback.recordId,
  );
  const photo = own.data ?? inherited.data ?? null;

  async function upload(file: File) {
    setBusy(true);
    setFailed("");
    try {
      await replaceRecordPhoto(orgSlug, resource, recordId, file, name);
      await client.invalidateQueries({
        queryKey: recordPhotoKey(orgSlug, resource, recordId),
      });
    } catch (error) {
      setFailed(
        error instanceof ApiError
          ? error.message
          : fr
            ? "La photo n’a pas pu être envoyée."
            : "The photo could not be uploaded.",
      );
    } finally {
      setBusy(false);
    }
  }

  const picture = photo ? (
    // Private preview URL served by the API; next/image cannot proxy it.
    <img
      src={photo.url}
      alt={photo.alt || name}
      className="size-full object-cover"
    />
  ) : (
    <ImageIcon className="size-5 text-brand/70" aria-hidden />
  );

  const frame = `relative grid shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-brand/[0.05] ${className}`;

  if (!editable)
    return (
      <span className={frame} title={photo ? name : undefined}>
        {picture}
      </span>
    );

  return (
    <span
      className={`${className.includes("w-full") ? "flex w-full" : "inline-flex"} flex-col items-center gap-1`}
    >
      <button
        type="button"
        className={`${frame} group cursor-pointer transition hover:border-brand/50`}
        onClick={(event) => {
          event.stopPropagation();
          input.current?.click();
        }}
        aria-label={
          photo
            ? fr
              ? "Changer la photo"
              : "Change photo"
            : fr
              ? "Ajouter une photo"
              : "Add photo"
        }
        title={
          photo
            ? fr
              ? "Changer la photo"
              : "Change photo"
            : fr
              ? "Ajouter une photo"
              : "Add photo"
        }
        disabled={busy}
      >
        {picture}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-ink/55 py-0.5 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <Camera className="size-3" aria-hidden />
          )}
          {photo ? (fr ? "Changer" : "Change") : fr ? "Ajouter" : "Add"}
        </span>
        {busy ? (
          <span className="absolute inset-0 grid place-items-center bg-surface-1/60">
            <Loader2 className="size-5 animate-spin text-brand" aria-hidden />
          </span>
        ) : null}
      </button>
      <input
        ref={input}
        type="file"
        accept={RECORD_PHOTO_ACCEPT}
        className="hidden"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      {failed ? (
        <span className="max-w-32 text-center text-[10px] leading-3 text-critical">
          {failed}
        </span>
      ) : null}
    </span>
  );
}
