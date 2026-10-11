"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type TreeNavItem = { label: string; href: string; badge?: string };

const ROW = 36;
const MARKER = 7;
const RAIL = 10;
const GLIDE = "220ms";
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

const moving = { transitionProperty: "transform, opacity", transitionDuration: `var(--glide, ${GLIDE}), 120ms`, transitionTimingFunction: `${EASE}, ease-out` };

export function TreeNav({ items, activeHref, className = "" }: { items: TreeNavItem[]; activeHref?: string; className?: string }) {
  const list = useRef<HTMLUListElement>(null);
  const rows = useRef<Array<HTMLLIElement | null>>([]);
  const centers = useRef<number[]>([]);
  const hovered = useRef<number | null>(null);
  const shown = useRef(false);
  const activeIndex = items.findIndex((item) => item.href === activeHref);
  const active = useRef(activeIndex);
  const [end, setEnd] = useState(0);
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    active.current = activeIndex;
  });

  const moveTo = useCallback((index: number | null, immediate = false) => {
    const node = list.current;
    if (!node) return;
    const target = index === null ? undefined : centers.current[index];
    if (target === undefined) {
      node.style.setProperty("--on", "0");
      shown.current = false;
      return;
    }
    const last = centers.current[centers.current.length - 1] || 1;
    const jump = immediate || !shown.current;
    if (jump) node.style.setProperty("--glide", "0ms");
    node.style.setProperty("--y", `${target}px`);
    node.style.setProperty("--run", String(Math.min(1, target / last)));
    node.style.setProperty("--on", "1");
    if (jump) {
      node.getBoundingClientRect();
      node.style.removeProperty("--glide");
    }
    shown.current = true;
  }, []);

  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => {
      const next = rows.current.slice(0, items.length).map((row) => (row ? row.offsetTop + row.offsetHeight / 2 : 0));
      centers.current = next;
      setEnd(next.length > 0 ? next[next.length - 1] : 0);
      setMeasured(true);
      moveTo(hovered.current ?? (active.current >= 0 ? active.current : null), true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length, moveTo]);

  useEffect(() => {
    if (hovered.current === null) moveTo(activeIndex >= 0 ? activeIndex : null);
  }, [activeIndex, moveTo]);

  const enter = (index: number) => {
    hovered.current = index;
    moveTo(index);
  };
  const leave = () => {
    hovered.current = null;
    moveTo(active.current >= 0 ? active.current : null);
  };

  return (
    <ul ref={list} className={`relative flex flex-col gap-0.5 ps-6 ${className}`} onPointerLeave={leave}>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-0 w-5">
        <span className="absolute top-0 w-px bg-line" style={{ insetInlineStart: RAIL - 0.5, height: end }} />
        <span className="absolute size-1 rounded-full bg-muted/50" style={{ insetInlineStart: RAIL - 2, top: end - 2 }} />
        <span
          className="absolute top-0 w-px origin-top bg-accent will-change-transform"
          style={{ insetInlineStart: RAIL - 0.5, height: end, transform: "scaleY(var(--run, 0))", opacity: "var(--on, 0)", ...moving }}
        />
        <span
          className="absolute top-0 rounded-[1px] bg-accent will-change-transform"
          style={{
            insetInlineStart: RAIL - MARKER / 2,
            width: MARKER,
            height: MARKER,
            transform: `translateY(calc(var(--y, 0px) - ${MARKER / 2}px)) rotate(45deg)`,
            opacity: "var(--on, 0)",
            ...moving,
          }}
        />
      </span>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute end-0 start-6 top-0 rounded-control bg-surface-2 will-change-transform"
        style={{ height: ROW, transform: `translateY(calc(var(--y, 0px) - ${ROW / 2}px))`, opacity: "var(--on, 0)", ...moving }}
      />

      {items.map((item, index) => {
        const current = index === activeIndex;
        return (
          <li
            key={item.href}
            ref={(row) => {
              rows.current[index] = row;
            }}
            className="relative"
            onPointerEnter={() => enter(index)}
          >
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              onFocus={() => enter(index)}
              onBlur={leave}
              className={`flex items-center gap-2 rounded-control px-3 text-[13px] transition-colors duration-150 ease-out ${
                current && !measured ? "bg-surface-2" : ""
              } ${current ? "font-medium text-ink" : "text-muted hover:text-ink"}`}
              style={{ height: ROW }}
            >
              <span className="truncate">{item.label}</span>
              {item.badge && <span className="inline-flex h-[18px] shrink-0 items-center rounded-md bg-accent/15 px-1.5 text-[11px] font-medium leading-none text-accent">{item.badge}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
