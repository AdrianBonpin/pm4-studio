import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../lib/platform";
import type { LibraryView, SaveResult } from "../lib/library";
import type { LfCard } from "../types";

/** Everything the shell needs to show and edit the library of Snapshots. */
export interface LibraryState {
  /** `null` until the library has been read once. */
  view: LibraryView | null;
  /**
   * A call that failed outright, as opposed to a file problem the store
   * reported inside `view.problem`.
   */
  error: string | null;
  loading: boolean;
  /** Save a 125 kHz read. `null` means the call itself failed. */
  saveLf: (card: LfCard) => Promise<SaveResult | null>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * The library lives in a file, not in the webview, so every read and write goes
 * through the Rust store. Loading happens once per app launch and each mutation
 * returns the whole library back, so the view can never drift from the file.
 */
export function useLibrary(): LibraryState {
  const [view, setView] = useState<LibraryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!isTauri()) {
      setError("The library is read through the desktop app; this preview cannot reach it.");
      setLoading(false);
      return;
    }
    try {
      setView(await invoke<LibraryView>("library_load"));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveLf = useCallback(async (card: LfCard): Promise<SaveResult | null> => {
    try {
      const result = await invoke<SaveResult>("library_save_lf", {
        customer: card.customer,
        data32: card.data32,
        raw: card.raw,
        capturedAt: new Date().toISOString(),
      });
      setView(result.library);
      setError(null);
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    try {
      setView(await invoke<LibraryView>("library_rename", { id, name }));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      setView(await invoke<LibraryView>("library_delete", { id }));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return { view, error, loading, saveLf, rename, remove, reload };
}
