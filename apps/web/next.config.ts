import type { NextConfig } from "next";
import { landingDir, stylexBabel } from "./stylex.babel.mjs";

const config: NextConfig = {
  transpilePackages: ["@eox/app-api"],
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    webpackConfig.module.rules.unshift({
      test: /\.tsx?$/,
      include: landingDir,
      enforce: "pre",
      use: [{ loader: "babel-loader", options: stylexBabel }],
    });
    return webpackConfig;
  },
};

export default config;
