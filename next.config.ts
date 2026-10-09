import type { NextConfig } from "next";

const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(staticExport && {
    output: "export",
    basePath: process.env.BASE_PATH || undefined,
    trailingSlash: true,
  }),
};

export default nextConfig;
