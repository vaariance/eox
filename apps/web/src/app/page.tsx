import Link from "next/link";
import { Change } from "@/components/change";
import { Sparkline } from "@/components/sparkline";
import { direction, formatAmount } from "@/lib/format";
import { assets, change, classes, crypto, findClass, latest } from "@/lib/sample";

const HOUR = 60;

export default function MarketsPage() {
  const active = classes.reduce((sum, item) => sum + item.backing, 0);
  const cryptoClass = findClass("CRYPTO");
  const cryptoChange = change(crypto.level, HOUR);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-title font-semibold tracking-tight">Markets</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Each asset is measured against {crypto.label}. A reference above 100 means the asset has outperformed CRYPTO since the origin.
          </p>
        </div>
        <dl className="flex gap-8 text-sm">
          <div>
            <dt className="text-xs text-muted">Active backing</dt>
            <dd className="num mt-0.5 text-lg">{formatAmount(active)} <span className="text-xs text-muted">tCOX</span></dd>
          </div>
          <div>
            <dt className="text-xs text-muted">CRYPTO level</dt>
            <dd className="num mt-0.5 text-lg">{formatAmount(latest(crypto.level), 4)}</dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-4 py-3 font-normal">Asset</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Price (USD)</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">COX reference</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Reference, 1h</th>
              <th scope="col" className="px-4 py-3 font-normal">Last 4h</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Class backing</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Unit value</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const hour = change(asset.reference, HOUR);
              const claim = findClass(asset.id);
              return (
                <tr key={asset.id} className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-surface-2">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link href={`/assets/${asset.id}`} className="flex items-baseline gap-2">
                      <span className="font-medium text-ink">{asset.id}</span>
                      <span className="text-xs text-muted">{asset.name}</span>
                    </Link>
                  </th>
                  <td className="num px-4 py-3 text-right">{formatAmount(latest(asset.price))}</td>
                  <td className="num px-4 py-3 text-right text-base">{formatAmount(latest(asset.reference), 4)}</td>
                  <td className="px-4 py-3 text-right"><Change ratio={hour} /></td>
                  <td className="px-4 py-3"><Sparkline points={asset.reference} tone={direction(change(asset.reference, 239))} /></td>
                  <td className="num px-4 py-3 text-right">{formatAmount(claim.backing)}</td>
                  <td className="num px-4 py-3 text-right">{formatAmount(claim.unitValue, 6)}</td>
                </tr>
              );
            })}
            <tr className="bg-bg">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <span className="flex items-baseline gap-2">
                  <span className="font-medium text-ink">CRYPTO</span>
                  <span className="text-xs text-muted">Benchmark, pilot, equal weight</span>
                </span>
              </th>
              <td className="num px-4 py-3 text-right text-muted">n/a</td>
              <td className="num px-4 py-3 text-right text-base">{formatAmount(100, 4)}</td>
              <td className="px-4 py-3 text-right"><Change ratio={0} /></td>
              <td className="px-4 py-3"><Sparkline points={crypto.level} tone={direction(cryptoChange)} /></td>
              <td className="num px-4 py-3 text-right">{formatAmount(cryptoClass.backing)}</td>
              <td className="num px-4 py-3 text-right">{formatAmount(cryptoClass.unitValue, 6)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        A rising reference is not a promise of the same gain on a position. What a position can redeem for is its class unit value, set by the pool at each publication.
      </p>
    </div>
  );
}
