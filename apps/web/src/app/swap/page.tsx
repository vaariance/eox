import { SwapForm } from "@/components/swap-form";
import { COLLATERAL } from "@/lib/config";
import { getDeployment, getPortfolio, getPublications, getStatus } from "@/lib/data";
import { SCALE_DIGITS, classViews, decimalsOf, latestOf, toNumber } from "@/lib/view";

export default async function SwapPage() {
  const [deployment, portfolio, publications, status] = await Promise.all([getDeployment(), getPortfolio(), getPublications(), getStatus()]);
  const classes = classViews(latestOf(publications), decimalsOf(deployment));
  const holdings = (portfolio?.positions ?? []).map((position) => ({ classId: position.classId, units: toNumber(position.units, SCALE_DIGITS) }));

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Swap</h1>
        <p className="mt-1 text-sm text-muted">
          Move between {COLLATERAL.name} and any class, or from one class to another. Putting {COLLATERAL.symbol} into CRYPTO backs the whole pilot market; putting it into one asset backs that asset against the market.
        </p>
      </div>
      <SwapForm classes={classes} holdings={holdings} nextBatch={status.currentBatch} />
    </div>
  );
}
