"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { shortAddress } from "@/lib/address";

export function WalletNote() {
  const { publicKey } = useWallet();
  if (!publicKey) return <>No wallet is connected, so this shows a sample wallet.</>;
  return (
    <>
      Connected as <span className="num text-ink">{shortAddress(publicKey.toBase58())}</span>. The positions below are still sample data until the live API is connected.
    </>
  );
}
