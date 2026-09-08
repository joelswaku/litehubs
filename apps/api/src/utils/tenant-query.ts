import type { PoolClient } from "pg";
import { db } from "../config/database";

export interface RequestContext {
  userId: string | null;
  organizationId: string | null;
}

/**
 * Pins the request context for the current transaction. The RLS policies added
 * in migrations 001/004 read these through current_user_id() and
 * current_organization_id().
 *
 * `set_config(..., true)` is the parameterisable form of SET LOCAL, so the
 * values are discarded when the transaction ends and cannot leak onto the next
 * request that borrows this pooled connection.
 *
 * An empty string reads back as NULL through the accessors, which makes an
 * unscoped connection see no tenant rows rather than all of them.
 */
export async function setRequestContext(
  client: PoolClient,
  context: RequestContext,
): Promise<void> {
  await client.query(
    "SELECT set_config('app.user_id', $1, true), set_config('app.organization_id', $2, true)",
    [context.userId ?? "", context.organizationId ?? ""],
  );
}

/**
 * Runs `handler` in a transaction scoped to one organization. Everything the
 * handler reads or writes is filtered by RLS to that organization, so a
 * forgotten WHERE clause cannot cross a tenant boundary.
 */
export async function withTenantContext<T>(
  context: RequestContext & { organizationId: string },
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await setRequestContext(client, context);
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* connection is already broken; the release below discards it */
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * For the lookups that happen before an organization is chosen — "which
 * workspaces do I belong to?". Sets only app.user_id, so tenant tables stay
 * invisible except where a policy allows a self-referencing read.
 */
export async function withUserContext<T>(
  userId: string,
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await setRequestContext(client, { userId, organizationId: null });
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
