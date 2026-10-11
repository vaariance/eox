import * as stylex from "@stylexjs/stylex";
import { logoOf } from "./logos";
import { color } from "./tokens.stylex";

const styles = stylex.create({
  coin: {
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    overflow: "hidden",
    backgroundColor: color.accent,
    color: color.onAccent,
    fontWeight: 600,
  },
  image: { display: "block", width: "100%", height: "100%" },
});

export function Coin({ id, size }: { id: string; size: number }) {
  const logo = logoOf(id);
  return (
    <span aria-hidden="true" {...stylex.props(styles.coin)} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {logo ? <img src={logo} alt="" {...stylex.props(styles.image)} /> : id.slice(0, 1)}
    </span>
  );
}
