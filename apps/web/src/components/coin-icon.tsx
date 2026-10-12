"use client";

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { llamaLogo } from "@/lib/logos";

const LogoContext = createContext<Record<string, string>>({});

export function LogoProvider({ logos, children }: { logos: Record<string, string>; children: ReactNode }) {
  return <LogoContext.Provider value={logos}>{children}</LogoContext.Provider>;
}

export function useCoinLogo(id: string, last?: string | null): { source: string | undefined; fail: () => void } {
  const logos = useContext(LogoContext);
  const sources = useMemo(() => [logos[id], llamaLogo(id), last].filter((source): source is string => Boolean(source)), [logos, id, last]);
  const [failed, setFailed] = useState(0);
  const fail = useCallback(() => setFailed((count) => count + 1), []);
  return { source: sources[failed], fail };
}

export function CoinIcon({ id, size = 24 }: { id: string; size?: number }) {
  const { source, fail } = useCoinLogo(id);
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent font-semibold text-accent-ink"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {source ? <img key={source} src={source} alt="" loading="lazy" referrerPolicy="no-referrer" onError={fail} className="block h-full w-full bg-surface-2 object-cover" /> : id.slice(0, 1)}
    </span>
  );
}
