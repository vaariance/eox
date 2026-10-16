import { Activity, ChevronRight, DollarSign, Layers } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetChart } from "@/components/asset-chart";
import { CoinIcon } from "@/components/coin-icon";
import { FirstPublication } from "@/components/first-publication";
import { MyPosition } from "@/components/my-position";
import { RequestList } from "@/components/request-list";
import { Figure, StatCard } from "@/components/stat-card";
import { TradeForm } from "@/components/trade-form";
import { getAssets, getDeployment, getPublications, getStatus } from "@/lib/data";
import { direction, formatAmount, formatPrice } from "@/lib/format";
import { CRYPTO_CLASS, changeSince, classViews, currentOf, decimalsOf, findClass, latest, levelSeries, priceSeries, referenceSeries, standingOf } from "@/lib/view";

const HOUR = 3600;
const SPARK = 60;
const EMPTY = "—";

function NoChart() {
  return (
    <section className="flex h-80 items-center justify-center rounded-card border border-line bg-surface p-4 text-sm text-muted shadow-card">
      The chart starts with the first price update.
    </section>
  );
}

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assets, deployment, publications, status] = await Promise.all([getAssets(), getDeployment(), getPublications(), getStatus()]);
  const asset = assets.find((item) => item.assetId === id);
  if (!asset) notFound();

  const decimals = decimalsOf(deployment);
  const current = currentOf(publications);
  const classes = classViews(current, assets, decimals);
  const claim = findClass(classes, asset.assetId);
  const cryptoClass = findClass(classes, CRYPTO_CLASS);

  const price = priceSeries(publications, asset.assetId);
  const reference = referenceSeries(publications, asset.assetId);
  const level = levelSeries(publications);
  const priceHour = current ? changeSince(price, HOUR) : 0;
  const relative = current ? standingOf(reference) : 0;
  const standing = direction(relative);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
        <Link href="/markets" className="hover:text-ink">Markets</Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span className="text-ink">{asset.assetId}</span>
      </nav>

      <h1 className="flex items-center gap-3 font-display text-title font-semibold tracking-tight">
        <CoinIcon id={asset.assetId} size={36} />
        {asset.assetId}
        {asset.name !== asset.assetId && <span className="text-base font-normal text-muted">{asset.name}</span>}
      </h1>

      {!current && <FirstPublication />}

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard
          icon={DollarSign}
          title="Price"
          aside="USD"
          value={current ? <Figure text={formatPrice(latest(price))} /> : EMPTY}
          change={current ? priceHour : null}
          caption={current ? "last hour" : "No price yet"}
          spark={current ? { points: price.slice(-SPARK), tone: direction(priceHour) } : null}
        />
        <StatCard
          icon={Activity}
          title="Relative reference"
          aside="starts at 100"
          value={current ? <Figure text={formatAmount(latest(reference), 4)} /> : EMPTY}
          change={current ? relative : null}
          caption={standing === "up" ? "ahead of $CRYPTO" : standing === "down" ? "behind $CRYPTO" : "level with $CRYPTO"}
          spark={current ? { points: reference, tone: standing } : null}
        />
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
            <AssetChart
              series={[
                { id: "reference", label: "Relative reference", points: reference, digits: 4, baseline: 100 },
                { id: "price", label: "Price", points: price, digits: latest(price) >= 1 ? 2 : latest(price) >= 0.01 ? 4 : 6 },
                { id: "crypto", label: "$CRYPTO", points: level, digits: 4, baseline: 100 },
              ]}
            />
          ) : (
            <NoChart />
          )}
          <RequestList classId={asset.assetId} status={status} decimals={decimals} />
        </div>
        <div className="flex flex-col gap-6">
          <TradeForm claim={claim} crypto={cryptoClass} nextBatch={status.currentBatch} decimals={decimals} />
          <MyPosition classId={asset.assetId} unitValue={claim.unitValue} decimals={decimals} />
        </div>
      </div>
    </div>
  );
}
