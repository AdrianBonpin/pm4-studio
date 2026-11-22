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
 *   2. **A tone's ink is named once.** `NOTICE_TONE_CLASS` is the one table that
 *      turns a notice tone into this app's ink: `ui/Notice` reads it for the
 *      leading word, `ui/ToastViewport` through `toneForSeverity`, `ui/Badge` for
 *      its pill, and the wording modules that draw a line of text beside a result
 *      (`lib/batchClone`) read it too. What it is **not** is the only place a hue
 *      is named, and this module does not claim to be. `ui/Button`'s `danger`
 *      variant and `ui/Badge`'s 20% tint are component palettes rather than notice
 *      ink, and a few dozen paragraphs, table cells and controls in `pages/` and
 *      `components/` still pick `text-warn`, `text-ok` or `text-err` by hand — a
 *      suspect row in the Records table (`HfPage`, `HfSnapshotReview`), the
 *      unreadable-page flag in `MemoryDumpPanel`, the completed-step tick in
 *      `CloneWizard`, the checksum in the console (`ToolsPage`), an inline error
 *      string. Several of those are not notice ink at all (a hover colour, a step
 *      indicator), so folding them into this table is a decision per site rather
 *      than a sweep; until that is made, a palette change means editing them too.
 *   3. **A severity maps to a tone in the seam.** `toneForSeverity` lives in
 *      `lib/severity.ts`, so a notice beside a result cannot be drawn in a calmer
 *      tone than the sound that result made.
 *
 * A tone is not the seam's property when there is no operation behind it. A
 * library file that cannot be written to, a migration warning, a pending
 * confirmation, a password gate that was not acknowledged: those are conditions,
 * they have no `Outcome` (see `lib/outcome`), and the module that owns the
 * condition picks the tone it is drawn in — `ReplacementConfirmation`'s
 * `replacementTone`, `lib/password.ts`'s `noticeTone`. Such a tone is presentation
 * for a condition: it produces no message in the corner and no sound, and it is
 * not a severity.
 *
 * `muted` is the informational tone: still said, not news. `pending` is a
 * confirmation waiting on a decision, which is neither good nor bad yet.
 */

/** How much attention a drawn notice claims. The hue is derived; never the only carrier. */
export type NoticeTone = "err" | "warn" | "ok" | "muted" | "pending";

/** Every tone, in severity order. Exported for the tests and for documentation. */
export const NOTICE_TONES: readonly NoticeTone[] = ["err", "warn", "ok", "muted", "pending"];

/**
 * Tone → the ink this app draws it in: the leading word of a notice, a line beside
 * a readout, a pill's label.
 *
 * Every class here is a `src/index.css` token: `text-err`, `text-warn`, `text-ok`,
 * `text-text-muted` and `text-accent-muted`. Nothing here composes a new hue, and
 * nothing outside this table needs to know which token a tone is — except the raw
 * sites the doc block above lists, which are known rather than denied.
 */
export const NOTICE_TONE_CLASS: Record<NoticeTone, string> = {
  err: "text-err",
  warn: "text-warn",
  ok: "text-ok",
  muted: "text-text-muted",
  pending: "text-accent-muted",
};
