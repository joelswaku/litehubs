import pino from "pino";
import pinoHttp from "pino-http";
import { env } from "./env";

// Anything matching these paths is stripped before a log line is written.
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.password",
  "*.passwordHash",
  "*.password_hash",
  "*.currentPassword",
  "*.newPassword",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
];

export const logger = pino({
  level: env.logLevel,
  base: { service: "litehubs-api" },
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  // Structured JSON in production; human-readable while developing.
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname,service",
          },
        },
      }),
});

export const httpLogger = pinoHttp({
  logger,
  // Health checks are polled constantly and would drown out real traffic.
  autoLogging: {
    ignore: (req) => req.url === "/health" || req.url === "/api/v1/health",
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
});

export type Logger = typeof logger;
