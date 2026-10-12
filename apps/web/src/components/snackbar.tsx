"use client";

import { CircleAlert, CircleCheck, X } from "lucide-react";
import Link from "next/link";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const SHOWN_MS = 8000;

export interface Snack {
  tone: "good" | "bad";
  title: string;
  text?: string;
  link?: { href: string; label: string; external?: boolean };
}

interface Snackbar {
  show: (snack: Snack) => void;
  fail: (text: string, title?: string) => void;
}

const SnackbarContext = createContext<Snackbar>({ show: () => undefined, fail: () => undefined });

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(Snack & { key: number }) | null>(null);

  const show = useCallback((snack: Snack) => setCurrent({ ...snack, key: Date.now() }), []);
  const fail = useCallback((text: string, title = "That did not work") => show({ tone: "bad", title, text }), [show]);
  const value = useMemo(() => ({ show, fail }), [show, fail]);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setCurrent(null), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [current]);

  const Icon = current?.tone === "bad" ? CircleAlert : CircleCheck;

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
        {current && (
          <div key={current.key} role={current.tone === "bad" ? "alert" : "status"} className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-card border border-line bg-surface-2 p-4 shadow-[0_16px_40px_rgb(0_0_0/0.5)]">
            <Icon size={18} className={`mt-0.5 shrink-0 ${current.tone === "bad" ? "text-down" : "text-up"}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{current.title}</p>
              {current.text && <p className="mt-0.5 text-sm text-muted">{current.text}</p>}
              {current.link && (
                <p className="mt-2 text-xs">
                  {current.link.external ? (
                    <a href={current.link.href} target="_blank" rel="noreferrer" className="font-medium text-accent underline">{current.link.label}</a>
                  ) : (
                    <Link href={current.link.href} onClick={() => setCurrent(null)} className="font-medium text-accent underline">{current.link.label}</Link>
                  )}
                </p>
              )}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setCurrent(null)} className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-control text-muted transition-colors duration-150 hover:bg-surface hover:text-ink">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): Snackbar {
  return useContext(SnackbarContext);
}
