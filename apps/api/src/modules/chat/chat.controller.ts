import type { Request, RequestHandler } from "express";
import * as service from "./chat.service";
import * as website from "./website-chat.service";
import { messagesQuery, publicMessagesQuery, type ChatAccessInput, type MessageInput } from "./chat.validation";

function context(req: Request): service.ChatContext {
  return {
    organizationId: req.organization!.id,
    organizationSlug: req.organization!.slug,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}
const param = (req: Request, key: string) => {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};
const noStore = (res: Parameters<RequestHandler>[1]) => res.setHeader("Cache-Control", "no-store, max-age=0");

export const overview: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await service.overview(context(req)));
};
export const unread: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await service.unreadTotal(context(req)));
};
export const openDirection: RequestHandler = async (req, res) =>
  res.json(await service.openDirection(context(req), (req.body as { memberId?: string }).memberId));
export const messages: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await service.listMessages(context(req), param(req, "conversationId"), messagesQuery.parse(req.query)));
};
export const send: RequestHandler = async (req, res) =>
  res.status(201).json(
    await service.sendMessage(context(req), param(req, "conversationId"), req.body as MessageInput, req.file ?? undefined),
  );
export const remove: RequestHandler = async (req, res) =>
  res.json(await service.deleteMessage(context(req), param(req, "messageId")));
export const pin: RequestHandler = async (req, res) =>
  res.json(await service.pinMessage(context(req), param(req, "messageId"), Boolean((req.body as { pinned: boolean }).pinned)));
export const file: RequestHandler = async (req, res) => {
  const data = await service.messageFile(context(req), param(req, "messageId"));
  const safeName = data.fileName.replace(/[\\/:*?"<>|\r\n]/g, "_");
  const asciiName = safeName.normalize("NFD").replace(/[^\x20-\x7e]/g, "") || "fichier";
  const inline =
    (req.query as { view?: string }).view === "inline" &&
    (data.mimeType === "application/pdf" || /^image\/(png|jpe?g|gif|webp)$/.test(data.mimeType));
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Type", data.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
  );
  res.send(data.buffer);
};
export const access: RequestHandler = async (req, res) => res.json(await service.getAccess(context(req)));
export const saveAccess: RequestHandler = async (req, res) =>
  res.json(await service.saveAccess(context(req), req.body as ChatAccessInput));
export const saveLabel: RequestHandler = async (req, res) =>
  res.json(await service.saveDirectionLabel(context(req), String((req.body as { label: string }).label)));

/* Website chat — team side */
export const visitorSessions: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await website.teamSessions(context(req)));
};
export const visitorSession: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await website.teamSession(context(req), param(req, "sessionId")));
};
export const visitorReply: RequestHandler = async (req, res) =>
  res.status(201).json(await website.teamReply(context(req), param(req, "sessionId"), String((req.body as { body: string }).body)));
export const visitorUpdate: RequestHandler = async (req, res) =>
  res.json(await website.teamUpdate(context(req), param(req, "sessionId"), req.body as { mode?: "ai" | "human"; status?: "open" | "closed" }));

/* Website chat — public visitor side */
export const publicInfo: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(await website.publicInfo(param(req, "site")));
};
export const publicStart: RequestHandler = async (req, res) =>
  res.status(201).json(await website.publicStart(param(req, "site"), req.body as Parameters<typeof website.publicStart>[1]));
export const publicMessages: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await website.publicMessages(param(req, "site"), param(req, "token"), publicMessagesQuery.parse(req.query).after));
};
export const publicSend: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await website.publicSend(param(req, "site"), param(req, "token"), String((req.body as { body: string }).body)));
};
export const publicHuman: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await website.publicRequestHuman(param(req, "site"), param(req, "token"), req.body as Parameters<typeof website.publicRequestHuman>[2]));
};
