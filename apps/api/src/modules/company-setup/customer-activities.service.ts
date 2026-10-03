import { sendMail } from "../../services/notification.service";
import {
  BadRequestError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  CustomerActivityCreateInput,
  CustomerActivityShareInput,
  CustomerActivityUpdateInput,
} from "./company-setup.validation";
import type { SetupContext } from "./company-setup.service";
import { env } from "../../config/env";

type ActivityStatus = "draft" | "published" | "archived";
type ActivityAudience = "all" | "invited";

type ActivityRow = {
  id: string;
  title: string;
  summary: string;
  body: string | null;
  image_url: string | null;
  button_label: string | null;
  button_url: string | null;
  audience: ActivityAudience;
  status: ActivityStatus;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  recipient_count?: string;
  sent_count?: string;
};

type WebsiteInvitationContext = {
  display_name: string;
  custom_domain: string | null;
  publication_status: "draft" | "published" | "paused";
  organization_slug: string;
};

const asIso = (value: Date | string | null) =>
  value ? (value instanceof Date ? value.toISOString() : value) : null;

function mapActivity(row: ActivityRow) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    imageUrl: row.image_url,
    buttonLabel: row.button_label,
    buttonUrl: row.button_url,
    audience: row.audience,
    status: row.status,
    publishedAt: asIso(row.published_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    recipientCount: Number(row.recipient_count ?? 0),
    sentCount: Number(row.sent_count ?? 0),
  };
}

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

function activityAccountUrl(website: WebsiteInvitationContext): string {
  if (website.custom_domain) return `https://${website.custom_domain}/account`;
  return `${env.frontendUrl.replace(/\/$/, "")}/sites/${encodeURIComponent(website.organization_slug)}/account`;
}

function invitationHtml(
  website: WebsiteInvitationContext,
  activity: ActivityRow,
  accountUrl: string,
): string {
  const brand = escapeHtml(website.display_name);
  const title = escapeHtml(activity.title);
  const summary = escapeHtml(activity.summary);
  const body = activity.body
    ? `<p style="margin:0 0 18px;color:#475467;font-size:15px;line-height:1.65;">${escapeHtml(activity.body).replace(/\n/g, "<br />")}</p>`
    : "";
  const visual = activity.image_url
    ? `<img src="${escapeHtml(activity.image_url)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:18px 18px 0 0;" />`
    : "";
  const safeUrl = escapeHtml(accountUrl);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${title}</title></head><body style="margin:0;padding:0;background:#f4f7f5;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#101828;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f5;padding:28px 12px;"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4ebe6;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(16,24,40,.08);">${visual}<tr><td style="padding:30px;"><p style="margin:0 0 14px;color:#18794e;font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;">${brand} · ACTIVITÉ PARTAGÉE</p><h1 style="margin:0 0 14px;color:#10231a;font-size:26px;line-height:1.22;letter-spacing:-.4px;">${title}</h1><p style="margin:0 0 18px;color:#344054;font-size:16px;line-height:1.6;">${summary}</p>${body}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:25px 0 18px;"><tr><td style="border-radius:9px;background:#12633c;"><a href="${safeUrl}" style="display:inline-block;padding:14px 21px;color:#fff;font-size:15px;font-weight:700;text-decoration:none;">Voir l’activité</a></td></tr></table><p style="margin:0;color:#667085;font-size:12px;line-height:1.55;">Créez votre compte public ou connectez-vous avec cette adresse e-mail. Cet espace donne uniquement accès aux activités partagées par ${brand}; il ne donne jamais accès à une candidature, à un dossier de recrutement ni aux outils internes.</p></td></tr></table></td></tr></table></body></html>`;
}

export async function listCustomerActivities(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<ActivityRow>(
      `SELECT a.id,a.title,a.summary,a.body,a.image_url,a.button_label,a.button_url,
              a.audience,a.status,a.published_at,a.created_at,a.updated_at,
              count(r.id)::text AS recipient_count,
              count(r.id) FILTER (WHERE r.sent_at IS NOT NULL)::text AS sent_count
         FROM public_customer_activities a
         LEFT JOIN public_customer_activity_recipients r
           ON r.organization_id=a.organization_id AND r.activity_id=a.id
        WHERE a.organization_id=$1
        GROUP BY a.id
        ORDER BY COALESCE(a.published_at,a.created_at) DESC, a.created_at DESC`,
      [context.organizationId],
    );
    return result.rows.map(mapActivity);
  });
}

export async function createCustomerActivity(
  context: SetupContext,
  input: CustomerActivityCreateInput,
) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<ActivityRow>(
      `INSERT INTO public_customer_activities
        (organization_id,title,summary,body,image_url,button_label,button_url,audience,status,published_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
               CASE WHEN $9='published' THEN now() ELSE NULL END,$10)
       RETURNING id,title,summary,body,image_url,button_label,button_url,audience,status,
                 published_at,created_at,updated_at`,
      [
        context.organizationId,
        input.title,
        input.summary,
        input.body ?? null,
        input.imageUrl ?? null,
        input.buttonLabel ?? null,
        input.buttonUrl ?? null,
        input.audience,
        input.status,
        context.userId,
      ],
    );
    return mapActivity(result.rows[0]!);
  });
}

export async function updateCustomerActivity(
  context: SetupContext,
  activityId: string,
  input: CustomerActivityUpdateInput,
) {
  const columns: Array<[string, unknown]> = [];
  if (input.title !== undefined) columns.push(["title", input.title]);
  if (input.summary !== undefined) columns.push(["summary", input.summary]);
  if (input.body !== undefined) columns.push(["body", input.body]);
  if (input.imageUrl !== undefined)
    columns.push(["image_url", input.imageUrl]);
  if (input.buttonLabel !== undefined)
    columns.push(["button_label", input.buttonLabel]);
  if (input.buttonUrl !== undefined)
    columns.push(["button_url", input.buttonUrl]);
  if (input.audience !== undefined) columns.push(["audience", input.audience]);
  if (input.status !== undefined) columns.push(["status", input.status]);

  return withTenantContext(context, async (client) => {
    const parameters: unknown[] = [context.organizationId, activityId];
    const assignments = columns.map(([column, value]) => {
      parameters.push(value);
      return `${column}=$${parameters.length}`;
    });
    if (input.status !== undefined) {
      parameters.push(input.status);
      assignments.push(
        `published_at=CASE WHEN $${parameters.length}='published' AND status <> 'published' THEN now() WHEN $${parameters.length}='draft' THEN NULL ELSE published_at END`,
      );
    }
    const result = await client.query<ActivityRow>(
      `UPDATE public_customer_activities
          SET ${assignments.join(", ")}
        WHERE organization_id=$1 AND id=$2 AND status <> 'archived'
        RETURNING id,title,summary,body,image_url,button_label,button_url,audience,status,
                  published_at,created_at,updated_at`,
      parameters,
    );
    const activity = result.rows[0];
    if (!activity) throw new NotFoundError("Cette activité n’existe pas ou est archivée");
    return mapActivity(activity);
  });
}

export async function archiveCustomerActivity(
  context: SetupContext,
  activityId: string,
): Promise<void> {
  await withTenantContext(context, async (client) => {
    const result = await client.query(
      `UPDATE public_customer_activities
          SET status='archived'
        WHERE organization_id=$1 AND id=$2 AND status <> 'archived'`,
      [context.organizationId, activityId],
    );
    if (!result.rowCount)
      throw new NotFoundError("Cette activité n’existe pas ou est déjà archivée");
  });
}

export async function shareCustomerActivity(
  context: SetupContext,
  activityId: string,
  input: CustomerActivityShareInput,
) {
  const { activity, website } = await withTenantContext(context, async (client) => {
    const activityResult = await client.query<ActivityRow>(
      `SELECT id,title,summary,body,image_url,button_label,button_url,audience,status,
              published_at,created_at,updated_at
         FROM public_customer_activities
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, activityId],
    );
    const activity = activityResult.rows[0];
    if (!activity) throw new NotFoundError("Cette activité n’existe pas");
    if (activity.status !== "published") {
      throw new BadRequestError("Publiez cette activité avant de l’envoyer");
    }

    const websiteResult = await client.query<WebsiteInvitationContext>(
      `SELECT ws.display_name,ws.custom_domain,ws.publication_status,o.slug AS organization_slug
         FROM organization_website_settings ws
         JOIN organizations o ON o.id=ws.organization_id
        WHERE ws.organization_id=$1`,
      [context.organizationId],
    );
    const website = websiteResult.rows[0];
    if (!website || website.publication_status !== "published") {
      throw new BadRequestError("Publiez le site avant de partager une activité");
    }

    await client.query(
      `INSERT INTO public_customer_activity_recipients
        (organization_id,activity_id,email,created_by)
       SELECT $1,$2,destination.email,$3
         FROM unnest($4::citext[]) AS destination(email)
       ON CONFLICT (organization_id,activity_id,email)
       DO UPDATE SET created_by=EXCLUDED.created_by`,
      [context.organizationId, activityId, context.userId, input.recipients],
    );
    return { activity, website };
  });

  const accountUrl = activityAccountUrl(website);
  const text = [
    `${website.display_name} vous partage une activité : ${activity.title}`,
    "",
    activity.summary,
    activity.body ?? "",
    "",
    "Pour la lire, créez votre compte public ou connectez-vous avec cette adresse e-mail :",
    accountUrl,
    "",
    "Ce lien donne accès uniquement aux activités partagées. Il ne donne jamais accès à une candidature, à un dossier de recrutement ni aux outils internes.",
  ]
    .filter(Boolean)
    .join("\n");
  const html = invitationHtml(website, activity, accountUrl);
  const deliveries = await Promise.all(
    input.recipients.map(async (email) => ({
      email,
      result: await sendMail({
        to: email,
        subject: `${website.display_name} — ${activity.title}`,
        text,
        html,
      }),
    })),
  );
  const sentEmails = deliveries
    .filter(({ result }) => result.sent)
    .map(({ email }) => email);
  if (sentEmails.length) {
    await withTenantContext(context, async (client) => {
      await client.query(
        `UPDATE public_customer_activity_recipients
            SET sent_at=now()
          WHERE organization_id=$1 AND activity_id=$2 AND email=ANY($3::citext[])`,
        [context.organizationId, activityId, sentEmails],
      );
    });
  }
  return {
    requested: input.recipients.length,
    sent: sentEmails.length,
    accountUrl,
  };
}

// Used only by the public-account route. It marks the invitation as viewed
// without returning the recipient list to the browser.
export async function listPublicCustomerActivities(
  organizationId: string,
  email: string | null,
) {
  return withTenantContext(
    { organizationId, userId: null, memberId: null },
    async (client) => {
      const result = await client.query<ActivityRow>(
        `SELECT DISTINCT a.id,a.title,a.summary,a.body,a.image_url,a.button_label,a.button_url,
                a.audience,a.status,a.published_at,a.created_at,a.updated_at
           FROM public_customer_activities a
           LEFT JOIN public_customer_activity_recipients r
             ON r.organization_id=a.organization_id AND r.activity_id=a.id
                AND $2::citext IS NOT NULL AND r.email=$2::citext
          WHERE a.organization_id=$1
            AND a.status='published'
            AND (a.audience='all' OR r.id IS NOT NULL)
          ORDER BY a.published_at DESC, a.created_at DESC`,
        [organizationId, email],
      );
      if (email && result.rows.length) {
        await client.query(
          `UPDATE public_customer_activity_recipients
              SET viewed_at=COALESCE(viewed_at,now())
            WHERE organization_id=$1 AND email=$2::citext
              AND activity_id=ANY($3::uuid[])`,
          [organizationId, email, result.rows.map((activity) => activity.id)],
        );
      }
      return result.rows.map(mapActivity);
    },
  );
}
