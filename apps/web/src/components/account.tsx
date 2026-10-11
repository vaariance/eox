"use client";

import type { Portfolio } from "@eox/app-api";
import { useWallet } from "@solana/wallet-adapter-react";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { walletPortfolio } from "@/app/actions";

const REFRESH_MS = 15000;

interface Account {
  live: boolean;
  owner: string | null;
  portfolio: Portfolio | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AccountContext = createContext<Account>({ live: false, owner: null, portfolio: null, loading: false, refresh: async () => undefined });

export function AccountProvider({ live, demo, children }: { live: boolean; demo: Portfolio | null; children: ReactNode }) {
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? null;
  const current = useRef<string | null>(null);
  const [own, setOwn] = useState<{ owner: string; portfolio: Portfolio | null } | null>(null);

  const refresh = useCallback(async () => {
    if (!live || !owner) return;
    const result = await walletPortfolio(owner);
    if (result.ok && current.current === owner) setOwn({ owner, portfolio: result.value });
  }, [live, owner]);

  useEffect(() => {
    current.current = owner;
    if (!live || !owner) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [live, owner, refresh]);

  const value = useMemo<Account>(() => {
    if (!live) return { live, owner, portfolio: demo, loading: false, refresh };
    const loaded = own !== null && own.owner === owner;
    return { live, owner, portfolio: loaded ? own.portfolio : null, loading: owner !== null && !loaded, refresh };
  }, [live, owner, demo, own, refresh]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): Account {
  return useContext(AccountContext);
}
