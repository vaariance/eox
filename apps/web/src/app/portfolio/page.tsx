import Link from "next/link";
import { RequestList } from "@/components/request-list";
import { WalletAction } from "@/components/wallet-action";
import { WalletNote } from "@/components/wallet-note";
import { getDeployment, getPortfolio, getPublications, getStatus } from "@/lib/data";
import { formatAmount, formatWhole } from "@/lib/format";
import { CRYPTO_CLASS, SCALE_DIGITS, classViews, decimalsOf, findClass, latestOf, toNumber } from "@/lib/view";

export default async function PortfolioPage() {
  const [deployment, portfolio, publications, status] = await Promise.all([getDeployment(), getPortfolio(), getPublications(), getStatus()]);
  const decimals = decimalsOf(deployment);

  if (!portfolio) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-title font-semibold tracking-tight">Portfolio</h1>
        <p className="max-w-2xl text-sm text-muted">There is no wallet to show yet. Looking up a connected wallet arrives with the live API.</p>
      </div>
    );
  }

  const classes = classViews(latestOf(publications), decimals);
  const rows = portfolio.positions.map((position) => {
    const units = toNumber(position.units, SCALE_DIGITS);
    const unitValue = findClass(classes, position.classId).unitValue;
    return { classId: position.classId, units, locked: toNumber(position.locked, SCALE_DIGITS), unitValue, redeemable: unitValue === null ? null : units * unitValue };
  });
  const redeemable = rows.reduce((sum, row) => sum + (row.redeemable ?? 0), 0);
  const cards = [
    { label: "Redeemable now, about", value: redeemable, note: "Your units at the latest unit values" },
    { label: "Pending buys", value: toNumber(portfolio.pending, decimals), note: "Still yours until the batch executes" },
    { label: "Refundable", value: toNumber(portfolio.refundable, decimals), note: "From rejected, expired or cancelled buys" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          <WalletNote /> Your return comes from unit values, not from the reference charts.
          {portfolio.appliedSequence !== null && ` Up to date with publication #${formatWhole(portfolio.appliedSequence)}.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-card border border-line bg-surface p-4 shadow-card">
            <div className="text-xs text-muted">{card.label}</div>
            <div className="num mt-2 text-2xl">{formatAmount(card.value)} <span className="text-xs text-muted">tUSDC</span></div>
            <div className="mt-1 text-xs text-muted">{card.note}</div>
          </div>
        ))}
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Ready to withdraw</div>
          <div className="num mt-2 text-2xl">{formatAmount(toNumber(portfolio.payable, decimals))} <span className="text-xs text-muted">tUSDC</span></div>
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
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-4 py-3 font-normal">Class</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Units</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Locked in requests</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Unit value</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Redeemable, about (tUSDC)</th>
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
                  <td className="num px-4 py-3 text-right">{row.redeemable === null ? "n/a" : formatAmount(row.redeemable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <RequestList requests={portfolio.requests} status={status} decimals={decimals} />
    </div>
  );
}
