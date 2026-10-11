"use client";

import type { TradeQuote } from "@eox/app-api";
import { useEffect, useState } from "react";
import type { Intent } from "@/lib/requests";
import { useAccount } from "./account";

const WAIT_MS = 500;

function request(owner: string, intent: Intent): { route: string; body: Record<string, string> } | null {
  if (intent.operation === "deposit") return { route: "deposit", body: { owner, toClass: intent.toClass, amount: intent.amount } };
  if (intent.operation === "switch") return { route: "switch", body: { owner, fromClass: intent.fromClass, toClass: intent.toClass, units: intent.units } };
  if (intent.operation === "redeem") return { route: "redeem", body: { owner, fromClass: intent.fromClass, units: intent.units } };
  return null;
}

export function useQuote(intent: Intent | null): { quote: TradeQuote | null; pending: boolean } {
  const { live, owner, apiUrl, sequence } = useAccount();
  const [held, setHeld] = useState<{ key: string; quote: TradeQuote | null } | null>(null);
  const wanted = live && owner && intent ? request(owner, intent) : null;
  const key = wanted ? `${wanted.route}:${JSON.stringify(wanted.body)}` : null;

  useEffect(() => {
    if (!key || !wanted) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiUrl}/v1/quotes/${wanted.route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(wanted.body),
          signal: controller.signal,
        });
        const payload = response.ok ? ((await response.json()) as { data?: TradeQuote }) : null;
        setHeld({ key, quote: payload?.data ?? null });
      } catch {
        if (!controller.signal.aborted) setHeld({ key, quote: null });
      }
    }, WAIT_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, apiUrl, sequence]);

  const settled = held !== null && held.key === key;
  return { quote: settled ? held.quote : null, pending: key !== null && !settled };
}
