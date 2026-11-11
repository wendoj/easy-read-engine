/**
 * Shared motion values for the input and result screens (Motion, motion.dev).
 *
 * - Staged entrances run once, when a view first appears: chunks 100ms apart,
 *   each with opacity, 4px blur and 12px translateY over 300ms.
 * - Status changes (an error, a flag, the blocked state) fade in over 150ms.
 *   Each also has a static cue (an icon and a label), so motion is never the
 *   only signal.
 * - Under prefers-reduced-motion, entrances keep only the opacity fade.
 * - Never animated: the Original text, key-fact highlights and line selection.
 *   People read and compare those.
 */
import type { Transition, Variants } from "motion/react";

/** Strong ease-out for UI: `cubic-bezier(0.23, 1, 0.32, 1)`. */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** Parent of a staged entrance. Children use `enterVariants`. */
export const STAGGER: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

/** One chunk of a staged entrance. `reduce` comes from `useReducedMotion()`. */
export function enterVariants(reduce: boolean): Variants {
  const transition: Transition = { duration: 0.3, ease: EASE_OUT };
  if (reduce) {
    return { hidden: { opacity: 0 }, visible: { opacity: 1, transition } };
  }
  return {
    hidden: { opacity: 0, transform: "translateY(12px)", filter: "blur(4px)" },
    visible: {
      opacity: 1,
      transform: "translateY(0px)",
      filter: "blur(0px)",
      transition,
      // Clear them after, so no stacking context or containing block is left behind.
      transitionEnd: { transform: "none", filter: "none" },
    },
  };
}

/** Fade for a status that appears after the view has loaded. Removal is instant unless `exit` is used. */
export const STATUS_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.15, ease: EASE_OUT } },
  transition: { duration: 0.15, ease: EASE_OUT },
} as const;

/** Exit of a swapped view (input → confirm): shorter and smaller than the entrance. */
export function exitVariant(reduce: boolean) {
  const transition: Transition = { duration: 0.15, ease: EASE_OUT };
  return reduce
    ? { opacity: 0, transition }
    : { opacity: 0, transform: "translateY(-12px)", filter: "blur(4px)", transition };
}

/** Lines cascade 40ms apart. Only the first 8 are delayed; the rest enter with the 8th. */
export const LINE_STAGGER_S = 0.04;
export const LINE_STAGGER_CAP = 8;

/** One Easy Read line in the result's first-load cascade. Under reduced motion, all lines fade together. */
export function lineEnterVariants(reduce: boolean, index: number): Variants {
  if (reduce) return enterVariants(true);
  const delay = Math.min(index, LINE_STAGGER_CAP - 1) * LINE_STAGGER_S;
  const base = enterVariants(false);
  const visible = base.visible as Record<string, unknown>;
  return {
    hidden: base.hidden,
    visible: { ...visible, transition: { duration: 0.3, ease: EASE_OUT, delay } },
  };
}

/**
 * Cross-fade for a contextual icon (a pipeline stage turning done): scale
 * 0.25 → 1, opacity, blur 4px → 0, spring 0.3s with no bounce. Opacity only
 * under reduced motion.
 */
export function iconSwapVariants(reduce: boolean): Variants {
  const transition: Transition = { type: "spring", duration: 0.3, bounce: 0 };
  if (reduce) return { hidden: { opacity: 0 }, visible: { opacity: 1, transition } };
  return {
    hidden: { opacity: 0, transform: "scale(0.25)", filter: "blur(4px)", transition },
    visible: { opacity: 1, transform: "scale(1)", filter: "blur(0px)", transition },
  };
}
