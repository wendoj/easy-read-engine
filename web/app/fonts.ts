/**
 * Atkinson Hyperlegible Next: letters that look alike (I, l and 1; O and 0)
 * have clearly different shapes. Use weights 400 and 600 only. The print
 * layout uses its own system fonts.
 */
import { Atkinson_Hyperlegible_Next } from "next/font/google";

export const brandSans = Atkinson_Hyperlegible_Next({ variable: "--font-brand-sans", subsets: ["latin"] });
