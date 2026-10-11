"use client";

import type { Batch } from "@eox/app-api";
import Link from "next/link";
import { useState } from "react";
import { COLLATERAL } from "@/lib/config";
import { formatAmount } from "@/lib/format";
import { planRequest } from "@/lib/requests";
import { CRYPTO_CLASS, type ClassView, holdingsOf, unlockedProblem } from "@/lib/view";
import { useAccount } from "./account";
import { TargetBatch, useOpenBatch } from "./open-batch";
import { SendButton } from "./send-button";

type Side = "buy" | "sell" | "cash";

const sides: { id: Side; label: string }[] = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
  { id: "cash", label: "Cash out" },
];

const field = "num h-11 w-full rounded-control border border-line bg-bg px-3 text-sm text-ink placeholder:text-muted";

export function TradeForm({ claim, crypto, nextBatch, decimals }: { claim: ClassView; crypto: ClassView; nextBatch: Batch | null; decimals: number }) {
  const { portfolio, owner, live } = useAccount();
  const holdings = holdingsOf(portfolio, decimals);
  const open = useOpenBatch(nextBatch);
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("10");
  const [minimum, setMinimum] = useState("");
  const [validFor, setValidFor] = useState(3);

  const buying = side === "buy";
  const cashing = side === "cash";
  const from = buying ? CRYPTO_CLASS : claim.id;
  const to = buying ? claim.id : CRYPTO_CLASS;
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const held = holdings?.find((item) => item.classId === from);
  const available = held ? held.units - held.locked : holdings === null ? null : 0;
  const unitsProblem = valid ? unlockedProblem(holdings, from, parsed) : null;
  const planned = planRequest({ operation: cashing ? "redeem" : "switch", fromClass: from, toClass: cashing ? null : to, amount, minimum, validForBatches: validFor, targetBatch: open.batch?.batch ?? null, collateralDecimals: decimals });
  const fromValue = (buying ? crypto : claim).unitValue ?? 1;
  const toValue = cashing ? 1 : ((buying ? claim : crypto).unitValue ?? 1);
  const estimate = valid ? (parsed * fromValue) / toValue : null;
  const receives = buying ? `${claim.id} units` : cashing ? COLLATERAL.symbol : "$CRYPTO";
  const needsCrypto = buying && live && owner !== null && available === 0;

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div role="group" aria-label="Buy, sell or cash out" className="mb-4 grid grid-cols-3 gap-1 rounded-control bg-surface-2 p-1">
        {sides.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={side === item.id}
            onClick={() => setSide(item.id)}
            className={`h-10 cursor-pointer rounded-control text-sm transition-colors duration-150 ${side === item.id ? "bg-accent font-medium text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <form className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted">
            <label htmlFor="trade-amount">{buying ? "You pay ($CRYPTO)" : `You give (${claim.id} units)`}</label>
            {available !== null && <span className="num">Available {formatAmount(available)}</span>}
          </div>
          <input id="trade-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={field} />
          {!valid && <p className="mt-1 text-xs text-down">Enter an amount above zero.</p>}
          {needsCrypto && (
            <p className="mt-1 text-xs text-muted">
              You have no $CRYPTO yet. <Link href="/swap" className="text-accent underline">Swap USDC for $CRYPTO</Link> first.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="trade-condition" className="mb-1 block text-xs text-muted">Minimum to receive</label>
            <input id="trade-condition" inputMode="decimal" placeholder="Optional" value={minimum} onChange={(event) => setMinimum(event.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="trade-expiry" className="mb-1 block text-xs text-muted">Expires after</label>
            <select id="trade-expiry" value={validFor} onChange={(event) => setValidFor(Number(event.target.value))} className={`${field} cursor-pointer`}>
              <option value="1">1 batch</option>
              <option value="3">3 batches</option>
              <option value="10">10 batches</option>
            </select>
          </div>
        </div>

        <dl className="mt-1 flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Target batch</dt>
            <dd className="num"><TargetBatch batch={open.batch} seconds={open.seconds} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">You receive</dt>
            <dd className="num">{estimate === null ? "—" : `≈ ${formatAmount(estimate, 4)} ${receives}`}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Fee</dt>
            <dd className="num">0</dd>
          </div>
        </dl>


        <SendButton describe={buying ? `Buy ${claim.id} with ${amount} $CRYPTO` : cashing ? `Cash out ${amount} ${claim.id} units to ${COLLATERAL.symbol}` : `Sell ${amount} ${claim.id} units for $CRYPTO`} intent={planned.intent} label={buying ? `Buy ${claim.id}` : cashing ? `Cash out ${claim.id}` : `Sell ${claim.id}`} connectLabel="Connect wallet to continue" problem={planned.problem ?? (needsCrypto ? null : unitsProblem)} className="h-11 rounded-pill bg-accent text-sm font-medium text-accent-ink" />
      </form>
    </section>
  );
}
