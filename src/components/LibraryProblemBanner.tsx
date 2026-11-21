import { AlertTriangle } from "lucide-react";
import type { LibraryProblem } from "../lib/library";

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
 * warning icon and the store's `detail` while `DraftsPage` rendered neither, so
 * the same state of the same file was two different things to look at depending
 * on which page was opened.
 *
 * The prose is fixed here too. It was already word for word the same on both
 * pages, and it is true of both collections: the file holds Snapshots and Drafts
 * together, so one unreadable file stops every write to either. A page that
 * wants to say something different about a locked file should be changing what
 * the store reports, not adding a second sentence about the same event.
 */
export function LibraryProblemBanner({ problem }: LibraryProblemBannerProps) {
  return (
    <div className="mb-4 flex items-start gap-3 border-l-2 border-err bg-err/5 px-3 py-2">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-err" />
      <div className="min-w-0">
        <p className="text-sm text-err">{PROBLEM_TITLES[problem.kind]}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
          {problem.message} Saving is turned off until it is dealt with, so the file on disk is
          never replaced by an empty one.
        </p>
        {problem.detail && (
          <p className="mt-1 select-text break-all font-mono text-[11px] text-text-muted">
            {problem.detail}
          </p>
        )}
      </div>
    </div>
  );
}
