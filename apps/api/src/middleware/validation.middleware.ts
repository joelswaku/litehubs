import type { RequestHandler } from "express";
import type { ZodType } from "zod";

interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Parses the named request parts with Zod, replacing them with the parsed
 * (coerced, stripped) values. A ZodError is handed to the error middleware,
 * which renders it as 422 with a per-field list.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) {
        // Express 5 leaves req.body undefined when no parser matched — usually
        // a missing Content-Type. Coerce to {} so the response names the
        // missing fields instead of reporting a bare root-level type error.
        req.body = schemas.body.parse(req.body ?? {});
      }
      if (schemas.query) {
        // req.query is a getter in Express 5, so mutate rather than assign.
        Object.assign(req.query, schemas.query.parse(req.query));
      }
      if (schemas.params) {
        Object.assign(req.params, schemas.params.parse(req.params));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
