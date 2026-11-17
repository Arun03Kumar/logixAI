import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages shipped as TypeScript source.
  transpilePackages: ["@logixai/ui"],
};

export default nextConfig;
