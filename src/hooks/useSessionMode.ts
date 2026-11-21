/**
 * A mode a page remembers, for the length of a session.
 *
 * The band pages are workspaces: one operation visible at a time, chosen from a
 * segmented control (spec, "Navigation and page shape"). Leaving 125 kHz to check
 * something in the Library and coming back must not cost the user their place,
 * so the chosen mode outlives the page's unmount.
 *
 * "Session" is the webview's lifetime, deliberately and not accidentally:
 *
 *   * it is **not** component state, because the shell renders one destination at
 *     a time and a page is unmounted the moment you leave it — that is exactly
 *     the trip the mode has to survive;
 *   * it is **not** persisted, because an app that reopens on the mode you last
 *     used is a different promise (the same reason the shell's destination is
 *     session state and not a stored preference). A launch starts at the mode
 *     that is first for the work.
 *
 * The store is a module-level map, like `lib/deviceLock`'s flag and
 * `lib/toastStore`: no context, no provider, and nothing to thread through the
 * shell for a value that is one small string per page.
 */

import { useCallback, useState } from "react";

/** One remembered mode per page. The key is the page's id, never a mode value. */
const remembered = new Map<string, string>();

/**
 * The mode this page is on, and a setter that remembers it.
 *
 * `initial` is what a fresh session opens on. It must be a mode the page offers:
 * a remembered value is returned as-is, so a mode that was renamed or removed
 * between builds would be a type error at the call site rather than a blank page
 * here — the two are the same union.
 */
export function useSessionMode<T extends string>(
  page: string,
  initial: T,
): readonly [T, (mode: T) => void] {
  const [mode, setMode] = useState<T>(() => (remembered.get(page) as T | undefined) ?? initial);

  const choose = useCallback(
    (next: T) => {
      remembered.set(page, next);
      setMode(next);
    },
    [page],
  );

  return [mode, choose] as const;
}

/** Test-only: forget every remembered mode, so one test cannot leak into the next. */
export function resetSessionModesForTest(): void {
  remembered.clear();
}
