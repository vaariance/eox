import Link from "next/link";
import { Change } from "@/components/change";
import { RequestList } from "@/components/request-list";
import { WalletAction } from "@/components/wallet-action";
import { WalletNote } from "@/components/wallet-note";
import { getDeployment, getPortfolio, getPublications } from "@/lib/data";
import { formatAmount, formatWhole } from "@/lib/format";
import { CRYPTO_CLASS, SCALE_DIGITS, classViews, findClass, latestOf, toNumber } from "@/lib/view";

export default async function PortfolioPage() {
  const [deployment, portfolio, publications] = await Promise.all([getDeployment(), getPortfolio(), getPublications()]);
  const decimals = deployment.collateralDecimals;
  const classes = classViews(latestOf(publications), decimals);
  const rows = portfolio.positions.map((position) => ({
    classId: position.classId,
    units: toNumber(position.units, SCALE_DIGITS),
    locked: toNumber(position.lockedUnits, SCALE_DIGITS),
    unitValue: findClass(classes, position.classId).unitValue,
    redeemable: toNumber(position.redeemableValue, decimals),
    deposited: toNumber(position.depositedBasis, decimals),
  }));
  const redeemable = rows.reduce((sum, row) => sum + row.redeemable, 0);
  const deposited = rows.reduce((sum, row) => sum + row.deposited, 0);
  const pendingDeposits = portfolio.pending
    .filter((request) => request.state === "queued" && request.amount !== null)
    .reduce((sum, request) => sum + toNumber(request.amount ?? "0", decimals), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          <WalletNote /> Your return comes from unit values, not from the reference charts.
          {portfolio.valuedAtSequence !== null && ` Valued at publication #${formatWhole(portfolio.valuedAtSequence)}.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Redeemable value</div>
          <div className="num mt-2 text-2xl">{formatAmount(redeemable)} <span className="text-xs text-muted">tUSDC</span></div>
          {deposited > 0 && <div className="mt-1 text-xs"><Change ratio={redeemable / deposited - 1} /> <span className="text-muted">on deposits</span></div>}
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Deposited</div>
          <div className="num mt-2 text-2xl">{formatAmount(deposited)} <span className="text-xs text-muted">tUSDC</span></div>
          <div className="mt-1 text-xs text-muted">In active positions</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Pending deposits</div>
          <div className="num mt-2 text-2xl">{formatAmount(pendingDeposits)} <span className="text-xs text-muted">tUSDC</span></div>
          <div className="mt-1 text-xs text-muted">Still yours until the batch executes</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Ready to withdraw</div>
          <div className="num mt-2 text-2xl">{formatAmount(toNumber(portfolio.withdrawalPayable, decimals))} <span className="text-xs text-muted">tUSDC</span></div>
          <div className="mt-3 flex flex-col gap-2">
            <WalletAction needsWallet="Connect wallet to withdraw" className="h-10 w-full rounded-pill bg-accent text-sm font-medium text-accent-ink" />
          </div>
        </div>
      </div>

      <section className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Positions</h2>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No positions yet.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-4 py-3 font-normal">Class</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Units</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Locked in requests</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Unit value</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Redeemable (tUSDC)</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Deposited (tUSDC)</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Profit and loss</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.classId} className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-surface-2">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    <Link href={row.classId === CRYPTO_CLASS ? "/crypto" : `/assets/${row.classId}`}>{row.classId}</Link>
                  </th>
                  <td className="num px-4 py-3 text-right">{formatAmount(row.units)}</td>
                  <td className="num px-4 py-3 text-right">{formatAmount(row.locked)}</td>
                  <td className="num px-4 py-3 text-right">{row.unitValue === null ? "n/a" : formatAmount(row.unitValue, 6)}</td>
                  <td className="num px-4 py-3 text-right">{formatAmount(row.redeemable)}</td>
                  <td className="num px-4 py-3 text-right">{formatAmount(row.deposited)}</td>
                  <td className="px-4 py-3 text-right">{row.deposited > 0 ? <Change ratio={row.redeemable / row.deposited - 1} /> : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <RequestList pending={portfolio.pending} receipts={portfolio.receipts} decimals={decimals} />
    </div>
  );
}
