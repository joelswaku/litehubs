import { del, get, orgUrl, patch, post } from "./api";

/** The complete company-scoped Agriculture API. */
export const AGRICULTURE_RESOURCES = [
  "farms",
  "fields",
  "plots",
  "crops",
  "seasons",
  "plantings",
  "operations",
  "irrigation",
  "fertilizer",
  "pesticides",
  "scouting",
  "weather",
  "harvest",
  "production-targets",
  "losses",
] as const;

export type AgricultureResource = (typeof AGRICULTURE_RESOURCES)[number];
export type AgricultureBody = Record<string, unknown>;
export type AgricultureQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

function queryString(query?: AgricultureQuery) {
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
  return orgUrl(orgSlug, `agriculture/${path}`);
}

export const agricultureApi = {
  overview<T>(orgSlug: string, query?: AgricultureQuery) {
    return get<T>(base(orgSlug, `overview${queryString(query)}`));
  },
  list<T>(
    orgSlug: string,
    resource: AgricultureResource,
    query?: AgricultureQuery,
  ) {
    return get<T>(base(orgSlug, `${resource}${queryString(query)}`));
  },
  get<T>(orgSlug: string, resource: AgricultureResource, recordId: string) {
    return get<T>(base(orgSlug, `${resource}/${recordId}`));
  },
  create<T>(
    orgSlug: string,
    resource: AgricultureResource,
    body: AgricultureBody,
  ) {
    return post<T>(base(orgSlug, resource), body);
  },
  update<T>(
    orgSlug: string,
    resource: AgricultureResource,
    recordId: string,
    body: AgricultureBody,
  ) {
    return patch<T>(base(orgSlug, `${resource}/${recordId}`), body);
  },
  remove<T>(orgSlug: string, resource: AgricultureResource, recordId: string) {
    return del<T>(base(orgSlug, `${resource}/${recordId}`));
  },
};
