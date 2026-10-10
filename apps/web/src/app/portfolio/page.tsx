import Link from "next/link";
import { Change } from "@/components/change";
import { RequestList } from "@/components/request-list";
import { WalletAction } from "@/components/wallet-action";
import { WalletNote } from "@/components/wallet-note";
import { formatAmount, formatWhole } from "@/lib/format";
import { account, findClass, positions, requests } from "@/lib/sample";

export default function PortfolioPage() {
  const rows = positions.map((position) => {
    const claim = findClass(position.classId);
    return { ...position, unitValue: claim.unitValue, redeemable: position.units * claim.unitValue };
  });
  const redeemable = rows.reduce((sum, row) => sum + row.redeemable, 0);
  const deposited = rows.reduce((sum, row) => sum + row.deposited, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          <WalletNote /> Your return comes from unit values, not from the reference charts.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Redeemable value</div>
          <div className="num mt-2 text-2xl">{formatAmount(redeemable)} <span className="text-xs text-muted">tCOX</span></div>
          <div className="mt-1 text-xs"><Change ratio={redeemable / deposited - 1} /> <span className="text-muted">on deposits</span></div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Deposited</div>
          <div className="num mt-2 text-2xl">{formatAmount(deposited)} <span className="text-xs text-muted">tCOX</span></div>
          <div className="mt-1 text-xs text-muted">In active positions</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Pending deposits</div>
          <div className="num mt-2 text-2xl">{formatAmount(account.pendingDeposits)} <span className="text-xs text-muted">tCOX</span></div>
          <div className="mt-1 text-xs text-muted">Still yours until the batch executes</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Ready to withdraw</div>
          <div className="num mt-2 text-2xl">{formatAmount(account.withdrawalPayable)} <span className="text-xs text-muted">tCOX</span></div>
          <div className="mt-3 flex flex-col gap-2">
            <WalletAction needsWallet="Connect wallet to withdraw" className="h-10 w-full rounded-pill bg-accent text-sm font-medium text-accent-ink" />
          </div>
        </div>
      </div>

      <section className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Positions</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-4 py-3 font-normal">Class</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Units</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Unit value</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Redeemable (tCOX)</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Deposited (tCOX)</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Profit and loss</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.classId} className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-surface-2">
                <th scope="row" className="px-4 py-3 text-left font-medium">
                  <Link href={row.classId === "CRYPTO" ? "/crypto" : `/assets/${row.classId}`}>{row.classId}</Link>
                </th>
                <td className="num px-4 py-3 text-right">{formatAmount(row.units)}</td>
                <td className="num px-4 py-3 text-right">{formatAmount(row.unitValue, 6)}</td>
                <td className="num px-4 py-3 text-right">{formatAmount(row.redeemable)}</td>
                <td className="num px-4 py-3 text-right">{formatAmount(row.deposited)}</td>
                <td className="px-4 py-3 text-right"><Change ratio={row.redeemable / row.deposited - 1} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <RequestList requests={requests} />

      <section className="rounded-card border border-line bg-surface shadow-card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Withdrawals</h2>
        <ul>
          {account.withdrawals.map((withdrawal) => (
            <li key={withdrawal.id} className="flex items-center justify-between border-b border-line px-4 py-3 text-sm last:border-b-0">
              <span className="num">{formatAmount(withdrawal.amount)} <span className="text-xs text-muted">tCOX</span></span>
              <span className="num text-muted">Paid after batch #{formatWhole(withdrawal.batch)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
