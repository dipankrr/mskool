import "./globals.css";
import type { Metadata } from "next";
import { TrpcProvider } from "@/lib/trpc/provider";
import { Outfit, Inter, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner"

import { ThemeProvider } from "@/components/theme-provider"

const spaceGrotesk = Space_Grotesk({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "mskool",
  description: "School management for private schools in India.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", spaceGrotesk.variable)} suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange>
          <TrpcProvider>
            {children}
          </TrpcProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
