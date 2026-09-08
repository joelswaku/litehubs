import compression from "compression";
import cookieParser from "cookie-parser";
import cors, { type CorsOptions } from "cors";
import type { RequestHandler } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { env } from "./env";

const allowedOrigins = new Set([env.frontendUrl]);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // No Origin header means a same-origin or non-browser client (curl, jobs).
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  // The organization headers are how a client names the active workspace when
  // it is not already in the path. Without them listed, the browser's preflight
  // strips the header and every tenant request looks unscoped.
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Organization-Slug",
    "X-Organization-Id",
  ],
  maxAge: 86_400,
};

/** Broad limiter for the whole API surface. */
export const apiRateLimiter = rateLimit({
  windowMs: 150 * 60 * 1000,
  limit: env.isProduction ? 300 : 10_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: { code: "TOO_MANY_REQUESTS", message: "Too many requests" },
  },
});

/** Tight limiter for credential endpoints — mounted by the auth module. */
export const authRateLimiter = rateLimit({
  windowMs: 150 * 60 * 1000,
  limit: env.isProduction ? 10 : 1_000,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_ATTEMPTS",
      message: "Too many attempts, try again later h",
    },
  },
});

/** Ordered middleware applied before any route. */
export function securityMiddleware(): RequestHandler[] {
  return [
    helmet({
      // The API serves JSON only; the dashboard sets its own CSP.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
    cors(corsOptions),
    compression(),
    cookieParser(),
    apiRateLimiter,
  ];
}
