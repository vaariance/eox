"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { ArrowDownUp, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type SwapBalances, type SwapDirection, type SwapMarket, type SwapSent, swapBalances, swapMarket, swapPrepare, swapQuote, swapSend, swapState } from "@/app/swap-actions";
import { parseScaled } from "@/lib/amounts";
import { COLLATERAL, SWAP_CHARGE_BPS } from "@/lib/config";
import { formatAmount, formatWhole } from "@/lib/format";

const COLLATERAL_DIGITS = 6;
const UNIT_DIGITS = 12;
const VALID_FOR_BATCHES = 3;
const MARKET_MS = 30000;
const QUOTE_MS = 600;
const POLL_MS = 2000;
const POLLS = 45;
const field = "num h-11 w-full rounded-control border border-line bg-bg px-3 text-sm text-ink placeholder:text-muted";
const fixed = "flex h-11 w-full items-center rounded-control border border-line bg-bg px-3 text-sm text-ink";

type Phase =
  | { step: "idle" }
  | { step: "working"; text: string }
  | { step: "sent"; kind: string; sent: SwapSent; earliestBatch: string | null }
  | { step: "failed"; message: string };

function show(value: string, digits: number, places = 2): string {
  return formatAmount(Number(BigInt(value)) / 10 ** digits, places);
}

function decode(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function declined(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|declin|cancel/i.test(message)) return "You declined it in your wallet. Nothing was sent.";
  return message.split("\n")[0] || "The request could not be sent.";
}

function closed(market: SwapMarket | null, problem: string | null): string | null {
  if (problem) return problem;
  if (!market) return "Reading the pool.";
  if (!market.initialized) return "Swaps open after the pool's first publication.";
  if (market.paused) return "The pool is paused.";
  if (market.halted) return "The pool is halted because nothing has been published for an hour.";
  return null;
}

function summary(kind: string, sent: SwapSent, earliestBatch: string | null): string {
  if (sent.state === "failed") return `The network refused it: ${sent.error ?? "no reason given"}.`;
  const landed = sent.state === "finalized" ? "Done." : "Sent, waiting for the network.";
  if (kind === "withdraw") return `${landed} The ${COLLATERAL.symbol} goes to your wallet.`;
  const batch = earliestBatch ? ` for batch #${formatWhole(Number(earliestBatch))} at the earliest` : "";
  return `${landed} It is queued${batch} and fills at a later publication, not now.`;
}

export function SwapForm() {
  const { publicKey, signTransaction } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [direction, setDirection] = useState<SwapDirection>("buy");
  const [amount, setAmount] = useState("250");
  const [market, setMarket] = useState<SwapMarket | null>(null);
  const [marketProblem, setMarketProblem] = useState<string | null>(null);
  const [balances, setBalances] = useState<SwapBalances | null>(null);
  const [quote, setQuote] = useState<{ key: string; value: string | null; problem: string | null } | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const alive = useRef(true);
  const owner = mounted ? (publicKey?.toBase58() ?? null) : null;
  const buying = direction === "buy";
  const base = parseScaled(amount, buying ? COLLATERAL_DIGITS : UNIT_DIGITS);
  const valid = base !== null && base > 0n;
  const blocked = closed(market, marketProblem);
  const key = `${owner}:${direction}:${base}`;

  useEffect(() => {
    setMounted(true);
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const read = async () => {
      const result = await swapMarket();
      if (!alive.current) return;
      if (result.ok) setMarket(result.value);
      setMarketProblem(result.ok ? null : result.message);
    };
    void read();
    const timer = window.setInterval(() => void read(), MARKET_MS);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(async () => {
    if (!owner) return setBalances(null);
    const result = await swapBalances(owner);
    if (alive.current && result.ok) setBalances(result.value);
  }, [owner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!owner || !valid || blocked) return;
    const timer = window.setTimeout(async () => {
      const result = await swapQuote(owner, direction, base.toString());
      if (alive.current) setQuote({ key, value: result.ok ? result.value : null, problem: result.ok ? null : result.message });
    }, QUOTE_MS);
    return () => window.clearTimeout(timer);
  }, [owner, valid, blocked, direction, base, key]);

  const current = quote && quote.key === key ? quote : null;
  const estimate = current?.value ? show(current.value, buying ? UNIT_DIGITS : COLLATERAL_DIGITS) : null;
  const short =
    !valid || !balances
      ? null
      : buying
        ? base > BigInt(balances.collateral)
          ? `Your wallet holds ${show(balances.collateral, COLLATERAL_DIGITS)} ${COLLATERAL.symbol}, which is less than this.`
          : null
        : base > BigInt(balances.availableUnits)
          ? `You hold ${show(balances.availableUnits, UNIT_DIGITS)} unlocked CRYPTO units, which is less than this.`
          : null;
  const problem = blocked ?? (!valid ? `Enter an amount above zero with at most ${buying ? COLLATERAL_DIGITS : UNIT_DIGITS} decimal places.` : short);
  const working = phase.step === "working";
  const ready = owner !== null && problem === null && !working;

  const track = async (kind: string, first: SwapSent, earliestBatch: string | null) => {
    let sent = first;
    for (let poll = 0; poll < POLLS && sent.state === "submitted" && alive.current; poll += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
      const next = await swapState(sent.signature);
      if (next.ok) sent = next.value;
    }
    if (alive.current) setPhase({ step: "sent", kind, sent, earliestBatch });
    await refresh();
  };

  const send = async (what: SwapDirection | "withdraw", value: string) => {
    if (!owner) return;
    if (!signTransaction) return setPhase({ step: "failed", message: "This wallet cannot sign a prepared transaction. Try a different wallet." });
    setPhase({ step: "working", text: "Preparing" });
    const prepared = await swapPrepare(owner, what, value, VALID_FOR_BATCHES);
    if (!prepared.ok) return setPhase({ step: "failed", message: prepared.message });
    try {
      const transaction = VersionedTransaction.deserialize(decode(prepared.value.transaction));
      if (transaction.message.staticAccountKeys[0]?.toBase58() !== owner || transaction.message.header.numRequiredSignatures !== 1) {
        return setPhase({ step: "failed", message: "The prepared transaction is not for this wallet alone, so it was not signed." });
      }
      setPhase({ step: "working", text: "Waiting for your wallet" });
      const signed = await signTransaction(transaction);
      setPhase({ step: "working", text: "Sending" });
      const sent = await swapSend(encode(signed.serialize()));
      if (!sent.ok) return setPhase({ step: "failed", message: sent.message });
      setPhase({ step: "sent", kind: prepared.value.kind, sent: sent.value, earliestBatch: prepared.value.earliestBatch });
      void track(prepared.value.kind, sent.value, prepared.value.earliestBatch);
    } catch (error) {
      setPhase({ step: "failed", message: declined(error) });
    }
  };

  const payable = balances ? BigInt(balances.payable) : 0n;
  const label = !owner ? "Connect wallet to swap" : working ? phase.text : buying ? "Queue buy" : "Queue sell";
  const bad = phase.step === "sent" && phase.sent.state === "failed";

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card">
      <form className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
        <div className="rounded-control bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <label htmlFor="swap-amount">You give</label>
            {balances && <span className="num">You hold {buying ? `${show(balances.collateral, COLLATERAL_DIGITS)} ${COLLATERAL.symbol}` : `${show(balances.availableUnits, UNIT_DIGITS)} CRYPTO units`}</span>}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <input id="swap-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={field} />
            <span className={fixed}>{buying ? `${COLLATERAL.symbol} (${COLLATERAL.name})` : "CRYPTO units"}</span>
          </div>
        </div>

        <div className="flex justify-center">
          <button type="button" onClick={() => setDirection(buying ? "sell" : "buy")} aria-label="Swap the two sides" className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-pill border border-line bg-surface transition-colors duration-150 hover:bg-surface-2">
            <ArrowDownUp size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="rounded-control bg-surface-2 p-3">
          <div className="mb-2 block text-xs text-muted">You get (estimate)</div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <output htmlFor="swap-amount" className={`${fixed} num`}>{estimate === null ? "—" : `≈ ${estimate}`}</output>
            <span className={fixed}>{buying ? "CRYPTO units" : `${COLLATERAL.symbol} (${COLLATERAL.name})`}</span>
          </div>
          {current?.problem && <p className="mt-1 text-xs text-muted">{current.problem}</p>}
          {!owner && <p className="mt-1 text-xs text-muted">Connect a wallet to get an estimate from the pool.</p>}
        </div>

        <dl className="mt-1 flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">This is a</dt>
            <dd>{buying ? "Buy" : "Sell"} request</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Earliest batch</dt>
            <dd className="num">{market ? `#${formatWhole(Number(market.earliestBatch))}` : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Stays valid for</dt>
            <dd className="num">{VALID_FOR_BATCHES} batches, no minimum</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Swap charge</dt>
            <dd className="num">{SWAP_CHARGE_BPS === null ? "Not set yet" : `${(SWAP_CHARGE_BPS / 100).toFixed(2)}%`}</dd>
          </div>
        </dl>

        <p className="flex gap-2 rounded-control bg-surface-2 p-3 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            The estimate comes from the pool on Solana devnet and is not a guarantee. A swap is queued and fills at the unit value fixed by a later publication. Selling leaves {COLLATERAL.symbol} ready to withdraw. To back one asset, swap into CRYPTO first, then switch on the CRYPTO page.
          </span>
        </p>

        <button type="button" disabled={!ready} onClick={() => valid && send(direction, base.toString())} className={`h-11 rounded-pill bg-accent text-sm font-medium text-accent-ink transition-opacity duration-150 ${ready ? "cursor-pointer hover:opacity-90" : "opacity-50"}`}>
          {label}
        </button>
        {problem && phase.step === "idle" && <p role="alert" className="text-xs text-down">{problem}</p>}
        {phase.step === "failed" && <p role="alert" className="text-xs text-down">{phase.message}</p>}
        {phase.step === "sent" && (
          <p role="status" className={`text-xs ${bad ? "text-down" : "text-up"}`}>
            {summary(phase.kind, phase.sent, phase.earliestBatch)}{" "}
            <a href={`https://explorer.solana.com/tx/${phase.sent.signature}?cluster=devnet`} target="_blank" rel="noreferrer" className="underline">
              View the transaction
            </a>
          </p>
        )}

        {payable > 0n && (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
            <span className="text-muted">
              Ready to withdraw: <span className="num text-ink">{show(payable.toString(), COLLATERAL_DIGITS)} {COLLATERAL.symbol}</span>
            </span>
            <button type="button" disabled={working} onClick={() => send("withdraw", payable.toString())} className={`h-9 rounded-pill border border-line px-3 text-xs ${working ? "opacity-50" : "cursor-pointer hover:bg-surface-2"}`}>
              Withdraw all
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
