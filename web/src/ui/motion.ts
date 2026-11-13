/**
 * Easy Read guidance asks for no animation on screen (IE section 3, standard 21).
 * The only motion is a 150ms fade for a status that appears after load, and
 * none under prefers-reduced-motion.
 */
import type { Transition } from "motion/react";

export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

const FADE: Transition = { duration: 0.15, ease: EASE_OUT };

/** Props for a status that appears after load. `reduce` comes from `useReducedMotion()`. */
export function statusFade(reduce: boolean) {
  if (reduce) return { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0 } };
  return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: FADE };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
