import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/Button";

interface DraftClosePromptProps {
  /** Why the last edit could not be written. Never null here — see `DraftsProvider`. */
  problem: string;
  /** Close the window anyway, without another attempt at the save. */
  onQuitAnyway: () => void;
  /** Stay open, keeping the edit in the view. */
  onKeepEditing: () => void;
}

/**
 * The question asked when the window was closing over an edit that did not save.
 *
 * It reads as a dialog rather than an inline notice because it is the obstacle
 * to a close the user has already asked for: a line buried in the page would be
 * a line the user does not see while looking for the window to disappear. The
 * choice is deliberate in both directions — quitting loses exactly one thing,
 * named here, and staying keeps it.
 */
export function DraftClosePrompt({
  problem,
  onQuitAnyway,
  onKeepEditing,
}: DraftClosePromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-6">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="draft-close-title"
        aria-describedby="draft-close-detail"
        className="w-full max-w-md border border-border bg-surface p-5 shadow-lg"
      >
        <p
          id="draft-close-title"
          className="flex items-center gap-1.5 font-heading text-sm text-err"
        >
          <AlertTriangle size={14} />
          The last Draft edit was not saved
        </p>
        <p id="draft-close-detail" className="mt-2 text-xs leading-relaxed text-text-muted">
          {problem}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Quitting now loses that edit. Staying keeps it here, so it can be saved once the
          problem is dealt with.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={onQuitAnyway}>
            Quit anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
