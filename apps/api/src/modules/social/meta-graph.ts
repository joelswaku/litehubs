import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import { decryptSecret, encryptSecret } from "../mail/mail.crypto";

/** Thin client for the Meta Graph API (Facebook Pages, Messenger, Instagram). */
export class MetaError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

function query(params: Params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) search.set(key, String(value));
  return search.toString();
}

export async function graph<T = Record<string, unknown>>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Params,
  body?: unknown,
): Promise<T> {
  const url = `${env.meta.graphUrl}/${path.replace(/^\//, "")}?${query(params)}`;
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number } };
  if (!response.ok || data.error) {
    const error = data.error ?? {};
    throw new MetaError(friendlyMetaMessage(error.message ?? `Meta ${response.status}`, error.code, error.error_subcode), error.code, error.error_subcode);
  }
  return data as T;
}

/** Meta's English errors, in words the team understands. */
export function friendlyMetaMessage(message: string, code?: number, subcode?: number) {
  if (code === 10 && subcode === 2018278) return "Plus de 24 h depuis le dernier message du client : Meta n’autorise plus de réponse. Attendez qu’il réécrive.";
  if (/outside of allowed window/i.test(message))
    return "Plus de 24 h depuis le dernier message du client : Meta n’autorise plus de réponse.";
  if (code === 190) return "La connexion Meta a expiré : reconnectez Facebook dans Réseaux sociaux.";
  if (code === 200 || code === 10 || /permission/i.test(message)) return `Autorisation Meta manquante : ${message}`;
  if (code === 9004 || /image/i.test(message)) return `Image refusée par Meta : ${message}`;
  return message;
}

export const sealToken = (token: string) => encryptSecret(token);
export const openToken = (sealed: string) => decryptSecret(sealed);

/** X-Hub-Signature-256 = sha256 HMAC of the raw body with the app secret. */
export function validSignature(rawBody: Buffer | undefined, header: string | undefined) {
  if (!rawBody || !header || !env.meta.appSecret) return false;
  const expected = `sha256=${createHmac("sha256", env.meta.appSecret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Text message to a Messenger (PSID) or Instagram (IGSID) user, through the Page. */
export async function sendDirectMessage(pageId: string, pageToken: string, recipientId: string, text: string) {
  const chunks = text.match(/[\s\S]{1,1900}/g) ?? [text];
  let lastId = "";
  for (const chunk of chunks) {
    const result = await graph<{ message_id?: string }>(
      "POST",
      `${pageId}/messages`,
      { access_token: pageToken },
      { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: chunk } },
    );
    lastId = result.message_id ?? lastId;
  }
  return lastId;
}
