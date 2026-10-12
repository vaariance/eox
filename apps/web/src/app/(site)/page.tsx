import type { Metadata } from "next";
import { Landing } from "@/landing/landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Relative · Trade Performance",
  description: "Back the coin your analysis says will outperform the market.",
};

export default function LandingPage() {
  return <Landing />;
}
