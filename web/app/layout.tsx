import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { ConversionProvider } from "@/src/ui/conversion-context";
import { brandSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Easy Read letters",
  description: "Turn a letter into a checked Easy Read version.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${brandSans.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col print:max-w-none">
          <ConversionProvider>{children}</ConversionProvider>
        </div>
      </body>
    </html>
  );
}
