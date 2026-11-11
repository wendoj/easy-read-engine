/**
 * Brand fonts. devin.ai uses NB International Pro (a paid typeface from
 * Neubau). Funnel Sans (SIL Open Font License) is the closest free match:
 * same width at 40px, tall x-height, single-storey g and similar numerals.
 * Set to Devin's metrics: weight 400, -0.03em tracking on headings.
 *
 * With an NB International Pro licence, put the files in `app/fonts/` and
 * swap `brandSans` for:
 *
 *   import localFont from "next/font/local";
 *   export const brandSans = localFont({
 *     src: [
 *       { path: "./fonts/NBInternationalPro-Regular.woff2", weight: "400" },
 *       { path: "./fonts/NBInternationalPro-Medium.woff2", weight: "500" },
 *     ],
 *     variable: "--font-brand-sans",
 *   });
 */
import { Funnel_Sans, Geist_Mono } from "next/font/google";

export const brandSans = Funnel_Sans({ variable: "--font-brand-sans", subsets: ["latin"] });

/** Devin sets its labels in Geist Mono. */
export const brandMono = Geist_Mono({ variable: "--font-brand-mono", subsets: ["latin"] });
