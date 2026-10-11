import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@eox/app-api", "@cox/client"],
  experimental: { externalDir: true },
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return webpackConfig;
  },
};

export default config;
