import { Activity, Layers, Users } from "lucide-react";
import Link from "next/link";
import { AssetChart } from "@/components/asset-chart";
import { Change } from "@/components/change";
import { CoinIcon } from "@/components/coin-icon";
import { FirstPublication } from "@/components/first-publication";
import { MyPosition } from "@/components/my-position";
import { PriceSource } from "@/components/price-source";
import { Figure, StatCard } from "@/components/stat-card";
import { getAssets, getCrypto, getDeployment, getPublications, getStatus } from "@/lib/data";
import { direction, formatAmount } from "@/lib/format";
import { CRYPTO_CLASS, changeSince, classViews, currentOf, decimalsOf, findClass, latest, levelSeries, priceOf, priceSeries } from "@/lib/view";

const HOUR = 3600;
const SPARK = 60;
const EMPTY = "—";

export default async function CryptoPage() {
  const [assets, crypto, deployment, publications, status] = await Promise.all([getAssets(), getCrypto(), getDeployment(), getPublications(), getStatus()]);
  const decimals = decimalsOf(deployment);
  const current = currentOf(publications);
  const classes = classViews(current, assets, decimals);
  const claim = findClass(classes, CRYPTO_CLASS);

  const level = levelSeries(publications);
  const members = crypto.members.map((member) => {
    const asset = assets.find((item) => item.assetId === member.assetId);
    const weight = Number(member.weightNumerator) / Number(member.weightDenominator);
    const priceHour = current ? changeSince(priceSeries(publications, member.assetId), HOUR) : 0;
    return { id: member.assetId, name: asset?.name ?? "", weight, priceHour, contribution: priceHour * weight };
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-title font-semibold tracking-tight">$CRYPTO</h1>

      {!current && <FirstPublication status={status} />}

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard
          icon={Activity}
          title="$CRYPTO level"
          aside="starts at 100"
          value={current ? <Figure text={formatAmount(latest(level), 4)} /> : EMPTY}
          change={current ? changeSince(level, HOUR) : null}
          caption="last hour"
          spark={current ? { points: level.slice(-SPARK), tone: direction(changeSince(level, HOUR)) } : null}
        />
        <StatCard icon={Users} title="Members" value={<Figure text={String(members.length)} />} caption={`each weighted 1/${members.length}`}>
          <div className="mt-3 flex">
            {members.slice(0, 9).map((member) => (
              <span key={member.id} className="-ml-1.5 rounded-full ring-2 ring-surface first:ml-0">
                <CoinIcon id={member.id} size={22} />
              </span>
            ))}
          </div>
        </StatCard>
        <StatCard
          icon={Layers}
          title="Class unit value"
          value={claim.unitValue === null ? "n/a" : <Figure text={formatAmount(claim.unitValue, 6)} />}
          caption={`${formatAmount(claim.backing)} USDC backing`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {current ? (
            <AssetChart series={[{ id: "level", label: "$CRYPTO level", points: level, digits: 4, baseline: 100 }]} />
          ) : (
            <section className="flex h-80 items-center justify-center rounded-card border border-line bg-surface p-4 text-sm text-muted shadow-card">
              The chart starts with the first publication.
            </section>
          )}

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
                        <span className="font-medium">{member.id}</span> {member.name !== member.id && <span className="text-xs text-muted">{member.name}</span>}
                      </Link>
                    </th>
                    <td className="px-4 py-3">{current ? <PriceSource price={priceOf(current, member.id)} /> : <span className="text-muted">{EMPTY}</span>}</td>
                    <td className="num px-4 py-3 text-right">{(member.weight * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right">{current ? <Change ratio={member.priceHour} /> : <span className="text-muted">{EMPTY}</span>}</td>
                    <td className="px-4 py-3 text-right">{current ? <Change ratio={member.contribution} /> : <span className="text-muted">{EMPTY}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <MyPosition classId={CRYPTO_CLASS} unitValue={claim.unitValue} decimals={decimals} />
          <Link href="/swap" className="flex h-11 items-center justify-center rounded-pill bg-accent text-sm font-medium text-accent-ink transition-opacity duration-150 hover:opacity-90">
            Swap USDC and $CRYPTO
          </Link>
        </div>
      </div>
    </div>
  );
}
