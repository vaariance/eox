import Link from "next/link";
import { AssetChart } from "@/components/asset-chart";
import { Change } from "@/components/change";
import { PriceSource } from "@/components/price-source";
import { TradeForm } from "@/components/trade-form";
import { getAssets, getCrypto, getDeployment, getPublications, getStatus } from "@/lib/data";
import { formatAmount } from "@/lib/format";
import { CRYPTO_CLASS, changeSince, classViews, decimalsOf, findClass, latest, latestOf, levelSeries, priceOf, priceSeries } from "@/lib/view";

const HOUR = 3600;

export default async function CryptoPage() {
  const [assets, crypto, deployment, publications, status] = await Promise.all([getAssets(), getCrypto(), getDeployment(), getPublications(), getStatus()]);
  const current = latestOf(publications);
  const classes = classViews(current, decimalsOf(deployment));
  const claim = findClass(classes, CRYPTO_CLASS);
  const level = levelSeries(publications);
  const members = crypto.members.map((member) => {
    const asset = assets.find((item) => item.assetId === member.assetId);
    const weight = Number(member.weightNumerator) / Number(member.weightDenominator);
    const priceHour = changeSince(priceSeries(publications, member.assetId), HOUR);
    return { id: member.assetId, name: asset?.name ?? "", weight, priceHour, contribution: priceHour * weight };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">CRYPTO</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          The shared benchmark every asset is measured against. This is {crypto.label}: equal weights, applied again at every publication. It is a pilot list, not the whole crypto market.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>CRYPTO level</span>
            <span className="flex items-center gap-1">1h <Change ratio={changeSince(level, HOUR)} /></span>
          </div>
          <div className="num mt-2 text-2xl">{formatAmount(latest(level), 4)}</div>
          <div className="mt-1 text-xs text-muted">Starts at 100</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Members</div>
          <div className="num mt-2 text-2xl">{members.length}</div>
          <div className="mt-1 text-xs text-muted">Each weighted 1/{members.length}</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Class unit value</div>
          <div className="num mt-2 text-2xl">{claim.unitValue === null ? "n/a" : formatAmount(claim.unitValue, 6)}</div>
          <div className="mt-1 text-xs text-muted">{formatAmount(claim.backing)} tUSDC backing</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <AssetChart series={[{ id: "level", label: "CRYPTO level", points: level, digits: 4, baseline: 100 }]} />

          <section className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
            <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Members</h2>
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-4 py-3 font-normal">Asset</th>
                  <th scope="col" className="px-4 py-3 font-normal">Price source</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Weight</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Price, 1h</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Contribution, 1h</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-surface-2">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <Link href={`/assets/${member.id}`}>
                        <span className="font-medium">{member.id}</span> <span className="text-xs text-muted">{member.name}</span>
                      </Link>
                    </th>
                    <td className="px-4 py-3"><PriceSource price={priceOf(current, member.id)} /></td>
                    <td className="num px-4 py-3 text-right">{(member.weight * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right"><Change ratio={member.priceHour} /></td>
                    <td className="px-4 py-3 text-right"><Change ratio={member.contribution} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <TradeForm claim={claim} others={classes.filter((item) => item.id !== CRYPTO_CLASS)} nextBatch={status.currentBatch} />
          <p className="px-1 text-xs text-muted">
            A CRYPTO position follows the benchmark. It is not cash and it is not risk-free: its unit value can fall.
          </p>
        </div>
      </div>
    </div>
  );
}
