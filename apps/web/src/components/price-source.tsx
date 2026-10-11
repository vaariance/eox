import type { PublishedPrice } from "@eox/app-api";
import { tradeAge, venueName } from "@/lib/view";

export function PriceSource({ price, detailed = false }: { price: PublishedPrice; detailed?: boolean }) {
  const stale = price.tradeAgeMinutes > 0;
  if (detailed) {
    return (
      <span className={stale ? "text-warn" : undefined}>
        {venueName(price.venue)} · {tradeAge(price.tradeAgeMinutes)}
      </span>
    );
  }
  return (
    <span className={`text-xs ${stale ? "text-warn" : "text-muted"}`} title={tradeAge(price.tradeAgeMinutes)}>
      {venueName(price.venue)}
      {stale && ` · ${price.tradeAgeMinutes} min old`}
    </span>
  );
}
