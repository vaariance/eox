import { AutoRefresh } from "@/components/auto-refresh";
import { PortfolioView } from "@/components/portfolio-view";
import { getAssets, getDeployment, getPublications, getStatus } from "@/lib/data";
import { classViews, currentOf, decimalsOf } from "@/lib/view";

export default async function PortfolioPage() {
  const [assets, deployment, publications, status] = await Promise.all([getAssets(), getDeployment(), getPublications(), getStatus()]);
  const decimals = decimalsOf(deployment);
  return (
    <>
      <AutoRefresh />
      <PortfolioView classes={classViews(currentOf(publications), assets, decimals)} status={status} decimals={decimals} />
    </>
  );
}
