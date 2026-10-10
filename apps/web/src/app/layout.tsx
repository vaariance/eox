import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { StatusBanner } from "@/components/status-banner";
import { TopBar } from "@/components/top-bar";
import { getDeployment, getStatus } from "@/lib/data";
import "./globals.css";

export const metadata: Metadata = {
  title: "COX",
  description: "Crypto price performance relative to CRYPTO",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [status, deployment] = await Promise.all([getStatus(), getDeployment()]);
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers>
          <TopBar />
          <StatusBanner status={status} sample={deployment.fixtureSource !== null} />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
