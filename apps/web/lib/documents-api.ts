import { api, del, get, orgUrl, patch } from "./api";

export type DocumentQuery = Record<string, string | boolean | undefined>;
function queryString(query?: DocumentQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return params.size ? `?${params}` : "";
}
export const documentsApi = {
  list<T>(orgSlug: string, query?: DocumentQuery) {
    return get<T>(orgUrl(orgSlug, `documents${queryString(query)}`));
  },
  summary<T>(orgSlug: string) {
    return get<T>(orgUrl(orgSlug, "documents-summary"));
  },
  async upload<T>(orgSlug: string, form: FormData) {
    const response = await api.post<T>(orgUrl(orgSlug, "documents"), form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },
  update<T>(
    orgSlug: string,
    documentId: string,
    body: Record<string, unknown>,
  ) {
    return patch<T>(orgUrl(orgSlug, `documents/${documentId}`), body);
  },
  remove<T>(orgSlug: string, documentId: string) {
    return del<T>(orgUrl(orgSlug, `documents/${documentId}`));
  },
};
