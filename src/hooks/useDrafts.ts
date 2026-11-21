import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../lib/platform";
import type { Draft, DraftRecord, DraftsView } from "../lib/drafts";
import type { LibraryProblem } from "../lib/library";

/** How long an edit settles before the whole Draft is written to disk. */
const SAVE_DELAY_MS = 350;

/** Everything the Drafts page needs to read and edit Drafts. */
export interface DraftsState {
  drafts: Draft[];
  /** Set when the library file must not be written to; saving is turned off. */
  problem: LibraryProblem | null;
  /**
   * Set when a file written by an older schema was lifted but the lift could
   * not be written back. The Drafts are whole and saving is on, so this is a
   * warning rather than a lock.
   */
  migrationWarning: string | null;
  /** A call that failed outright, as opposed to a reported file problem. */
  error: string | null;
  loading: boolean;
  create: (name: string) => Promise<Draft | null>;
  /**
   * Create a Draft that already holds `records`, in the order given, and return
   * it saved. Used when a Tag's Records are loaded into a Draft: the Records
   * belong to the Draft from the moment it exists, so there is no window in
   * which an empty Draft is on disk under the tag's name.
   */
  createWith: (name: string, records: DraftRecord[]) => Promise<Draft | null>;
  rename: (id: string, name: string) => void;
  setRecords: (id: string, records: DraftRecord[]) => void;
  remove: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Drafts are a collection in the same file as the Snapshots, read and written
 * through the Rust store. Edits apply to the view immediately and are written
 * to disk a moment later, so typing does not turn into one file rewrite per
 * keystroke; anything still pending is written when the page unmounts, so
 * nothing is lost by leaving the section.
 */
export function useDrafts(): DraftsState {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [problem, setProblem] = useState<LibraryProblem | null>(null);
  const [migrationWarning, setMigrationWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** The latest list, readable from timers and cleanups without a re-render. */
  const draftsRef = useRef<Draft[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const apply = useCallback((next: Draft[]) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  /** Write one Draft to the store as it now stands. */
  const persist = useCallback(async (id: string) => {
    const draft = draftsRef.current.find((d) => d.id === id);
    if (!draft) return;
    try {
      const view = await invoke<DraftsView>("draft_save", { draft });
      setProblem(view.problem);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /** Queue a write for one Draft, replacing any write already queued for it. */
  const schedule = useCallback(
    (id: string) => {
      const queued = timers.current.get(id);
      if (queued) clearTimeout(queued);
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          void persist(id);
        }, SAVE_DELAY_MS),
      );
    },
    [persist],
  );

  /** Write everything still queued, now. Used when the page goes away. */
  const flush = useCallback(() => {
    for (const [id, queued] of timers.current) {
      clearTimeout(queued);
      void persist(id);
    }
    timers.current.clear();
  }, [persist]);

  useEffect(() => flush, [flush]);

  const reload = useCallback(async () => {
    if (!isTauri()) {
      setError("Drafts are read through the desktop app; this preview cannot reach them.");
      setLoading(false);
      return;
    }
    try {
      const view = await invoke<DraftsView>("drafts_load");
      apply(view.drafts);
      setProblem(view.problem);
      setMigrationWarning(view.migrationWarning);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (name: string): Promise<Draft | null> => {
      try {
        const view = await invoke<DraftsView>("draft_create", {
          name,
          updatedAt: new Date().toISOString(),
        });
        setProblem(view.problem);
        setError(null);
        // The store generated the id, so the new Draft is the one this view has
        // that the page did not. Adopting only that keeps any edit still queued
        // for another Draft from being overwritten by the reply.
        const known = new Set(draftsRef.current.map((d) => d.id));
        const added = view.drafts.filter((d) => !known.has(d.id));
        if (added.length > 0) apply([...draftsRef.current, ...added]);
        return added[0] ?? null;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [apply],
  );

  const createWith = useCallback(
    async (name: string, records: DraftRecord[]): Promise<Draft | null> => {
      try {
        const created = await invoke<DraftsView>("draft_create", {
          name,
          updatedAt: new Date().toISOString(),
        });
        setProblem(created.problem);
        setError(null);
        // The store generated the id, so the Draft it just added is the one
        // this view did not have. Adopting only that leaves every other Draft,
        // and any edit queued for one, exactly as it is.
        const known = new Set(draftsRef.current.map((d) => d.id));
        const added = created.drafts.find((d) => !known.has(d.id));
        if (!added) {
          setError("the store did not report the Draft it created");
          return null;
        }

        // The Records are written before anything is shown as saved: a Draft
        // created and left empty would be a worse answer than an error.
        const filled: Draft = { ...added, records };
        const saved = await invoke<DraftsView>("draft_save", { draft: filled });
        setProblem(saved.problem);
        const stored = saved.drafts.find((d) => d.id === filled.id) ?? filled;
        apply([...draftsRef.current, stored]);
        return stored;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [apply],
  );

  const edit = useCallback(
    (id: string, patch: (draft: Draft) => Draft) => {
      const next = draftsRef.current.map((draft) => {
        if (draft.id !== id) return draft;
        const edited = patch(draft);
        return { ...edited, updatedAt: new Date().toISOString() };
      });
      apply(next);
      schedule(id);
    },
    [apply, schedule],
  );

  const rename = useCallback(
    (id: string, name: string) => edit(id, (draft) => ({ ...draft, name })),
    [edit],
  );

  const setRecords = useCallback(
    (id: string, records: DraftRecord[]) => edit(id, (draft) => ({ ...draft, records })),
    [edit],
  );

  const remove = useCallback(
    async (id: string) => {
      const queued = timers.current.get(id);
      if (queued) {
        clearTimeout(queued);
        timers.current.delete(id);
      }
      apply(draftsRef.current.filter((draft) => draft.id !== id));
      try {
        const view = await invoke<DraftsView>("draft_delete", { id });
        setProblem(view.problem);
        setError(null);
      } catch (e) {
        setError(String(e));
        await reload();
      }
    },
    [apply, reload],
  );

  return {
    drafts,
    problem,
    migrationWarning,
    error,
    loading,
    create,
    createWith,
    rename,
    setRecords,
    remove,
    reload,
  };
}
