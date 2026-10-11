"use client";

import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Check, Copy, LogOut, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { shortAddress } from "@/lib/address";

const primary = "flex h-10 cursor-pointer items-center gap-2 rounded-pill bg-accent px-4 text-sm font-medium text-accent-ink transition-opacity duration-150 hover:opacity-90";
const row = "flex h-11 w-full cursor-pointer items-center gap-3 rounded-control px-3 text-left text-sm transition-colors duration-150 hover:bg-surface-2";

export function WalletButton() {
  const { connection } = useConnection();
  const { wallets, wallet, select, connect, disconnect, publicKey, connected, connecting } = useWallet();
  const dialog = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState<WalletName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const available = wallets.filter((item) => item.readyState === WalletReadyState.Installed || item.readyState === WalletReadyState.Loadable);
  const address = mounted ? (publicKey?.toBase58() ?? null) : null;

  useEffect(() => {
    if (!chosen || wallet?.adapter.name !== chosen || connected || connecting) return;
    setChosen(null);
    connect().catch((cause: unknown) => setError(cause instanceof Error && cause.message ? cause.message : "The wallet did not connect."));
  }, [chosen, wallet, connected, connecting, connect]);

  useEffect(() => {
    if (connected) dialog.current?.close();
  }, [connected]);

  useEffect(() => {
    setBalance(null);
    if (!publicKey) return;
    let current = true;
    connection
      .getBalance(publicKey)
      .then((lamports) => {
        if (current) setBalance(lamports / LAMPORTS_PER_SOL);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [connection, publicKey]);

  const open = () => {
    setError(null);
    dialog.current?.showModal();
  };

  const pick = (name: WalletName) => {
    setError(null);
    setChosen(name);
    select(name);
  };

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const leave = () => {
    dialog.current?.close();
    disconnect().catch(() => undefined);
  };

  return (
    <>
      <button type="button" onClick={open} className={primary}>
        <Wallet size={16} aria-hidden="true" />
        {address ? <span className="num">{shortAddress(address)}</span> : mounted && connecting ? "Connecting" : "Connect wallet"}
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="wallet-title"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/30"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="wallet-title" className="text-sm font-medium">{address ? "Wallet" : "Connect a wallet"}</h2>
          <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-pill text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {!mounted ? null : address ? (
          <div className="flex flex-col gap-1 p-3">
            <dl className="mb-2 flex flex-col gap-2 px-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Wallet</dt><dd>{wallet?.adapter.name}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Address</dt><dd className="num">{shortAddress(address)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Devnet SOL</dt><dd className="num">{balance === null ? "…" : balance.toFixed(4)}</dd></div>
            </dl>
            <button type="button" onClick={copy} className={row}>
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied ? "Copied" : "Copy address"}
            </button>
            <button type="button" onClick={leave} className={row}>
              <LogOut size={16} aria-hidden="true" />
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-3">
            {available.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted">
                No Solana wallet was found in this browser. Install Phantom, Solflare or Backpack, set it to devnet, then reload this page.
              </p>
            ) : (
              available.map((item) => (
                <button key={item.adapter.name} type="button" onClick={() => pick(item.adapter.name)} disabled={connecting} className={`${row} disabled:cursor-default disabled:opacity-50`}>
                  <img src={item.adapter.icon} alt="" width={24} height={24} className="rounded-md" />
                  {item.adapter.name}
                </button>
              ))
            )}
            {error && <p role="alert" className="px-3 py-2 text-xs text-down">{error}</p>}
            <p className="px-3 pb-1 pt-2 text-xs text-muted">COX runs on Solana devnet with test collateral. Your keys stay in your wallet.</p>
          </div>
        )}
      </dialog>
    </>
  );
}
