import { notFound } from "next/navigation";
import { PositionView } from "@/components/position-view";
import { getAssets, getDeployment, getPublications, getStatus } from "@/lib/data";
import { CRYPTO_CLASS, classViews, currentOf, decimalsOf, findClass, priceSeries, referenceSeries, unitValueSeries } from "@/lib/view";

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assets, deployment, publications, status] = await Promise.all([getAssets(), getDeployment(), getPublications(), getStatus()]);
  const asset = assets.find((item) => item.assetId === id);
  if (!asset && id !== CRYPTO_CLASS) notFound();
  const decimals = decimalsOf(deployment);
  const classes = classViews(currentOf(publications), assets, decimals);

  return (
    <>
      <PositionView
        classId={id}
        claim={findClass(classes, id)}
        crypto={findClass(classes, CRYPTO_CLASS)}
        values={unitValueSeries(publications, id, decimals)}
        reference={asset ? referenceSeries(publications, id) : []}
        price={asset ? priceSeries(publications, id) : []}
        cutoffs={Object.fromEntries(publications.map((publication) => [publication.identity.sequence, publication.identity.cutoff]))}
        status={status}
        decimals={decimals}
      />
    </>
  );
}
