import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/platform";

/** What a close that could not finish asking looks like to the page. */
export interface CloseGuard {
  /**
   * Why the window could not close, or null when it may. Set only after a final
   * write failed: the window is held open until the user answers.
   */
  problem: string | null;
  /** Close the window without another attempt at writing. */
  quitAnyway: () => void;
  /** Stay open, keeping the edit in the view. */
  keepEditing: () => void;
}

/**
 * Hold the window open until what is queued has been written.
 *
 * Navigating away is an unmount, so the queue flushes on its own; closing the
 * window is not, and a queued write used to die with the process. This registers
 * the one place the app is told a close is coming, writes everything still
 * queued, and only then lets the window go.
 *
 * `settle` writes what is waiting and resolves to null when it reached the file,
 * or to the reason it did not. A window with nothing queued never awaits
 * anything, so an idle close is exactly as immediate as it was before this
 * existed. A close whose final write fails is prevented rather than allowed
 * silently: the reason is reported and the choice stays with the user.
 *
 * The app is one window, so destroying it quits. Quitting that way makes no
 * second attempt at the save — the user has already been told it failed and has
 * chosen to go anyway.
 */
export function useCloseGuard(settle: () => Promise<string | null>): CloseGuard {
  const [problem, setProblem] = useState<string | null>(null);

  // The listener is registered once for the life of the page; the settle it
  // calls is whichever is current, so a re-render cannot leave a stale one
  // closing over an old view of the queue.
  const currentSettle = useRef(settle);
  useEffect(() => {
    currentSettle.current = settle;
  }, [settle]);

  useEffect(() => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    let stopped = false;
    let unlisten: (() => void) | null = null;

    void window
      .onCloseRequested(async (event) => {
        const reported = await currentSettle.current();
        if (reported === null) return;
        // Must be called before the handler returns: the window is destroyed as
        // usual otherwise, and the reason would never reach the user.
        event.preventDefault();
        setProblem(reported);
      })
      .then((stopListening) => {
        // A page that went away while the listener was being registered still
        // unregisters, or the handle outlives its owner.
        if (stopped) stopListening();
        else unlisten = stopListening;
      });

    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);

  const quitAnyway = useCallback(() => {
    setProblem(null);
    void getCurrentWindow().destroy();
  }, []);

  const keepEditing = useCallback(() => setProblem(null), []);

  return { problem, quitAnyway, keepEditing };
}
