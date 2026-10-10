import { AssetChart } from "@/components/asset-chart";
import { Change } from "@/components/change";
import { TradeForm } from "@/components/trade-form";
import { formatAmount, formatChange } from "@/lib/format";
import { assets, change, classes, crypto, findClass, latest, publication } from "@/lib/sample";

const HOUR = 60;

export default function CryptoPage() {
  const claim = findClass("CRYPTO");
  const levelHour = change(crypto.level, HOUR);
  const members = assets.map((asset) => {
    const priceHour = change(asset.price, HOUR);
    return { asset, priceHour, contribution: priceHour * crypto.weight };
  });

  const stats = [
    { label: "CRYPTO level", value: formatAmount(latest(crypto.level), 4), ratio: levelHour, note: "Starts at 100" },
    { label: "Members", value: String(assets.length), ratio: null, note: "Pilot roster, not all of crypto" },
    { label: "Class unit value", value: formatAmount(claim.unitValue, 6), ratio: null, note: `${formatAmount(claim.backing)} tCOX backing` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">CRYPTO</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          The shared benchmark every asset is measured against. This is {crypto.label}: equal weights, applied again at every publication.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-card border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{stat.label}</span>
              {stat.ratio !== null && <span className="flex items-center gap-1">1h <Change ratio={stat.ratio} /></span>}
            </div>
            <div className="num mt-2 text-2xl">{stat.value}</div>
            <div className="mt-1 text-xs text-muted">{stat.note}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <AssetChart series={[{ id: "level", label: "CRYPTO level", points: crypto.level, digits: 4, baseline: 100 }]} />

          <section className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
            <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Members</h2>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-4 py-3 font-normal">Asset</th>
                  <th scope="col" className="px-4 py-3 font-normal">Pyth feed</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Weight</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Price, 1h</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Contribution, 1h</th>
                </tr>
              </thead>
              <tbody>
                {members.map(({ asset, priceHour, contribution }) => (
                  <tr key={asset.id} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <span className="font-medium">{asset.id}</span> <span className="text-xs text-muted">{asset.name}</span>
                    </th>
                    <td className="px-4 py-3 text-muted">{asset.feed}</td>
                    <td className="num px-4 py-3 text-right">{formatChange(crypto.weight).slice(1)}</td>
                    <td className="px-4 py-3 text-right"><Change ratio={priceHour} /></td>
                    <td className="px-4 py-3 text-right"><Change ratio={contribution} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <TradeForm claim={claim} others={classes.filter((item) => item.id !== "CRYPTO")} nextBatch={publication.sequence + 1} />
          <p className="px-1 text-xs text-muted">
            A CRYPTO position follows the benchmark. It is not cash and it is not risk-free: its unit value can fall.
          </p>
        </div>
      </div>
    </div>
  );
}
