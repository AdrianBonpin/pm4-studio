/** Shared Tailwind radius class for all form controls. */
export const INPUT_ROUNDING = "rounded-lg";

/**
 * The one horizontal inset a page's text sits at, from both edges of the content
 * area: 24px.
 *
 * The shell applies it once, to the pane the page scrolls in, so a page's header
 * and its section bodies share it by construction rather than by agreement. A
 * thing that has to cross the inset — the rule between one section and the next —
 * cancels it with `PAGE_RULE` and re-applies it to its own content, which is what
 * makes a page read as one panel instead of a column in a box.
 *
 * The width cap this replaces was `max-w-3xl` on a centred column: a 768px
 * letterbox in a maximised window, which is the one thing the design system says
 * this app does not do (`DESIGN.md`, Layout).
 */
export const PAGE_INSET = "px-6";

/**
 * A rule between one page section and the next: `PAGE_INSET`, cancelled and
 * re-applied, so the rule reaches both edges of the content area while the words
 * it separates stay at the page's inset.
 */
export const PAGE_RULE = `-mx-6 ${PAGE_INSET}`;
