import { SwapForm } from "@/components/swap-form";
import { COLLATERAL } from "@/lib/config";
import { getAssets, getDeployment, getPublications, getStatus } from "@/lib/data";
import { CRYPTO_CLASS, classViews, currentOf, decimalsOf, findClass } from "@/lib/view";

export default async function SwapPage() {
  const [assets, deployment, publications, status] = await Promise.all([getAssets(), getDeployment(), getPublications(), getStatus()]);
  const decimals = decimalsOf(deployment);
  const crypto = findClass(classViews(currentOf(publications), assets, decimals), CRYPTO_CLASS);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Swap</h1>
        <p className="mt-1 text-sm text-muted">
          Swap {COLLATERAL.symbol} for CRYPTO and back. CRYPTO is what you pay with on Relative: once you hold it, you can buy any asset from the Markets page.
        </p>
      </div>
      <SwapForm crypto={crypto} nextBatch={status.currentBatch} decimals={decimals} />
    </div>
  );
}
