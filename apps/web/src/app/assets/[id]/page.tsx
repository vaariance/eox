import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetChart } from "@/components/asset-chart";
import { Change } from "@/components/change";
import { PriceSource } from "@/components/price-source";
import { RequestList } from "@/components/request-list";
import { TradeForm } from "@/components/trade-form";
import { getAssets, getCrypto, getDeployment, getPortfolio, getPublications, getStatus } from "@/lib/data";
import { formatAmount, formatChange, formatPrice } from "@/lib/format";
import { SCALE_DIGITS, changeSince, classViews, decimalsOf, findClass, latest, latestOf, levelSeries, priceOf, priceSeries, referenceSeries, toNumber } from "@/lib/view";

const HOUR = 3600;

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assets, crypto, deployment, portfolio, publications, status] = await Promise.all([
    getAssets(),
    getCrypto(),
    getDeployment(),
    getPortfolio(),
    getPublications(),
    getStatus(),
  ]);
  const asset = assets.find((item) => item.assetId === id);
  if (!asset) notFound();

  const decimals = decimalsOf(deployment);
  const current = latestOf(publications);
  const classes = classViews(current, decimals);
  const claim = findClass(classes, asset.assetId);
  const price = priceSeries(publications, asset.assetId);
  const reference = referenceSeries(publications, asset.assetId);
  const level = levelSeries(publications);
  const priceHour = changeSince(price, HOUR);
  const cryptoHour = changeSince(level, HOUR);
  const referenceHour = changeSince(reference, HOUR);
  const verb = (ratio: number) => (ratio >= 0 ? "rose" : "fell");
  const size = (ratio: number) => formatChange(Math.abs(ratio)).slice(1);
  const holding = portfolio?.positions.find((item) => item.classId === asset.assetId);
  const heldUnits = holding ? toNumber(holding.units, SCALE_DIGITS) : 0;
  const involved = (classId: string | null) => classId === asset.assetId;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-ink">Markets</Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span className="text-ink">{asset.assetId}</span>
      </nav>

      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">
          {asset.assetId} <span className="text-base font-normal text-muted">{asset.name} against {crypto.label}</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          Last hour: {asset.assetId} {verb(priceHour)} {size(priceHour)}, CRYPTO {verb(cryptoHour)} {size(cryptoHour)}, so the reference {verb(referenceHour)} {size(referenceHour)}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Price (USD)</span>
            <span className="flex items-center gap-1">1h <Change ratio={priceHour} /></span>
          </div>
          <div className="num mt-2 text-2xl">{formatPrice(latest(price))}</div>
          <div className="mt-1 text-xs text-muted"><PriceSource price={priceOf(current, asset.assetId)} detailed /></div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>COX reference</span>
            <span className="flex items-center gap-1">1h <Change ratio={referenceHour} /></span>
          </div>
          <div className="num mt-2 text-2xl">{formatAmount(latest(reference), 4)}</div>
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
          <AssetChart
            series={[
              { id: "reference", label: "COX reference", points: reference, digits: 4, baseline: 100 },
              { id: "price", label: "Price", points: price, digits: latest(price) >= 1 ? 2 : latest(price) >= 0.01 ? 4 : 6 },
              { id: "crypto", label: "CRYPTO", points: level, digits: 4, baseline: 100 },
            ]}
          />
          <RequestList
            requests={(portfolio?.requests ?? []).filter((request) => involved(request.fromClass) || involved(request.toClass))}
            status={status}
            decimals={decimals}
          />
        </div>
        <div className="flex flex-col gap-6">
          <TradeForm claim={claim} others={classes.filter((item) => item.id !== asset.assetId)} nextBatch={status.currentBatch} />
          <section className="rounded-card border border-line bg-surface p-4 shadow-card">
            <h2 className="text-sm font-medium">Your position</h2>
            {holding ? (
              <dl className="mt-3 flex flex-col gap-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Units</dt><dd className="num">{formatAmount(heldUnits)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Locked in requests</dt><dd className="num">{formatAmount(toNumber(holding.locked, SCALE_DIGITS))}</dd></div>
                <div className="flex justify-between border-t border-line pt-2">
                  <dt className="text-muted">Redeemable now, about</dt>
                  <dd className="num">{claim.unitValue === null ? "n/a" : `${formatAmount(heldUnits * claim.unitValue)} tUSDC`}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-muted">{portfolio ? `You hold no ${asset.assetId} units.` : "Connect a wallet to see your position."}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
