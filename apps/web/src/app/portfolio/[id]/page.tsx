import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { PositionView } from "@/components/position-view";
import { getAssets, getDeployment, getPublications, getStatus } from "@/lib/data";
import { CRYPTO_CLASS, decimalsOf, referenceSeries, unitValueSeries } from "@/lib/view";

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assets, deployment, publications, status] = await Promise.all([getAssets(), getDeployment(), getPublications(), getStatus()]);
  const isAsset = assets.some((asset) => asset.assetId === id);
  if (!isAsset && id !== CRYPTO_CLASS) notFound();
  const decimals = decimalsOf(deployment);

  return (
    <>
      <AutoRefresh />
      <PositionView classId={id} values={unitValueSeries(publications, id, decimals)} reference={isAsset ? referenceSeries(publications, id) : []} status={status} decimals={decimals} />
    </>
  );
}
