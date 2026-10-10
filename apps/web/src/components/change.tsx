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
