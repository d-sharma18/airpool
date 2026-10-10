import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray lockfile in the home folder otherwise confuses Next's workspace detection.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
