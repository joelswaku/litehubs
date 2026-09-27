import { ApiError } from "./api";
import { pigsApi, type PigBody, type PigResource } from "./pigs-api";

/**
 * High-frequency pig records which remain safe to queue on a field phone.
 * The API persists the client key in an idempotency ledger before processing a
 * record, including a stock-backed feed issue, so a retry cannot duplicate it.
 */
export type OfflinePigResource = Extract<
  PigResource,
  "daily-records" | "mortality" | "feed"
>;

type QueuedPigRecord = {
  id: string;
  resource: OfflinePigResource;
  body: PigBody;
  queuedAt: string;
  lastError?: string;
};

type QueueState = { version: 1; records: QueuedPigRecord[] };
type SyncResult = { synced: number; pending: number; needsAttention: number };

const STORAGE_PREFIX = "litehubs:offline-pig-records:";
const MAX_QUEUED_RECORDS = 500;

function storageKey(orgSlug: string) {
  return `${STORAGE_PREFIX}${orgSlug}`;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readQueue(orgSlug: string): QueueState {
  const storage = browserStorage();
  if (!storage) return { version: 1, records: [] };
  try {
    const value = JSON.parse(storage.getItem(storageKey(orgSlug)) ?? "{}") as Partial<QueueState>;
    if (value.version !== 1 || !Array.isArray(value.records)) return { version: 1, records: [] };
    return {
      version: 1,
      records: value.records.filter(
        (item): item is QueuedPigRecord =>
          Boolean(item) &&
          typeof item.id === "string" &&
          ["daily-records", "mortality", "feed"].includes(String(item.resource)) &&
          typeof item.body === "object" &&
          item.body !== null &&
          typeof item.queuedAt === "string",
      ),
    };
  } catch {
    return { version: 1, records: [] };
  }
}

function writeQueue(orgSlug: string, state: QueueState) {
  const storage = browserStorage();
  if (!storage) return;
  storage.setItem(storageKey(orgSlug), JSON.stringify(state));
  window.dispatchEvent(new Event("litehubs:offline-pig-change"));
}

export function isOfflinePigResource(resource: PigResource): resource is OfflinePigResource {
  return resource === "daily-records" || resource === "mortality" || resource === "feed";
}

export function newOfflinePigSyncKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const value = Math.floor(Math.random() * 16);
    return (letter === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function offlinePigRecordCount(orgSlug: string) {
  return readQueue(orgSlug).records.length;
}

export function queueOfflinePigRecord(orgSlug: string, resource: OfflinePigResource, body: PigBody) {
  const queue = readQueue(orgSlug);
  const id = String(body.offlineSyncKey ?? newOfflinePigSyncKey());
  if (queue.records.some((record) => record.id === id)) return;
  if (queue.records.length >= MAX_QUEUED_RECORDS)
    throw new Error("Offline storage is full. Reconnect to synchronize saved pig records.");
  queue.records.push({
    id,
    resource,
    body: { ...body, offlineSyncKey: id },
    queuedAt: new Date().toISOString(),
  });
  writeQueue(orgSlug, queue);
}

export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

export async function syncOfflinePigRecords(orgSlug: string): Promise<SyncResult> {
  const queue = readQueue(orgSlug);
  if (!queue.records.length) return { synced: 0, pending: 0, needsAttention: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return { synced: 0, pending: queue.records.length, needsAttention: 0 };

  const remaining: QueuedPigRecord[] = [];
  let synced = 0;
  let needsAttention = 0;
  for (let index = 0; index < queue.records.length; index += 1) {
    const record = queue.records[index]!;
    try {
      await pigsApi.create(orgSlug, record.resource, { ...record.body, offlineSyncKey: record.id });
      synced += 1;
    } catch (error) {
      if (isNetworkFailure(error)) {
        remaining.push(record, ...queue.records.slice(index + 1));
        break;
      }
      needsAttention += 1;
      remaining.push({
        ...record,
        lastError: error instanceof Error ? error.message : "This record needs attention before synchronization.",
      });
    }
  }
  writeQueue(orgSlug, { version: 1, records: remaining });
  return { synced, pending: remaining.length, needsAttention };
}
