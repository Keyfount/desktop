/**
 * Standardised motion presets.
 *
 * Centralising the spring config means every animation in the app feels
 * like it belongs to the same physical universe. Don't roll a one-off
 * transition into a component if a preset already covers the case.
 */
import type { Transition, Variants } from "framer-motion";

/** Soft, almost-no-overshoot spring. Default for layout transitions. */
export const SOFT_SPRING: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 28,
  mass: 0.9,
};

/** Slightly bouncier spring — use for "appear" feedback (popovers, generated). */
export const BOUNCY_SPRING: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 22,
  mass: 0.8,
};

/** Standard fade-and-rise variants for screens / sections. */
export const FADE_RISE: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12, ease: "easeIn" } },
};

/** Pop-in for cards / surfaces that appear inside an already-mounted screen. */
export const POP_IN: Variants = {
  initial: { opacity: 0, scale: 0.94 },
  animate: { opacity: 1, scale: 1, transition: BOUNCY_SPRING },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.12 } },
};

/** Tap feedback — apply via `whileTap`. */
export const TAP_SCALE = { scale: 0.96 };

/** Hover feedback — apply via `whileHover`. */
export const HOVER_LIFT = { y: -1 };
