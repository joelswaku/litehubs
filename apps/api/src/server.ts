import type { Server } from "node:http";
import { createApp } from "./app";
import { closeDatabase, verifyDatabaseConnection } from "./config/database";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { startNotificationScheduler } from "./modules/notifications/notifications.scheduler";
import {
  closeMailTransport,
  verifyMailTransport,
} from "./config/notifications";

const SHUTDOWN_TIMEOUT_MS = 10_000;

let server: Server | undefined;
let shuttingDown = false;

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ reason }, "Shutting down");

  // Force exit if a connection refuses to drain.
  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      logger.info("HTTP server closed");
    }
    await closeMailTransport();
    await closeDatabase();
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown");
    exitCode = 1;
  }

  clearTimeout(forceExit);
  process.exit(exitCode);
}

async function start(): Promise<void> {
  try {
    await verifyDatabaseConnection();
  } catch (error) {
    // In production an unreachable database means we cannot serve anything, so
    // fail fast and let the orchestrator restart us. Locally, keep going so the
    // API is still inspectable while Postgres is being set up.
    if (env.isProduction) {
      logger.fatal({ err: error }, "Database unreachable, refusing to start");
      process.exit(1);
    }
    logger.warn(
      { err: error },
      "Database unreachable — starting anyway (development)",
    );
  }

  // Reports a bad relay password now rather than on a user's first reset.
  // Never fatal: the API is fully usable except for outbound email.
  await verifyMailTransport();

  const app = createApp();
  startNotificationScheduler();

  server = app.listen(env.port, () => {
    logger.info(
      {
        url: `http://localhost:${env.port}`,
        health: `http://localhost:${env.port}/api/v1/health`,
        environment: env.nodeEnv,
      },
      "Congo Omega API listening",
    );
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.fatal(`Port ${env.port} is already in use`);
      process.exit(1);
    }
    logger.fatal({ err: error }, "HTTP server error");
    process.exit(1);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});

void start();
