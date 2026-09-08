import { RootRedirect } from "./root-redirect";

/**
 * `/` decides where a signed-in user belongs, which depends on their session:
 * their one workspace, a picker if several, or the staff console.
 *
 * That decision needs the session, and the session lives in httpOnly cookies
 * the API reads — so it happens on the client, after /auth/me answers. The edge
 * middleware has already established that *some* valid token exists; this only
 * routes.
 */
export default function RootPage() {
  return <RootRedirect />;
}
