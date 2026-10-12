"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONSENT_OPEN_EVENT, readConsent, writeConsent } from "@/lib/consent";

const button = "h-10 cursor-pointer rounded-control px-4 text-sm transition-colors duration-150";
const quiet = `${button} border border-line hover:bg-surface`;
const primary = `${button} bg-accent font-medium text-accent-ink hover:opacity-90`;

export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))} className={className ?? "cursor-pointer text-left underline-offset-4 hover:underline"}>
      Cookie settings
    </button>
  );
}

export function CookieConsent() {
  const [view, setView] = useState<"hidden" | "banner" | "manage">("hidden");
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const saved = readConsent();
    if (saved) setRemember(saved.preferences);
    else setView("banner");
    const open = () => {
      setRemember(readConsent()?.preferences ?? false);
      setView("manage");
    };
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, []);

  const decide = (preferences: boolean) => {
    writeConsent({ preferences });
    setRemember(preferences);
    setView("hidden");
  };

  if (view === "hidden") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-start p-4">
      <section role="dialog" aria-label="Cookies" className="pointer-events-auto w-full max-w-md rounded-card border border-line bg-surface-2 p-5 font-sans text-ink shadow-[0_16px_40px_rgb(0_0_0/0.5)]">
        <h2 className="text-sm font-medium">Cookies</h2>
        {view === "banner" ? (
          <>
            <p className="mt-2 text-sm text-muted">
              We use cookies and analytics to improve Relative. See our <Link href="/privacy" className="text-accent underline underline-offset-4">Privacy Policy</Link> and <Link href="/terms" className="text-accent underline underline-offset-4">Terms of Use</Link>.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => decide(true)} className={primary}>Accept</button>
              <button type="button" onClick={() => setView("manage")} className={quiet}>Manage</button>
              <button type="button" onClick={() => decide(false)} className={quiet}>Reject</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">No tracking, analytics or advertising cookies are used on Relative.</p>
            <ul className="mt-4 flex flex-col gap-4">
              <li>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>Needed for the site to work</span>
                  <span className="text-xs text-muted">Always on</span>
                </div>
                <p className="mt-1 text-xs text-muted">Your cookie choice, and which wallet you connected so you stay connected between visits.</p>
              </li>
              <li>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span id="remember-layout">Remember my layout</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={remember}
                    aria-labelledby="remember-layout"
                    onClick={() => setRemember(!remember)}
                    className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full border border-line transition-colors duration-150 ${remember ? "bg-accent" : "bg-surface"}`}
                  >
                    <span className={`absolute top-0.5 size-[18px] rounded-full bg-ink transition-[left] duration-150 ${remember ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted">Keeps the side menu open or collapsed the way you left it. Stored on this device only.</p>
              </li>
            </ul>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => decide(remember)} className={primary}>Save</button>
              <Link href="/privacy" className="ml-auto text-xs text-muted underline underline-offset-4 hover:text-ink">Privacy Policy</Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
