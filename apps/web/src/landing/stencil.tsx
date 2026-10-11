import * as stylex from "@stylexjs/stylex";
import { stencilPath } from "./stencil-glyphs";

const WEIGHT = 1;
const GAP = 0.34;
const HEIGHT = 7;

const styles = stylex.create({
  block: { display: "flex", flexDirection: "column", gap: "0.16em" },
  center: { alignItems: "center" },
  start: { alignItems: "flex-start" },
  end: { alignItems: "flex-end" },
  line: { display: "block", height: "1em", width: "auto", maxWidth: "100%", overflow: "visible" },
  fill: { display: "block", width: "100%", height: "auto", overflow: "visible" },
});

export function Stencil({ lines, align = "center", fill, tones }: { lines: string[]; align?: "center" | "start" | "end"; fill?: boolean; tones?: Array<string | undefined> }) {
  return (
    <span role="img" aria-label={lines.join(" ")} {...stylex.props(styles.block, styles[align])}>
      {lines.map((text, index) => {
        const { path, width } = stencilPath(text, WEIGHT, GAP);
        return (
          <svg key={text} aria-hidden="true" viewBox={`-0.5 -0.5 ${width + 1} ${HEIGHT}`} {...stylex.props(fill ? styles.fill : styles.line)}>
            <path d={path} fill="none" stroke={tones?.[index] ?? "currentColor"} strokeWidth={WEIGHT} />
          </svg>
        );
      })}
    </span>
  );
}
