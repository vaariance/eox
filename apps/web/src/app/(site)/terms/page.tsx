import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { legalDocument } from "@/lib/legal";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Relative · Devnet Terms of Use",
};

export default function TermsPage() {
  return <LegalPage blocks={legalDocument("terms")} />;
}
