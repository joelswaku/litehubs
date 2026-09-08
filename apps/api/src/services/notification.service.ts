import { env } from "../config/env";
import { logger } from "../config/logger";
import { getMailTransport, mailFromAddress } from "../config/notifications";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
}

const BRAND = "Congo Omega";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function paragraph(content: string): string {
  return `<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#344054;">${content}</p>`;
}

function notice(content: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;"><tr><td style="padding:16px 18px;font-size:13px;line-height:1.55;color:#166534;">${content}</td></tr></table>`;
}

function button(url: string, label: string): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 22px;"><tr><td style="border-radius:8px;background:#146c43;">
    <a href="${safeUrl}" style="display:inline-block;padding:14px 22px;border:1px solid #146c43;border-radius:8px;color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.1px;text-decoration:none;">${safeLabel}</a>
  </td></tr></table>
  <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#667085;">Button not working? Copy and paste this secure link into your browser:</p>
  <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;color:#475467;"><a href="${safeUrl}" style="color:#146c43;text-decoration:underline;">${safeUrl}</a></p>`;
}

/**
 * Sends one email. Never throws: callers are user-facing flows where a mail
 * outage must not turn into a 500, and must not change the response in a way
 * that reveals whether an address exists.
 */
export async function sendMail(message: MailMessage): Promise<SendResult> {
  // Integration tests must prove business logic without sending real emails.
  if (env.isTest) {
    return { sent: false, reason: "email_skipped_in_test" };
  }

  const transport = getMailTransport();

  if (!transport) {
    // Without a relay, log enough to follow the flow locally.
    logger.warn(
      { to: message.to, subject: message.subject },
      "Email not sent — SMTP is not configured",
    );
    return { sent: false, reason: "smtp_not_configured" };
  }

  try {
    const info = await transport.sendMail({
      from: mailFromAddress(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    logger.info(
      { to: message.to, subject: message.subject, messageId: info.messageId },
      "Email sent",
    );
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    logger.error(
      { err: error, to: message.to, subject: message.subject },
      "Email delivery failed",
    );
    return { sent: false, reason: "delivery_failed" };
  }
}

function layout(heading: string, preview: string, bodyHtml: string): string {
  const safeHeading = escapeHtml(heading);
  const safePreview = escapeHtml(preview);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeHeading}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7f5;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#101828;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${safePreview}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f4f7f5;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dfe8e2;border-radius:14px;overflow:hidden;">
          <tr><td style="padding:24px 32px;background:#0f5132;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:22px;line-height:1;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">Congo <span style="color:#a7f3d0;">Omega</span></td>
              <td align="right" style="font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:#bbf7d0;">LiteHubs</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:36px 32px 30px;">
            <div style="width:42px;height:5px;margin:0 0 20px;background:#22a06b;border-radius:99px;"></div>
            <h1 style="margin:0 0 18px;font-size:27px;line-height:1.22;letter-spacing:-0.5px;color:#101828;">${safeHeading}</h1>
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:22px 32px;background:#f8faf9;border-top:1px solid #e7eeea;font-size:12px;line-height:1.6;color:#667085;">
            This is an automated security and account email from ${BRAND}. Please do not reply to this message.<br />
            © ${new Date().getFullYear()} ${BRAND} on LiteHubs.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  expiresInMinutes: number,
): Promise<SendResult> {
  return sendMail({
    to,
    subject: `Reset your ${BRAND} password`,
    text: [
      `A password reset was requested for your ${BRAND} account.`,
      "",
      `Open this link to choose a new password (valid for ${expiresInMinutes} minutes):`,
      resetUrl,
      "",
      "If you did not request this, you can ignore this email — your password stays unchanged.",
    ].join("\n"),
    html: layout(
      "Reset your password",
      "A secure link to choose a new Congo Omega password.",
      [
        paragraph(`A password reset was requested for your ${BRAND} account.`),
        notice(
          `For your security, this reset link expires in <strong>${expiresInMinutes} minutes</strong> and can only be used once.`,
        ),
        button(resetUrl, "Choose a new password"),
        paragraph(
          `<span style="font-size:13px;color:#667085;">Did not request this? You can safely ignore this email. Your current password will remain unchanged.</span>`,
        ),
      ].join(""),
    ),
  });
}

export async function sendPasswordChangedEmail(
  to: string,
): Promise<SendResult> {
  return sendMail({
    to,
    subject: `Your ${BRAND} password was changed`,
    text: [
      `The password on your ${BRAND} account was just changed.`,
      "",
      "All other sessions have been signed out.",
      "",
      "If this was not you, contact your administrator immediately.",
    ].join("\n"),
    html: layout(
      "Your password was changed",
      "Your Congo Omega password was changed and other sessions were signed out.",
      [
        paragraph(`The password on your ${BRAND} account was just changed.`),
        notice(
          `<strong>Security update:</strong> all other active sessions have been signed out.`,
        ),
        paragraph(
          `<span style="font-size:13px;color:#667085;">If this was not you, contact your administrator immediately and request another password reset.</span>`,
        ),
      ].join(""),
    ),
  });
}

export async function sendWelcomeEmail(
  to: string,
  fullName: string,
  // Kept for compatibility with older callers. Passwords are never emailed.
  _temporaryPassword?: string,
  organizationName = BRAND,
): Promise<SendResult> {
  const loginUrl = `${env.frontendUrl}/login`;
  const workspaceName = organizationName.trim() || BRAND;
  const safeName = escapeHtml(fullName.trim() || "there");
  const safeWorkspaceName = escapeHtml(workspaceName);

  return sendMail({
    to,
    subject: `Welcome to ${workspaceName}`,
    text: [
      `Hello ${fullName},`,
      "",
      `Welcome to ${workspaceName} on LiteHubs. Your account is ready.`,
      "",
      "Sign in to access your company workspace, team and approved operations.",
      "",
      `Sign in: ${loginUrl}`,
    ].join("\n"),
    html: layout(
      `Welcome to ${workspaceName}`,
      `Your ${workspaceName} account is ready to use.`,
      [
        paragraph(`Hello <strong>${safeName}</strong>,`),
        paragraph(
          `Your account is ready. You can now sign in and start working with your company team in LiteHubs.`,
        ),
        notice(`<strong>Your workspace</strong><br />${safeWorkspaceName}`),
        button(loginUrl, "Sign in to your workspace"),
        paragraph(
          `<span style="font-size:13px;color:#667085;">Keep your password private. Congo Omega will never ask you to send it by email or chat.</span>`,
        ),
      ].join(""),
    ),
  });
}

export async function sendTeamInvitationEmail(
  to: string,
  _organizationId: string,
  acceptUrl: string,
  expiresInDays: number,
): Promise<SendResult> {
  return sendMail({
    to,
    subject: `Your ${BRAND} access has been assigned`,
    text: [
      `Your LiteHubs access has been assigned for ${BRAND}.`,
      "",
      `Open this secure link within ${expiresInDays} days to create your password and activate your account:`,
      acceptUrl,
      "",
      "LiteHubs will never send a password by email. If you were not expecting this access, you can safely ignore this email.",
    ].join("\n"),
    html: layout(
      "Your access is ready",
      "Your LiteHubs access has been assigned for Congo Omega.",
      [
        paragraph(
          `An administrator assigned you access to <strong>${BRAND}</strong> on LiteHubs.`,
        ),
        notice(
          `This secure activation link is personal and expires in <strong>${expiresInDays} days</strong>.`,
        ),
        button(acceptUrl, "Set your password"),
        paragraph(
          `<span style="font-size:13px;color:#667085;">LiteHubs never sends passwords by email. If you were not expecting this access, you can safely ignore this email.</span>`,
        ),
      ].join(""),
    ),
  });
}
