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

  // A signed-in user has no business on the login page.
  if (isPublic(pathname)) {
    if (
      hasValidToken &&
      (pathname === "/login" ||
        pathname.startsWith("/staff/login") ||
        pathname.startsWith("/staff/loging") ||
        pathname === "/register")
    ) {
      return NextResponse.redirect(new URL("/", request.url));
    }
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
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
