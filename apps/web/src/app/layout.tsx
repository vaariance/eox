import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StatusBanner } from "@/components/status-banner";
import { TopBar } from "@/components/top-bar";
import "./globals.css";

export const metadata: Metadata = {
  title: "COX",
  description: "Crypto price performance relative to CRYPTO",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <TopBar />
        <StatusBanner />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
