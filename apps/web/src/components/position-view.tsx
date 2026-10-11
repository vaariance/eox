"use client";

import type { CoxStatus } from "@eox/app-api";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { costBasis, paidFor } from "@/lib/basis";
import { COLLATERAL } from "@/lib/config";
import { direction, formatAmount, formatSigned, formatWhole } from "@/lib/format";
import { CRYPTO_CLASS, type Point, type ValuePoint, holdingsOf } from "@/lib/view";
import { useAccount } from "./account";
import { AssetChart } from "./asset-chart";
import { useOpenBatch } from "./open-batch";
import { RequestList } from "./request-list";
import { SendButton } from "./send-button";

const card = "rounded-card border border-line bg-surface p-4 shadow-card";
const tones = { up: "text-up", down: "text-down", flat: "text-muted" };

export function PositionView({ classId, values, reference, status, decimals }: { classId: string; values: ValuePoint[]; reference: Point[]; status: CoxStatus; decimals: number }) {
  const { portfolio, owner, live, loading } = useAccount();
  const open = useOpenBatch(status.currentBatch);
  const holding = holdingsOf(portfolio, decimals)?.find((item) => item.classId === classId) ?? null;
  const position = portfolio?.positions.find((item) => item.classId === classId) ?? null;
  const requests = portfolio?.requests ?? [];
  const entered = requests
    .filter((request) => request.state === "filled" && request.receipt !== null && (request.toClass === classId || request.fromClass === classId))
    .reduce<number | null>((latest, request) => (latest === null || request.receipt!.sequence > latest ? request.receipt!.sequence : latest), null);
  const units = holding?.units ?? 0;
  const since = entered === null ? values : values.filter((point) => point.sequence >= entered);
  const worthSeries = since.map((point) => ({ cutoff: point.cutoff, value: point.value * units }));
  const unitValue = values[values.length - 1]?.value ?? null;
  const worth = holding && unitValue !== null ? units * unitValue : null;
  const paid = holding ? paidFor(costBasis(requests, decimals), classId, units) : null;
  const change = worth === null || paid === null ? null : worth - paid;
  const percent = change === null || paid === null || paid === 0 ? null : (change / paid) * 100;
  const tone = change === null ? "" : tones[direction(change)];
  const free = position ? BigInt(position.units) - BigInt(position.locked) : 0n;
  const expiryBatch = open.batch ? open.batch.batch + 2 : null;
  const tradeHref = classId === CRYPTO_CLASS ? "/swap" : `/assets/${classId}`;
  const empty = loading ? "Loading your position." : live && !owner ? "Connect a wallet to see your position." : `You hold no ${classId} right now.`;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
        <Link href="/portfolio" className="hover:text-ink">Portfolio</Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span className="text-ink">{classId}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-title font-semibold tracking-tight">Your {classId} position</h1>
          <p className="mt-1 text-sm text-muted">
            Updated every minute, at each publication.
            {status.latestSequence !== null && ` Latest is publication #${formatWhole(status.latestSequence)}.`}
          </p>
        </div>
        {holding && (
          <div className="flex items-start gap-2">
            <Link href={tradeHref} className="flex h-10 items-center rounded-pill border border-line px-4 text-sm transition-colors duration-150 hover:bg-surface-2">
              {classId === CRYPTO_CLASS ? "Swap" : "Buy or sell"}
            </Link>
            <span className="flex flex-col items-end gap-1">
              <SendButton
                intent={free > 0n && expiryBatch !== null ? { operation: "redeem", fromClass: classId, units: free.toString(), minimumProceeds: "0", expiryBatch } : null}
                describe={`Cash out your ${classId} position to ${COLLATERAL.symbol}`}
                label="Cash out"
                connectLabel="Cash out"
                className="h-10 rounded-pill bg-accent px-4 text-sm font-medium text-accent-ink"
                quiet
              />
            </span>
          </div>
        )}
      </div>

      {!holding ? (
        <p className={`${card} text-sm text-muted`}>{empty}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={card}>
              <div className="text-xs text-muted">Worth now, about</div>
              <div className="num mt-2 text-2xl">{worth === null ? "n/a" : formatAmount(worth, 4)} <span className="text-xs text-muted">{COLLATERAL.symbol}</span></div>
              <div className="mt-1 text-xs text-muted">{formatAmount(units, 4)} units at {unitValue === null ? "n/a" : formatAmount(unitValue, 6)}</div>
            </div>
            <div className={card}>
              <div className="text-xs text-muted">Gain or loss</div>
              <div className={`num mt-2 text-2xl ${tone}`}>{change === null ? "—" : formatSigned(change, 6)} <span className="text-xs text-muted">{COLLATERAL.symbol}</span></div>
              <div className={`num mt-1 text-xs ${tone || "text-muted"}`}>{percent === null ? "Since you bought" : `${formatSigned(percent, 4)}% since you bought`}</div>
            </div>
            <div className={card}>
              <div className="text-xs text-muted">Paid</div>
              <div className="num mt-2 text-2xl">{paid === null ? "—" : formatAmount(paid, 4)} <span className="text-xs text-muted">{COLLATERAL.symbol}</span></div>
              <div className="mt-1 text-xs text-muted">What this position cost you</div>
            </div>
            <div className={card}>
              <div className="text-xs text-muted">Locked in requests</div>
              <div className="num mt-2 text-2xl">{formatAmount(holding.locked, 4)}</div>
              <div className="mt-1 text-xs text-muted">Units waiting in an open order</div>
            </div>
          </div>

          {worthSeries.length > 1 ? (
            <AssetChart
              note="One value per one-minute publication, since your last buy or sale of this position. The dashed line is what you paid."
              series={[
                { id: "worth", label: `Worth (${COLLATERAL.symbol})`, points: worthSeries, digits: 6, baseline: paid ?? undefined },
                { id: "unit", label: "Unit value", points: since, digits: 6 },
                ...(reference.length > 1 ? [{ id: "reference", label: "COX reference", points: reference, digits: 4, baseline: 100 }] : []),
              ]}
            />
          ) : (
            <p className={`${card} text-sm text-muted`}>The chart starts at the next publication after your order filled.</p>
          )}
        </>
      )}

      <RequestList classId={classId} status={status} decimals={decimals} />
    </div>
  );
}
