import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { ConversionProvider } from "@/src/ui/conversion-context";
import { brandMono, brandSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Easy Read letters",
  description: "Turn a letter into a checked Easy Read version.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${brandSans.variable} ${brandMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {/* Devin's frame: a 1160px column with hairline rails on both sides. */}
        <div className="mx-auto flex w-full max-w-[1160px] flex-1 flex-col border-border sm:border-x print:max-w-none print:border-0">
          <ConversionProvider>{children}</ConversionProvider>
        </div>
      </body>
    </html>
  );
}
