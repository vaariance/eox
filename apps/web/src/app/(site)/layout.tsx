import { Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "@/landing/landing.css";

const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div data-site="" className={mono.variable}>
      {children}
    </div>
  );
}
