import type { Metadata } from "next";
import { Landing } from "@/landing/landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Relative · Back your analysis",
  description: "Back the coin your analysis says will do better than the rest of crypto.",
};

export default function LandingPage() {
  return <Landing />;
}
