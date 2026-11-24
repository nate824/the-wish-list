import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bip322-js", "bitcoinjs-lib"],
};

export default nextConfig;
