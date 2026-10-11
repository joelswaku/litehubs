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
        required: ["message", "imageIndex"],
        properties: {
          message: { type: "string" },
          imageIndex: { type: ["integer", "null"] },
        },
      },
    },
  },
};
const planOutput = z.object({ posts: z.array(z.object({ message: z.string(), imageIndex: z.number().int().nullable() })) });

/** Dates of the plan: start date, then every N days, at the chosen local time. */
function planDates(input: PlanInput) {
  const [hours, minutes] = input.time.split(":").map(Number) as [number, number];
  const [year, month, day] = input.startDate.split("-").map(Number) as [number, number, number];
  return Array.from({ length: input.count }, (_, index) => {
    // Local wall-clock time → UTC using the browser's offset (getTimezoneOffset).
    const utc = Date.UTC(year, month - 1, day + index * input.everyDays, hours, minutes) + input.timeZoneOffsetMinutes * 60_000;
    return new Date(utc);
  });
}

export async function createContentPlan(context: ChatContext, input: PlanInput) {
  assertManager(context);
  if (!input.toFacebook && !input.toInstagram) throw new BadRequestError("Choisissez Facebook, Instagram ou les deux.");
  const dates = planDates(input);
  if (dates[0]!.getTime() < Date.now() - 5 * 60_000) throw new BadRequestError("La première date est déjà passée : choisissez une date à venir.");
  const data = await withTenantContext(context, (client) => knowledge(client, context.organizationId));
  if (!data.account) throw new BadRequestError("Connectez d’abord la Page Facebook de l’entreprise.");
  if (input.toInstagram && !data.account.igUserId) throw new BadRequestError("Aucun compte Instagram professionnel n’est relié à la Page.");

  const prompt = [
    `Tu es le responsable des réseaux sociaux de ${data.company || "l’entreprise"} (République démocratique du Congo).`,
    `Rédige ${input.count} publications ${input.toInstagram ? (input.toFacebook ? "Facebook et Instagram" : "Instagram") : "Facebook"} différentes, à publier dans cet ordre, une tous les ${input.everyDays} jour(s).`,
    `Ton : ${TONES[input.tone]}. Écris en français, sauf si la demande précise une autre langue.`,
    "Chaque publication : une accroche forte en première ligne, 2 à 5 phrases courtes, un appel à l’action (écrire en message privé, commander, visiter le site…), puis 3 à 6 hashtags pertinents à la fin. Emojis avec modération (0 à 3).",
    "Règles strictes : n’invente aucun prix, chiffre, date, promotion, garantie ou témoignage qui n’est pas dans les données ci-dessous ou dans la demande. Pas de fausse urgence. Varie les sujets et les formulations.",
    data.images.length
      ? `Photos disponibles (choisis celle qui illustre le mieux chaque publication par son numéro, ou null si aucune ne convient ; évite de réutiliser la même photo) :\n${data.images.map((image, index) => `${index}. ${image.title}`).join("\n")}`
      : "Aucune photo n’est disponible : imageIndex = null.",
    knowledgeText(data),
    `Demande du responsable (thème de la campagne) :\n<<<\n${input.brief}\n>>>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const parsed = planOutput.safeParse(await askJson(prompt, "content_plan", planSchema, 4_000));
  if (!parsed.success || !parsed.data.posts.length) throw new BadRequestError("L’assistant IA n’a pas proposé de publications. Réessayez.");
  const posts = parsed.data.posts.slice(0, input.count);

  await withTenantContext(context, async (client) => {
    for (const [index, post] of posts.entries()) {
      const image = post.imageIndex !== null ? data.images[post.imageIndex] : undefined;
      // Instagram needs a photo: without one, the draft goes to Facebook only.
      const toInstagram = input.toInstagram && Boolean(image);
      const toFacebook = input.toFacebook || !toInstagram;
      await client.query(
        `INSERT INTO social_posts(organization_id,social_account_id,to_facebook,to_instagram,message,image_url,status,scheduled_at,created_by_member_id,ai_generated)
         VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,true)`,
        [context.organizationId, data.account!.id, toFacebook, toInstagram, post.message.trim().slice(0, 5000), image?.url ?? null, dates[index]!.toISOString(), context.memberId],
      );
    }
  });
  return { created: posts.length };
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
