/**
 * AI help for the social pages:
 *  - a content plan: several Facebook / Instagram posts written by the AI and
 *    saved as drafts with a date.  Nothing is published until a manager
 *    approves them; approved posts are then published at their date by the
 *    existing scheduler.
 *  - ad copy: text for a sponsored ad that the manager launches himself in
 *    Meta Ads Manager with his own budget.  Nothing is stored or spent here.
 */
import type { PoolClient } from "pg";
import { z } from "zod";
import { env } from "../../config/env";
import { BadRequestError, ForbiddenError, ServiceUnavailableError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { readAiInstructions } from "../ai-instructions/ai-instructions.service";
import type { ChatContext } from "../chat/chat.service";
import { createPoster } from "./social-poster.service";
import { type BankPhoto, describePhotos, readPhotos, readSpecialDays, specialDaysBetween } from "./social-photos.service";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function assertManager(context: ChatContext) {
  if (!(context.isOwner || context.permissions.includes("social.manage")))
    throw new ForbiddenError("Réservé au propriétaire et aux responsables des réseaux sociaux.");
}

function extractOutput(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as Record<string, unknown>;
  if (typeof data.output_text === "string") return data.output_text.trim();
  if (!Array.isArray(data.output)) return "";
  return data.output
    .flatMap((item) => {
      const content = (item as { content?: unknown })?.content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) => (typeof (part as { text?: unknown })?.text === "string" ? [(part as { text: string }).text] : []));
    })
    .join("")
    .trim();
}

async function askJson(prompt: string, name: string, schema: object, maxTokens: number): Promise<unknown> {
  if (!env.ai.enabled || !env.ai.apiKey) throw new ServiceUnavailableError("L’assistant IA n’est pas activé sur ce serveur");
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.ai.model,
        input: prompt,
        text: { format: { type: "json_schema", name, strict: true, schema } },
        max_output_tokens: maxTokens,
        store: false,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new ServiceUnavailableError("L’assistant IA ne répond pas. Réessayez dans un instant.");
  }
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = (payload as { error?: { message?: string } })?.error?.message ?? "Le service IA a refusé la demande";
    throw new ServiceUnavailableError(message);
  }
  try {
    return JSON.parse(extractOutput(payload));
  } catch {
    throw new BadRequestError("L’assistant IA n’a pas renvoyé de réponse utilisable. Réessayez.");
  }
}

type Knowledge = {
  company: string;
  instructions: string;
  offers: { title: string; description: string; price: string }[];
  images: { title: string; url: string }[];
  recent: string[];
  account: { id: string; igUserId: string | null } | null;
};

/** What the AI may rely on: company rules, shop offers, photos, recent posts. */
async function knowledge(client: PoolClient, organizationId: string): Promise<Knowledge> {
  const org = await client.query<{ name: string }>(`SELECT display_name AS name FROM organizations WHERE id=$1`, [organizationId]);
  const instructions = await readAiInstructions(client, organizationId);
  const offers = await client
    .query<Row>(
      `SELECT COALESCE(NULLIF(btrim(web_title),''),title) AS title, COALESCE(web_description,'') AS description,
              default_unit_price::text AS price, currency, web_unit_label, web_image_url
         FROM sales_operational_offers
        WHERE organization_id=$1 AND web_visible
        ORDER BY web_sort_order, title LIMIT 25`,
      [organizationId],
    )
    .catch(() => ({ rows: [] as Row[] }));
  const media = await client
    .query<Row>(
      `SELECT title, public_url FROM organization_website_media WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 25`,
      [organizationId],
    )
    .catch(() => ({ rows: [] as Row[] }));
  const recent = await client.query<{ message: string }>(
    `SELECT message FROM social_posts WHERE organization_id=$1 AND btrim(message)<>'' ORDER BY created_at DESC LIMIT 8`,
    [organizationId],
  );
  const account = await client.query<{ id: string; ig_user_id: string | null }>(
    `SELECT id, ig_user_id FROM social_accounts WHERE organization_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,
    [organizationId],
  );
  const images = [
    ...offers.rows.filter((row) => row.web_image_url).map((row) => ({ title: `Produit : ${row.title}`, url: String(row.web_image_url) })),
    ...media.rows.map((row) => ({ title: String(row.title), url: String(row.public_url) })),
  ].filter((image) => image.url.startsWith("https://"));
  return {
    company: org.rows[0]?.name ?? "",
    instructions: [instructions.shared, instructions.website].filter(Boolean).join("\n\n").slice(0, 8000),
    offers: offers.rows.map((row) => ({
      title: String(row.title),
      description: String(row.description ?? "").slice(0, 300),
      price: row.price ? `${Number(row.price).toLocaleString("fr-FR")} ${row.currency ?? ""}${row.web_unit_label ? ` / ${row.web_unit_label}` : ""}`.trim() : "",
    })),
    images: images.slice(0, 30),
    recent: recent.rows.map((row) => row.message.slice(0, 200)),
    account: account.rows[0] ? { id: account.rows[0].id, igUserId: account.rows[0].ig_user_id } : null,
  };
}

function knowledgeText(data: Knowledge) {
  return [
    data.instructions ? `Consignes de la direction (à respecter) :\n${data.instructions}` : "",
    data.offers.length
      ? `Produits et services en vente (seuls prix autorisés) :\n${data.offers.map((offer) => `- ${offer.title}${offer.price ? ` — ${offer.price}` : ""}${offer.description ? ` : ${offer.description}` : ""}`).join("\n")}`
      : "Aucun prix n’est fourni : n’annonce aucun prix.",
    data.recent.length ? `Publications récentes (ne pas répéter) :\n${data.recent.map((text) => `- ${text}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Content plan                                                        */
/* ------------------------------------------------------------------ */

export const planInput = z.object({
  brief: z.string().trim().min(5).max(2000),
  count: z.number().int().min(1).max(14),
  startDate: z.string().date(),
  everyDays: z.number().int().min(1).max(14),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  timeZoneOffsetMinutes: z.number().int().min(-840).max(840).default(-60),
  tone: z.enum(["professional", "friendly", "promotional", "educational"]).default("friendly"),
  toFacebook: z.boolean(),
  toInstagram: z.boolean(),
  // AI posters: none, only for special days / events, or also ~1 post in 3.
  posters: z.enum(["none", "special", "some"]).default("special"),
  useSpecialDays: z.boolean().default(true),
});
export type PlanInput = z.infer<typeof planInput>;

const TONES: Record<PlanInput["tone"], string> = {
  professional: "professionnel et rassurant",
  friendly: "chaleureux et proche de la communauté",
  promotional: "commercial et dynamique, avec un appel à l’action clair",
  educational: "pédagogique : conseils utiles et faits concrets",
};

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["posts"],
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["message", "imageIndex", "posterHeadline"],
        properties: {
          message: { type: "string" },
          imageIndex: { type: ["integer", "null"] },
          posterHeadline: { type: "string" },
        },
      },
    },
  },
};
const planOutput = z.object({
  posts: z.array(z.object({ message: z.string(), imageIndex: z.number().int().nullable(), posterHeadline: z.string().default("") })),
});

/** A wall-clock day + time in the browser's zone → UTC. */
function atLocal(year: number, month: number, day: number, time: string, offsetMinutes: number) {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) + offsetMinutes * 60_000);
}

/** Dates of the plan: start date, then every N days, at the chosen local time. */
function planDates(input: PlanInput) {
  const [year, month, day] = input.startDate.split("-").map(Number) as [number, number, number];
  return Array.from({ length: input.count }, (_, index) => atLocal(year, month, day + index * input.everyDays, input.time, input.timeZoneOffsetMinutes));
}

type Slot = {
  at: Date;
  special: string | null; // name of the special day / event
  fixedPhoto: BankPhoto | null; // a finished poster or the event photo
  eventPhotos: BankPhoto[]; // event photos for an AI poster
};

export async function createContentPlan(context: ChatContext, input: PlanInput) {
  assertManager(context);
  if (!input.toFacebook && !input.toInstagram) throw new BadRequestError("Choisissez Facebook, Instagram ou les deux.");
  const dates = planDates(input);
  if (dates[0]!.getTime() < Date.now() - 5 * 60_000) throw new BadRequestError("La première date est déjà passée : choisissez une date à venir.");
  const { data, bank, days } = await withTenantContext(context, async (client) => ({
    data: await knowledge(client, context.organizationId),
    bank: await readPhotos(client, context.organizationId),
    days: await readSpecialDays(client, context.organizationId),
  }));
  if (!data.account) throw new BadRequestError("Connectez d’abord la Page Facebook de l’entreprise.");
  if (input.toInstagram && !data.account.igUserId) throw new BadRequestError("Aucun compte Instagram professionnel n’est relié à la Page.");

  /* Slots: the regular dates, plus special days and events inside the plan. */
  const from = new Date(input.startDate + "T00:00:00Z");
  const to = new Date(dates[dates.length - 1]!.getTime() + 86_400_000);
  const slots: Slot[] = dates.map((at) => ({ at, special: null, fixedPhoto: null, eventPhotos: [] }));
  const specials = new Map<string, string[]>();
  if (input.useSpecialDays) for (const day of specialDaysBetween(days, from, to)) specials.set(day.date, [...(specials.get(day.date) ?? []), day.name]);
  const dated = bank.filter((photo) => photo.kind !== "normal" && photo.eventDate && photo.eventDate >= from.toISOString().slice(0, 10) && photo.eventDate <= to.toISOString().slice(0, 10));
  for (const photo of dated) specials.set(photo.eventDate!, [...new Set([...(specials.get(photo.eventDate!) ?? []), photo.eventName || "Événement"])]);
  for (const [date, names] of [...specials.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    const at = atLocal(year, month, day, input.time, input.timeZoneOffsetMinutes);
    if (at.getTime() < Date.now()) continue;
    const onDay = dated.filter((photo) => photo.eventDate === date && !photo.reserved);
    const poster = onDay.find((photo) => photo.kind === "poster") ?? null;
    const eventPhotos = onDay.filter((photo) => photo.kind === "event");
    // The special post replaces a regular post planned the same day.
    const same = slots.findIndex((slot) => !slot.special && slot.at.toISOString().slice(0, 10) === date);
    const slot: Slot = { at, special: names.join(" / "), fixedPhoto: poster ?? eventPhotos[0] ?? null, eventPhotos };
    if (same >= 0) slots[same] = slot;
    else slots.push(slot);
  }
  slots.sort((a, b) => a.at.getTime() - b.at.getTime());

  /* Photos for the regular posts: never published first, then the oldest used. */
  const candidates = bank
    .filter((photo) => photo.kind === "normal" && !photo.reserved)
    .sort((a, b) => a.publishedCount - b.publishedCount || (a.lastPublishedAt ?? "").localeCompare(b.lastPublishedAt ?? "") || a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.min(24, slots.length * 2 + 2));
  const toDescribe = [...candidates, ...dated].filter((photo) => !photo.description);
  if (toDescribe.length) {
    await withTenantContext(context, (client) => describePhotos(client, context.organizationId, toDescribe));
    const fresh = await withTenantContext(context, (client) => readPhotos(client, context.organizationId));
    const byId = new Map(fresh.map((photo) => [photo.id, photo]));
    candidates.forEach((photo, index) => (candidates[index] = byId.get(photo.id) ?? photo));
    slots.forEach((slot) => {
      if (slot.fixedPhoto) slot.fixedPhoto = byId.get(slot.fixedPhoto.id) ?? slot.fixedPhoto;
    });
  }
  // Without a photo bank, the shop and website images are used as before.
  const pool: { title: string; url: string; photo: BankPhoto | null }[] = candidates.length
    ? candidates.map((photo) => ({ title: photo.description || photo.originalName || "Photo", url: photo.url, photo }))
    : data.images.map((image) => ({ title: image.title, url: image.url, photo: null }));

  const describe = (photo: BankPhoto) => photo.description || photo.originalName || (photo.kind === "poster" ? "Affiche" : "Photo");
  const slotLines = slots.map((slot, index) => {
    const when = slot.at.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (!slot.special) return `${index + 1}. ${when} — publication normale : choisis une photo dans la liste.`;
    const visual = slot.fixedPhoto
      ? slot.fixedPhoto.kind === "poster"
        ? `affiche déjà prête (« ${describe(slot.fixedPhoto)} ») : écris le texte qui l’accompagne, imageIndex = null.`
        : `photo de l’événement (« ${describe(slot.fixedPhoto)} »), imageIndex = null.`
      : "pas de photo dédiée : choisis la photo la plus adaptée dans la liste, ou null.";
    return `${index + 1}. ${when} — JOUR SPÉCIAL « ${slot.special} » : publication dédiée à ce jour (vœux, célébration ou annonce selon le cas) ; ${visual}`;
  });

  const prompt = [
    `Tu es le responsable des réseaux sociaux de ${data.company || "l’entreprise"} (République démocratique du Congo).`,
    `Rédige exactement ${slots.length} publications ${input.toInstagram ? (input.toFacebook ? "Facebook et Instagram" : "Instagram") : "Facebook"}, une par ligne du calendrier ci-dessous, dans le même ordre.`,
    `Ton : ${TONES[input.tone]}. Écris en français, sauf si la demande précise une autre langue.`,
    "Chaque publication : une accroche forte en première ligne, 2 à 5 phrases courtes, un appel à l’action (écrire en message privé, commander, visiter le site…), puis 3 à 6 hashtags pertinents à la fin. Emojis avec modération (0 à 3).",
    "Le texte doit correspondre à ce que montre la photo choisie. Règles strictes : n’invente aucun prix, chiffre, date, promotion, garantie ou témoignage qui n’est pas dans les données ci-dessous ou dans la demande. Pas de fausse urgence. Varie les sujets et les formulations.",
    "posterHeadline : un titre d’affiche très court (2 à 6 mots, français, sans hashtag), par exemple « Bonne fête de l’Indépendance » ou « Poulets de chair disponibles ».",
    `Calendrier :\n${slotLines.join("\n")}`,
    pool.length
      ? `Photos disponibles (choisis par son numéro la photo qui illustre le mieux chaque publication ; chaque photo une seule fois ; utilise d’abord les premières de la liste, jamais publiées) :\n${pool.map((image, index) => `${index}. ${image.title}`).join("\n")}`
      : "Aucune photo n’est disponible : imageIndex = null.",
    knowledgeText(data),
    `Demande du responsable (thème de la campagne) :\n<<<\n${input.brief}\n>>>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const parsed = planOutput.safeParse(await askJson(prompt, "content_plan", planSchema, 6_000));
  if (!parsed.success || !parsed.data.posts.length) throw new BadRequestError("L’assistant IA n’a pas proposé de publications. Réessayez.");
  const posts = parsed.data.posts.slice(0, slots.length);

  /* Photo of each post; never the same photo twice, unused photos first. */
  const used = new Set<number>();
  const nextFree = () => pool.findIndex((_, index) => !used.has(index));
  const posterJobs: string[] = [];
  await withTenantContext(context, async (client) => {
    for (const [index, post] of posts.entries()) {
      const slot = slots[index]!;
      let image: { url: string; photo: BankPhoto | null } | null = slot.fixedPhoto ? { url: slot.fixedPhoto.url, photo: slot.fixedPhoto } : null;
      if (!image) {
        let pick = post.imageIndex !== null && post.imageIndex >= 0 && post.imageIndex < pool.length && !used.has(post.imageIndex) ? post.imageIndex : -1;
        // A regular post always gets a bank photo while some are left.
        if (pick < 0 && candidates.length && (!slot.special || post.imageIndex !== null)) pick = nextFree();
        if (pick >= 0) {
          used.add(pick);
          image = { url: pool[pick]!.url, photo: pool[pick]!.photo };
        }
      }
      const wantsPoster =
        Boolean(image) &&
        image!.photo?.kind !== "poster" &&
        (input.posters === "some" ? Boolean(slot.special) || index % 3 === 2 : input.posters === "special" ? Boolean(slot.special) : false);
      const posterPhotos = slot.eventPhotos.length ? slot.eventPhotos.slice(0, 3).map((photo) => photo.url) : image ? [image.url] : [];
      // Instagram needs a photo: without one, the draft goes to Facebook only.
      const toInstagram = input.toInstagram && Boolean(image);
      const toFacebook = input.toFacebook || !toInstagram;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO social_posts(organization_id,social_account_id,to_facebook,to_instagram,message,image_url,status,scheduled_at,created_by_member_id,ai_generated,photo_id,poster_status,poster_spec)
         VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,true,$9,$10,$11) RETURNING id`,
        [
          context.organizationId,
          data.account!.id,
          toFacebook,
          toInstagram,
          post.message.trim().slice(0, 5000),
          image?.url ?? null,
          slot.at.toISOString(),
          context.memberId,
          image?.photo?.id ?? null,
          wantsPoster ? "pending" : null,
          wantsPoster
            ? JSON.stringify({
                imageUrls: posterPhotos,
                headline: (post.posterHeadline || slot.special || "").slice(0, 80) || undefined,
                style: slot.special ? "premium" : "nature",
                format: "portrait",
              })
            : null,
        ],
      );
      if (wantsPoster) posterJobs.push(inserted.rows[0]!.id);
    }
  });
  if (posterJobs.length) void runPosterJobs(context, posterJobs);
  return { created: posts.length, specials: slots.filter((slot) => slot.special).length, posters: posterJobs.length };
}

/** AI posters are made one by one after the plan; each replaces the post photo when ready. */
async function runPosterJobs(context: ChatContext, postIds: string[]) {
  for (const postId of postIds) {
    const job = await withTenantContext(context, async (client) =>
      (await client.query<Row>(`SELECT poster_spec FROM social_posts WHERE organization_id=$1 AND id=$2 AND poster_status='pending'`, [context.organizationId, postId])).rows[0],
    ).catch(() => null);
    if (!job?.poster_spec) continue;
    const spec = job.poster_spec as { imageUrls: string[]; headline?: string; style: "nature" | "premium" | "collage" | "bold"; format: "portrait" | "square" };
    try {
      const made = await createPoster(context, { imageUrls: spec.imageUrls, headline: spec.headline, style: spec.style, format: spec.format });
      await withTenantContext(context, (client) =>
        client.query(
          `UPDATE social_posts SET image_url=$3,poster_status='done' WHERE organization_id=$1 AND id=$2 AND poster_status='pending' AND status IN ('draft','scheduled','failed')`,
          [context.organizationId, postId, made.url],
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Échec de l’affiche";
      await withTenantContext(context, (client) =>
        client.query(
          `UPDATE social_posts SET poster_status='failed',poster_spec=COALESCE(poster_spec,'{}'::jsonb) || jsonb_build_object('error',$3::text) WHERE organization_id=$1 AND id=$2 AND poster_status='pending'`,
          [context.organizationId, postId, message.slice(0, 300)],
        ),
      ).catch(() => undefined);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ad copy                                                             */
/* ------------------------------------------------------------------ */

export const adInput = z.object({
  brief: z.string().trim().min(5).max(2000),
  objective: z.enum(["messages", "sales", "awareness", "traffic", "leads"]).default("messages"),
  audienceHint: z.string().trim().max(500).optional().default(""),
});
export type AdInput = z.infer<typeof adInput>;

const OBJECTIVES: Record<AdInput["objective"], string> = {
  messages: "recevoir des messages Messenger / WhatsApp de clients intéressés",
  sales: "vendre (commandes)",
  awareness: "faire connaître la marque",
  traffic: "amener des visiteurs sur le site web",
  leads: "collecter des contacts de prospects",
};

const adSchema = {
  type: "object",
  additionalProperties: false,
  required: ["variants", "audience", "callToAction", "tips"],
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["headline", "primaryText", "description"],
        properties: { headline: { type: "string" }, primaryText: { type: "string" }, description: { type: "string" } },
      },
    },
    audience: {
      type: "object",
      additionalProperties: false,
      required: ["locations", "ageRange", "interests", "notes"],
      properties: {
        locations: { type: "string" },
        ageRange: { type: "string" },
        interests: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
    },
    callToAction: { type: "string" },
    tips: { type: "array", items: { type: "string" } },
  },
};
const adOutput = z.object({
  variants: z.array(z.object({ headline: z.string(), primaryText: z.string(), description: z.string() })),
  audience: z.object({ locations: z.string(), ageRange: z.string(), interests: z.array(z.string()), notes: z.string() }),
  callToAction: z.string(),
  tips: z.array(z.string()),
});

export async function createAdCopy(context: ChatContext, input: AdInput) {
  assertManager(context);
  const data = await withTenantContext(context, (client) => knowledge(client, context.organizationId));
  const prompt = [
    `Tu es expert en publicité Facebook / Instagram (Meta Ads) pour ${data.company || "l’entreprise"} en République démocratique du Congo.`,
    `Objectif de la campagne : ${OBJECTIVES[input.objective]}.`,
    "Propose 3 variantes d’annonce en français, chacune avec : un titre (40 caractères max), un texte principal (125 caractères conseillés pour la première ligne, 3 à 5 phrases au total, appel à l’action clair) et une description courte (30 caractères max).",
    "Propose aussi un public cible (lieux, tranche d’âge, centres d’intérêt Meta, remarques), le bouton d’appel à l’action Meta le plus adapté (ex. « Envoyer un message », « Acheter », « En savoir plus ») et 3 à 5 conseils pratiques (photo, budget de test, durée, suivi).",
    "Règles strictes : respecte les règles publicitaires de Meta ; n’invente aucun prix, chiffre, promotion, garantie ou témoignage absent des données ou de la demande ; pas de promesse exagérée.",
    knowledgeText(data),
    input.audienceHint ? `Public souhaité selon le responsable : ${input.audienceHint}` : "",
    `Demande du responsable :\n<<<\n${input.brief}\n>>>`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const parsed = adOutput.safeParse(await askJson(prompt, "ad_copy", adSchema, 2_500));
  if (!parsed.success || !parsed.data.variants.length) throw new BadRequestError("L’assistant IA n’a pas proposé d’annonce. Réessayez.");
  return parsed.data;
}
