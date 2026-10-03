import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { ACCESS_COOKIE, PUBLIC_PATHS } from "@/lib/constants";

/**
 * Edge guard. Keeps a signed-out visitor from ever reaching a dashboard route.
 *
 * Named `proxy` in `proxy.ts`: Next 16 renamed the edge interceptor, and
 * `middleware.ts` is now only a legacy alias. Next resolves either, so keeping
 * both files would be ambiguous — structure.md still says `middleware.ts`,
 * which predates the rename.
 *
 * What this is and is not:
 *
 * **It is** a redirect, so nobody sees a shell flash before being bounced to
 * login. Doing that in a client component means rendering the layout first.
 *
 * **It is not** authorization. It only asks "is there a plausibly valid token".
 * Whether this person may read *this workspace's* data is decided by the API on
 * every request, backed by row-level security. Someone editing the org slug in
 * the URL gets a 404 from the API, not data — the check below neither knows nor
 * needs to know which workspaces they belong to.
 *
 * Verifying the signature here rather than just checking the cookie exists
 * means a forged or expired cookie is caught before any page work happens. An
 * expired token still redirects to login, where the client can refresh — the
 * API's refresh flow handles the routine 15-minute expiry.
 */

const encoder = new TextEncoder();

function requestedCustomDomain(request: NextRequest): string | null {
  const rawHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = rawHost?.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  // Congo Omega is an independently branded public website.  Its DNS points
  // to the same web service as LiteHubs, so it must be identified by hostname
  // before looking at the service's own public URL.  This keeps a production
  // `NEXT_PUBLIC_SITE_URL=https://congoomega.com` configuration from ever
  // rendering the LiteHubs product landing at the Congo Omega domain.
  if (host === "congoomega.com" || host === "www.congoomega.com") {
    return "congoomega.com";
  }
  const primary = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://litehubs.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  // Keep the LiteHubs application, local development and internal rewrites on
  // their normal routes. Every other syntactically safe host is verified by the
  // API before any public content is returned.
  // Railway sends health checks through an internal or service hostname. Those
  // hosts are infrastructure, not public customer domains: routing them into
  // the website builder would make a healthy `/login` check look like an
  // unknown public site and prevent an otherwise valid release from starting.
  const isInfrastructureHost =
    host.endsWith(".railway.app") ||
    host.endsWith(".railway.internal") ||
    host.endsWith(".railway.local");
  if (
    !host ||
    host === "localhost" ||
    host === primary ||
    host === `www.${primary}` ||
    host.endsWith(".localhost") ||
    isInfrastructureHost
  ) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  return host.replace(/^www\./, "");
}

function secret(): Uint8Array | null {
  const value = process.env.JWT_SECRET;
  return value ? encoder.encode(value) : null;
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(ACCESS_COOKIE)?.value;

  const customDomain = requestedCustomDomain(request);
  // A customer who visits Congo Omega's public domain is never sent to the
  // LiteHubs workforce sign-in.  Keep old bookmarks and typed /login URLs in
  // the isolated customer journey instead; staff sign in only on LiteHubs.
  const isWorkforceAccessPath =
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/accept-invitation" ||
    pathname === "/staff" ||
    pathname.startsWith("/staff/") ||
    pathname === "/select-organization" ||
    pathname === "/platform" ||
    pathname.startsWith("/platform/");
  if (customDomain && isWorkforceAccessPath) {
    return NextResponse.redirect(new URL("/account", request.url), 307);
  }
  // Congo Omega previously used WordPress.  Visitors may still follow an old
  // wp-admin or wp-login bookmark; it must never be mistaken for a LiteHubs
  // dashboard route and send them to the workspace sign-in screen.  Bring
  // those obsolete paths back to the company home page instead.
  const isLegacyWordPressPath = /^(?:\/wp-admin(?:\/|$)|\/wp-login\.php$|\/wp-content(?:\/|$)|\/wp-includes(?:\/|$)|\/xmlrpc\.php$)/i.test(pathname);
  if (customDomain && isLegacyWordPressPath) {
    return NextResponse.redirect(new URL("/", request.url), 308);
  }
  // Recruitment and appointment booking are real public application routes,
  // not website-builder pages. Keep them reachable from the company domain;
  // their own route then scopes the request to the organisation.
  const isPublicCompanyService =
    pathname.startsWith("/careers/") ||
    pathname === "/rendezvous" ||
    pathname === "/rendez-vous" ||
    pathname.startsWith("/book/");
  if (customDomain && !pathname.startsWith("/site-by-domain/") && !isPublicCompanyService) {
    const route = `/site-by-domain/${encodeURIComponent(customDomain)}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(new URL(route, request.url));
  }

  let hasValidToken = false;
  if (token) {
    const key = secret();
    if (key) {
      try {
        await jwtVerify(token, key, {
          issuer: "litehubs",
          audience: "litehubs-api",
        });
        hasValidToken = true;
      } catch {
        // Expired or forged. Treated as signed out; the client refreshes if it
        // can, and the API is the one that decides either way.
      }
    } else {
      // Without JWT_SECRET the edge cannot verify anything. Falling back to
      // "cookie present" keeps the app usable in a misconfigured environment
      // while the API continues to do the real check.
      hasValidToken = true;
    }
  }

  // Always leave a sign-in page reachable. A browser can retain a valid-looking
  // access cookie after its server session has expired or been revoked. Sending
  // that visitor away from /login would create a redirect loop that can only be
  // escaped by deleting browser data. The login form safely replaces any stale
  // session with a fresh one after successful authentication.
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  if (!hasValidToken) {
    const login = new URL("/login", request.url);
    // So an expired session returns the user to where they were.
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Skips the API rewrite, static assets and Next internals.
   *
   * `/api` in particular must not be guarded here: the login and refresh calls
   * are how a session is obtained in the first place, and guarding them would
   * make signing in impossible.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|robots\\.txt|sitemap\\.xml|site\\.webmanifest|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
