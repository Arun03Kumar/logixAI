import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages shipped as TypeScript source.
  transpilePackages: ["@logixai/ui"],
  // `next build` also writes .next/standalone: a minimal server with only the
  // files it needs, used by the Docker image (deploy/docker/web.Dockerfile).
  output: "standalone",
  // Trace files from the monorepo root so workspace packages are included.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
};

export default nextConfig;
