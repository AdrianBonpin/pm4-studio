/**
 * The shell's page list: each page's id, its sidebar label, its title, and the
 * one sentence under the title.
 *
 * The copy lives here rather than in `App.tsx` so it can be held to the same
 * glossary guard as a confirmation. A page subtitle is user-facing text, and a
 * retired word in one is the same defect as a retired word in a warning — it was
 * simply a place the guard could not see. Icons stay in `App.tsx`, because they
 * are the shell's business rather than the words'.
 *
 * The vocabulary is GLOSSARY.md's: a 125 kHz credential is a **Tag** carrying an
 * **Identity**; a **Blank** is a Tag that carries none; copying an Identity onto
 * a Blank is a **Clone**; a 13.56 MHz serial is a **UID**; and `card type` is the
 * one approved use of "card", as the derived family label.
 */

/** Every page the sidebar can show. */
export type PageId = "lf" | "hf" | "drafts" | "library" | "tools";

export interface PageCopy {
  readonly id: PageId;
  /** Short sidebar label. */
  readonly label: string;
  /** The page's heading. */
  readonly title: string;
  /** The one sentence under the heading, in approved vocabulary. */
  readonly subtitle: string;
}

export const PAGES: readonly PageCopy[] = [
  {
    id: "lf",
    label: "125 kHz",
    title: "125 kHz",
    subtitle:
      "EM4100 tags. Read an Identity, Clone it onto a Blank, author one by hand, or blank a tag.",
  },
  {
    id: "hf",
    label: "13.56 MHz",
    title: "13.56 MHz",
    subtitle: "ISO14443-A tags. Read the UID, the card type, and the raw memory.",
  },
  {
    id: "drafts",
    label: "Drafts",
    title: "Drafts",
    subtitle: "NDEF messages you are composing. Not attached to any Tag.",
  },
  {
    id: "library",
    label: "Library",
    title: "Library",
    subtitle: "Snapshots of every read, browsable with no Reader attached.",
  },
  {
    id: "tools",
    label: "Tools",
    title: "Tools",
    subtitle: "Hardware probes and raw command frames.",
  },
];

/** Every subtitle, for the glossary guard in `pageCopy.test.ts`. */
export const PAGE_SUBTITLES: readonly string[] = PAGES.map((page) => page.subtitle);
