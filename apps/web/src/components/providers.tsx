"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { clusterApiUrl } from "@solana/web3.js";
import type { FeeTerms, Portfolio } from "@eox/app-api";
import type { ReactNode } from "react";
import { AccountProvider } from "./account";
import { LogoProvider } from "./coin-icon";
import { SnackbarProvider } from "./snackbar";

const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl("devnet");
const wallets: never[] = [];

export function Providers({ live, demo, apiUrl, sequence, fee, logos, children }: { live: boolean; demo: Portfolio | null; apiUrl: string; sequence: number | null; fee: FeeTerms | null; logos: Record<string, string>; children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <SnackbarProvider>
          <AccountProvider live={live} demo={demo} apiUrl={apiUrl} sequence={sequence} fee={fee}>
            <LogoProvider logos={logos}>{children}</LogoProvider>
          </AccountProvider>
        </SnackbarProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
