"use client";

import { ArrowDownUp, Info } from "lucide-react";
import { useState } from "react";
import { COLLATERAL, SWAP_CHARGE_BPS } from "@/lib/config";
import type { Batch } from "@eox/app-api";
import { formatAmount, formatUtcTime, formatWhole } from "@/lib/format";
import type { ClassView } from "@/lib/view";
import { Countdown } from "./countdown";
import { WalletAction } from "./wallet-action";

const CASH = "collateral";
const field = "num h-11 w-full rounded-control border border-line bg-bg px-3 text-sm text-ink placeholder:text-muted";

interface Holding {
  classId: string;
  units: number;
}

export function SwapForm({ classes, holdings, nextBatch }: { classes: ClassView[]; holdings: Holding[]; nextBatch: Batch | null }) {
  const [from, setFrom] = useState(CASH);
  const [to, setTo] = useState("CRYPTO");
  const [amount, setAmount] = useState("250");

  const options = [{ id: CASH, label: `${COLLATERAL.symbol} (${COLLATERAL.name})` }, ...classes.map((item) => ({ id: item.id, label: item.id }))];
  const valueOf = (id: string) => (id === CASH ? 1 : (classes.find((item) => item.id === id)?.unitValue ?? 1));
  const unitOf = (id: string) => (id === CASH ? COLLATERAL.symbol : `${id} units`);
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const same = from === to;
  const operation = from === CASH ? "Deposit" : to === CASH ? "Redeem" : "Switch";
  const held = from === CASH ? null : (holdings.find((item) => item.classId === from)?.units ?? 0);
  const gross = valid && !same ? (parsed * valueOf(from)) / valueOf(to) : null;
  const charge = gross !== null && SWAP_CHARGE_BPS !== null ? (gross * SWAP_CHARGE_BPS) / 10000 : null;
  const estimate = gross === null ? null : gross - (charge ?? 0);

  const flip = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card">
      <form className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
        <div className="rounded-control bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <label htmlFor="swap-from">You give</label>
            {held !== null && <span className="num">You hold {formatAmount(held)} units</span>}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <input id="swap-amount" aria-label={`Amount in ${unitOf(from)}`} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={field} />
            <select id="swap-from" value={from} onChange={(event) => setFrom(event.target.value)} className={`${field} cursor-pointer`}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          {!valid && <p className="mt-1 text-xs text-down">Enter an amount above zero.</p>}
        </div>

        <div className="flex justify-center">
          <button type="button" onClick={flip} aria-label="Swap the two sides" className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-pill border border-line bg-surface transition-colors duration-150 hover:bg-surface-2">
            <ArrowDownUp size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="rounded-control bg-surface-2 p-3">
          <label htmlFor="swap-to" className="mb-2 block text-xs text-muted">You get (estimate)</label>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <output htmlFor="swap-amount swap-from swap-to" className={`${field} flex items-center`}>{estimate === null ? "n/a" : `≈ ${formatAmount(estimate)}`}</output>
            <select id="swap-to" value={to} onChange={(event) => setTo(event.target.value)} className={`${field} cursor-pointer`}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          {same && <p className="mt-1 text-xs text-down">Choose two different sides.</p>}
        </div>

        <dl className="mt-1 flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">This is a</dt>
            <dd>{operation} request</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Target batch</dt>
            <dd className="num">{nextBatch ? <>#{formatWhole(nextBatch.batch)} · {formatUtcTime(nextBatch.cutoff)} · closes in <Countdown /></> : "No open batch"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">You receive</dt>
            <dd className="num">{estimate === null ? "n/a" : `≈ ${formatAmount(estimate)} ${unitOf(to)}`}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Swap charge</dt>
            <dd className="num">
              {SWAP_CHARGE_BPS === null ? "Not set yet" : charge === null ? `${(SWAP_CHARGE_BPS / 100).toFixed(2)}%` : `${formatAmount(charge)} ${unitOf(to)} (${(SWAP_CHARGE_BPS / 100).toFixed(2)}%)`}
            </dd>
          </div>
        </dl>

        <p className="flex gap-2 rounded-control bg-surface-2 p-3 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          This is an estimate, not a quote. A swap is queued and executes at the unit values fixed by the next publication. You hold a share of a class, not the underlying coin.
        </p>

        <WalletAction needsWallet="Connect wallet to swap" className="h-11 rounded-pill bg-accent text-sm font-medium text-accent-ink" />
      </form>
    </section>
  );
}
