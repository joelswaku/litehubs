import type { RequestHandler } from "express";
import * as service from "./contact.service";
import type {
  CreateContactRequestInput,
  ListContactRequestsInput,
  UpdateContactRequestInput,
} from "./contact.validation";

export const create: RequestHandler = async (req, res) => {
  await service.createContactRequest(req.body as CreateContactRequestInput, {
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  });
  // Do not echo a record identifier to a public caller. It keeps the request
  // private and avoids making IDs useful to a guessing attempt.
  res.status(201).json({ message: "Contact request received" });
};

export const list: RequestHandler = async (req, res) => {
  res.json(
    await service.listContactRequests(
      req.query as unknown as ListContactRequestsInput,
    ),
  );
};

export const update: RequestHandler = async (req, res) => {
  res.json({
    request: await service.updateContactRequest(
      String(req.params.id),
      req.user!.id,
      req.body as UpdateContactRequestInput,
    ),
  });
};
