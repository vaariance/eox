import { SwapForm } from "@/components/swap-form";
import { COLLATERAL } from "@/lib/config";

export default function SwapPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Swap</h1>
        <p className="mt-1 text-sm text-muted">
          Move between {COLLATERAL.name} and CRYPTO, the benchmark class. Putting {COLLATERAL.symbol} into CRYPTO backs the whole pilot market. From there you can switch into a single asset to back it against the market.
        </p>
      </div>
      <SwapForm />
    </div>
  );
}
