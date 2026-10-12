import type { TradeQuote } from "@eox/app-api";
import { feeIncluded } from "@/lib/view";

export function Dots({ label = "Calculating" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-1">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </span>
  );
}

export function FeeNote({ pending, quote, decimals }: { pending: boolean; quote: TradeQuote | null; decimals: number }) {
  return (
    <div aria-live="polite" className="flex h-5 items-center justify-end text-xs text-muted">
      {pending ? <Dots label="Working out the fee" /> : quote ? <span key={quote.fee} className="slot-in num">({feeIncluded(quote.fee, decimals)})</span> : null}
    </div>
  );
}
