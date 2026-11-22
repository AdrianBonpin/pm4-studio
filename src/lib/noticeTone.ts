/**
 * The notice tones, and the one table that turns a tone into this app's ink.
 *
 * A tone is not a severity — severity is the seam's (`lib/severity.ts`) and drives
 * both channels. A tone is how a severity, or a condition that is not an outcome at
 * all, is drawn: the ink of a notice's leading word, the ink of a line of plain
 * text beside a readout, the ink of the save note under a form.
 *
 * Three deliberate properties:
 *
 *   1. **The vocabulary is one type.** `NoticeTone` is defined here and imported by
 *      the notice component and by every module that words a notice. There used to
 *      be two types with that name and a hand-written map between them in
 *      `ClearSavedData`, which is a translation layer nobody could keep honest.
 *   2. **The hue is named once.** `NOTICE_TONE_CLASS` is the only table in the app
 *      that says "a warning is `text-warn`". A site picks a tone; it does not pick a
 *      colour, so a palette change is one edit rather than a search. `ui/Notice`
 *      draws the frame, the tint and the icon from the tone as well, and reads its
 *      ink from this table.
 *   3. **A severity maps to a tone in the seam.** `toneForSeverity` lives in
 *      `lib/severity.ts`, so a notice beside a result cannot be drawn in a calmer
 *      tone than the sound that result made.
 *
 * `muted` is the informational tone: still said, not news. `pending` is a
 * confirmation waiting on a decision, which is neither good nor bad yet.
 */

/** How much attention a drawn notice claims. The hue is derived; never the only carrier. */
export type NoticeTone = "err" | "warn" | "ok" | "muted" | "pending";

/** Every tone, in severity order. Exported for the tests and for documentation. */
export const NOTICE_TONES: readonly NoticeTone[] = ["err", "warn", "ok", "muted", "pending"];

/**
 * Tone → the ink this app draws it in. The only place a notice colour is named.
 *
 * Every class here is a `src/index.css` token: `text-err`, `text-warn`, `text-ok`,
 * `text-text-muted` and `text-accent-muted`. Nothing here composes a new hue.
 */
export const NOTICE_TONE_CLASS: Record<NoticeTone, string> = {
  err: "text-err",
  warn: "text-warn",
  ok: "text-ok",
  muted: "text-text-muted",
  pending: "text-accent-muted",
};
