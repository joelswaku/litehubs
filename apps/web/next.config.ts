import type { NextConfig } from "next";

/**
 * The file was empty, which meant none of this was in force.
 *
 * The rewrite is the important part: the browser talks to `/api/v1/...` on its
 * own origin and Next forwards it to the API. Without it the dashboard is a
 * cross-origin client, which means CORS on every request and — worse — the
 * httpOnly auth cookies the API sets would be third-party cookies and silently
 * dropped by Safari and by Chrome's tightening defaults. Same-origin keeps the
 * cookie flow working as designed.
 */
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:5000";

const nextConfig: NextConfig = {
  // Lets the production image include only the files the Next.js server needs.
  // This is particularly important for a monorepo deployment, where copying
  // the whole development workspace would make the web service needlessly
  // large and slow to start.
  output: "standalone",
  reactStrictMode: true,

  // Next's dev overlay badge sits bottom-left, directly on top of the
  // sidebar footer — it covered the signed-in user's name. It is a
  // development-only element, so turning it off costs nothing.
  devIndicators: false,

  // Fail the build on a type error rather than shipping one. Next's default
  // already does this; stated explicitly so nobody "temporarily" flips it.
  // (Next 16 dropped the `eslint` key from this config — linting is its own
  // step now, run by `npm run lint`.)
  typescript: { ignoreBuildErrors: false },

  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The dashboard is never framed; this blocks clickjacking outright.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // A workspace URL contains a customer's slug; keep it out of
          // third-party referers.
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },

  experimental: {
    // Trims the client bundle for the two libraries with the largest surface.
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default nextConfig;
