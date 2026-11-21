import { AlertTriangle } from "lucide-react";

interface MigrationWarningProps {
  /**
   * Why the lift could not be written, as the store reported it — the sentence
   * from `Lifted::message` naming the schema it came from and the reason the
   * rewrite failed.
   */
  detail: string;
}

/**
 * The one rendering of "this library was lifted, and the lift is not on disk".
 *
 * The same warning is shown wherever a page can be the first to see the lifted
 * library, so it is one component rather than one copy per page. It already
 * drifted once: `LibraryPage` rendered it with the warning icon and a
 * `flex items-start gap-3` frame while `DraftsPage` rendered the same prose
 * without either, so the same state of the same file was two different things
 * to look at depending on which page the user happened to open first.
 *
 * The prose is fixed here for the same reason. Everything after `detail` is what
 * the reader needs to know next, and it is true on every page: the warning is not
 * a lock, and the next save is what corrects the file — which is exactly why the
 * controls stay usable. A page that wants to say something different about a
 * lift should be changing the store's message, not adding a second sentence
 * about the same event.
 */
export function MigrationWarning({ detail }: MigrationWarningProps) {
  return (
    <div className="mb-4 flex items-start gap-3 border-l-2 border-warn bg-warn/5 px-3 py-2">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0">
        <p className="text-sm text-warn">This library was upgraded from an older version</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
          {detail} Saving is still on: a save writes the upgraded library and corrects the
          version the file claims.
        </p>
      </div>
    </div>
  );
}
