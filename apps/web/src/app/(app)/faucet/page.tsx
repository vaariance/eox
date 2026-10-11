import { FaucetPanel } from "@/components/faucet-panel";

export default function FaucetPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <h1 className="font-display text-title font-semibold tracking-tight">Faucet</h1>
      <FaucetPanel />
    </div>
  );
}
