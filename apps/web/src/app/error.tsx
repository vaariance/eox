"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-4 py-16">
      <h1 className="font-display text-title font-semibold tracking-tight">COX data is not available</h1>
      <p className="text-sm text-muted">The app could not read from the COX API. Nothing has been lost: positions and requests live on chain. Try again in a moment.</p>
      <button type="button" onClick={reset} className="h-10 cursor-pointer rounded-pill bg-accent px-4 text-sm font-medium text-accent-ink transition-opacity duration-150 hover:opacity-90">
        Try again
      </button>
    </div>
  );
}
