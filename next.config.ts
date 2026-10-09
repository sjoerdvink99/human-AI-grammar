import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = (staticExport && process.env.BASE_PATH) || undefined;

export default function config(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    env: { NEXT_PUBLIC_BASE_PATH: basePath ?? "" },
    ...(staticExport && {
      output: "export",
      basePath,
      trailingSlash: true,
    }),
  };
}
