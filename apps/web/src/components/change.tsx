import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { direction, formatChange } from "@/lib/format";

export function Change({ ratio }: { ratio: number }) {
  const way = direction(ratio);
  const Icon = way === "up" ? ArrowUpRight : way === "down" ? ArrowDownRight : Minus;
  const tone = way === "up" ? "text-up" : way === "down" ? "text-down" : "text-muted";
  return (
    <span className={`num inline-flex items-center gap-0.5 ${tone}`}>
      <Icon size={14} aria-hidden="true" />
      {formatChange(ratio)}
    </span>
  );
}

export function ChangePill({ ratio }: { ratio: number }) {
  const way = direction(ratio);
  const Icon = way === "up" ? ArrowUpRight : way === "down" ? ArrowDownRight : Minus;
  const tone = way === "up" ? "bg-up/15 text-up" : way === "down" ? "bg-down/15 text-down" : "bg-surface-2 text-muted";
  return (
    <span className={`num inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${tone}`}>
      <Icon size={12} aria-hidden="true" />
      {formatChange(ratio)}
    </span>
  );
}
