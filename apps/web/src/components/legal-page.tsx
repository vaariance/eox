import Link from "next/link";
import { stencilPath } from "@/landing/stencil-glyphs";
import type { Block, Inline } from "@/lib/legal";
import { CookieSettingsButton } from "./cookie-consent";

const wordmark = stencilPath("RELATIVE", 1, 0.34);

function Parts({ parts }: { parts: Inline[] }) {
  return parts.map((part, index) => {
    if (part.kind === "bold") return <strong key={index} className="font-medium text-ink">{part.text}</strong>;
    if (part.kind === "link") {
      const outside = /^https?:/.test(part.href);
      return outside ? (
        <a key={index} href={part.href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">{part.text}</a>
      ) : (
        <Link key={index} href={part.href} className="text-accent underline underline-offset-4">{part.text}</Link>
      );
    }
    return <span key={index}>{part.text}</span>;
  });
}

export function LegalPage({ blocks }: { blocks: Block[] }) {
  return (
    <div className="min-h-screen bg-bg font-sans text-ink">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-6">
        <Link href="/" aria-label="Relative home" className="flex items-center text-ink">
          <svg aria-hidden="true" viewBox={`-0.5 -0.5 ${wordmark.width + 1} 7`} className="h-5 w-auto overflow-visible">
            <path d={wordmark.path} fill="none" stroke="currentColor" strokeWidth={1} />
          </svg>
        </Link>
        <Link href="/markets" className="flex h-10 items-center rounded-control bg-accent px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-ink transition-opacity duration-150 hover:opacity-90">Open app</Link>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 pb-20 pt-6">
        <article className="flex flex-col gap-4 text-sm leading-7 text-muted">
          {blocks.map((block, index) => {
            if (block.kind === "title") return <h1 key={index} className="mb-2 text-2xl font-semibold leading-tight tracking-tight text-ink"><Parts parts={block.parts} /></h1>;
            if (block.kind === "heading") return <h2 key={index} className="mt-6 text-base font-medium text-ink"><Parts parts={block.parts} /></h2>;
            if (block.kind === "table") {
              return (
                <div key={index} className="overflow-x-auto rounded-card border border-line">
                  <table className="w-full min-w-[520px] text-left text-sm leading-6">
                    <thead>
                      <tr className="border-b border-line text-ink">
                        {block.head.map((cell, column) => (
                          <th key={column} scope="col" className="px-4 py-3 font-medium"><Parts parts={cell} /></th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, line) => (
                        <tr key={line} className="border-b border-line align-top last:border-b-0">
                          {row.map((cell, column) => (
                            <td key={column} className={`px-4 py-3 ${column === 0 ? "w-2/5 text-ink" : ""}`}><Parts parts={cell} /></td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            return <p key={index}><Parts parts={block.parts} /></p>;
          })}
        </article>
      </main>
      <footer className="border-t border-line">
        <nav aria-label="Legal" className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-xs text-muted">
          <Link href="/" className="hover:text-ink">Home</Link>
          <Link href="/terms" className="hover:text-ink">Terms of Use</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy Policy</Link>
          <CookieSettingsButton className="cursor-pointer hover:text-ink" />
        </nav>
      </footer>
    </div>
  );
}
