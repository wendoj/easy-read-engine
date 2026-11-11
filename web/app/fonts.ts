/**
 * One typeface for the whole app: Atkinson Hyperlegible Next (SIL Open Font
 * License), from the Braille Institute. It is drawn for low-vision readers:
 * letters that look alike (I, l and 1; O and 0; b, d, p and q) have clearly
 * different shapes. Easy Read guidance asks for a clear sans-serif font
 * (Inclusion Europe "Information for all" 2.5, DH 2010 A3; README "Easy Read guidance").
 *
 * Variable font. The app uses weight 400 for text and 600 for headings and
 * labels only. The print layout uses its own system fonts (src/export/print-document.ts).
 */
import { Atkinson_Hyperlegible_Next } from "next/font/google";

export const brandSans = Atkinson_Hyperlegible_Next({ variable: "--font-brand-sans", subsets: ["latin"] });
