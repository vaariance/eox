"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { clusterApiUrl } from "@solana/web3.js";
import type { Portfolio } from "@eox/app-api";
import type { ReactNode } from "react";
import { AccountProvider } from "./account";

const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl("devnet");
const wallets: never[] = [];

export function Providers({ live, demo, children }: { live: boolean; demo: Portfolio | null; children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <AccountProvider live={live} demo={demo}>{children}</AccountProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
