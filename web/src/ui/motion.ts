/**
 * Shared motion values for the input and result screens (Motion, motion.dev).
 *
 * Easy Read guidance says not to have animations on the screen (Inclusion
 * Europe "Information for all", section 3, standard 21), so motion is kept to one thing: a
 * status that appears after the page has loaded (an error, a flag after an
 * edit, the blocked state after an edit) fades in over 150ms. Each also has
 * an icon and a label, so motion is never the only signal.
 *
 * - No entrances, cascades, slides, blur or shimmer.
 * - Under prefers-reduced-motion nothing animates: `statusFade(true)` shows
 *   the status at once. globals.css also stops CSS animations then.
 * - Never animated: the Original text, key-fact highlights and line selection.
 */
import type { Transition } from "motion/react";

/** Strong ease-out for UI: `cubic-bezier(0.23, 1, 0.32, 1)`. */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

const FADE: Transition = { duration: 0.15, ease: EASE_OUT };

/**
 * Props for a status that appears after load. `reduce` comes from
 * `useReducedMotion()`; when true there is no animation at all.
 */
export function statusFade(reduce: boolean) {
  if (reduce) return { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0 } };
  return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: FADE };
}
