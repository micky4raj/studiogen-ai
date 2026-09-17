import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

const title = "StudioGen AI — AI Product Photo Studio & SEO Copywriting";
const description = "Turn raw product photos into 4K studio shots and SEO-optimized listings.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary", title, description },
};

// Matches the graphite (#1C1B1A) from the design tokens in globals.css — this
// is what mobile browser chrome (e.g. Android's address bar) tints to.
export const viewport: Viewport = {
  themeColor: "#1C1B1A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
