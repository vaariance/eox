import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const browserCrypto = local("./src/lib/browser-crypto.ts");
const anchorDefault = local("./src/lib/anchor-default.ts");

const config: NextConfig = {
  transpilePackages: ["@eox/app-api", "@cox/client"],
  webpack(webpackConfig, { isServer, webpack }) {
    webpackConfig.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    webpackConfig.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^@coral-xyz\/anchor$/, (resource: { context: string; request: string }) => {
        if (resource.context.includes("cox-client")) resource.request = anchorDefault;
      }),
    );
    if (!isServer) webpackConfig.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, browserCrypto));
    return webpackConfig;
  },
};

export default config;
