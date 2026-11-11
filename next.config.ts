import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["xlsx", "@paypal/agent-toolkit"],
};

export default nextConfig;
