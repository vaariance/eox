"use client";

import * as stylex from "@stylexjs/stylex";
import { useCoinLogo } from "@/components/coin-icon";
import { localLogo } from "./logos";
import { color } from "./tokens.stylex";

const styles = stylex.create({
  coin: {
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    overflow: "hidden",
    backgroundColor: color.disc,
    color: color.fg,
    fontWeight: 600,
  },
  image: { display: "block", width: "100%", height: "100%", objectFit: "cover" },
  round: { clipPath: "circle(50%)" },
});

export function CoinFace({ id }: { id: string }) {
  const { source, fail } = useCoinLogo(id, localLogo(id));
  return source ? <img key={source} src={source} alt="" referrerPolicy="no-referrer" onError={fail} {...stylex.props(styles.image)} /> : <>{id.slice(0, 1)}</>;
}

export function Coin({ id, size }: { id: string; size: number }) {
  return (
    <span aria-hidden="true" {...stylex.props(styles.coin)} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      <CoinFace id={id} />
    </span>
  );
}

export function CoinNode({ id, x, y }: { id: string; x: number; y: number }) {
  const { source, fail } = useCoinLogo(id, localLogo(id));
  return (
    <g>
      <circle cx={x} cy={y} r="27" fill="#151517" stroke="rgba(255, 255, 255, 0.16)" />
      {source ? (
        <image key={source} href={source} x={x - 16} y={y - 16} width="32" height="32" preserveAspectRatio="xMidYMid slice" onError={fail} {...stylex.props(styles.round)} />
      ) : (
        <>
          <circle cx={x} cy={y} r="16" fill="#F2622E" />
          <text x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#FFFFFF">{id.slice(0, 1)}</text>
        </>
      )}
    </g>
  );
}
