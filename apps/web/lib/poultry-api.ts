import { del, get, orgUrl, patch, post } from "./api";

/**
 * The complete workspace-facing Poultry API. Screens use React Query for
 * caching and loading state; this module is the one place that owns route
 * construction so a new Poultry feature cannot silently use a wrong tenant
 * URL or bypass the API client.
 */
export const POULTRY_RESOURCES = [
  "houses",
  "flocks",
  "daily-records",
  "mortality",
  "feed",
  "water",
  "weights",
  "eggs",
  "health",
  "vaccinations",
  "treatments",
  "sanitation",
  "biosecurity",
  "production-targets",
  "losses",
] as const;

export type PoultryResource = (typeof POULTRY_RESOURCES)[number];
export type PoultryBody = Record<string, unknown>;
export type PoultryQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

function queryString(query?: PoultryQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function base(orgSlug: string, path: string): string {
  return orgUrl(orgSlug, `poultry/${path}`);
}

export const poultryApi = {
  overview<T>(orgSlug: string, query?: PoultryQuery) {
    return get<T>(base(orgSlug, `overview${queryString(query)}`));
  },

  list<T>(orgSlug: string, resource: PoultryResource, query?: PoultryQuery) {
    return get<T>(base(orgSlug, `${resource}${queryString(query)}`));
  },
  get<T>(orgSlug: string, resource: PoultryResource, recordId: string) {
    return get<T>(base(orgSlug, `${resource}/${recordId}`));
  },
  create<T>(orgSlug: string, resource: PoultryResource, body: PoultryBody) {
    return post<T>(base(orgSlug, resource), body);
  },
  update<T>(
    orgSlug: string,
    resource: PoultryResource,
    recordId: string,
    body: PoultryBody,
  ) {
    return patch<T>(base(orgSlug, `${resource}/${recordId}`), body);
  },
  remove<T>(orgSlug: string, resource: PoultryResource, recordId: string) {
    return del<T>(base(orgSlug, `${resource}/${recordId}`));
  },

  climateProfiles: {
    list<T>(orgSlug: string) {
      return get<T>(base(orgSlug, "climate-profiles"));
    },
    get<T>(orgSlug: string, climateProfileId: string) {
      return get<T>(base(orgSlug, `climate-profiles/${climateProfileId}`));
    },
    create<T>(orgSlug: string, body: PoultryBody) {
      return post<T>(base(orgSlug, "climate-profiles"), body);
    },
    update<T>(orgSlug: string, climateProfileId: string, body: PoultryBody) {
      return patch<T>(
        base(orgSlug, `climate-profiles/${climateProfileId}`),
        body,
      );
    },
    remove<T>(orgSlug: string, climateProfileId: string) {
      return del<T>(base(orgSlug, `climate-profiles/${climateProfileId}`));
    },
  },

  performanceModels: {
    list<T>(orgSlug: string) {
      return get<T>(base(orgSlug, "performance-models"));
    },
    get<T>(orgSlug: string, modelId: string) {
      return get<T>(base(orgSlug, `performance-models/${modelId}`));
    },
    create<T>(orgSlug: string, body: PoultryBody) {
      return post<T>(base(orgSlug, "performance-models"), body);
    },
    update<T>(orgSlug: string, modelId: string, body: PoultryBody) {
      return patch<T>(base(orgSlug, `performance-models/${modelId}`), body);
    },
    remove<T>(orgSlug: string, modelId: string) {
      return del<T>(base(orgSlug, `performance-models/${modelId}`));
    },
    targets: {
      list<T>(orgSlug: string, modelId: string) {
        return get<T>(
          base(orgSlug, `performance-models/${modelId}/weekly-targets`),
        );
      },
      create<T>(orgSlug: string, modelId: string, body: PoultryBody) {
        return post<T>(
          base(orgSlug, `performance-models/${modelId}/weekly-targets`),
          body,
        );
      },
      update<T>(
        orgSlug: string,
        modelId: string,
        targetId: string,
        body: PoultryBody,
      ) {
        return patch<T>(
          base(
            orgSlug,
            `performance-models/${modelId}/weekly-targets/${targetId}`,
          ),
          body,
        );
      },
      remove<T>(orgSlug: string, modelId: string, targetId: string) {
        return del<T>(
          base(
            orgSlug,
            `performance-models/${modelId}/weekly-targets/${targetId}`,
          ),
        );
      },
    },
    vaccineSchedules: {
      list<T>(orgSlug: string, modelId: string) {
        return get<T>(
          base(orgSlug, `performance-models/${modelId}/vaccine-schedules`),
        );
      },
      create<T>(orgSlug: string, modelId: string, body: PoultryBody) {
        return post<T>(
          base(orgSlug, `performance-models/${modelId}/vaccine-schedules`),
          body,
        );
      },
      update<T>(
        orgSlug: string,
        modelId: string,
        scheduleId: string,
        body: PoultryBody,
      ) {
        return patch<T>(
          base(
            orgSlug,
            `performance-models/${modelId}/vaccine-schedules/${scheduleId}`,
          ),
          body,
        );
      },
      remove<T>(orgSlug: string, modelId: string, scheduleId: string) {
        return del<T>(
          base(
            orgSlug,
            `performance-models/${modelId}/vaccine-schedules/${scheduleId}`,
          ),
        );
      },
    },
  },

  flockPerformance<T>(orgSlug: string, flockId: string, query?: PoultryQuery) {
    return get<T>(
      base(orgSlug, `flocks/${flockId}/performance${queryString(query)}`),
    );
  },
  dailyWork: {
    mine<T>(orgSlug: string, query?: PoultryQuery) {
      return get<T>(base(orgSlug, `daily-work/mine${queryString(query)}`));
    },
    list<T>(orgSlug: string, flockId: string, query?: PoultryQuery) {
      return get<T>(
        base(orgSlug, `flocks/${flockId}/daily-work${queryString(query)}`),
      );
    },
    create<T>(orgSlug: string, flockId: string, body: PoultryBody) {
      return post<T>(base(orgSlug, `flocks/${flockId}/daily-work`), body);
    },
    generate<T>(orgSlug: string, flockId: string, body: PoultryBody) {
      return post<T>(
        base(orgSlug, `flocks/${flockId}/daily-work/generate`),
        body,
      );
    },
    update<T>(orgSlug: string, workItemId: string, body: PoultryBody) {
      return patch<T>(base(orgSlug, `daily-work/${workItemId}`), body);
    },
    review<T>(orgSlug: string, workItemId: string, body: PoultryBody) {
      return post<T>(base(orgSlug, `daily-work/${workItemId}/review`), body);
    },
  },
};
