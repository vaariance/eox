import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { legalDocument } from "@/lib/legal";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Relative · Devnet Privacy Policy",
};

export default function PrivacyPage() {
  return <LegalPage blocks={legalDocument("privacy")} />;
}
