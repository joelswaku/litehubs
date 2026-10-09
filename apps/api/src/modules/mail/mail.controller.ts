import type { Request, RequestHandler } from "express";
import * as service from "./mail.service";
import { createAiDraft } from "./mail-ai.service";
import type { AiDraftInput, MailboxInput, MessageFlagsInput, MessageMoveInput, SendInput } from "./mail.validation";
import { folderQuery, messageListQuery } from "./mail.validation";

function context(req: Request): service.MailContext {
  return {
    organizationId: req.organization!.id,
    organizationSlug: req.organization!.slug,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const noStore = (res: Parameters<RequestHandler>[1]) => res.setHeader("Cache-Control", "no-store, max-age=0");

export const mailboxes: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await service.listMailboxes(context(req)));
};
export const createMailbox: RequestHandler = async (req, res) =>
  res.status(201).json({ mailbox: await service.saveMailbox(context(req), req.body as MailboxInput) });
export const updateMailbox: RequestHandler = async (req, res) =>
  res.json({ mailbox: await service.saveMailbox(context(req), req.body as MailboxInput, param(req, "mailboxId")) });
export const deleteMailbox: RequestHandler = async (req, res) =>
  res.json(await service.deleteMailbox(context(req), param(req, "mailboxId")));
export const folders: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await service.listFolders(context(req), param(req, "mailboxId")));
};
export const messages: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await service.listMessages(context(req), param(req, "mailboxId"), messageListQuery.parse(req.query)));
};
export const message: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(
    await service.getMessage(
      context(req),
      param(req, "mailboxId"),
      Number(param(req, "uid")),
      folderQuery.parse(req.query).folder,
    ),
  );
};
export const attachment: RequestHandler = async (req, res) => {
  const file = await service.getAttachment(
    context(req),
    param(req, "mailboxId"),
    Number(param(req, "uid")),
    folderQuery.parse(req.query).folder,
    Number(param(req, "index")),
  );
  const safeName = file.fileName.replace(/[\\/:*?"<>|\r\n]/g, "_");
  const asciiName = safeName.normalize("NFD").replace(/[^\x20-\x7e]/g, "") || "piece-jointe";
  const inline =
    (req.query as { view?: string }).view === "inline" &&
    (file.mimeType === "application/pdf" || /^image\/(png|jpe?g|gif|webp)$/.test(file.mimeType));
  noStore(res);
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
  );
  res.send(file.buffer);
};
export const flags: RequestHandler = async (req, res) =>
  res.json(await service.updateFlags(context(req), param(req, "mailboxId"), Number(param(req, "uid")), req.body as MessageFlagsInput));
export const move: RequestHandler = async (req, res) =>
  res.json(await service.moveMessage(context(req), param(req, "mailboxId"), Number(param(req, "uid")), req.body as MessageMoveInput));
export const send: RequestHandler = async (req, res) =>
  res.status(201).json(
    await service.sendMessage(
      context(req),
      param(req, "mailboxId"),
      req.body as SendInput,
      (req.files as Express.Multer.File[] | undefined) ?? [],
    ),
  );
export const aiDraft: RequestHandler = async (req, res) =>
  res.json(await createAiDraft(context(req), param(req, "mailboxId"), req.body as AiDraftInput));
