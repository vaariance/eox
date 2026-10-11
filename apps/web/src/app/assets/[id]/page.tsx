import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetChart } from "@/components/asset-chart";
import { Change } from "@/components/change";
import { FirstPublication } from "@/components/first-publication";
import { MyPosition } from "@/components/my-position";
import { PriceSource } from "@/components/price-source";
import { RequestList } from "@/components/request-list";
import { TradeForm } from "@/components/trade-form";
import { getAssets, getCrypto, getDeployment, getPublications, getStatus } from "@/lib/data";
import { formatAmount, formatChange, formatPrice } from "@/lib/format";
import { changeSince, classViews, currentOf, decimalsOf, findClass, latest, levelSeries, priceOf, priceSeries, referenceSeries } from "@/lib/view";

const HOUR = 3600;
const EMPTY = "—";

function NoChart() {
  return (
    <section className="flex h-80 items-center justify-center rounded-card border border-line bg-surface p-4 text-sm text-muted shadow-card">
      The chart starts with the first publication.
    </section>
  );
}

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assets, crypto, deployment, publications, status] = await Promise.all([getAssets(), getCrypto(), getDeployment(), getPublications(), getStatus()]);
  const asset = assets.find((item) => item.assetId === id);
  if (!asset) notFound();

  const decimals = decimalsOf(deployment);
  const current = currentOf(publications);
  const classes = classViews(current, assets, decimals);
  const claim = findClass(classes, asset.assetId);
  const others = classes.filter((item) => item.id !== asset.assetId);

  const price = priceSeries(publications, asset.assetId);
  const reference = referenceSeries(publications, asset.assetId);
  const level = levelSeries(publications);
  const priceHour = current ? changeSince(price, HOUR) : 0;
  const cryptoHour = current ? changeSince(level, HOUR) : 0;
  const referenceHour = current ? changeSince(reference, HOUR) : 0;
  const verb = (ratio: number) => (ratio >= 0 ? "rose" : "fell");
  const size = (ratio: number) => formatChange(Math.abs(ratio)).slice(1);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-ink">Markets</Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span className="text-ink">{asset.assetId}</span>
      </nav>

      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">
          {asset.assetId} <span className="text-base font-normal text-muted">{asset.name !== asset.assetId && `${asset.name} `}against {crypto.label}</span>
        </h1>
        {current && (
          <p className="mt-1 text-sm text-muted">
            Last hour: {asset.assetId} {verb(priceHour)} {size(priceHour)}, CRYPTO {verb(cryptoHour)} {size(cryptoHour)}, so the reference {verb(referenceHour)} {size(referenceHour)}.
          </p>
        )}
      </div>

      {!current && <FirstPublication status={status} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Price (USD)</span>
            {current && <span className="flex items-center gap-1">1h <Change ratio={priceHour} /></span>}
          </div>
          <div className="num mt-2 text-2xl">{current ? formatPrice(latest(price)) : EMPTY}</div>
          <div className="mt-1 text-xs text-muted">{current ? <PriceSource price={priceOf(current, asset.assetId)} detailed /> : "No price published yet"}</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>COX reference</span>
            {current && <span className="flex items-center gap-1">1h <Change ratio={referenceHour} /></span>}
          </div>
          <div className="num mt-2 text-2xl">{current ? formatAmount(latest(reference), 4) : EMPTY}</div>
          <div className="mt-1 text-xs text-muted">Against CRYPTO, starts at 100</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="text-xs text-muted">Class unit value</div>
          <div className="num mt-2 text-2xl">{claim.unitValue === null ? "n/a" : formatAmount(claim.unitValue, 6)}</div>
          <div className="mt-1 text-xs text-muted">{formatAmount(claim.backing)} tUSDC backing</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {current ? (
            <AssetChart
              series={[
                { id: "reference", label: "COX reference", points: reference, digits: 4, baseline: 100 },
                { id: "price", label: "Price", points: price, digits: latest(price) >= 1 ? 2 : latest(price) >= 0.01 ? 4 : 6 },
                { id: "crypto", label: "CRYPTO", points: level, digits: 4, baseline: 100 },
              ]}
            />
          ) : (
            <NoChart />
          )}
          <RequestList classId={asset.assetId} status={status} decimals={decimals} />
        </div>
        <div className="flex flex-col gap-6">
          <TradeForm claim={claim} others={others} nextBatch={status.currentBatch} decimals={decimals} />
          <MyPosition classId={asset.assetId} unitValue={claim.unitValue} />
        </div>
      </div>
    </div>
  );
}
