/**
 * The 125 kHz page's modes, in the order the work is done.
 *
 * The page is a workspace, not a column of every panel: one mode is visible at a
 * time, chosen from the segmented switch. The order is the spec's and is the
 * order the pills are in — Read first, because it is both the base capability and
 * the precondition every write depends on.
 *
 * This lives outside the page for the reason `lib/hfWorkspace` does: the mode's
 * name is user-facing copy, and copy that nothing can check is copy that drifts.
 * It drifted once — the pill said **Reset** while the panel behind it said
 * *Blank a tag*, repeated the verb five times, and spent a paragraph denying a
 * factory restore that the right name would never have suggested (GLOSSARY puts
 * "blank (as a verb)" on Reset's *Avoid* line). `lib/blankTag.test.ts` now asserts
 * that the mode's name and the panel's words are the same name, so the two cannot
 * part company again.
 */

/** Every operation the 125 kHz page offers. */
export type LfMode = "read" | "write" | "reset" | "clone" | "batch";

/** One mode, as the switch shows it. */
export interface LfModeOption {
  readonly id: LfMode;
  readonly label: string;
}

/**
 * The canonical order. Not alphabetical and not historical: this is the order a
 * user actually moves through.
 */
export const LF_MODE_ORDER: readonly LfMode[] = ["read", "write", "reset", "clone", "batch"];

/**
 * The words on the switch. One name per mode, and the same name everywhere the
 * mode is spoken about — including in the panel's own heading, its controls and
 * the words its outcome arrives in.
 */
export const LF_MODE_LABEL: Record<LfMode, string> = {
  read: "Read",
  write: "Write",
  reset: "Reset",
  clone: "Clone",
  batch: "Batch",
};

/** The modes the switch shows, in `LF_MODE_ORDER`'s order: all of them. */
export const LF_MODES: readonly LfModeOption[] = LF_MODE_ORDER.map((id) => ({
  id,
  label: LF_MODE_LABEL[id],
}));

/** Where a fresh session opens: the operation everything else follows from. */
export const LF_FIRST_MODE: LfMode = "read";

/** The key the session remembers this page's mode under. */
export const LF_MODE_KEY = "lf";
