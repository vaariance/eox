"use client";

import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";

const NARROW = "@media (max-width: 860px)";
const STILL = "@media (prefers-reduced-motion: reduce)";
const CELL = 72;
const GLOW = 620;
const EASE = 0.07;
const IDLE_AFTER = 2500;

const drift = stylex.keyframes({
  from: { backgroundPosition: "0 0" },
  to: { backgroundPosition: `${CELL}px ${CELL}px` },
});

const LINES =
  "linear-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.07) 1px, transparent 1px)";
const BRIGHT =
  "linear-gradient(rgba(242, 98, 46, 0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(242, 98, 46, 0.55) 1px, transparent 1px)";

const styles = stylex.create({
  frame: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: { default: 760, [NARROW]: 600 },
    overflow: "hidden",
    pointerEvents: "none",
    maskImage: "radial-gradient(ellipse 70% 75% at 50% 45%, #000 0%, transparent 100%)",
  },
  grid: {
    position: "absolute",
    inset: 0,
    backgroundImage: LINES,
    backgroundSize: `${CELL}px ${CELL}px`,
    animationName: { default: drift, [STILL]: "none" },
    animationDuration: "14s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  lit: {
    backgroundImage: BRIGHT,
    maskImage: "radial-gradient(circle 240px at var(--x, 50%) var(--y, 45%), #000 0%, transparent 100%)",
  },
  glow: {
    position: "absolute",
    top: 0,
    left: 0,
    width: GLOW,
    height: GLOW,
    translate: "calc(var(--x, 50vw) - 50%) calc(var(--y, 340px) - 50%)",
    backgroundImage: "radial-gradient(closest-side, rgba(242, 98, 46, 0.24), transparent)",
    filter: "blur(30px)",
  },
});

export function HeroBackdrop() {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let box = node.getBoundingClientRect();
    let x = box.width / 2;
    let y = box.height * 0.45;
    let pointer: { x: number; y: number } | null = null;
    let moved = 0;
    let visible = true;
    let handle = 0;

    const measure = () => {
      box = node.getBoundingClientRect();
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      measure();
      const inside = event.clientY >= box.top && event.clientY <= box.bottom;
      pointer = inside ? { x: event.clientX - box.left, y: event.clientY - box.top } : null;
      moved = performance.now();
    };

    const tick = (now: number) => {
      const following = pointer !== null && now - moved < IDLE_AFTER;
      const angle = now / 5200;
      const targetX = following && pointer ? pointer.x : box.width * (0.5 + 0.2 * Math.cos(angle));
      const targetY = following && pointer ? pointer.y : box.height * (0.45 + 0.1 * Math.sin(angle * 1.3));
      x += (targetX - x) * EASE;
      y += (targetY - y) * EASE;
      node.style.setProperty("--x", `${x.toFixed(1)}px`);
      node.style.setProperty("--y", `${y.toFixed(1)}px`);
      if (visible) handle = requestAnimationFrame(tick);
    };

    const watcher = new IntersectionObserver(([entry]) => {
      const next = entry.isIntersecting;
      if (next && !visible) handle = requestAnimationFrame(tick);
      visible = next;
    });

    watcher.observe(node);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("resize", measure);
    handle = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(handle);
      watcher.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div ref={frame} aria-hidden="true" {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.glow)} />
      <div {...stylex.props(styles.grid)} />
      <div {...stylex.props(styles.grid, styles.lit)} />
    </div>
  );
}
