"use client";

import { type ReactNode, createContext, useContext, useMemo, useState } from "react";
import { llamaLogo } from "@/lib/logos";

const LogoContext = createContext<Record<string, string>>({});

export function LogoProvider({ logos, children }: { logos: Record<string, string>; children: ReactNode }) {
  return <LogoContext.Provider value={logos}>{children}</LogoContext.Provider>;
}

export function CoinIcon({ id, size = 24 }: { id: string; size?: number }) {
  const logos = useContext(LogoContext);
  const sources = useMemo(() => [logos[id], llamaLogo(id)].filter((source): source is string => Boolean(source)), [logos, id]);
  const [failed, setFailed] = useState(0);
  const source = sources[failed];
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent font-semibold text-accent-ink"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {source ? <img key={source} src={source} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed((count) => count + 1)} className="block h-full w-full bg-surface-2 object-cover" /> : id.slice(0, 1)}
    </span>
  );
}
