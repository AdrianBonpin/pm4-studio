import type { LibraryProblem } from "../lib/library";
import { Notice } from "./ui/Notice";

interface LibraryProblemBannerProps {
  /** The problem the store reported: why the library file must not be written. */
  problem: LibraryProblem;
}

/** The sentence for each kind of problem: what the file is, in the user's terms. */
const PROBLEM_TITLES: Record<LibraryProblem["kind"], string> = {
  newerVersion: "This library was written by a newer version of PM4 Studio",
  olderVersion: "This library is from an older version of PM4 Studio",
  corrupt: "The library file could not be read",
  unreadable: "The library file could not be read",
};

/**
 * The one rendering of "the library file cannot be written to".
 *
 * The same lock is reached from wherever the file is used — the Snapshots page
 * and the Drafts page both hold a view of the same library — so it is one
 * component rather than one copy per page, for the same reason
 * `MigrationWarning` is. It had already drifted: `LibraryPage` rendered the
 * warning icon and the store's `detail` while the Drafts page rendered neither, so
 * the same state of the same file was two different things to look at depending
 * on which page was opened.
 *
 * The prose is fixed here too. It was already word for word the same on both
 * pages, and it is true of both collections: the file holds Snapshots and Drafts
 * together, so one unreadable file stops every write to either. A page that
 * wants to say something different about a locked file should be changing what
 * the store reports, not adding a second sentence about the same event.
 *
 * **The severity is the leading word.** It used to be a red rule down one side,
 * which said "something is wrong" to a user who can see the hue and nothing at
 * all to one who cannot. "Saving is off" says the consequence in words, and the
 * octagon says it again in shape; the sentence further down explains why the file
 * is protected rather than repeating that saving is disabled.
 *
 * `LibraryProblem.kind` decides nothing about the treatment: every kind is the
 * same lock, so every kind is the same notice. It decides only what the file is
 * (the title) and, through the store, why (the detail).
 */
export function LibraryProblemBanner({ problem }: LibraryProblemBannerProps) {
  return (
    <Notice
      tone="err"
      label="Saving is off"
      title={PROBLEM_TITLES[problem.kind]}
      className="mb-4"
    >
      <p className="text-xs leading-relaxed text-text-muted">
        {problem.message} The file on disk is never replaced by an empty one.
      </p>
      {problem.detail && (
        <p className="select-text break-all font-mono text-[11px] text-text-muted">
          {problem.detail}
        </p>
      )}
    </Notice>
  );
}
