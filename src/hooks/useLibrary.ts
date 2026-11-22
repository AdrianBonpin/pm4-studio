import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../lib/platform";
import { migrateLegacyReads } from "../lib/libraryMigration";
import type { LibraryView, SaveResult } from "../lib/library";
import type { HfSnapshotSave } from "../lib/hfSnapshot";
import type { ExportResult, ImportPreview, ImportResult, PickMode } from "../lib/libraryFiles";
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
  /**
   * Save a 13.56 MHz read, whole: its identity, its family, its capacity, its
   * NDEF status, its raw reply and its Records. `null` means the call itself
   * failed; the store's own answer — added, already there, or refused — comes
   * back inside the result.
   */
  saveHf: (read: HfSnapshotSave) => Promise<SaveResult | null>;
  rename: (id: string, name: string) => Promise<void>;
  /** Write the name and note of one Snapshot in a single call, or neither. */
  edit: (id: string, draft: { name: string; note: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  /**
   * Choose a file with the system dialog. `null` means the user cancelled, and
   * nothing has been read or written.
   */
  pickPath: (mode: PickMode, suggestedName?: string) => Promise<string | null>;
  /** Write the whole library to `path`. `null` means it was not written. */
  exportTo: (path: string) => Promise<ExportResult | null>;
  /**
   * Count what importing `path` would add, writing nothing. Cancelling an
   * import is simply never calling `applyImport`.
   */
  previewImport: (path: string) => Promise<ImportPreview | null>;
  /** Merge `path` into the library, keeping everything already here. */
  applyImport: (path: string) => Promise<ImportResult | null>;
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
      // Hand the old webview store's saved reads over on every launch; the file
      // store migrates only while its file does not exist yet, so this can
      // neither duplicate nor overwrite. The old store is only ever read.
      const migrated = await migrateLegacyReads();
      if (migrated) setView(migrated.library);
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

  const saveHf = useCallback(async (read: HfSnapshotSave): Promise<SaveResult | null> => {
    try {
      const result = await invoke<SaveResult>("library_save_hf", {
        hf: read,
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

  const edit = useCallback(async (id: string, draft: { name: string; note: string }) => {
    try {
      setView(
        await invoke<LibraryView>("library_edit", {
          id,
          name: draft.name,
          note: draft.note,
        }),
      );
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

  const pickPath = useCallback(
    async (mode: PickMode, suggestedName?: string): Promise<string | null> => {
      if (!isTauri()) {
        setError("Files are chosen through the desktop app; this preview cannot open a dialog.");
        return null;
      }
      try {
        const chosen = await invoke<string | null>("library_pick_file", {
          mode,
          suggestedName: suggestedName ?? null,
        });
        setError(null);
        return chosen;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [],
  );

  const exportTo = useCallback(async (path: string): Promise<ExportResult | null> => {
    try {
      const result = await invoke<ExportResult>("library_export", { path });
      setError(null);
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const previewImport = useCallback(async (path: string): Promise<ImportPreview | null> => {
    try {
      const preview = await invoke<ImportPreview>("library_import_preview", { path });
      setError(null);
      return preview;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const applyImport = useCallback(async (path: string): Promise<ImportResult | null> => {
    try {
      const result = await invoke<ImportResult>("library_import_apply", { path });
      setView(result.library);
      setError(null);
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  return {
    view,
    error,
    loading,
    saveLf,
    saveHf,
    rename,
    edit,
    remove,
    reload,
    pickPath,
    exportTo,
    previewImport,
    applyImport,
  };
}
