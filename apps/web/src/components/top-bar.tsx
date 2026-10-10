"use client";

import { Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Markets" },
  { href: "/crypto", label: "CRYPTO" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/publications", label: "Publications" },
];

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/assets");
  return pathname.startsWith(href);
}

function NavLinks({ pathname }: { pathname: string }) {
  return links.map((link) => {
    const current = isCurrent(pathname, link.href);
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={current ? "page" : undefined}
        className={`flex h-10 shrink-0 items-center rounded-pill px-3 text-sm transition-colors duration-150 ${
          current ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
        }`}
      >
        {link.label}
      </Link>
    );
  });
}

export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bar backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="font-display text-lg font-semibold tracking-tight text-ink">
          COX
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          <NavLinks pathname={pathname} />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden rounded-pill border border-line px-2 py-1 text-xs text-muted lg:inline">Solana devnet</span>
          <span className="hidden rounded-pill border border-warn px-2 py-1 text-xs text-warn sm:inline">Test collateral · MVP-0</span>
          <button
            type="button"
            className="flex h-10 cursor-pointer items-center gap-2 rounded-pill bg-accent px-4 text-sm font-medium text-accent-ink transition-opacity duration-150 hover:opacity-90"
          >
            <Wallet size={16} aria-hidden="true" />
            Connect wallet
          </button>
        </div>
      </div>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
        <NavLinks pathname={pathname} />
      </nav>
    </header>
  );
}
