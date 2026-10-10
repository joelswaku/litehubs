import type { PoolClient } from "pg";
import { ForbiddenError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { rightsOf, settingsOf, type ChatContext } from "../chat/chat.service";

export type AiInstructions = { shared: string; mail: string; website: string };

/** Instructions management wrote for the AI assistants (trusted text). */
export async function readAiInstructions(client: PoolClient, organizationId: string): Promise<AiInstructions> {
  const result = await client.query<{ shared_text: string | null; mail_text: string | null }>(
    `SELECT shared_text,mail_text FROM organization_ai_instructions WHERE organization_id=$1`,
    [organizationId],
  );
  const settings = await settingsOf(client, organizationId);
  return {
    shared: result.rows[0]?.shared_text?.trim() ?? "",
    mail: result.rows[0]?.mail_text?.trim() ?? "",
    website: settings.websiteKnowledge?.trim() ?? "",
  };
}

/** Owner, mail managers and chat moderators keep the AI instructions. */
async function assertEditor(client: PoolClient, context: ChatContext) {
  if (context.isOwner || context.permissions.includes("mail.manage")) return;
  const rights = await rightsOf(client, context);
  if (!rights.moderator) throw new ForbiddenError("Seule la direction modifie les consignes de l’IA.");
}

export async function getAiInstructions(context: ChatContext) {
  return withTenantContext(context, async (client) => {
    await assertEditor(client, context);
    return readAiInstructions(client, context.organizationId);
  });
}

export async function saveAiInstructions(context: ChatContext, input: Partial<AiInstructions>) {
  return withTenantContext(context, async (client) => {
    await assertEditor(client, context);
    const current = await readAiInstructions(client, context.organizationId);
    const clean = (value: string | undefined, fallback: string) =>
      value === undefined ? fallback || null : value.trim() || null;
    await client.query(
      `INSERT INTO organization_ai_instructions(organization_id,shared_text,mail_text,updated_by_member_id,updated_at)
       VALUES($1,$2,$3,$4,now())
       ON CONFLICT (organization_id) DO UPDATE SET shared_text=EXCLUDED.shared_text,mail_text=EXCLUDED.mail_text,
         updated_by_member_id=EXCLUDED.updated_by_member_id,updated_at=now()`,
      [context.organizationId, clean(input.shared, current.shared), clean(input.mail, current.mail), context.memberId],
    );
    if (input.website !== undefined)
      await client.query(
        `INSERT INTO chat_settings(organization_id,website_knowledge,updated_at) VALUES($1,$2,now())
         ON CONFLICT (organization_id) DO UPDATE SET website_knowledge=EXCLUDED.website_knowledge,updated_at=now()`,
        [context.organizationId, input.website.trim() || null],
      );
    return readAiInstructions(client, context.organizationId);
  });
}
