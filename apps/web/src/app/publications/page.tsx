import { CircleAlert, CircleCheck } from "lucide-react";
import { formatAmount, formatUtcTime, formatWhole } from "@/lib/format";
import { assets, crypto, history } from "@/lib/sample";

const SHOWN = 40;

export default function PublicationsPage() {
  const rows = history.slice(0, SHOWN);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-title font-semibold tracking-tight">Publications</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          One row per one-minute batch. A missed batch stays visible as a gap; the next publication covers the whole time since the last one.
        </p>
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-4 py-3 font-normal">Batch</th>
              <th scope="col" className="px-4 py-3 font-normal">Cutoff</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">CRYPTO level</th>
              {assets.map((asset) => (
                <th key={asset.id} scope="col" className="px-4 py-3 text-right font-normal">{asset.id} reference</th>
              ))}
              <th scope="col" className="px-4 py-3 text-right font-normal">Executed</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Rejected</th>
              <th scope="col" className="px-4 py-3 font-normal">Monitor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              row.missed ? (
                <tr key={row.batch} className="border-b border-line bg-surface-2 last:border-b-0">
                  <th scope="row" className="num px-4 py-3 text-left font-normal">#{formatWhole(row.batch)}</th>
                  <td className="num whitespace-nowrap px-4 py-3 text-muted">{formatUtcTime(row.cutoff)}</td>
                  <td colSpan={assets.length + 4} className="px-4 py-3 text-warn">
                    <span className="flex items-center gap-1.5">
                      <CircleAlert size={14} aria-hidden="true" />
                      No publication. The price snapshot was not admissible, so requests rolled to the next batch.
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={row.batch} className="border-b border-line last:border-b-0">
                  <th scope="row" className="num px-4 py-3 text-left font-normal">#{formatWhole(row.batch)}</th>
                  <td className="num whitespace-nowrap px-4 py-3 text-muted">{formatUtcTime(row.cutoff)}</td>
                  <td className="num px-4 py-3 text-right">{formatAmount(row.level, 4)}</td>
                  {assets.map((asset) => (
                    <td key={asset.id} className="num px-4 py-3 text-right">{formatAmount(row.references[asset.id], 4)}</td>
                  ))}
                  <td className="num px-4 py-3 text-right">{row.executed}</td>
                  <td className="num px-4 py-3 text-right">{row.rejected}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-up">
                      <CircleCheck size={14} aria-hidden="true" />
                      Matches
                    </span>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        Showing the latest {SHOWN} batches of {crypto.label}. Each publication will link to its archived price evidence once the evidence API is connected.
      </p>
    </div>
  );
}
