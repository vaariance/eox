import { Activity, Layers, Users } from "lucide-react";
import { AssetChart } from "@/components/asset-chart";
import { CoinIcon } from "@/components/coin-icon";
import { FirstPublication } from "@/components/first-publication";
import { MyPosition } from "@/components/my-position";
import { Figure, StatCard } from "@/components/stat-card";
import { SwapForm } from "@/components/swap-form";
import { getAssets, getCrypto, getDeployment, getPublications, getStatus } from "@/lib/data";
import { direction, formatAmount } from "@/lib/format";
import { CRYPTO_CLASS, changeSince, classViews, currentOf, decimalsOf, findClass, latest, levelSeries } from "@/lib/view";

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
  const members = crypto.members.map((member) => ({ id: member.assetId }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-title font-semibold tracking-tight">$CRYPTO</h1>

      {!current && <FirstPublication />}

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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {current ? (
            <AssetChart series={[{ id: "level", label: "$CRYPTO level", points: level, digits: 4, baseline: 100 }]} />
          ) : (
            <section className="flex h-80 items-center justify-center rounded-card border border-line bg-surface p-4 text-sm text-muted shadow-card">
              The chart starts with the first price update.
            </section>
          )}
        </div>
        <SwapForm crypto={claim} nextBatch={status.currentBatch} decimals={decimals} />
        <MyPosition classId={CRYPTO_CLASS} unitValue={claim.unitValue} decimals={decimals} />
      </div>
    </div>
  );
}
