import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetChart } from "@/components/asset-chart";
import { Change } from "@/components/change";
import { RequestList } from "@/components/request-list";
import { TradeForm } from "@/components/trade-form";
import { formatAmount, formatChange } from "@/lib/format";
import { assets, change, classes, crypto, findAsset, findClass, latest, positions, publication, requests } from "@/lib/sample";

const HOUR = 60;

export function generateStaticParams() {
  return assets.map((asset) => ({ id: asset.id }));
}

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = findAsset(id);
  if (!asset) notFound();

  const claim = findClass(asset.id);
  const priceHour = change(asset.price, HOUR);
  const cryptoHour = change(crypto.level, HOUR);
  const referenceHour = change(asset.reference, HOUR);
  const verb = (ratio: number) => (ratio >= 0 ? "rose" : "fell");
  const held = positions.find((item) => item.classId === asset.id);
  const holding = held ? { ...held, redeemable: held.units * claim.unitValue } : null;

  const stats = [
    { label: "Price (USD)", value: formatAmount(latest(asset.price)), ratio: priceHour, note: asset.feed },
    { label: "COX reference", value: formatAmount(latest(asset.reference), 4), ratio: referenceHour, note: "Against CRYPTO, starts at 100" },
    { label: "Class unit value", value: formatAmount(claim.unitValue, 6), ratio: null, note: `${formatAmount(claim.backing)} tCOX backing` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-ink">Markets</Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span className="text-ink">{asset.id}</span>
      </nav>

      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">
          {asset.id} <span className="text-base font-normal text-muted">{asset.name} against {crypto.label}</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          Last hour: {asset.id} {verb(priceHour)} {formatChange(Math.abs(priceHour)).slice(1)}, CRYPTO {verb(cryptoHour)} {formatChange(Math.abs(cryptoHour)).slice(1)}, so the reference {verb(referenceHour)} {formatChange(Math.abs(referenceHour)).slice(1)}.
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
          <AssetChart
            series={[
              { id: "reference", label: "COX reference", points: asset.reference, digits: 4, baseline: 100 },
              { id: "price", label: "Price", points: asset.price, digits: 2 },
              { id: "crypto", label: "CRYPTO", points: crypto.level, digits: 4, baseline: 100 },
            ]}
          />
          <RequestList requests={requests} />
        </div>
        <div className="flex flex-col gap-6">
          <TradeForm claim={claim} others={classes.filter((item) => item.id !== asset.id)} nextBatch={publication.sequence + 1} />
          <section className="rounded-card border border-line bg-surface p-4 shadow-card">
            <h2 className="text-sm font-medium">Your position</h2>
            {holding ? (
              <dl className="mt-3 flex flex-col gap-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Units</dt><dd className="num">{formatAmount(holding.units)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Redeemable value</dt><dd className="num">{formatAmount(holding.redeemable)} tCOX</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Deposited</dt><dd className="num">{formatAmount(holding.deposited)} tCOX</dd></div>
                <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Profit and loss</dt><dd><Change ratio={holding.redeemable / holding.deposited - 1} /></dd></div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-muted">You hold no {asset.id} units.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
