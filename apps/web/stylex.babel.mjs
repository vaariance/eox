import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export const landingDir = path.join(root, "src/landing");

export const stylexBabel = {
  babelrc: false,
  configFile: false,
  parserOpts: { plugins: ["typescript", "jsx"] },
  plugins: [
    [
      "@stylexjs/babel-plugin",
      {
        dev: false,
        runtimeInjection: false,
        treeshakeCompensation: true,
        aliases: { "@/*": [path.join(root, "src/*")] },
        unstable_moduleResolution: { type: "commonJS", rootDir: root },
      },
    ],
  ],
};
