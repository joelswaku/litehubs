/**
 * Photo bank and special days of the social pages.
 *
 * The manager drops photos (normal, for an event, or finished posters); the
 * AI describes each photo once by looking at it, and the content plan uses
 * photos never published first.
 */
import type { PoolClient } from "pg";
import { z } from "zod";
import { env } from "../../config/env";
import { deleteStoredImage, storeImage } from "../../services/file-storage.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type { ChatContext } from "../chat/chat.service";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function assertManager(context: ChatContext) {
  if (!(context.isOwner || context.permissions.includes("social.manage")))
    throw new ForbiddenError("Réservé au propriétaire et aux responsables des réseaux sociaux.");
}

export type PhotoKind = "normal" | "event" | "poster";
export const photoMeta = z
  .object({
    kind: z.enum(["normal", "event", "poster"]).default("normal"),
    eventName: z.string().trim().max(120).nullable().optional(),
    eventDate: z.string().date().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "normal" && !value.eventDate)
      ctx.addIssue({ code: "custom", path: ["eventDate"], message: "Choisissez la date de l’événement." });
  });
export type PhotoMeta = z.infer<typeof photoMeta>;

/** Photo with its use: published (date), reserved by a draft / scheduled post, or never used. */
const PHOTO_SELECT = `
  SELECT ph.*, to_char(ph.event_date,'YYYY-MM-DD') AS event_day,
         (SELECT max(COALESCE(p.published_at,p.scheduled_at)) FROM social_posts p
           WHERE p.organization_id=ph.organization_id AND p.photo_id=ph.id AND p.status IN ('published','partial')) AS last_published_at,
         (SELECT count(*)::int FROM social_posts p
           WHERE p.organization_id=ph.organization_id AND p.photo_id=ph.id AND p.status IN ('published','partial')) AS published_count,
         EXISTS (SELECT 1 FROM social_posts p
           WHERE p.organization_id=ph.organization_id AND p.photo_id=ph.id AND p.status IN ('draft','scheduled','publishing')) AS reserved
    FROM social_photos ph`;

function mapPhoto(row: Row) {
  return {
    id: row.id as string,
    url: row.url as string,
    kind: row.kind as PhotoKind,
    eventName: (row.event_name as string | null) ?? null,
    eventDate: (row.event_day as string | null) ?? null,
    description: (row.ai_description as string | null) ?? null,
    originalName: (row.original_name as string | null) ?? null,
    publishedCount: Number(row.published_count ?? 0),
    lastPublishedAt: (row.last_published_at as string | null) ?? null,
    reserved: Boolean(row.reserved),
    createdAt: row.created_at as string,
  };
}
export type BankPhoto = ReturnType<typeof mapPhoto>;

export async function readPhotos(client: PoolClient, organizationId: string) {
  const result = await client.query<Row>(`${PHOTO_SELECT} WHERE ph.organization_id=$1 ORDER BY ph.created_at DESC LIMIT 500`, [organizationId]);
  return result.rows.map(mapPhoto);
}

export async function listPhotos(context: ChatContext) {
  assertManager(context);
  return withTenantContext(context, async (client) => ({
    photos: await readPhotos(client, context.organizationId),
    specialDays: await readSpecialDays(client, context.organizationId),
  }));
}

export async function uploadPhotos(context: ChatContext, files: Express.Multer.File[], meta: PhotoMeta) {
  assertManager(context);
  if (!files.length) throw new BadRequestError("Choisissez au moins une photo.");
  const stored: { provider: string; publicId: string | null }[] = [];
  try {
    await withTenantContext(context, async (client) => {
      for (const file of files) {
        const image = await storeImage({
          organizationId: context.organizationId,
          module: "social",
          resource: "photo-bank",
          originalName: file.originalname,
          mimeType: file.mimetype,
          buffer: file.buffer,
        });
        stored.push({ provider: image.provider, publicId: image.publicId });
        await client.query(
          `INSERT INTO social_photos(organization_id,url,provider,storage_key,public_id,mime_type,width,height,original_name,kind,event_name,event_date,created_by_member_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            context.organizationId,
            image.url,
            image.provider,
            image.storageKey,
            image.publicId,
            image.mimeType,
            image.width,
            image.height,
            file.originalname.slice(0, 255),
            meta.kind,
            meta.kind === "normal" ? null : meta.eventName?.trim() || null,
            meta.kind === "normal" ? null : meta.eventDate,
            context.memberId,
          ],
        );
      }
    });
  } catch (error) {
    await Promise.all(stored.map((image) => deleteStoredImage(image).catch(() => undefined)));
    throw error;
  }
  return listPhotos(context);
}

export async function updatePhoto(context: ChatContext, photoId: string, meta: PhotoMeta) {
  assertManager(context);
  await withTenantContext(context, async (client) => {
    const updated = await client.query(
      `UPDATE social_photos SET kind=$3,event_name=$4,event_date=$5 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, photoId, meta.kind, meta.kind === "normal" ? null : meta.eventName?.trim() || null, meta.kind === "normal" ? null : meta.eventDate],
    );
    if (!updated.rowCount) throw new NotFoundError("Photo introuvable.");
  });
  return listPhotos(context);
}

export async function deletePhoto(context: ChatContext, photoId: string) {
  assertManager(context);
  const photo = await withTenantContext(context, async (client) => {
    const found = await client.query<Row>(`SELECT * FROM social_photos WHERE organization_id=$1 AND id=$2`, [context.organizationId, photoId]);
    if (!found.rows[0]) throw new NotFoundError("Photo introuvable.");
    const used = await client.query(`SELECT 1 FROM social_posts WHERE organization_id=$1 AND photo_id=$2 LIMIT 1`, [context.organizationId, photoId]);
    await client.query(`DELETE FROM social_photos WHERE organization_id=$1 AND id=$2`, [context.organizationId, photoId]);
    return { row: found.rows[0], used: Boolean(used.rowCount) };
  });
  // A photo already in a post keeps its file: Facebook / the post still point to it.
  if (!photo.used && photo.row.public_id)
    await deleteStoredImage({ provider: String(photo.row.provider), publicId: String(photo.row.public_id) }).catch(() => undefined);
  return listPhotos(context);
}

/* ------------------------------------------------------------------ */
/* AI description (the AI looks at each photo once)                    */
/* ------------------------------------------------------------------ */

const small = (url: string) => (/res\.cloudinary\.com\/.+\/upload\//.test(url) && !/\/upload\/(c_|w_|f_)/.test(url) ? url.replace("/upload/", "/upload/c_limit,w_768,f_jpg,q_70/") : url);

/** Describes up to 10 photos per call; photos without a description get one. */
export async function describePhotos(client: PoolClient, organizationId: string, photos: { id: string; url: string }[]) {
  if (!photos.length || !env.ai.enabled || !env.ai.apiKey) return;
  for (let start = 0; start < photos.length; start += 10) {
    const batch = photos.slice(start, start + 10);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.ai.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.ai.model,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Décris en français, en une phrase concrète (max 30 mots), ce que montre chacune des ${batch.length} photos d’une entreprise agricole et d’élevage en RDC (animaux, cultures, machines, produits, personnes, lieu, ambiance). Si c’est une affiche, résume son texte principal. Réponds dans l’ordre des photos.`,
                },
                ...batch.map((photo) => ({ type: "input_image", image_url: small(photo.url), detail: "low" })),
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "photo_descriptions",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["descriptions"],
                properties: { descriptions: { type: "array", items: { type: "string" } } },
              },
            },
          },
          max_output_tokens: 1_500,
          store: false,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || !payload) continue;
      const text =
        typeof payload.output_text === "string"
          ? payload.output_text
          : (Array.isArray(payload.output) ? payload.output : [])
              .flatMap((item: { content?: { text?: string }[] }) => (Array.isArray(item?.content) ? item.content.map((part) => part?.text ?? "") : []))
              .join("");
      const parsed = JSON.parse(text) as { descriptions?: string[] };
      for (const [index, photo] of batch.entries()) {
        const description = parsed.descriptions?.[index]?.trim();
        if (description)
          await client.query(`UPDATE social_photos SET ai_description=$3 WHERE organization_id=$1 AND id=$2`, [organizationId, photo.id, description.slice(0, 400)]);
      }
    } catch {
      // A description is a bonus: the plan still works with file names.
    }
  }
}

/* ------------------------------------------------------------------ */
/* Special days                                                        */
/* ------------------------------------------------------------------ */

const DEFAULT_DAYS: [string, number, number][] = [
  ["Nouvel An", 1, 1],
  ["Journée internationale des droits des femmes", 3, 8],
  ["Fête du travail", 5, 1],
  ["Fête de l’Indépendance de la RDC", 6, 30],
  ["Journée mondiale de l’alimentation", 10, 16],
  ["Noël", 12, 25],
];

export async function readSpecialDays(client: PoolClient, organizationId: string) {
  const count = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_special_days WHERE organization_id=$1`, [organizationId]);
  if (!count.rows[0]?.n)
    for (const [name, month, day] of DEFAULT_DAYS)
      await client.query(`INSERT INTO social_special_days(organization_id,name,month,day) VALUES($1,$2,$3,$4)`, [organizationId, name, month, day]);
  const result = await client.query<Row>(
    `SELECT * FROM social_special_days WHERE organization_id=$1 AND is_active ORDER BY month, day, name`,
    [organizationId],
  );
  return result.rows.map((row) => ({ id: row.id as string, name: row.name as string, month: Number(row.month), day: Number(row.day), year: row.year === null ? null : Number(row.year) }));
}
export type SpecialDay = Awaited<ReturnType<typeof readSpecialDays>>[number];

export const specialDayInput = z.object({ name: z.string().trim().min(2).max(120), date: z.string().date(), everyYear: z.boolean().default(true) });

export async function addSpecialDay(context: ChatContext, input: z.infer<typeof specialDayInput>) {
  assertManager(context);
  const [year, month, day] = input.date.split("-").map(Number) as [number, number, number];
  await withTenantContext(context, async (client) => {
    await readSpecialDays(client, context.organizationId);
    await client.query(`INSERT INTO social_special_days(organization_id,name,month,day,year) VALUES($1,$2,$3,$4,$5)`, [
      context.organizationId,
      input.name,
      month,
      day,
      input.everyYear ? null : year,
    ]);
  });
  return listPhotos(context);
}

export async function removeSpecialDay(context: ChatContext, dayId: string) {
  assertManager(context);
  await withTenantContext(context, async (client) => {
    await client.query(`UPDATE social_special_days SET is_active=false WHERE organization_id=$1 AND id=$2`, [context.organizationId, dayId]);
  });
  return listPhotos(context);
}

/** Special days falling between two dates (inclusive), with their exact date. */
export function specialDaysBetween(days: SpecialDay[], from: Date, to: Date) {
  const found: { name: string; date: string }[] = [];
  for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year += 1)
    for (const day of days) {
      if (day.year !== null && day.year !== year) continue;
      const date = new Date(Date.UTC(year, day.month - 1, day.day));
      if (date.getUTCMonth() !== day.month - 1) continue;
      const iso = date.toISOString().slice(0, 10);
      if (iso >= from.toISOString().slice(0, 10) && iso <= to.toISOString().slice(0, 10)) found.push({ name: day.name, date: iso });
    }
  return found.sort((a, b) => a.date.localeCompare(b.date));
}
