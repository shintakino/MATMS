import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.MATMS_NEXT_DIST_DIR ?? ".next",
  typedRoutes: true,
  reactCompiler: true,
  output: "standalone",
  // `pnpm run check-types` is the authoritative, strict workspace type gate.
  // Next 16's TypeScript CLI adapter cannot parse the workspace's TS 6 project
  // references during build, so avoid running a second, incompatible type pass.
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    useTypeScriptCli: false,
  },
  async headers() {
    const revision = process.env.MATMS_RELEASE_SHA;
    if (!revision || !/^[0-9a-f]{40}$/.test(revision)) return [];
    return [{ source: "/:path*", headers: [{ key: "X-MATMS-Release", value: revision }] }];
  },
  async redirects() {
    const origin = process.env.MATMS_CANONICAL_ORIGIN;
    if (process.env.NODE_ENV !== "production" || !origin) return [];

    const canonical = new URL(origin);
    if (canonical.protocol !== "https:") return [];

    // Cloudflare supplies the visitor protocol. Match only the public host so
    // private HTTP health checks remain independent of the tunnel's readiness.
    return [{
      source: "/:path*",
      has: [
        { type: "host", value: canonical.hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") },
        { type: "header", key: "x-forwarded-proto", value: "http" },
      ],
      destination: `${canonical.origin}/:path*`,
      permanent: true,
    }];
  },
  async rewrites() {
    const serverUrl = (process.env.SERVER_URL ?? "http://localhost:3000").replace(/\/$/, "");

    return [
      { source: "/api/health/ready", destination: `${serverUrl}/health/ready` },
      { source: "/api/auth/:path*", destination: `${serverUrl}/api/auth/:path*` },
      { source: "/api/custodial-imports", destination: `${serverUrl}/api/custodial-imports` },
      { source: "/api/inventory-reports/:path*", destination: `${serverUrl}/api/inventory-reports/:path*` },
      { source: "/rpc/:path*", destination: `${serverUrl}/rpc/:path*` },
    ];
  },
};

export default nextConfig;
