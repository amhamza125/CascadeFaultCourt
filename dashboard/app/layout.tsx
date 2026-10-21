import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Shell from "../components/Shell";

export const metadata: Metadata = {
  title: "CascadeFaultCourt — Court Docket & Case Files",
  description:
    "On-chain fault attribution for multi-agent pipelines: bonded stage agents, hash-bound execution traces, and verdicts read live from the CascadeFaultCourt contract on GenLayer StudioNet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
