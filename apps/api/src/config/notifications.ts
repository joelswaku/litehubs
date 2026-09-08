import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";
import { logger } from "./logger";

let transporter: Transporter | null = null;
let initialised = false;

/**
 * The SMTP transport, or null when mail is not configured.
 *
 * Built lazily and reused: nodemailer pools connections, so creating one
 * transport per message would open a new TLS handshake every time.
 */
export function getMailTransport(): Transporter | null {
  if (initialised) return transporter;
  initialised = true;

  if (!env.mail.enabled) {
    logger.warn(
      "SMTP is not configured — emails will be logged instead of sent",
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: env.mail.port === 465,
    auth: { user: env.mail.user, pass: env.mail.password },
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });

  return transporter;
}

export function mailFromAddress(): string {
  return `"${env.mail.fromName}" <${env.mail.fromEmail}>`;
}

/**
 * Checks the SMTP credentials without sending anything. Called once at startup
 * so a bad relay password is reported then, not on a user's first reset.
 */
export async function verifyMailTransport(): Promise<boolean> {
  const transport = getMailTransport();
  if (!transport) return false;

  try {
    await transport.verify();
    logger.info(
      { host: env.mail.host, port: env.mail.port, from: env.mail.fromEmail },
      "SMTP ready",
    );
    return true;
  } catch (error) {
    logger.error({ err: error }, "SMTP verification failed");
    return false;
  }
}

export async function closeMailTransport(): Promise<void> {
  transporter?.close();
  transporter = null;
  initialised = false;
}
