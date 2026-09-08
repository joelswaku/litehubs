import type { PoolClient } from "pg";
import type {
  ActiveMembership,
  AuthenticatedUser,
} from "../modules/auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. Absent on public routes. */
      user?: AuthenticatedUser;

      /**
       * The `org` claim as it arrived, before anything was verified. Present so
       * organization.middleware can fall back to it; handlers should read
       * `organization` instead.
       */
      tokenOrganizationId?: string | null;

      /** Set by `requireOrganization`: the workspace this request acts on. */
      organization?: {
        id: string;
        slug: string;
        displayName: string;
      };

      /** The caller's standing in that workspace, with roles and permissions. */
      membership?: ActiveMembership;

      /**
       * Runs database work in a transaction pinned to the active organization,
       * so row-level security filters it even where a WHERE clause was
       * forgotten. Handlers on tenant routes should use this rather than
       * querying the pool directly.
       */
      tenant?: {
        organizationId: string;
        run<T>(handler: (client: PoolClient) => Promise<T>): Promise<T>;
      };
    }
  }
}
