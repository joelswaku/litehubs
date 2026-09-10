import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../../middleware/auth.middleware";
import { requirePlatformPermission } from "../../middleware/platform.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./contact.controller";
import {
  contactRequestParams,
  createContactRequestBody,
  listContactRequestsQuery,
  updateContactRequestBody,
} from "./contact.validation";

export const contactRoutes = Router();

const publicContactLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_CONTACT_REQUESTS",
      message: "Too many contact requests. Please try again later.",
    },
  },
});

contactRoutes.post(
  "/contact",
  publicContactLimiter,
  validate({ body: createContactRequestBody }),
  controller.create,
);

contactRoutes.get(
  "/platform/contact-requests",
  authenticate,
  requirePlatformPermission("platform.contact_requests.read"),
  validate({ query: listContactRequestsQuery }),
  controller.list,
);

contactRoutes.patch(
  "/platform/contact-requests/:id",
  authenticate,
  requirePlatformPermission("platform.contact_requests.update"),
  validate({ params: contactRequestParams, body: updateContactRequestBody }),
  controller.update,
);
