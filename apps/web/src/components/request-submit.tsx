"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { formatWhole } from "@/lib/format";
import type { Planned } from "@/lib/requests";

type Phase = { step: "idle" } | { step: "sending" } | { step: "sent"; signature: string } | { step: "failed"; message: string };

const button = "h-11 rounded-pill bg-accent text-sm font-medium text-accent-ink transition-opacity duration-150";

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "CoxAccountNotFound") return "The COX pool could not be found on this network.";
  if (/reject|denied|cancel/i.test(message)) return "You declined the request in your wallet. Nothing was sent.";
  return message.split("\n")[0] || "The request could not be sent.";
}

export function RequestSubmit({ planned, poolId, label, batch, blocked }: { planned: Planned; poolId: string | null; label: string; batch: number | null; blocked: string | null }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  useEffect(() => setMounted(true), []);

  const owner = mounted ? publicKey : null;
  const problem = planned.problem ?? blocked;
  const ready = owner !== null && poolId !== null && planned.plan !== null && blocked === null && phase.step !== "sending";

  const send = async () => {
    if (!owner || poolId === null || planned.plan === null) return;
    setPhase({ step: "sending" });
    try {
      const { submitRequest } = await import("@/lib/chain");
      const result = await submitRequest(planned.plan, { connection, owner, poolId: BigInt(poolId), send: (transaction, target) => sendTransaction(transaction, target) });
      setPhase({ step: "sent", signature: result.signature });
    } catch (error) {
      setPhase({ step: "failed", message: explain(error) });
    }
  };

  const text = !owner ? "Connect wallet to continue" : poolId === null ? "No live pool yet" : phase.step === "sending" ? "Waiting for your wallet" : label;

  return (
    <>
      <button type="button" disabled={!ready} onClick={send} className={`${button} ${ready ? "cursor-pointer hover:opacity-90" : "opacity-50"}`}>
        {text}
      </button>
      {owner && poolId === null && (
        <p className="text-xs text-muted">The COX program is on devnet, but its pool has not been opened yet. Requests can be sent as soon as it is.</p>
      )}
      {owner && poolId !== null && problem && phase.step === "idle" && <p role="alert" className="text-xs text-down">{problem}</p>}
      {phase.step === "failed" && <p role="alert" className="text-xs text-down">{phase.message}</p>}
      {phase.step === "sent" && (
        <p role="status" className="text-xs text-up">
          Sent. {batch === null ? "It is queued" : `It is queued for batch #${formatWhole(batch)}`} and fills at the next publication, not now.{" "}
          <a href={`https://explorer.solana.com/tx/${phase.signature}?cluster=devnet`} target="_blank" rel="noreferrer" className="underline">
            View the transaction
          </a>
        </p>
      )}
    </>
  );
}
