"use client";

import type { Submission, UnsignedTransaction } from "@eox/app-api";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { CircleCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buildTransaction, submissionState, submitSigned } from "@/app/actions";
import { COLLATERAL } from "@/lib/config";
import { formatUtcTime, formatWhole } from "@/lib/format";
import type { Intent } from "@/lib/requests";
import { useAccount } from "./account";

const POLL_MS = 2000;
const POLLS = 45;
const TOAST_MS = 10000;

type Phase =
  | { step: "idle" }
  | { step: "working"; text: string }
  | { step: "sent"; built: UnsignedTransaction; submission: Submission }
  | { step: "failed"; message: string };

function decode(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function explain(code: string, message: string, intent: Intent): string {
  if (code === "NOT_LIVE") return "This is fixture data, so nothing can be sent.";
  if (code === "UNAVAILABLE") return message;
  if (code === "TRANSACTION_REJECTED") {
    if (intent.operation === "deposit" && /AccountNotInitialized|user_token|AccountNotFound|insufficient|0x1\b/i.test(message)) return `Your wallet does not have enough ${COLLATERAL.symbol}, or has no devnet SOL for the fee. You can get both on the Faucet page.`;
    return `The test run of this request failed, so it was not sent: ${message}`;
  }
  return message;
}

function declined(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|declin|cancel/i.test(message)) return "You declined it in your wallet. Nothing was sent.";
  return message.split("\n")[0] || "The request could not be sent.";
}

function summary(built: UnsignedTransaction, submission: Submission): string {
  if (submission.state === "failed") return `The network refused it: ${submission.error ?? "no reason given"}.`;
  if (submission.state === "expired") return "It was not picked up in time and has expired. Nothing moved. Please try again.";
  const landed = submission.state === "submitted" ? "Sent, waiting for the network." : "Done.";
  if (built.operation === "cancel") return `${landed} The request is cancelled.`;
  if (built.operation === "refund") return `${landed} The refund goes to your wallet.`;
  if (built.operation === "withdraw") return `${landed} The ${COLLATERAL.symbol} goes to your wallet.`;
  const batch = built.targetBatch ? ` for batch #${formatWhole(built.targetBatch.batch)} (closes ${formatUtcTime(built.targetBatch.cutoff)})` : "";
  return `${landed} It is queued${batch} and fills at the next publication, not now.`;
}

interface SendButtonProps {
  intent: Intent | null;
  label: string;
  connectLabel: string;
  problem?: string | null;
  className: string;
  quiet?: boolean;
  hideSuccess?: boolean;
  describe?: string;
}

export function SendButton({ intent, label, connectLabel, problem = null, className, quiet = false, hideSuccess = false, describe }: SendButtonProps) {
  const { live, owner, refresh } = useAccount();
  const { signTransaction } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const alive = useRef(true);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    setMounted(true);
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const wallet = mounted ? owner : null;
  const ready = live && wallet !== null && intent !== null && problem === null && phase.step !== "working";

  const track = async (built: UnsignedTransaction, first: Submission) => {
    let submission = first;
    for (let poll = 0; poll < POLLS && submission.state === "submitted" && alive.current; poll += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
      const next = await submissionState(submission.signature);
      if (next.ok) submission = next.value;
    }
    if (alive.current) setPhase({ step: "sent", built, submission });
    await refresh();
  };

  const send = async () => {
    if (!wallet || !intent) return;
    if (!signTransaction) return setPhase({ step: "failed", message: "This wallet cannot sign a transaction for another service to send. Try a different wallet." });
    setPhase({ step: "working", text: "Preparing" });
    const built = await buildTransaction(wallet, intent);
    if (!built.ok) return setPhase({ step: "failed", message: explain(built.code, built.message, intent) });
    try {
      const transaction = VersionedTransaction.deserialize(decode(built.value.transaction));
      if (built.value.owner !== wallet || transaction.message.staticAccountKeys[0]?.toBase58() !== wallet || transaction.message.header.numRequiredSignatures !== 1) {
        return setPhase({ step: "failed", message: "The prepared transaction is not for this wallet alone, so it was not signed." });
      }
      setPhase({ step: "working", text: "Waiting for your wallet" });
      const signed = await signTransaction(transaction);
      setPhase({ step: "working", text: "Sending" });
      const submitted = await submitSigned(encode(signed.serialize()));
      if (!submitted.ok) return setPhase({ step: "failed", message: explain(submitted.code, submitted.message, intent) });
      setPhase({ step: "sent", built: built.value, submission: submitted.value });
      if (describe) setToast(true);
      void track(built.value, submitted.value);
    } catch (error) {
      setPhase({ step: "failed", message: declined(error) });
    }
  };

  const text = !wallet ? connectLabel : !live ? "Not available on fixture data" : phase.step === "working" ? phase.text : label;
  const bad = phase.step === "sent" && (phase.submission.state === "failed" || phase.submission.state === "expired");

  return (
    <>
      <button type="button" disabled={!ready} onClick={send} className={`${className} transition-opacity duration-150 ${ready ? "cursor-pointer hover:opacity-90" : "opacity-50"}`}>
        {text}
      </button>
      {wallet && !live && !quiet && <p className="text-xs text-muted">This page shows fixture data, so nothing can be sent from it.</p>}
      {wallet && live && problem && phase.step === "idle" && !quiet && <p role="alert" className="text-xs text-down">{problem}</p>}
      {phase.step === "failed" && <p role="alert" className="text-xs text-down">{phase.message}</p>}
      {phase.step === "sent" && (bad || (!hideSuccess && !describe)) && (
        <p role="status" className={`text-xs ${bad ? "text-down" : "text-up"}`}>
          {summary(phase.built, phase.submission)}{" "}
          <a href={`https://explorer.solana.com/tx/${phase.submission.signature}?cluster=devnet`} target="_blank" rel="noreferrer" className="underline">
            View the transaction
          </a>
        </p>
      )}
      {describe && toast && phase.step === "sent" && (
        <div role="status" aria-live="polite" className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div className="flex w-full max-w-md items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
            <CircleCheck size={18} className={`mt-0.5 shrink-0 ${bad ? "text-down" : "text-up"}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{bad ? "Order not placed" : "Order placed"}</p>
              <p className="mt-0.5 text-sm">{describe}</p>
              {bad && (
                <p className="mt-1 text-xs text-down">
                  {phase.submission.state === "failed" ? `Refused: ${phase.submission.error ?? "no reason given"}` : "It was not picked up in time. Nothing moved."}
                </p>
              )}
              {!bad && (
                <p className="mt-2 text-xs">
                  <Link href="/portfolio" onClick={() => setToast(false)} className="font-medium text-accent underline">View portfolio</Link>
                </p>
              )}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setToast(false)} className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-pill text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
