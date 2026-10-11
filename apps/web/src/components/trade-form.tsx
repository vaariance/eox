"use client";

import { Info } from "lucide-react";
import { useState } from "react";
import { COLLATERAL } from "@/lib/config";
import type { Batch } from "@eox/app-api";
import { formatAmount, formatUtcTime, formatWhole } from "@/lib/format";
import { type ClassView, type Holding, unlockedProblem } from "@/lib/view";
import { Countdown } from "./countdown";
import { WalletAction } from "./wallet-action";

type Operation = "deposit" | "switch" | "redeem";

const operations: { id: Operation; label: string }[] = [
  { id: "deposit", label: "Buy" },
  { id: "switch", label: "Switch" },
  { id: "redeem", label: "Redeem" },
];

const field = "num h-11 w-full rounded-control border border-line bg-bg px-3 text-sm text-ink placeholder:text-muted";

export function TradeForm({ claim, others, holdings, nextBatch }: { claim: ClassView; others: ClassView[]; holdings: Holding[] | null; nextBatch: Batch | null }) {
  const [operation, setOperation] = useState<Operation>("deposit");
  const [amount, setAmount] = useState("250");
  const [target, setTarget] = useState(others[0].id);
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const destination = others.find((item) => item.id === target) ?? others[0];
  const sameClass = operation === "switch" && destination.id === claim.id;
  const unitsProblem = valid && operation !== "deposit" ? unlockedProblem(holdings, claim.id, parsed) : null;

  const sourceValue = claim.unitValue ?? 1;
  const destinationValue = destination.unitValue ?? 1;
  const estimate = !valid
    ? null
    : operation === "deposit"
      ? { value: parsed / sourceValue, unit: `${claim.id} units` }
      : operation === "redeem"
        ? { value: parsed * sourceValue, unit: "tUSDC" }
        : { value: (parsed * sourceValue) / destinationValue, unit: `${destination.id} units` };

  const amountLabel = operation === "deposit" ? "Amount (tUSDC)" : `${claim.id} units`;
  const conditionLabel = operation === "deposit" ? "Minimum units" : operation === "redeem" ? "Minimum proceeds (tUSDC)" : "Minimum units out";

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div role="group" aria-label="Operation" className="mb-4 grid grid-cols-3 gap-1 rounded-control bg-surface-2 p-1">
        {operations.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={operation === item.id}
            onClick={() => setOperation(item.id)}
            className={`h-10 cursor-pointer rounded-control text-sm transition-colors duration-150 ${
              operation === item.id ? "bg-accent font-medium text-accent-ink" : "text-muted hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="mb-3 text-xs text-muted">
        Buying puts {COLLATERAL.name} into the {claim.id} class and gives you units, a share of that class. You do not receive {claim.id === "CRYPTO" ? "the coins" : `${claim.id} coins`}.
      </p>

      <form className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
        {operation === "switch" && (
          <div>
            <label htmlFor="trade-target" className="mb-1 block text-xs text-muted">Switch into</label>
            <select id="trade-target" value={target} onChange={(event) => setTarget(event.target.value)} className={`${field} cursor-pointer`}>
              {others.map((item) => (
                <option key={item.id} value={item.id}>{item.id}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="trade-amount" className="mb-1 block text-xs text-muted">{amountLabel}</label>
          <input id="trade-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={field} />
          {!valid && <p className="mt-1 text-xs text-down">Enter an amount above zero.</p>}
          {unitsProblem && <p role="alert" className="mt-1 text-xs text-down">{unitsProblem}</p>}
          {sameClass && <p role="alert" className="mt-1 text-xs text-down">Choose a different class to switch into.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="trade-condition" className="mb-1 block text-xs text-muted">{conditionLabel}</label>
            <input id="trade-condition" inputMode="decimal" placeholder="Optional" className={field} />
          </div>
          <div>
            <label htmlFor="trade-expiry" className="mb-1 block text-xs text-muted">Expires after</label>
            <select id="trade-expiry" defaultValue="3" className={`${field} cursor-pointer`}>
              <option value="1">1 batch</option>
              <option value="3">3 batches</option>
              <option value="10">10 batches</option>
            </select>
          </div>
        </div>

        <dl className="mt-1 flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Target batch</dt>
            <dd className="num">{nextBatch ? <>#{formatWhole(nextBatch.batch)} · {formatUtcTime(nextBatch.cutoff)} · closes in <Countdown /></> : "No open batch"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Last unit value</dt>
            <dd className="num">{claim.unitValue === null ? "1.000000 (empty class)" : formatAmount(claim.unitValue, 6)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Estimate</dt>
            <dd className="num">{estimate ? `≈ ${formatAmount(estimate.value)} ${estimate.unit}` : "n/a"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Fee</dt>
            <dd className="num">0</dd>
          </div>
        </dl>

        <p className="flex gap-2 rounded-control bg-surface-2 p-3 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          This is an estimate, not a quote. Your request is queued and executes at the unit value fixed by the next publication. You can cancel until the batch closes.
        </p>

        <WalletAction needsWallet="Connect wallet to continue" className="h-11 rounded-pill bg-accent text-sm font-medium text-accent-ink" />
      </form>
    </section>
  );
}
