/**
 * AI posters for Facebook / Instagram.
 *
 * The manager picks one to four real photos (shop products, website images or
 * a new upload) and a style. The image model composes a branded poster from
 * those photos and the company logo: headline, short tagline, website and
 * colours. The result is saved in the website images (public URL, needed by
 * Meta) and can be attached to a draft post.
 */
import { z } from "zod";
import { env } from "../../config/env";
import { storeImage } from "../../services/file-storage.service";
import { BadRequestError, ForbiddenError, ServiceUnavailableError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type { ChatContext } from "../chat/chat.service";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function assertManager(context: ChatContext) {
  if (!(context.isOwner || context.permissions.includes("social.manage")))
    throw new ForbiddenError("Réservé au propriétaire et aux responsables des réseaux sociaux.");
}

export const posterInput = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(4),
  headline: z.string().trim().max(80).optional(),
  tagline: z.string().trim().max(140).optional(),
  details: z.string().trim().max(300).optional(),
  style: z.enum(["nature", "premium", "collage", "bold"]),
  format: z.enum(["portrait", "square"]),
  postId: z.string().uuid().optional(),
});
export type PosterInput = z.infer<typeof posterInput>;

const STYLES: Record<PosterInput["style"], string> = {
  nature:
    "Fresh natural look: bright daylight, lush green fields, soft leaves framing the edges, deep green and golden accents, clean white or green banner for the text.",
  premium:
    "Premium, elegant look: cinematic warm light, rich deep green with gold accents, refined serif headline in gold, subtle gold lines and leaf ornament, lots of breathing room.",
  collage:
    "Dynamic collage: the photos arranged as tilted vertical panels side by side with thin white separators, white header area with the logo and flag, bold sans-serif headline below.",
  bold:
    "Bold advertising look: strong diagonal green and yellow shapes, big punchy headline with one brush-script highlighted word, high contrast, energetic composition.",
};

/** Photos the poster may use: the shop products and the website images of this company only. */
async function allowedImages(organizationId: string, context: ChatContext) {
  return withTenantContext(context, async (client) => {
    const offers = await client
      .query<Row>(
        `SELECT COALESCE(NULLIF(btrim(web_title),''),title) AS title, web_image_url AS url
           FROM sales_operational_offers WHERE organization_id=$1 AND web_image_url IS NOT NULL ORDER BY web_sort_order, title LIMIT 60`,
        [organizationId],
      )
      .catch(() => ({ rows: [] as Row[] }));
    const media = await client.query<Row>(
      `SELECT title, public_url AS url FROM organization_website_media WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 120`,
      [organizationId],
    );
    const brand = await client.query<Row>(
      `SELECT COALESCE(o.display_name,o.legal_name,o.slug) AS name, settings.logo_url,
              web.custom_domain, web.contact_phone
         FROM organizations o
         LEFT JOIN organization_settings settings ON settings.organization_id=o.id
         LEFT JOIN organization_website_settings web ON web.organization_id=o.id
        WHERE o.id=$1`,
      [organizationId],
    );
    const images = [
      ...offers.rows.map((row) => ({ title: `Produit : ${row.title}`, url: String(row.url) })),
      ...media.rows.map((row) => ({ title: String(row.title), url: String(row.url) })),
    ].filter((image) => image.url.startsWith("https://"));
    const b = brand.rows[0] ?? {};
    return {
      images,
      company: String(b.name ?? ""),
      logoUrl: (b.logo_url as string | null) ?? null,
      website: (b.custom_domain as string | null)?.replace(/^www\./, "") ?? null,
      phone: (b.contact_phone as string | null) ?? null,
    };
  });
}

export async function posterOptions(context: ChatContext) {
  assertManager(context);
  const data = await allowedImages(context.organizationId, context);
  return {
    images: data.images,
    logoUrl: data.logoUrl,
    website: data.website,
    enabled: Boolean(env.ai.enabled && env.ai.apiKey),
  };
}

/** Downloads a company image from Cloudinary, resized so the model receives a light JPEG/PNG. */
async function download(url: string, kind: "photo" | "logo"): Promise<Blob> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestError("Image invalide.");
  }
  if (parsed.protocol !== "https:" || !/(^|\.)res\.cloudinary\.com$/i.test(parsed.hostname))
    throw new BadRequestError("Cette image ne peut pas être utilisée pour une affiche. Ajoutez-la dans les images du site.");
  const transform = kind === "logo" ? "f_png,w_600,c_limit" : "f_jpg,q_85,w_1400,c_limit";
  const source = /\/upload\//.test(parsed.href) && !/\/upload\/(f_|w_|c_|q_)/.test(parsed.href) ? parsed.href.replace("/upload/", `/upload/${transform}/`) : parsed.href;
  const response = await fetch(source, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!response?.ok) throw new BadRequestError("Une image n’a pas pu être téléchargée. Réessayez.");
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 12_000_000) throw new BadRequestError("Une image est trop lourde.");
  const type = response.headers.get("content-type")?.split(";")[0]?.trim() || (kind === "logo" ? "image/png" : "image/jpeg");
  if (!["image/png", "image/jpeg", "image/webp"].includes(type)) throw new BadRequestError("Format d’image non pris en charge.");
  return new Blob([bytes], { type });
}

function posterPrompt(input: PosterInput, brand: { company: string; website: string | null; phone: string | null; hasLogo: boolean }) {
  const lines = [
    `Create a professional, high-end social media marketing poster for "${brand.company}", an agriculture and livestock company in the Democratic Republic of the Congo.`,
    `Format: ${input.format === "portrait" ? "vertical 4:5 / 2:3 poster for Facebook and Instagram feed" : "square 1:1 post"}.`,
    `Use the provided photos as the real main visuals (${input.imageUrls.length} photo${input.imageUrls.length > 1 ? "s" : ""}). Keep the people, animals, machines and products recognisable and realistic: improve light, colour and sharpness, extend or blend backgrounds, but never change faces, never add or remove people, never invent other brands or logos.`,
    brand.hasLogo
      ? "The LAST provided image is the company logo: place it prominently and reproduce it exactly (same shapes, colours and letters), on a clean area so it stays readable."
      : `Write the company name "${brand.company}" as a clean wordmark at the top.`,
    "Add a small, tasteful flag of the DR Congo (sky blue with a yellow-bordered red diagonal stripe and a yellow star at top left) as an accent.",
    `Style: ${STYLES[input.style]}`,
    "All text must be in French, spelled exactly as given below, perfectly legible, with correct accents, and nothing else written:",
    input.headline ? `- Headline: «${input.headline}»` : "- Headline: «Ensemble, cultivons l’avenir»",
    input.tagline ? `- Tagline: «${input.tagline}»` : "- Tagline: «Agriculture • Élevage • Développement»",
    input.details ? `- Small info line: «${input.details}»` : "",
    brand.website ? `- Website in a rounded pill at the bottom: «${brand.website}»` : "",
    brand.phone && !input.details ? `- Optional small contact line: «${brand.phone}»` : "",
    "Typography: modern and professional, strong hierarchy, generous margins, no spelling mistakes, no extra words, no watermarks, no lorem ipsum.",
  ];
  return lines.filter(Boolean).join("\n");
}

async function callImageModel(model: string, prompt: string, images: Blob[], size: string) {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", size);
  form.set("quality", env.ai.imageQuality);
  form.set("n", "1");
  images.forEach((image, index) => form.append("image[]", image, `image-${index}.${image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg"}`));
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ai.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(240_000),
    });
  } catch {
    throw new ServiceUnavailableError("La création de l’affiche a pris trop de temps. Réessayez.");
  }
  const payload = (await response.json().catch(() => null)) as { data?: { b64_json?: string }[]; error?: { message?: string; code?: string } } | null;
  return { ok: response.ok, status: response.status, payload };
}

export async function createPoster(context: ChatContext, input: PosterInput) {
  assertManager(context);
  if (!env.ai.enabled || !env.ai.apiKey) throw new ServiceUnavailableError("L’assistant IA n’est pas activé sur ce serveur");
  const data = await allowedImages(context.organizationId, context);
  const allowed = new Set(data.images.map((image) => image.url));
  // Photos just uploaded from this screen live in this company's own storage folder.
  const ownUpload = (url: string) => /^https:\/\/res\.cloudinary\.com\//i.test(url) && url.includes(`/${context.organizationId}/`);
  for (const url of input.imageUrls)
    if (!allowed.has(url) && !ownUpload(url)) throw new BadRequestError("Choisissez des photos de la boutique ou des images du site.");

  const photos = await Promise.all(input.imageUrls.map((url) => download(url, "photo")));
  const logo = data.logoUrl ? await download(data.logoUrl, "logo").catch(() => null) : null;
  const prompt = posterPrompt(input, { company: data.company, website: data.website, phone: data.phone, hasLogo: Boolean(logo) });
  const size = input.format === "portrait" ? "1024x1536" : "1024x1024";
  const images = logo ? [...photos, logo] : photos;

  let result = await callImageModel(env.ai.imageModel, prompt, images, size);
  // An older account may not have the newest image model yet.
  if (!result.ok && env.ai.imageModel !== "gpt-image-1" && (result.status === 404 || /model/i.test(result.payload?.error?.message ?? "")))
    result = await callImageModel("gpt-image-1", prompt, images, size);
  if (!result.ok) {
    const message = result.payload?.error?.message ?? "Le service d’images a refusé la demande.";
    throw new ServiceUnavailableError(/safety|moderation/i.test(message) ? "L’IA a refusé ces photos. Essayez d’autres photos." : message);
  }
  const b64 = result.payload?.data?.[0]?.b64_json;
  if (!b64) throw new ServiceUnavailableError("L’IA n’a pas renvoyé d’image. Réessayez.");
  const buffer = Buffer.from(b64, "base64");

  const title = `Affiche IA — ${input.headline || "Ensemble, cultivons l’avenir"}`.slice(0, 180);
  const stored = await storeImage({
    organizationId: context.organizationId,
    module: "public-website",
    resource: "media-library",
    originalName: "affiche-ia.png",
    mimeType: "image/png",
    buffer,
  });
  await withTenantContext(context, async (client) => {
    const website = await client.query<{ id: string }>(`SELECT id FROM organization_website_settings WHERE organization_id=$1 LIMIT 1`, [context.organizationId]);
    if (website.rows[0])
      await client.query(
        `INSERT INTO organization_website_media (organization_id,website_id,title,original_name,provider,storage_key,public_id,public_url,mime_type,size_bytes,width,height,created_by_member_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [context.organizationId, website.rows[0].id, title, "affiche-ia.png", stored.provider, stored.storageKey, stored.publicId, stored.url, stored.mimeType, stored.bytes, stored.width, stored.height, context.memberId],
      );
    if (input.postId) {
      const updated = await client.query(
        `UPDATE social_posts SET image_url=$3,error=NULL,poster_status=CASE WHEN poster_status IS NULL THEN NULL ELSE 'done' END WHERE organization_id=$1 AND id=$2 AND status IN ('draft','scheduled','failed')`,
        [context.organizationId, input.postId, stored.url],
      );
      if (!updated.rowCount) throw new BadRequestError("Cette publication est déjà en ligne : l’affiche est gardée dans les images du site.");
    }
  });
  return { url: stored.url, title };
}
