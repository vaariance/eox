import { Activity, Coins, LayoutList, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Change } from "@/components/change";
import { CoinIcon } from "@/components/coin-icon";
import { FirstPublication } from "@/components/first-publication";
import { RowLink } from "@/components/row-link";
import { Sparkline } from "@/components/sparkline";
import { CardTitle, Figure, StatCard } from "@/components/stat-card";
import { getAssets, getDeployment, getPublications } from "@/lib/data";
import { direction, formatAmount, formatPrice } from "@/lib/format";
import { changeSince, decimalsOf, standingOf, classViews, currentOf, findClass, latest, levelSeries, priceSeries, referenceSeries } from "@/lib/view";

const HOUR = 3600;
const SPARK = 240;
const EMPTY = "—";

function EmptyRow({ id, name, href }: { id: string; name: string; href: string }) {
  return (
    <RowLink href={href} className="border-b border-line transition-colors last:border-b-0 duration-150 hover:bg-surface-2">
      <th scope="row" className="px-4 py-3 text-left font-normal">
        <Link href={href} className="flex items-center gap-2.5">
          <CoinIcon id={id} />
          <span className="font-medium text-ink">{id}</span>
          {name !== id && <span className="text-xs text-muted">{name}</span>}
        </Link>
      </th>
      <td className="num px-4 py-3 text-right text-muted">{EMPTY}</td>
      <td className="num px-4 py-3 text-right text-base text-muted">{EMPTY}</td>
      <td className="px-4 py-3 text-right text-muted">{EMPTY}</td>
      <td className="px-4 py-3 text-muted">{EMPTY}</td>
      <td className="num px-4 py-3 text-right">{formatAmount(0)}</td>
    </RowLink>
  );
}

export default async function MarketsPage() {
  const [assets, deployment, publications] = await Promise.all([getAssets(), getDeployment(), getPublications()]);
  const current = currentOf(publications);

  const classes = classViews(current, assets, decimalsOf(deployment));
  const active = classes.reduce((sum, item) => sum + item.backing, 0);
  const level = levelSeries(publications);
  const ranked = current
    ? assets
        .map((asset) => {
          const reference = referenceSeries(publications, asset.assetId);
          return { id: asset.assetId, reference, standing: standingOf(reference) };
        })
        .sort((left, right) => right.standing - left.standing)
    : [];
  const best = ranked[0] ?? null;
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-title font-semibold tracking-tight">Markets</h1>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Activity}
          title="Index"
          value={current ? <Figure text={formatAmount(latest(level), 4)} /> : EMPTY}
          change={current ? changeSince(level, HOUR) : null}
          caption="last hour"
          spark={current ? { points: level.slice(-SPARK), tone: direction(changeSince(level, HOUR)) } : null}
        />
        <StatCard
          icon={TrendingUp}
          title="Leading"
          value={best ? <><CoinIcon id={best.id} size={28} />{best.id}</> : EMPTY}
          change={best ? best.standing : null}
          caption="vs $CRYPTO"
          spark={best ? { points: best.reference, tone: direction(best.standing) } : null}
        />
        <StatCard
          icon={TrendingDown}
          title="Trailing"
          value={worst ? <><CoinIcon id={worst.id} size={28} />{worst.id}</> : EMPTY}
          change={worst ? worst.standing : null}
          caption="vs $CRYPTO"
          spark={worst ? { points: worst.reference, tone: direction(worst.standing) } : null}
        />
        <StatCard icon={Coins} title="Pool TVL" value={<Figure text={formatAmount(active)} unit="USDC" />} caption={`across ${classes.length} classes`} />
      </div>

      {!current && <FirstPublication />}

      <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <div className="border-b border-line px-4 py-3">
          <CardTitle icon={LayoutList} aside={`${assets.length} coins`}>All markets</CardTitle>
        </div>
        <table className="w-full min-w-[660px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-4 py-3 font-normal">Asset</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Price (USD)</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Relative reference</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Performance</th>
              <th scope="col" className="px-4 py-3 font-normal">Last 4h</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Class backing</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const reference = referenceSeries(publications, asset.assetId);
              const claim = findClass(classes, asset.assetId);
              if (!current) return <EmptyRow key={asset.assetId} id={asset.assetId} name={asset.name} href={`/assets/${asset.assetId}`} />;
              return (
                <RowLink key={asset.assetId} href={`/assets/${asset.assetId}`} className="border-b border-line transition-colors last:border-b-0 duration-150 hover:bg-surface-2">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link href={`/assets/${asset.assetId}`} className="flex items-center gap-2.5">
                      <CoinIcon id={asset.assetId} />
                      <span className="font-medium text-ink">{asset.assetId}</span>
                      {asset.name !== asset.assetId && <span className="text-xs text-muted">{asset.name}</span>}
                    </Link>
                  </th>
                  <td className="num px-4 py-3 text-right">{formatPrice(latest(priceSeries([current], asset.assetId)))}</td>
                  <td className="num px-4 py-3 text-right text-base">{formatAmount(latest(reference), 4)}</td>
                  <td className="px-4 py-3 text-right"><Change ratio={standingOf(reference)} /></td>
                  <td className="px-4 py-3"><Sparkline points={reference.slice(-SPARK)} tone={direction(standingOf(reference))} /></td>
                  <td className="num px-4 py-3 text-right">{formatAmount(claim.backing)}</td>
                </RowLink>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
