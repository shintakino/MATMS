import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  async rewrites() {
    const serverUrl = (process.env.SERVER_URL ?? "http://localhost:3000").replace(/\/$/, "");

    return [
      { source: "/api/auth/:path*", destination: `${serverUrl}/api/auth/:path*` },
      { source: "/rpc/:path*", destination: `${serverUrl}/rpc/:path*` },
    ];
  },
};

export default nextConfig;
