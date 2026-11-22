/**
 * The 13.56 MHz page's modes, in the order the work is done.
 *
 * The band page is a workspace rather than a column of every panel: one mode is
 * visible at a time, chosen from the shell's segmented switch. The order here is
 * that switch's order, and it is the work order rather than history or the
 * alphabet — read what is there, then write, then copy a whole message, then
 * erase, then look at the raw bytes when none of the four explained the Tag.
 *
 * Copy took the slot the order already gave it: the fifth pill joined the same
 * row when its panel arrived, and nothing about the page's frame moved. A mode is
 * only ever offered with a panel behind it, so the switch renders `HF_MODES`,
 * which is the order filtered to the modes this build has.
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

/** The modes the switch shows, in `HF_MODE_ORDER`'s order: all of them. */
export const HF_MODES: readonly HfModeOption[] = HF_MODE_ORDER.map((id) => ({
  id,
  label: HF_MODE_LABEL[id],
}));
