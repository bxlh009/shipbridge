import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShipBridge",
  description: "Match carrier manifests to PayPal orders and push tracking in bulk.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
