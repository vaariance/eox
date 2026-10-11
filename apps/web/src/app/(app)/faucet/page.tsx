import { FaucetPanel } from "@/components/faucet-panel";

export default function FaucetPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Faucet</h1>
        <p className="mt-1 text-sm text-muted">
          Get free test funds for Solana devnet. You need a little devnet SOL to pay network fees, and devnet USDC from Circle to buy with.
        </p>
      </div>
      <FaucetPanel />
    </div>
  );
}
