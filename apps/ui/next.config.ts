import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // output: "standalone" -- disabled on Windows (symlink EPERM), re-enable for Docker/CI
  output: process.env.NEXT_OUTPUT_MODE === "standalone" ? "standalone" : undefined
};

export default nextConfig;
