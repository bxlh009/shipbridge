import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShipBridge",
  description: "Match Chinese carrier manifests to PayPal orders and sync tracking in bulk.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
