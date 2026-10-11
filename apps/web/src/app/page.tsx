import Link from "next/link";
import { Change } from "@/components/change";
import { PriceSource } from "@/components/price-source";
import { Sparkline } from "@/components/sparkline";
import { getAssets, getCrypto, getDeployment, getPublications } from "@/lib/data";
import { direction, formatAmount, formatPrice } from "@/lib/format";
import { CRYPTO_CLASS, changeSince, decimalsOf, classViews, findClass, latest, latestOf, levelSeries, priceOf, priceSeries, referenceSeries } from "@/lib/view";

const HOUR = 3600;
const WINDOW = 4 * HOUR;

export default async function MarketsPage() {
  const [assets, crypto, deployment, publications] = await Promise.all([getAssets(), getCrypto(), getDeployment(), getPublications()]);
  const current = latestOf(publications);
  const classes = classViews(current, decimalsOf(deployment));
  const active = classes.reduce((sum, item) => sum + item.backing, 0);
  const level = levelSeries(publications);
  const cryptoClass = findClass(classes, CRYPTO_CLASS);

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
            <dd className="num mt-0.5 text-lg">{formatAmount(active)} <span className="text-xs text-muted">tUSDC</span></dd>
          </div>
          <div>
            <dt className="text-xs text-muted">CRYPTO level</dt>
            <dd className="num mt-0.5 text-lg">{formatAmount(latest(level), 4)}</dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-4 py-3 font-normal">Asset</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Price (USD)</th>
              <th scope="col" className="px-4 py-3 font-normal">Price source</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">COX reference</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Reference, 1h</th>
              <th scope="col" className="px-4 py-3 font-normal">Last 4h</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Class backing</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Unit value</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const reference = referenceSeries(publications, asset.assetId);
              const claim = findClass(classes, asset.assetId);
              return (
                <tr key={asset.assetId} className="border-b border-line transition-colors duration-150 hover:bg-surface-2">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link href={`/assets/${asset.assetId}`} className="flex items-baseline gap-2">
                      <span className="font-medium text-ink">{asset.assetId}</span>
                      <span className="text-xs text-muted">{asset.name}</span>
                    </Link>
                  </th>
                  <td className="num px-4 py-3 text-right">{formatPrice(latest(priceSeries([current], asset.assetId)))}</td>
                  <td className="px-4 py-3"><PriceSource price={priceOf(current, asset.assetId)} /></td>
                  <td className="num px-4 py-3 text-right text-base">{formatAmount(latest(reference), 4)}</td>
                  <td className="px-4 py-3 text-right"><Change ratio={changeSince(reference, HOUR)} /></td>
                  <td className="px-4 py-3"><Sparkline points={reference} tone={direction(changeSince(reference, WINDOW))} /></td>
                  <td className="num px-4 py-3 text-right">{formatAmount(claim.backing)}</td>
                  <td className="num px-4 py-3 text-right">{claim.unitValue === null ? "n/a" : formatAmount(claim.unitValue, 6)}</td>
                </tr>
              );
            })}
            <tr className="bg-bg">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <Link href="/crypto" className="flex items-baseline gap-2">
                  <span className="font-medium text-ink">CRYPTO</span>
                  <span className="text-xs text-muted">Benchmark, pilot, equal weight</span>
                </Link>
              </th>
              <td className="num px-4 py-3 text-right text-muted">n/a</td>
              <td className="px-4 py-3 text-xs text-muted">All {assets.length} assets</td>
              <td className="num px-4 py-3 text-right text-base">{formatAmount(100, 4)}</td>
              <td className="px-4 py-3 text-right"><Change ratio={0} /></td>
              <td className="px-4 py-3"><Sparkline points={level} tone={direction(changeSince(level, WINDOW))} /></td>
              <td className="num px-4 py-3 text-right">{formatAmount(cryptoClass.backing)}</td>
              <td className="num px-4 py-3 text-right">{cryptoClass.unitValue === null ? "n/a" : formatAmount(cryptoClass.unitValue, 6)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        A rising reference is not a promise of the same gain on a position. What a position can redeem for is its class unit value, set by the pool at each publication. Each price is the exchange's one-minute closing price for the batch: Kraken first, then Coinbase, then Bybit when Kraken had no trade.
      </p>
    </div>
  );
}
