import { logoOf } from "@/landing/logos";

export function CoinIcon({ id, size = 24 }: { id: string; size?: number }) {
  const logo = logoOf(id);
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent font-semibold text-accent-ink"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {logo ? <img src={logo} alt="" className="block h-full w-full" /> : id.slice(0, 1)}
    </span>
  );
}
