import { createContext, useContext, type ReactNode } from "react";
import { DraftClosePrompt } from "./DraftClosePrompt";
import { useCloseGuard } from "../hooks/useCloseGuard";
import { useDrafts, type DraftsState } from "../hooks/useDrafts";

/**
 * The Drafts queue and the close guard, held above the page that shows them.
 *
 * Both used to live in the Drafts page, which meant both ended with the page. The
 * queue is the lesser half of that: a page that unmounts can still flush, and
 * does, so leaving the section cost nothing. The guard is the half that cannot
 * be fixed from inside the page — story 57 promises that quitting never costs
 * the last edit, and the window is closed from a page the user navigated to
 * afterwards. A listener that died with the Drafts page could not keep it.
 *
 * So the queue is owned here, once, above the navigation: an edit made on the
 * Drafts page is still here when the user is somewhere else, and the one close
 * listener the app has is registered for as long as the app is, not for as long
 * as one page is. The prompt for a close that could not finish is rendered
 * here too, because the close is the app's, not the page's.
 */
const DraftsContext = createContext<DraftsState | null>(null);

export function DraftsProvider({ children }: { children: ReactNode }) {
  const drafts = useDrafts();
  const closeGuard = useCloseGuard(drafts.settle);

  return (
    <DraftsContext.Provider value={drafts}>
      {closeGuard.problem !== null && (
        <DraftClosePrompt
          problem={closeGuard.problem}
          onQuitAnyway={closeGuard.quitAnyway}
          onKeepEditing={closeGuard.keepEditing}
        />
      )}
      {children}
    </DraftsContext.Provider>
  );
}

/**
 * The queue, for the page that edits it. Throwing rather than defaulting to a
 * second queue: two `useDrafts` instances would each hold a register of pending
 * edits and write over one another, and that is not a mistake worth making
 * silently.
 */
export function useDraftsState(): DraftsState {
  const drafts = useContext(DraftsContext);
  if (!drafts) {
    throw new Error("useDraftsState is used outside DraftsProvider");
  }
  return drafts;
}
