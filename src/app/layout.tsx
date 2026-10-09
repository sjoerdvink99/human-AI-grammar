import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { SiteHeader } from "@/components/ui/site-header";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: { default: "A Grammar for Human-AI Systems", template: "%s · Human-AI Systems Repository" },
  description: "Describe, compare, and explore Human-AI systems through a common process representation.",
  authors: [{ name: "Sjoerd Vink" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <SiteHeader />
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-6 pt-8 pb-20">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex h-12 w-full max-w-[1240px] items-center justify-between px-6 text-xs text-faint">
            <span>A Grammar for Human-AI Systems · Vink et al.</span>
            <a href="https://github.com/sjoerdvink99/human-AI-grammar" target="_blank" rel="noreferrer" className="hover:text-ink">
              Source and Claude Code plugin
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
