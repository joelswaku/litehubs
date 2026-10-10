import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import { organizationSlugSchema } from "../organization/organization.validation";
import type { ChatContext } from "../chat/chat.service";
import { getAiInstructions, saveAiInstructions } from "./ai-instructions.service";

const params = z.object({ orgSlug: organizationSlugSchema });
const body = z.object({
  shared: z.string().max(8000).optional(),
  mail: z.string().max(8000).optional(),
  website: z.string().max(6000).optional(),
});

function context(req: Request): ChatContext {
  return {
    organizationId: req.organization!.id,
    organizationSlug: req.organization!.slug,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}
const read: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(await getAiInstructions(context(req)));
};
const save: RequestHandler = async (req, res) =>
  res.json(await saveAiInstructions(context(req), req.body as z.infer<typeof body>));

export const aiInstructionsRoutes = Router();
const path = "/organizations/:orgSlug/ai-instructions";
aiInstructionsRoutes.get(path, authenticate, validate({ params }), requireOrganization, read);
aiInstructionsRoutes.put(path, authenticate, validate({ params, body }), requireOrganization, save);
