import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";
import { AppError, NotFoundError, isAppError } from "../utils/errors";

/** PostgreSQL SQLSTATE codes worth translating into client-facing errors. */
const PG_ERROR_MAP: Record<
  string,
  { statusCode: number; code: string; message: string }
> = {
  "23505": {
    statusCode: 409,
    code: "CONFLICT",
    message: "That record already exists",
  },
  "23503": {
    statusCode: 409,
    code: "FOREIGN_KEY_VIOLATION",
    message: "A referenced record is missing or still in use",
  },
  "23502": {
    statusCode: 400,
    code: "NOT_NULL_VIOLATION",
    message: "A required field was not provided",
  },
  "23514": {
    statusCode: 400,
    code: "CHECK_VIOLATION",
    message: "A field failed a database constraint",
  },
  "22P02": {
    statusCode: 400,
    code: "INVALID_INPUT",
    message: "A value has the wrong format",
  },
  "40001": {
    statusCode: 409,
    code: "SERIALIZATION_FAILURE",
    message: "Conflicting concurrent update, please retry",
  },
  "40P01": {
    statusCode: 409,
    code: "DEADLOCK_DETECTED",
    message: "Conflicting concurrent update, please retry",
  },
  "57014": {
    statusCode: 504,
    code: "QUERY_TIMEOUT",
    message: "The query took too long",
  },
  "3D000": {
    statusCode: 503,
    code: "DATABASE_UNAVAILABLE",
    message: "Database is not available",
  },
  ECONNREFUSED: {
    statusCode: 503,
    code: "DATABASE_UNAVAILABLE",
    message: "Database is not available",
  },
};

function hasCode(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

/** Friendlier text for the body-parser failures clients actually hit. */
const BODY_PARSER_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "Request body is not valid JSON",
  "entity.too.large": "Request body is too large",
  "request.aborted": "Request was aborted",
  "request.size.invalid": "Request body size did not match Content-Length",
  "encoding.unsupported": "Unsupported content encoding",
  "charset.unsupported": "Unsupported charset",
};

/**
 * Express and its body parsers throw `http-errors` objects that already carry
 * the right status (400 for unparseable JSON, 413 for an oversized body).
 * Without this they would all be reported as 500.
 */
function asHttpError(
  error: unknown,
): { statusCode: number; code: string; message: string } | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
    type?: unknown;
    message?: unknown;
  };

  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : undefined;

  if (status === undefined || status < 400 || status > 599) return undefined;

  const type = typeof candidate.type === "string" ? candidate.type : undefined;
  const code = type ? type.replace(/\./g, "_").toUpperCase() : `HTTP_${status}`;

  // `expose` is http-errors' own signal that the message is client-safe.
  const exposed =
    candidate.expose === true && typeof candidate.message === "string"
      ? candidate.message
      : undefined;

  const message =
    (type ? BODY_PARSER_MESSAGES[type] : undefined) ??
    exposed ??
    "Request could not be processed";

  return { statusCode: status, code, message };
}

/** Reached only when no route matched. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  // Headers already sent — the response is committed, hand back to Express.
  if (res.headersSent) return next(error);

  let statusCode = 500;
  let code = "INTERNAL_SERVER_ERROR";
  let message = "Internal server error";
  let details: unknown;

  if (error instanceof ZodError) {
    statusCode = 422;
    code = "VALIDATION_ERROR";
    message = "Validation failed";
    details = error.issues.map((issue) => ({
      field: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
  } else if (isAppError(error)) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (hasCode(error) && PG_ERROR_MAP[error.code]) {
    const mapped = PG_ERROR_MAP[error.code] as (typeof PG_ERROR_MAP)[string];
    statusCode = mapped.statusCode;
    code = mapped.code;
    message = mapped.message;
  } else if (
    error instanceof Error &&
    error.message.includes("not allowed by CORS")
  ) {
    statusCode = 403;
    code = "CORS_FORBIDDEN";
    message = error.message;
  } else {
    const httpError = asHttpError(error);
    if (httpError) {
      statusCode = httpError.statusCode;
      code = httpError.code;
      message = httpError.message;
    }
  }

  const log = req.log ?? console;
  if (statusCode >= 500) {
    log.error({ err: error, statusCode, code }, "Request failed");
  } else {
    log.warn({ err: error, statusCode, code }, "Request rejected");
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      // A stack trace in a production response is an information leak. Even in
      // development only 5xx gets one — a 404 stack is noise.
      ...(env.isProduction || statusCode < 500 || !(error instanceof Error)
        ? {}
        : { stack: error.stack }),
    },
  });
};

export { AppError };
