import { stylexBabel } from "./stylex.babel.mjs";

export default {
  plugins: {
    "@tailwindcss/postcss": {},
    "@stylexjs/postcss-plugin": {
      include: ["src/landing/**/*.{ts,tsx}"],
      useCSSLayers: false,
      babelConfig: stylexBabel,
    },
  },
};
