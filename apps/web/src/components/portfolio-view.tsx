"use client";

import type { CoxStatus } from "@eox/app-api";
import Link from "next/link";
import { shortAddress } from "@/lib/address";
import { COLLATERAL } from "@/lib/config";
import { costBasis, paidFor } from "@/lib/basis";
import { direction, formatAmount, formatSigned, formatWhole } from "@/lib/format";
import { CRYPTO_CLASS, type ClassView, toNumber, unitDigits } from "@/lib/view";
import { useAccount } from "./account";
import { useOpenBatch } from "./open-batch";
import { RequestList } from "./request-list";
import { SendButton } from "./send-button";

export function PortfolioView({ classes, status, decimals }: { classes: ClassView[]; status: CoxStatus; decimals: number }) {
  const { portfolio, owner, live, loading } = useAccount();
  const open = useOpenBatch(status.currentBatch);
  const expiryBatch = open.batch ? open.batch.batch + 2 : null;
  const book = costBasis(portfolio?.requests ?? [], decimals);
  const rows = (portfolio?.positions ?? []).map((position) => {
    const units = toNumber(position.units, unitDigits(decimals));
    const unitValue = classes.find((item) => item.id === position.classId)?.unitValue ?? null;
    const redeemable = unitValue === null ? null : units * unitValue;
    const paid = paidFor(book, position.classId, units);
    const free = BigInt(position.units) - BigInt(position.locked);
    return { free: free > 0n ? free.toString() : null, classId: position.classId, units, locked: toNumber(position.locked, unitDigits(decimals)), unitValue, redeemable, paid, change: redeemable === null || paid === null ? null : redeemable - paid };
  });
  const redeemable = rows.reduce((sum, row) => sum + (row.redeemable ?? 0), 0);
  const total = rows.length > 0 && rows.every((row) => row.change !== null) ? rows.reduce((sum, row) => sum + (row.change ?? 0), 0) : null;
  const tone = (value: number | null) => (value === null ? "text-muted" : { up: "text-up", down: "text-down", flat: "text-muted" }[direction(value)]);
  const payable = portfolio?.payable ?? "0";
  const cards = [
    { label: "Worth now, about", value: redeemable, note: total === null ? "Your units at the latest unit values" : `Gain or loss so far: ${formatSigned(total, 6)} ${COLLATERAL.symbol}` },
    { label: "Pending buys", value: toNumber(portfolio?.pending ?? "0", decimals), note: "Still yours until the batch executes" },
    { label: "Refundable", value: toNumber(portfolio?.refundable ?? "0", decimals), note: "From rejected, expired or cancelled buys" },
  ];
  const who = !live
    ? "This is fixture data, so it shows a demo wallet."
    : !owner
      ? "Connect a wallet to see its positions."
      : loading
        ? `Loading ${shortAddress(owner)}.`
        : portfolio
          ? `Showing ${shortAddress(owner)}.`
          : `${shortAddress(owner)} has no positions or requests yet.`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {who} Your return comes from unit values, not from the reference charts.
          {portfolio && portfolio.appliedSequence !== null && ` Up to date with publication #${formatWhole(portfolio.appliedSequence)}.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-card border border-line bg-surface p-4 shadow-card">
            <div className="text-xs text-muted">{card.label}</div>
            <div className="num mt-2 text-2xl">{formatAmount(card.value, 4)} <span className="text-xs text-muted">{COLLATERAL.symbol}</span></div>
            <div className="mt-1 text-xs text-muted">{card.note}</div>
          </div>
        ))}
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Ready to withdraw</div>
          <div className="num mt-2 text-2xl">{formatAmount(toNumber(payable, decimals))} <span className="text-xs text-muted">{COLLATERAL.symbol}</span></div>
          <div className="mt-3 flex flex-col gap-2">
            <SendButton
              intent={BigInt(payable) > 0n ? { operation: "withdraw", amount: payable } : null}
              label={BigInt(payable) > 0n ? "Withdraw all" : "Nothing to withdraw"}
              connectLabel="Connect wallet to withdraw"
              className="h-10 w-full rounded-pill bg-accent text-sm font-medium text-accent-ink"
              hideSuccess
            />
          </div>
        </div>
      </div>

      <section className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Positions</h2>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No positions yet.</p>
        ) : (
          <table className="w-full min-w-[940px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-4 py-3 font-normal">Class</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Units</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Locked in requests</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Unit value</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Paid ({COLLATERAL.symbol})</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Worth now, about ({COLLATERAL.symbol})</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Gain or loss</th>
                <th scope="col" className="px-4 py-3 text-right font-normal"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.classId} className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-surface-2">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    <Link href={row.classId === CRYPTO_CLASS ? "/crypto" : `/assets/${row.classId}`}>{row.classId}</Link>
                  </th>
                  <td className="num px-4 py-3 text-right">{formatAmount(row.units, 4)}</td>
                  <td className="num px-4 py-3 text-right">{formatAmount(row.locked, 4)}</td>
                  <td className="num px-4 py-3 text-right">{row.unitValue === null ? "n/a" : formatAmount(row.unitValue, 6)}</td>
                  <td className="num px-4 py-3 text-right">{row.paid === null ? "—" : formatAmount(row.paid, 4)}</td>
                  <td className="num px-4 py-3 text-right">{row.redeemable === null ? "n/a" : formatAmount(row.redeemable, 6)}</td>
                  <td className={`num px-4 py-3 text-right ${tone(row.change)}`}>{row.change === null ? "—" : formatSigned(row.change, 6)}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex flex-col items-end gap-1">
                      <SendButton
                        intent={row.free !== null && expiryBatch !== null ? { operation: "redeem", fromClass: row.classId, units: row.free, minimumProceeds: "0", expiryBatch } : null}
                        label="Cash out"
                        connectLabel="Cash out"
                        className="h-9 rounded-pill border border-line px-3 text-xs"
                        quiet
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <RequestList status={status} decimals={decimals} />
    </div>
  );
}
