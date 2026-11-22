import { Notice } from "./ui/Notice";

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
 * `flex items-start gap-3` frame while the Drafts page rendered the same prose
 * without either, so the same state of the same file was two different things
 * to look at depending on which page the user happened to open first.
 *
 * The prose is fixed here for the same reason. Everything after `detail` is what
 * the reader needs to know next, and it is true on every page: the warning is not
 * a lock, and the next save is what corrects the file — which is exactly why the
 * controls stay usable. A page that wants to say something different about a
 * lift should be changing the store's message, not adding a second sentence
 * about the same event.
 *
 * **This one is a warning and the lock beside it is not.** Both are notices about
 * the same file, so the pair is the case the treatment has to keep apart: this
 * says "check this" and "saving is still on", the lock says "saving is off". That
 * distinction is carried by the leading words and by two different icon shapes,
 * so it survives a user who cannot tell amber from red.
 */
export function MigrationWarning({ detail }: MigrationWarningProps) {
  return (
    <Notice
      tone="warn"
      label="Check this"
      title="This library was upgraded from an older version"
      className="mb-4"
    >
      <p className="text-xs leading-relaxed text-text-muted">
        {detail} Saving is still on: a save writes the upgraded library and corrects the version
        the file claims.
      </p>
    </Notice>
  );
}
