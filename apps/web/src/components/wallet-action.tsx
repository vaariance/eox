"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

export function WalletAction({ needsWallet, className }: { needsWallet: string; className: string }) {
  const wallet = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const connected = mounted && wallet.connected;
  return (
    <>
      <button type="submit" disabled className={`${className} opacity-50`}>
        {connected ? "Not available yet" : needsWallet}
      </button>
      {connected && <p className="text-xs text-muted">Your wallet is connected. Sending requests opens when the live API is ready.</p>}
    </>
  );
}
