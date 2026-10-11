"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NETWORKS } from "@/lib/config";

export function NetworkSwitcher() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = NETWORKS.find((network) => network.live) ?? NETWORKS[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Network: ${current.label}`}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 cursor-pointer items-center gap-1.5 rounded-pill border border-line px-3 text-sm transition-colors duration-150 hover:bg-surface-2"
      >
        <span className="h-2 w-2 rounded-full bg-up" aria-hidden="true" />
        {current.label}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-12 z-50 w-56 sm:left-auto sm:right-0 rounded-control border border-line bg-surface p-1 shadow-card">
          {NETWORKS.map((network) => (
            <button
              key={network.id}
              type="button"
              role="menuitemradio"
              aria-checked={network.id === current.id}
              disabled={!network.live}
              onClick={() => setOpen(false)}
              className="flex h-11 w-full items-center justify-between rounded-control px-3 text-left text-sm enabled:cursor-pointer enabled:hover:bg-surface-2 disabled:text-muted"
            >
              <span>{network.label}</span>
              {network.id === current.id ? <Check size={14} aria-hidden="true" /> : <span className="text-xs">Not live yet</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
