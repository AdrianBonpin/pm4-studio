import type { ReactNode } from "react";
import { Button } from "./ui/Button";

interface RowDeleteConfirmationProps {
  /** What is about to be destroyed, as the row names it. */
  name: string;
  /**
   * What is destroyed with it, in the words of the collection it belongs to.
   *
   * This is the one part a caller supplies, because the two collections are
   * lost for different reasons: a Snapshot can be read off its Tag again, a
   * Draft was authored here and never lived on one. Both sentences say what the
   * user loses; neither is a matter of taste.
   */
  children: ReactNode;
  /** Destroy it. The caller owns what "it" is: this component owns no store. */
  onConfirm: () => void;
  /** Leave it exactly as it is. */
  onDismiss: () => void;
}

/**
 * The one rendering of a row-level destructive confirmation.
 *
 * A row's trash control is one click; this is the second, deliberate one that
 * stands between it and something the app cannot get back. The words that name
 * the target and the control that destroys it are fixed here rather than passed
 * in, so a page cannot quietly change the confirmation's shape — the label, the
 * dismiss and the `danger` variant are the same wherever a row is destroyed.
 *
 * It exists because the Drafts page reproduced `LibraryPage`'s markup token for
 * token: the same prompt, the same danger button, the same `Keep`, the same
 * wrapper classes. That is the smell `ReplacementConfirmation` was extracted
 * for, one row down: once the markup exists twice, the copies agree until one
 * of them is edited, and the next reviewer cannot tell which one is meant.
 */
export function RowDeleteConfirmation({
  name,
  children,
  onConfirm,
  onDismiss,
}: RowDeleteConfirmationProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text">
        Delete <span className="text-text">{name}</span> permanently?
      </p>
      <p className="max-w-prose text-xs leading-relaxed text-text-muted">{children}</p>
      <div className="flex items-center gap-2">
        <Button autoFocus variant="danger" onClick={onConfirm}>
          Delete permanently
        </Button>
        <Button variant="ghost" onClick={onDismiss}>
          Keep
        </Button>
      </div>
    </div>
  );
}
