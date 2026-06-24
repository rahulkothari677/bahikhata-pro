import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "BahiKhata Pro — India's Smartest Ledger App",
  description: "Complete ledger, inventory, GST & AI bill scanner for Indian shop owners. Track sales, purchases, profit, taxes & inventory effortlessly.",
  keywords: ["ledger", "bahi khata", "GST", "inventory", "Indian shop", "kirana", "billing"],
  authors: [{ name: "BahiKhata Pro" }],
  icons: { icon: "/logo.svg" },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <Providers>
          {children}
        </Providers>
        <Toaster />
        <SonnerToaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
