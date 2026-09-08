import { del, get, orgUrl, patch, post } from "./api";

/**
 * The complete company-scoped Pig API. Keeping route construction here makes
 * all Pig screens use the authenticated API client and active organization.
 */
export const PIG_RESOURCES = [
  "pens",
  "groups",
  "animals",
  "daily-records",
  "feed",
  "water",
  "weights",
  "movements",
  "mortality",
  "losses",
  "breeding",
  "pregnancies",
  "farrowing",
  "piglets",
  "health",
  "vaccinations",
  "treatments",
  "quarantine",
  "veterinary",
] as const;

export type PigResource = (typeof PIG_RESOURCES)[number];
export type PigBody = Record<string, unknown>;
export type PigQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

function queryString(query?: PigQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "")
      params.set(key, String(value));
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

function base(orgSlug: string, path: string) {
  return orgUrl(orgSlug, `pigs/${path}`);
}

export const pigsApi = {
  overview<T>(orgSlug: string, query?: PigQuery) {
    return get<T>(base(orgSlug, `overview${queryString(query)}`));
  },
  list<T>(orgSlug: string, resource: PigResource, query?: PigQuery) {
    return get<T>(base(orgSlug, `${resource}${queryString(query)}`));
  },
  get<T>(orgSlug: string, resource: PigResource, recordId: string) {
    return get<T>(base(orgSlug, `${resource}/${recordId}`));
  },
  create<T>(orgSlug: string, resource: PigResource, body: PigBody) {
    return post<T>(base(orgSlug, resource), body);
  },
  update<T>(
    orgSlug: string,
    resource: PigResource,
    recordId: string,
    body: PigBody,
  ) {
    return patch<T>(base(orgSlug, `${resource}/${recordId}`), body);
  },
  remove<T>(orgSlug: string, resource: PigResource, recordId: string) {
    return del<T>(base(orgSlug, `${resource}/${recordId}`));
  },
};
