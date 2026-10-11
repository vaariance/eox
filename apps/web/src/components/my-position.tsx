"use client";

import { COLLATERAL } from "@/lib/config";
import { formatAmount } from "@/lib/format";
import { holdingsOf } from "@/lib/view";
import { useAccount } from "./account";

export function MyPosition({ classId, unitValue }: { classId: string; unitValue: number | null }) {
  const { portfolio, owner, live, loading } = useAccount();
  const holding = holdingsOf(portfolio)?.find((item) => item.classId === classId);
  const none = loading ? "Loading your position." : live && !owner ? "Connect a wallet to see your position." : `You hold no ${classId} units.`;

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 className="text-sm font-medium">Your position</h2>
      {holding ? (
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Units</dt><dd className="num">{formatAmount(holding.units)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Locked in requests</dt><dd className="num">{formatAmount(holding.locked)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2">
            <dt className="text-muted">Redeemable now, about</dt>
            <dd className="num">{unitValue === null ? "n/a" : `${formatAmount(holding.units * unitValue)} ${COLLATERAL.symbol}`}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted">{none}</p>
      )}
    </section>
  );
}
