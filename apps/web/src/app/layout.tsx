import "./globals.css";
import type { Metadata } from "next";
import { TrpcProvider } from "@/lib/trpc/provider";
import { Outfit } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner"

import { ThemeProvider } from "@/components/theme-provider"
import Navbar from "@/components/navbar";

const outfit = Outfit({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: "mskool",
  description: "School management for private schools in India.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", outfit.variable)} suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange>
          <TrpcProvider>
            <Navbar />
            {children}
          </TrpcProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
