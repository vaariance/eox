import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { StatusBanner } from "@/components/status-banner";
import { SideBar, TopBar } from "@/components/top-bar";
import { API_URL, getDemoPortfolio, getDeployment, getStatus } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [status, deployment, demo] = await Promise.all([getStatus(), getDeployment(), getDemoPortfolio()]);
  return (
    <Providers live={deployment.origin === "live"} demo={demo} apiUrl={API_URL} sequence={status.latestSequence} fee={status.fees?.active ?? null}>
      <div className="flex min-h-screen">
        <SideBar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <StatusBanner status={status} origin={deployment.origin} />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </Providers>
  );
}
