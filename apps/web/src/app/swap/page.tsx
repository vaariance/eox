import { SwapForm } from "@/components/swap-form";
import { COLLATERAL } from "@/lib/config";
import { getAssets, getDeployment, getPublications, getStatus } from "@/lib/data";
import { classViews, currentOf, decimalsOf } from "@/lib/view";

export default async function SwapPage() {
  const [assets, deployment, publications, status] = await Promise.all([getAssets(), getDeployment(), getPublications(), getStatus()]);
  const decimals = decimalsOf(deployment);
  const classes = classViews(currentOf(publications), assets, decimals);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Swap</h1>
        <p className="mt-1 text-sm text-muted">
          Move between {COLLATERAL.name} and any class, or from one class to another. Putting {COLLATERAL.symbol} into CRYPTO backs the whole pilot market; putting it into one asset backs that asset against the market.
        </p>
      </div>
      <SwapForm classes={classes} nextBatch={status.currentBatch} decimals={decimals} />
    </div>
  );
}
