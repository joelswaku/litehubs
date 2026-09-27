import { ApiError } from "./api";
import { poultryApi, type PoultryBody, type PoultryResource } from "./poultry-api";

/**
 * Only the three high-frequency farm records are queued locally. They are
 * small, operational inputs with an API idempotency key, so reconnecting can
 * never silently duplicate eggs, mortality or feed consumption.
 */
export type OfflinePoultryResource = Extract<
  PoultryResource,
  "eggs" | "mortality" | "feed"
>;

type QueuedPoultryRecord = {
  id: string;
  resource: OfflinePoultryResource;
  body: PoultryBody;
  queuedAt: string;
  lastError?: string;
};

type QueueState = { version: 1; records: QueuedPoultryRecord[] };

type SyncResult = {
  synced: number;
  pending: number;
  needsAttention: number;
};

const STORAGE_PREFIX = "litehubs:offline-poultry-records:";
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
    if (value.version !== 1 || !Array.isArray(value.records))
      return { version: 1, records: [] };
    return {
      version: 1,
      records: value.records.filter(
        (item): item is QueuedPoultryRecord =>
          Boolean(item) &&
          typeof item.id === "string" &&
          ["eggs", "mortality", "feed"].includes(String(item.resource)) &&
          typeof item.body === "object" &&
          item.body !== null &&
          typeof item.queuedAt === "string",
      ),
    };
  } catch {
    return { version: 1, records: [] };
  }
}

function writeQueue(orgSlug: string, state: QueueState): void {
  const storage = browserStorage();
  if (!storage) return;
  storage.setItem(storageKey(orgSlug), JSON.stringify(state));
  window.dispatchEvent(new Event("litehubs:offline-poultry-change"));
}

export function isOfflinePoultryResource(
  resource: PoultryResource,
): resource is OfflinePoultryResource {
  return resource === "eggs" || resource === "mortality" || resource === "feed";
}

export function newOfflinePoultrySyncKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const value = Math.floor(Math.random() * 16);
    return (letter === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function offlinePoultryRecordCount(orgSlug: string): number {
  return readQueue(orgSlug).records.length;
}

export function queueOfflinePoultryRecord(
  orgSlug: string,
  resource: OfflinePoultryResource,
  body: PoultryBody,
): void {
  const queue = readQueue(orgSlug);
  const id = String(body.offlineSyncKey ?? newOfflinePoultrySyncKey());
  if (queue.records.some((record) => record.id === id)) return;
  if (queue.records.length >= MAX_QUEUED_RECORDS)
    throw new Error("Offline storage is full. Reconnect to synchronize the saved field records.");
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

export async function syncOfflinePoultryRecords(
  orgSlug: string,
): Promise<SyncResult> {
  const queue = readQueue(orgSlug);
  if (!queue.records.length) return { synced: 0, pending: 0, needsAttention: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return { synced: 0, pending: queue.records.length, needsAttention: 0 };

  const remaining: QueuedPoultryRecord[] = [];
  let synced = 0;
  let needsAttention = 0;
  for (let index = 0; index < queue.records.length; index += 1) {
    const record = queue.records[index]!;
    try {
      await poultryApi.create(orgSlug, record.resource, {
        ...record.body,
        offlineSyncKey: record.id,
      });
      synced += 1;
    } catch (error) {
      if (isNetworkFailure(error)) {
        remaining.push(record, ...queue.records.slice(index + 1));
        break;
      }
      needsAttention += 1;
      remaining.push({
        ...record,
        lastError: error instanceof Error ? error.message : "This record needs attention before it can be synchronized.",
      });
    }
  }
  writeQueue(orgSlug, { version: 1, records: remaining });
  return { synced, pending: remaining.length, needsAttention };
}