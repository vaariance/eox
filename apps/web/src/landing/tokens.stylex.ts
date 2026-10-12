import * as stylex from "@stylexjs/stylex";

export const color = stylex.defineVars({
  bg: "#09090A",
  panel: "#121214",
  disc: "#1C1C1F",
  line: "rgba(255, 255, 255, 0.1)",
  fg: "#F4F4F5",
  muted: "#9A9BA1",
  accent: "#F2622E",
  onAccent: "#FFFFFF",
  ahead: "#F4F4F5",
  behind: "#6B6D73",
});

export const font = stylex.defineConsts({
  mono: 'var(--font-mono), ui-monospace, "SF Mono", Menlo, monospace',
});
