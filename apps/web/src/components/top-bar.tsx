"use client";

import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NetworkSwitcher } from "./network-switcher";
import { WalletButton } from "./wallet-button";

const links = [
  { href: "/", label: "Markets" },
  { href: "/swap", label: "Swap" },
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
    if (link.href === "/swap") {
      return (
        <Link
          key={link.href}
          href={link.href}
          aria-current={current ? "page" : undefined}
          className={`flex h-10 shrink-0 items-center gap-1.5 rounded-pill border border-accent px-4 text-sm font-medium transition-colors duration-150 ${
            current ? "bg-accent text-accent-ink" : "text-accent hover:bg-accent hover:text-accent-ink"
          }`}
        >
          <ArrowLeftRight size={15} aria-hidden="true" />
          {link.label}
        </Link>
      );
    }
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
          <NetworkSwitcher />
          <WalletButton />
        </div>
      </div>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
        <NavLinks pathname={pathname} />
      </nav>
    </header>
  );
}
