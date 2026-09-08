import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { API_PREFIX, ORGANIZATION_SLUG_HEADER } from "./constants";

/**
 * The single HTTP client for both dashboards.
 *
 * Three things it takes care of, each of which would otherwise be repeated at
 * every call site and eventually forgotten in one of them:
 *
 * 1. **Cookies travel.** `withCredentials` plus the same-origin rewrite in
 *    next.config.ts means the API's httpOnly cookies work normally. The access
 *    token is never read by JavaScript, so an XSS cannot steal it.
 *
 * 2. **The active workspace is named on every request.** The API resolves the
 *    workspace from the path, then a header, then the token claim. The header is
 *    what makes a request unambiguous, and it is attached here rather than by
 *    each caller.
 *
 * 3. **A 401 is retried once, after refreshing.** Access tokens live 15 minutes,
 *    so this fires routinely. Concurrent 401s share one refresh — otherwise ten
 *    parallel widget requests would fire ten refreshes, and since the API
 *    rotates refresh tokens and treats a reused one as a leak, nine of them
 *    would look like an attack and drop every session.
 */

/** The workspace the app is currently showing. Set by the workspace layout. */
let activeOrganizationSlug: string | null = null;

export function setActiveOrganizationSlug(slug: string | null): void {
  activeOrganizationSlug = slug;
}

export function getActiveOrganizationSlug(): string | null {
  return activeOrganizationSlug;
}

/** Called when refreshing fails, so the app can send the user to log in. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * A failed request, already unwrapped from the API's `{ error: {...} }` body.
 *
 * Carrying `code` and `details` matters: the API returns machine-readable codes
 * and field-level validation issues, and a UI that only shows `message` throws
 * away the information needed to highlight the offending field.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, error: ApiErrorShape) {
    super(error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }

  /** Field name → messages, for wiring straight into react-hook-form. */
  get fieldErrors(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    const add = (field: unknown, message: unknown) => {
      const key = String(field ?? "").trim();
      const text = String(message ?? "").trim();
      if (key && text) (result[key] ??= []).push(text);
    };

    if (Array.isArray(this.details)) {
      for (const issue of this.details) {
        if (
          typeof issue === "object" &&
          issue !== null &&
          "field" in issue &&
          "message" in issue
        )
          add(
            (issue as { field: unknown }).field,
            (issue as { message: unknown }).message,
          );
      }
    } else if (
      typeof this.details === "object" &&
      this.details !== null &&
      "field" in this.details
    ) {
      // AppErrors commonly provide `{ field: "dueDate" }`; their useful text
      // is the API error message itself.
      add((this.details as { field: unknown }).field, this.message);
    }

    return result;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** True when the caller has no workspace selected — show the picker, not an error. */
  get needsWorkspace(): boolean {
    return (
      typeof this.details === "object" &&
      this.details !== null &&
      "reason" in this.details &&
      (this.details as { reason?: unknown }).reason === "no_active_organization"
    );
  }
}

function toApiError(error: AxiosError): ApiError {
  const status = error.response?.status ?? 0;
  const body = error.response?.data as { error?: ApiErrorShape } | undefined;

  if (body?.error) return new ApiError(status, body.error);

  // No response at all: the request never reached the API.
  if (!error.response) {
    return new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Could not reach the server. Check your connection.",
    });
  }

  return new ApiError(status, {
    code: "UNEXPECTED_ERROR",
    message: error.message || "Something went wrong.",
  });
}

export const api: AxiosInstance = axios.create({
  baseURL: API_PREFIX,
  withCredentials: true,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // Only when the path does not already name the workspace — a path slug is
  // more specific and the API prefers it anyway.
  const alreadyInPath = config.url?.includes("/organizations/");
  if (activeOrganizationSlug && !alreadyInPath) {
    config.headers.set(ORGANIZATION_SLUG_HEADER, activeOrganizationSlug);
  }
  return config;
});

/**
 * Shared across concurrent 401s. The first failure starts a refresh; the rest
 * await the same promise instead of starting their own.
 */
let refreshInFlight: Promise<void> | null = null;

async function refreshSession(): Promise<void> {
  refreshInFlight ??= (async () => {
    try {
      await axios.post(
        `${API_PREFIX}/auth/refresh`,
        // Tells the API which workspace to point the new token at; a refresh
        // token belongs to a person, not a workspace.
        activeOrganizationSlug
          ? { organizationSlug: activeOrganizationSlug }
          : {},
        { withCredentials: true },
      );
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/** Marker so a retried request cannot loop. */
interface RetryableConfig extends AxiosRequestConfig {
  _retried?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const status = error.response?.status;

    const isRefreshCall = config?.url?.includes("/auth/refresh");
    // These public authentication calls deliberately return 401/423 when a
    // password or invitation token is wrong. They must show that error in the
    // current form, never trigger a token refresh or a redirect to /login.
    const isSessionFreeAuthCall = [
      "/auth/login",
      "/auth/staff-login",
      "/auth/register",
      "/auth/forgot-password",
      "/auth/reset-password",
      "/auth/accept-invitation",
    ].some((path) => config?.url?.includes(path));
    const shouldRefresh =
      status === 401 &&
      config &&
      !config._retried &&
      !isRefreshCall &&
      !isSessionFreeAuthCall;

    if (shouldRefresh) {
      config._retried = true;
      try {
        await refreshSession();
        return api.request(config);
      } catch {
        // The refresh token is gone or was rejected. Nothing left to try.
        onSessionExpired?.();
        throw toApiError(error);
      }
    }

    throw toApiError(error);
  },
);

/* ------------------------------------------------------------------ helpers -- */
/* Thin wrappers so callers deal in data and ApiError, never in AxiosResponse.  */

export async function get<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await api.get<T>(url, config);
  return response.data;
}

export async function post<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await api.post<T>(url, body, config);
  return response.data;
}

export async function patch<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await api.patch<T>(url, body, config);
  return response.data;
}

export async function put<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await api.put<T>(url, body, config);
  return response.data;
}

export async function del<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await api.delete<T>(url, config);
  return response.data;
}

/** Builds a workspace-scoped path: `orgUrl("congo-omega", "employees")`. */
export function orgUrl(slug: string, path: string): string {
  return `/organizations/${slug}/${path.replace(/^\//, "")}`;
}

/**
 * Browser links do not use Axios, so they must include the API prefix
 * themselves. Use this for previews/downloads; use orgUrl with the API client.
 */
export function orgApiUrl(slug: string, path: string): string {
  return `${API_PREFIX}${orgUrl(slug, path)}`;
}
