import { del, get, orgUrl, patch, post, put } from "./api";

export type DailyWorkBody = Record<string, unknown>;
export type DailyWorkQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

function queryString(query?: DailyWorkQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "")
      params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

function base(orgSlug: string, path: string): string {
  return orgUrl(orgSlug, `daily-work/${path}`);
}

/** Every company Daily Work endpoint used by the workspace application. */
export const dailyWorkApi = {
  overview<T>(orgSlug: string, query?: DailyWorkQuery) {
    return get<T>(base(orgSlug, `overview${queryString(query)}`));
  },
  templates: {
    list<T>(orgSlug: string, query?: DailyWorkQuery) {
      return get<T>(base(orgSlug, `templates${queryString(query)}`));
    },
    create<T>(orgSlug: string, body: DailyWorkBody) {
      return post<T>(base(orgSlug, "templates"), body);
    },
    update<T>(orgSlug: string, templateId: string, body: DailyWorkBody) {
      return patch<T>(base(orgSlug, `templates/${templateId}`), body);
    },
    remove<T>(orgSlug: string, templateId: string) {
      return del<T>(base(orgSlug, `templates/${templateId}`));
    },
    items: {
      create<T>(orgSlug: string, templateId: string, body: DailyWorkBody) {
        return post<T>(base(orgSlug, `templates/${templateId}/items`), body);
      },
      update<T>(
        orgSlug: string,
        templateId: string,
        itemId: string,
        body: DailyWorkBody,
      ) {
        return patch<T>(
          base(orgSlug, `templates/${templateId}/items/${itemId}`),
          body,
        );
      },
      remove<T>(orgSlug: string, templateId: string, itemId: string) {
        return del<T>(base(orgSlug, `templates/${templateId}/items/${itemId}`));
      },
    },
  },
  runs: {
    list<T>(orgSlug: string, query?: DailyWorkQuery) {
      return get<T>(base(orgSlug, `runs${queryString(query)}`));
    },
    create<T>(orgSlug: string, body: DailyWorkBody) {
      return post<T>(base(orgSlug, "runs"), body);
    },
    get<T>(orgSlug: string, runId: string) {
      return get<T>(base(orgSlug, `runs/${runId}`));
    },
    answerItem<T>(
      orgSlug: string,
      runId: string,
      itemId: string,
      body: DailyWorkBody,
    ) {
      return put<T>(
        base(orgSlug, `runs/${runId}/items/${itemId}/response`),
        body,
      );
    },
    complete<T>(orgSlug: string, runId: string) {
      return post<T>(base(orgSlug, `runs/${runId}/complete`));
    },
    verify<T>(orgSlug: string, runId: string) {
      return post<T>(base(orgSlug, `runs/${runId}/verify`));
    },
  },
  reports: {
    list<T>(orgSlug: string, query?: DailyWorkQuery) {
      return get<T>(base(orgSlug, `reports${queryString(query)}`));
    },
    create<T>(orgSlug: string, body: DailyWorkBody) {
      return post<T>(base(orgSlug, "reports"), body);
    },
    update<T>(orgSlug: string, reportId: string, body: DailyWorkBody) {
      return patch<T>(base(orgSlug, `reports/${reportId}`), body);
    },
    review<T>(orgSlug: string, reportId: string, body: DailyWorkBody) {
      return post<T>(base(orgSlug, `reports/${reportId}/review`), body);
    },
  },
  handovers: {
    list<T>(orgSlug: string, query?: DailyWorkQuery) {
      return get<T>(base(orgSlug, `handovers${queryString(query)}`));
    },
    create<T>(orgSlug: string, body: DailyWorkBody) {
      return post<T>(base(orgSlug, "handovers"), body);
    },
    acknowledge<T>(orgSlug: string, handoverId: string) {
      return post<T>(base(orgSlug, `handovers/${handoverId}/acknowledge`));
    },
  },
};
