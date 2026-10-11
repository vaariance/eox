import { CircleAlert } from "lucide-react";
import { Fragment } from "react";
import { getCrypto, getPublications } from "@/lib/data";
import { formatAmount, formatUtcTime, formatWhole } from "@/lib/format";
import { SCALE_DIGITS, toNumber } from "@/lib/view";

const SHOWN = 40;

export default async function PublicationsPage() {
  const [crypto, publications] = await Promise.all([getCrypto(), getPublications()]);
  const rows = publications.slice(-SHOWN).reverse();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Publications</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Every minute is a batch. A publication is a batch that was accepted and committed. When a batch is missed there is no publication for it, and the next one covers the whole time since the last.
        </p>
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-4 py-3 font-normal">Publication</th>
              <th scope="col" className="px-4 py-3 font-normal">Batch and cutoff</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">CRYPTO level</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Fallback prices</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Oldest trade</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Executed</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Rejected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((publication) => {
              const { identity } = publication;
              const fallback = publication.prices.filter((price) => price.step !== 1).length;
              const oldest = Math.max(0, ...publication.prices.map((price) => price.tradeAgeMinutes));
              return (
                <Fragment key={identity.sequence}>
                  <tr className="border-b border-line">
                    <th scope="row" className="num px-4 py-3 text-left font-normal">#{formatWhole(identity.sequence)}</th>
                    <td className="num whitespace-nowrap px-4 py-3 text-muted">#{formatWhole(identity.batch)} · {formatUtcTime(identity.cutoff)}</td>
                    <td className="num px-4 py-3 text-right">{formatAmount(toNumber(publication.benchmark, SCALE_DIGITS), 4)}</td>
                    <td className="num px-4 py-3 text-right">{fallback} of {publication.prices.length}</td>
                    <td className="num px-4 py-3 text-right">{oldest === 0 ? "This minute" : `${oldest} min`}</td>
                    <td className="num px-4 py-3 text-right">{publication.flows.executed}</td>
                    <td className="num px-4 py-3 text-right">{publication.flows.rejected}</td>
                  </tr>
                  {identity.missedBatches.length > 0 && (
                    <tr className="border-b border-line bg-surface-2">
                      <td colSpan={7} className="px-4 py-3 text-warn">
                        <span className="flex items-center gap-1.5">
                          <CircleAlert size={14} aria-hidden="true" />
                          No publication for {identity.missedBatches.length === 1 ? "batch" : "batches"} {identity.missedBatches.map((batch) => `#${formatWhole(batch)}`).join(", ")}. Queued requests waited for the next publication.
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        Showing the latest {rows.length} publications of {crypto.label}. A fallback price is one that did not come from a Kraken trade in the cutoff minute. Each publication will link to its archived price evidence once the evidence API is connected.
      </p>
    </div>
  );
}
