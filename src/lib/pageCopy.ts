/**
 * The shell's destination list: each page's id, its sidebar label, its title, and
 * the one sentence under the title.
 *
 * The copy lives here rather than in `App.tsx` so it can be held to the same
 * glossary guard as a confirmation. A page subtitle is user-facing text, and a
 * retired word in one is the same defect as a retired word in a warning — it was
 * simply a place the guard could not see. Icons stay in `App.tsx`, because they
 * are the shell's business rather than the words'.
 *
 * **Five destinations, and no more.** Drafts is not one of them: it is a second
 * Collection inside Library (`pages/LibraryPage.tsx`), so that "Library" means
 * everything that has been saved and nothing that has not. A sixth entry here is
 * a change to the shell's shape and belongs in a ticket of its own.
 *
 * The vocabulary is GLOSSARY.md's: a 125 kHz credential is a **Tag** carrying an
 * **Identity**; a **Blank** is a Tag that carries none; copying an Identity onto
 * a Blank is a **Clone**; a 13.56 MHz serial is a **UID**; `card type` is the one
 * approved use of "card", as the derived family label; and a **Collection** is
 * one of Library's two kinds of saved thing.
 */

/** Every destination the sidebar can show. */
export type PageId = "lf" | "hf" | "library" | "tools" | "settings";

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
      "EM4100 tags. Read an Identity, Clone it onto a Blank, author one by hand, or Clear a tag.",
  },
  {
    id: "hf",
    label: "13.56 MHz",
    title: "13.56 MHz",
    subtitle:
      "ISO14443-A tags. Read a UID and its Records, write a Draft, copy a message onto another tag, erase one, or dump the raw memory.",
  },
  {
    id: "library",
    label: "Library",
    title: "Library",
    subtitle:
      "Everything you have kept — Snapshots of every read, and the Drafts you are composing — usable with no Reader attached.",
  },
  {
    id: "tools",
    label: "Tools",
    title: "Tools",
    subtitle:
      "A raw frame, typed by hand and sent to the Reader exactly as written.",
  },
  {
    id: "settings",
    label: "Settings",
    title: "Settings",
    subtitle: "Feedback, what this build is, and what this Reader cannot do.",
  },
];

/** Every subtitle, for the glossary guard in `pageCopy.test.ts`. */
export const PAGE_SUBTITLES: readonly string[] = PAGES.map((page) => page.subtitle);
