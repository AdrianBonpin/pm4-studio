/**
 * The 13.56 MHz page's modes, in the order the work is done.
 *
 * The band page is a workspace rather than a column of every panel: one mode is
 * visible at a time, chosen from the shell's segmented switch. The order here is
 * that switch's order, and it is the work order rather than history or the
 * alphabet — read what is there, then write, then copy a whole message, then
 * erase, then look at the raw bytes when none of the four explained the Tag.
 *
 * `copy` already has its slot: it is in the union and in `HF_MODE_ORDER` between
 * Write and Erase. Ticket 15 builds its panel, which leaves `NOT_BUILT` and joins
 * the switch where the order already puts it — one pill more in the same row, and
 * nothing about the page's frame moves. A mode offered before its panel exists
 * would be a control that does nothing, which is why the switch renders
 * `HF_MODES` and not `HF_MODE_ORDER`.
 */

/** Every mode the workspace will have. */
export type HfMode = "read" | "write" | "copy" | "erase" | "memory";

/** One mode, as the switch shows it. */
export interface HfModeOption {
  readonly id: HfMode;
  readonly label: string;
}

/**
 * The canonical order, Copy included.
 *
 * The band's memory-dump mode is named **Memory**, not Diagnostics: Diagnostics is
 * Settings' group that owns the capability limits, and a user told to look in
 * "Diagnostics" must have exactly one destination to try (GLOSSARY.md).
 */
export const HF_MODE_ORDER: readonly HfMode[] = ["read", "write", "copy", "erase", "memory"];

/**
 * The words on the switch. One name per mode, and the same name everywhere the
 * mode is spoken about.
 */
export const HF_MODE_LABEL: Record<HfMode, string> = {
  read: "Read",
  write: "Write",
  copy: "Copy",
  erase: "Erase",
  memory: "Memory",
};

/**
 * Modes whose panel this build does not have yet.
 *
 * One entry, removed by ticket 15. It exists so the slot Copy will occupy is
 * decided here once, rather than discovered by relaying out the switch later.
 */
const NOT_BUILT: ReadonlySet<HfMode> = new Set<HfMode>(["copy"]);

/** The modes the switch shows today, in `HF_MODE_ORDER`'s order. */
export const HF_MODES: readonly HfModeOption[] = HF_MODE_ORDER.filter(
  (id) => !NOT_BUILT.has(id),
).map((id) => ({ id, label: HF_MODE_LABEL[id] }));
