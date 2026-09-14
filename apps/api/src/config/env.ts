import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// The monorepo keeps one .env at the workspace root, but npm runs workspace
// scripts with cwd set to apps/api — so resolve it relative to this file.
// Holds for both src/config (tsx) and dist/config (compiled), same depth.
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
  quiet: true,
});

const PLACEHOLDER_SECRETS = ["your_long_secret", "your_other_long_secret"];

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().max(65535).default(5000),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    REFRESH_TOKEN_SECRET: z
      .string()
      .min(16, "REFRESH_TOKEN_SECRET must be at least 16 characters"),

    // Defaults are intentionally short for local testing and protective in production.
    AUTH_LOCK_DURATION_SECONDS: z.coerce
      .number()
      .int()
      .min(5)
      .max(86_400)
      .optional(),

    FRONTEND_URL: z.string().url().default("http://localhost:3000"),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    // Outbound email (Brevo SMTP relay). Optional in development: without it
    // password-reset links are logged instead of sent.
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    // Supported for existing Brevo configurations. BREVO_API_KEY here means
    // Brevo's SMTP key, not a REST API key.
    BREVO_SMTP_LOGIN: z.string().min(1).optional(),
    BREVO_API_KEY: z.string().min(1).optional(),
    // Brevo transactional SMS uses a REST API key, separate from SMTP.
    // SMS_CONGO_O remains accepted as a private Railway-variable alias during rollout.
    BREVO_SMS_API_KEY: z.string().trim().min(1).optional(),
    SMS_CONGO_O: z.string().trim().min(1).optional(),
    BREVO_SMS_SENDER: z.string().trim().min(1).max(20).default("CongoOmega"),
    SMS_DEFAULT_COUNTRY_CODE: z.string().trim().regex(/^\d{1,3}$/, "Use an international calling code without +").default("243"),
    // Image storage. Keep the API secret in .env only; it is never exposed to browsers.
    CLOUDINARY_CLOUD_NAME: z.string().trim().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().trim().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().trim().min(1).optional(),
    CLOUDINARY_FOLDER: z
      .string()
      .trim()
      .regex(
        /^[a-zA-Z0-9_/-]+$/,
        "Use letters, numbers, underscores, hyphens and slashes",
      )
      .default("litehubs"),
    UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(25).default(10),
    // AI is server-only. OPEN_API_KEY and the misspelled limit are accepted
    // temporarily so existing local .env files keep working.
    OPENAI_API_KEY: z.string().trim().min(1).optional(),
    OPEN_API_KEY: z.string().trim().min(1).optional(),
    OPEN_MODEL: z.string().trim().min(1).max(160).default("gpt-5.6"),
    AI_ENABLED: z.string().trim().optional(),
    AI_DAILY_REQUEST_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .optional(),
    AI_DAILY_REQUEST_LIMITE: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .optional(),
    MAIL_FROM_NAME: z.string().min(1).default("LiteHubs"),
    MAIL_FROM_EMAIL: z.string().email().optional(),
  })
  // Placeholder secrets are fine while developing, never in production.
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") return;

    for (const key of ["JWT_SECRET", "REFRESH_TOKEN_SECRET"] as const) {
      const secret = value[key];
      if (PLACEHOLDER_SECRETS.includes(secret)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is still the example value — set a real secret before running in production`,
        });
      } else if (secret.length < 32) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must be at least 32 characters in production`,
        });
      }
    }

    if (value.JWT_SECRET === value.REFRESH_TOKEN_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["REFRESH_TOKEN_SECRET"],
        message: "REFRESH_TOKEN_SECRET must differ from JWT_SECRET",
      });
    }

    // Password reset is unusable without a mailer, so require one in prod.
    const hasBrevoSmtp = Boolean(value.BREVO_SMTP_LOGIN && value.BREVO_API_KEY);
    const hasStandardSmtp = Boolean(
      value.SMTP_HOST && value.SMTP_USER && value.SMTP_PASSWORD,
    );
    if (!hasBrevoSmtp && !hasStandardSmtp) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message:
          "SMTP_HOST, SMTP_USER and SMTP_PASSWORD (or BREVO_SMTP_LOGIN and BREVO_API_KEY) are required in production",
      });
    }
    const aiEnabled = ["true", "1", "yes", "on"].includes(
      (value.AI_ENABLED ?? "").toLowerCase(),
    );
    if (aiEnabled && !value.OPENAI_API_KEY && !value.OPEN_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when AI_ENABLED is true",
      });
    }

    const cloudinaryValues = [
      value.CLOUDINARY_CLOUD_NAME,
      value.CLOUDINARY_API_KEY,
      value.CLOUDINARY_API_SECRET,
    ].filter(Boolean).length;
    if (cloudinaryValues > 0 && cloudinaryValues < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["CLOUDINARY_CLOUD_NAME"],
        message:
          "Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET together",
      });
    }
    if (!value.MAIL_FROM_EMAIL) {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_FROM_EMAIL"],
        message:
          "MAIL_FROM_EMAIL is required in production so password reset emails can be sent",
      });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  // Logger depends on env, so this one case has to use console.
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

const config = parsed.data;
const useBrevoSmtp = Boolean(config.BREVO_SMTP_LOGIN && config.BREVO_API_KEY);
const mailHost = useBrevoSmtp ? "smtp-relay.brevo.com" : config.SMTP_HOST;
const mailPort = useBrevoSmtp ? 587 : config.SMTP_PORT;
const mailUser = useBrevoSmtp ? config.BREVO_SMTP_LOGIN : config.SMTP_USER;
const mailPassword = useBrevoSmtp ? config.BREVO_API_KEY : config.SMTP_PASSWORD;

export const env = {
  nodeEnv: config.NODE_ENV,
  port: config.PORT,

  databaseUrl: config.DATABASE_URL,

  jwtSecret: config.JWT_SECRET,
  refreshTokenSecret: config.REFRESH_TOKEN_SECRET,

  frontendUrl: config.FRONTEND_URL,
  logLevel: config.LOG_LEVEL,

  auth: {
    maxFailedLogins: 5,
    lockDurationSeconds:
      config.AUTH_LOCK_DURATION_SECONDS ??
      (config.NODE_ENV === "production" ? 15 * 60 : 15),
  },

  mail: {
    enabled: Boolean(
      mailHost && mailUser && mailPassword && config.MAIL_FROM_EMAIL,
    ),
    host: mailHost,
    port: mailPort,
    user: mailUser,
    password: mailPassword,
    fromName: config.MAIL_FROM_NAME,
    fromEmail: config.MAIL_FROM_EMAIL,
  },

  sms: {
    enabled: Boolean(config.BREVO_SMS_API_KEY ?? config.SMS_CONGO_O),
    apiKey: config.BREVO_SMS_API_KEY ?? config.SMS_CONGO_O,
    sender: config.BREVO_SMS_SENDER,
    defaultCountryCallingCode: config.SMS_DEFAULT_COUNTRY_CODE,
  },

  cloudinary: {
    enabled: Boolean(
      config.CLOUDINARY_CLOUD_NAME &&
      config.CLOUDINARY_API_KEY &&
      config.CLOUDINARY_API_SECRET,
    ),
    cloudName: config.CLOUDINARY_CLOUD_NAME,
    apiKey: config.CLOUDINARY_API_KEY,
    apiSecret: config.CLOUDINARY_API_SECRET,
    folder: config.CLOUDINARY_FOLDER,
  },
  ai: {
    enabled:
      ["true", "1", "yes", "on"].includes(
        (config.AI_ENABLED ?? "").toLowerCase(),
      ) && Boolean(config.OPENAI_API_KEY ?? config.OPEN_API_KEY),
    apiKey: config.OPENAI_API_KEY ?? config.OPEN_API_KEY,
    model: config.OPEN_MODEL,
    dailyRequestLimit:
      config.AI_DAILY_REQUEST_LIMIT ?? config.AI_DAILY_REQUEST_LIMITE ?? 20,
  },
  maxUploadBytes: config.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
  isProduction: config.NODE_ENV === "production",
  isDevelopment: config.NODE_ENV === "development",
  isTest: config.NODE_ENV === "test",
} as const;

export type Env = typeof env;
