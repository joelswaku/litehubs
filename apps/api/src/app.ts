import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import { pingDatabase } from "./config/database";
import { env } from "./config/env";
import { httpLogger } from "./config/logger";
import { securityMiddleware } from "./config/security";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { authRoutes } from "./modules/auth";
import { attendanceRoutes } from "./modules/attendance";
import { agricultureRoutes } from "./modules/agriculture";
import { alertRoutes } from "./modules/alerts";
import { companySetupRoutes } from "./modules/company-setup";
import { dailyWorkRoutes } from "./modules/daily-work";
import { disciplineRoutes } from "./modules/discipline";
import { documentsRoutes } from "./modules/documents";
import { contractsRoutes } from "./modules/contracts";
import { auditRoutes } from "./modules/audit";
import { employeeRoutes } from "./modules/employees";
import { fileUploadRoutes } from "./modules/files";
import { organizationRoutes } from "./modules/organization";
import { ownerManagementRoutes } from "./modules/owner-management";
import { leaveRoutes } from "./modules/leave";
import { trainingRoutes } from "./modules/training";
import { platformStaffRoutes } from "./modules/platform-staff";
import { performanceRoutes } from "./modules/performance";
import { payrollRoutes } from "./modules/payroll";
import { poultryRoutes } from "./modules/poultry";
import { pigRoutes } from "./modules/pigs";
import { notificationRoutes } from "./modules/notifications";
import { reportsRoutes } from "./modules/reports/reports.routes";
import { salesRoutes } from "./modules/sales";

export const API_PREFIX = "/api/v1";

export function createApp(): Application {
  const app = express();

  app.disable("x-powered-by");
  // Trust one proxy hop so rate limiting and req.ip see the real client.
  app.set("trust proxy", 1);

  app.use(httpLogger);
  app.use(securityMiddleware());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Liveness: is the process up. Never touches the database.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "litehubs-api",
      environment: env.nodeEnv,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness: can the process actually serve traffic.
  app.get(`${API_PREFIX}/health`, async (_req: Request, res: Response) => {
    const databaseUp = await pingDatabase();
    res.status(databaseUp ? 200 : 503).json({
      status: databaseUp ? "ok" : "degraded",
      service: "litehubs-api",
      environment: env.nodeEnv,
      checks: { database: databaseUp ? "up" : "down" },
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use(`${API_PREFIX}/auth`, authRoutes);
  app.use(API_PREFIX, platformStaffRoutes);
  app.use(API_PREFIX, performanceRoutes);
  app.use(API_PREFIX, payrollRoutes);
  app.use(API_PREFIX, organizationRoutes);
  app.use(API_PREFIX, companySetupRoutes);
  app.use(API_PREFIX, dailyWorkRoutes);
  app.use(API_PREFIX, disciplineRoutes);
  app.use(API_PREFIX, documentsRoutes);
  app.use(API_PREFIX, contractsRoutes);
  app.use(API_PREFIX, auditRoutes);
  app.use(API_PREFIX, employeeRoutes);
  app.use(API_PREFIX, fileUploadRoutes);
  app.use(API_PREFIX, agricultureRoutes);
  app.use(API_PREFIX, alertRoutes);
  app.use(API_PREFIX, attendanceRoutes);
  app.use(API_PREFIX, leaveRoutes);
  app.use(API_PREFIX, trainingRoutes);
  app.use(API_PREFIX, poultryRoutes);
  app.use(API_PREFIX, pigRoutes);
  app.use(API_PREFIX, ownerManagementRoutes);
  app.use(API_PREFIX, notificationRoutes);
  app.use(API_PREFIX, reportsRoutes);
  app.use(API_PREFIX, salesRoutes);

  // Tenant module routers mount here as they are built. Each one goes under
  // /organizations/:orgSlug and behind requireOrganization, so no handler can
  // run without a proved membership and a pinned RLS context.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
