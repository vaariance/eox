import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { StatusBanner } from "@/components/status-banner";
import { TopBar } from "@/components/top-bar";
import { getDemoPortfolio, getDeployment, getStatus } from "@/lib/data";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "COX",
  description: "Crypto price performance relative to CRYPTO",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [status, deployment, demo] = await Promise.all([getStatus(), getDeployment(), getDemoPortfolio()]);
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers live={deployment.origin === "live"} demo={demo}>
          <TopBar />
          <StatusBanner status={status} origin={deployment.origin} />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
