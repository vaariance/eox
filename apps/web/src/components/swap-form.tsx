"use client";

import type { Batch } from "@eox/app-api";
import { ArrowDownUp, Info } from "lucide-react";
import { useState } from "react";
import { COLLATERAL, SWAP_CHARGE_BPS } from "@/lib/config";
import { formatAmount } from "@/lib/format";
import { planRequest } from "@/lib/requests";
import { CRYPTO_CLASS, type ClassView, holdingsOf, unlockedProblem } from "@/lib/view";
import { useAccount } from "./account";
import { TargetBatch, useOpenBatch } from "./open-batch";
import { SendButton } from "./send-button";

const VALID_FOR_BATCHES = 3;
const field = "num h-11 w-full rounded-control border border-line bg-bg px-3 text-sm text-ink placeholder:text-muted";
const fixed = "flex h-11 w-full items-center rounded-control border border-line bg-bg px-3 text-sm text-ink";

export function SwapForm({ crypto, nextBatch, decimals }: { crypto: ClassView; nextBatch: Batch | null; decimals: number }) {
  const { portfolio } = useAccount();
  const holdings = holdingsOf(portfolio, decimals);
  const open = useOpenBatch(nextBatch);
  const [buying, setBuying] = useState(true);
  const [amount, setAmount] = useState("250");

  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const unitValue = crypto.unitValue ?? 1;
  const held = buying || holdings === null ? null : (holdings.find((item) => item.classId === CRYPTO_CLASS)?.units ?? 0);
  const unitsProblem = valid && !buying ? unlockedProblem(holdings, CRYPTO_CLASS, parsed) : null;
  const planned = planRequest({
    operation: buying ? "deposit" : "redeem",
    fromClass: buying ? null : CRYPTO_CLASS,
    toClass: buying ? CRYPTO_CLASS : null,
    amount,
    minimum: "",
    validForBatches: VALID_FOR_BATCHES,
    targetBatch: open.batch?.batch ?? null,
    collateralDecimals: decimals,
  });
  const gross = valid ? (buying ? parsed / unitValue : parsed * unitValue) : null;
  const charge = gross !== null && SWAP_CHARGE_BPS !== null ? (gross * SWAP_CHARGE_BPS) / 10000 : null;
  const estimate = gross === null ? null : gross - (charge ?? 0);
  const give = buying ? COLLATERAL.symbol : "CRYPTO";
  const get = buying ? "CRYPTO" : COLLATERAL.symbol;

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card">
      <form className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
        <div className="rounded-control bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <label htmlFor="swap-amount">You give</label>
            {held !== null && <span className="num">You hold {formatAmount(held)} CRYPTO</span>}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <input id="swap-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={field} />
            <span className={fixed}>{give}</span>
          </div>
        </div>

        <div className="flex justify-center">
          <button type="button" onClick={() => setBuying(!buying)} aria-label="Swap the two sides" className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-pill border border-line bg-surface transition-colors duration-150 hover:bg-surface-2">
            <ArrowDownUp size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="rounded-control bg-surface-2 p-3">
          <div className="mb-2 block text-xs text-muted">You get (estimate)</div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <output htmlFor="swap-amount" className={`${fixed} num`}>{estimate === null ? "—" : `≈ ${formatAmount(estimate)}`}</output>
            <span className={fixed}>{get}</span>
          </div>
        </div>

        <dl className="mt-1 flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Target batch</dt>
            <dd className="num"><TargetBatch batch={open.batch} seconds={open.seconds} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Stays valid for</dt>
            <dd className="num">{VALID_FOR_BATCHES} batches</dd>
          </div>
          {SWAP_CHARGE_BPS !== null && (
            <div className="flex justify-between">
              <dt className="text-muted">Swap charge</dt>
              <dd className="num">{charge === null ? `${(SWAP_CHARGE_BPS / 100).toFixed(2)}%` : `${formatAmount(charge)} ${get} (${(SWAP_CHARGE_BPS / 100).toFixed(2)}%)`}</dd>
            </div>
          )}
        </dl>

        <p className="flex gap-2 rounded-control bg-surface-2 p-3 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            A swap is queued and fills at the next publication, so the amount you get is an estimate. Swapping back leaves {COLLATERAL.symbol} ready to withdraw on the Portfolio page.
          </span>
        </p>

        <SendButton describe={`Swap ${amount} ${give} for ${get}`} intent={planned.intent} label="Swap" connectLabel="Connect wallet to swap" problem={planned.problem ?? unitsProblem} className="h-11 rounded-pill bg-accent text-sm font-medium text-accent-ink" />
      </form>
    </section>
  );
}
