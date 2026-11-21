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
  /**
   * Write everything still queued, wait for it, and report whether it reached
   * the file: `null` when it did, otherwise the reason it did not. Resolves at
   * once when nothing is queued, so a window with no pending edit closes with no
   * delay. Used when the window is about to close, the one exit that is not an
   * unmount and cannot be retried afterwards — and when the page that edits
   * Drafts goes away, which does not wait for the reply.
   */
  settle: () => Promise<string | null>;
}

/**
 * Drafts are a collection in the same file as the Snapshots, read and written
 * through the Rust store. Edits apply to the view immediately and are written
 * to disk a moment later, so typing does not turn into one file rewrite per
 * keystroke. Anything still pending is written when the queue's owner goes away
 * — see `settle`, which is the one definition of "pending" every exit uses.
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
  /** Writes on their way to the store, so a close can wait for them first. */
  const inFlight = useRef(new Set<Promise<string | null>>());
  /** How many times each Draft has been edited, so a write knows if it is current. */
  const revisions = useRef(new Map<string, number>());
  /** Drafts whose newest edit has not reached the file yet. */
  const unsaved = useRef(new Set<string>());
  /** The settle in flight, so two exits at the same moment write nothing twice. */
  const settling = useRef<Promise<string | null> | null>(null);

  const apply = useCallback((next: Draft[]) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  /**
   * Write one Draft to the store as it now stands, and say what happened:
   * `null` when the file took it, otherwise why it did not. A refusal is a
   * failure here even though the call succeeded: the edit is not on disk, and a
   * caller waiting to close the window must not mistake refusal for a write.
   */
  const persist = useCallback(async (id: string): Promise<string | null> => {
    const draft = draftsRef.current.find((d) => d.id === id);
    // A Draft that has been deleted has nothing left to write.
    if (!draft) {
      unsaved.current.delete(id);
      return null;
    }
    const revision = revisions.current.get(id) ?? 0;
    const write = (async () => {
      try {
        const view = await invoke<DraftsView>("draft_save", { draft });
        setProblem(view.problem);
        setError(null);
        // The edit this write carried is on disk only if no newer edit arrived
        // while it was out. Otherwise the Draft is still unsaved, and a close
        // that ran now would drop what was typed since.
        if (view.problem === null && (revisions.current.get(id) ?? 0) === revision) {
          unsaved.current.delete(id);
        }
        return view.problem === null ? null : view.problem.message;
      } catch (e) {
        setError(String(e));
        return String(e);
      }
    })();
    inFlight.current.add(write);
    try {
      return await write;
    } finally {
      inFlight.current.delete(write);
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

  /** Stop the queued writes without performing them: they are queued anyway. */
  const stopTimers = useCallback(() => {
    for (const queued of timers.current.values()) clearTimeout(queued);
    timers.current.clear();
  }, []);

  /**
   * What has been edited and is not on disk yet: the one answer to "what is
   * queued" that every exit uses.
   *
   * A timer is only a delayed write of something already here, so a Draft with a
   * timer is always in this set. A write that is out is not: it carries an edit
   * that is already on its way, and a newer edit waits for it rather than racing
   * it. A write that failed leaves its Draft here, which is why a failed save is
   * retried by whatever exit happens next, whichever exit that is.
   */
  const queued = useCallback((): string[] => [...unsaved.current], []);

  /**
   * Write everything queued and wait for it, so a caller about to end the
   * process knows what is on disk.
   *
   * A write already on its way is awaited first. Only then is what is still
   * queued written, because a queued Draft is newer than the copy in flight:
   * writing the other way round would let the older copy land last and become
   * the file. Nothing queued and nothing in flight resolves immediately, which
   * is what keeps an idle window closing instantly.
   *
   * A write that failed stays queued, so the next exit tries it again rather
   * than treating an edit on screen as one that reached the file.
   */
  const settleOnce = useCallback(async (): Promise<string | null> => {
    const pending = queued();
    if (pending.length === 0 && inFlight.current.size === 0) return null;

    // The timers are stopped before anything is awaited: a timer that fired
    // mid-settle would write the same Draft a second time, after this call had
    // already worked out what to write.
    stopTimers();

    await Promise.allSettled([...inFlight.current]);

    let failure: string | null = null;
    for (const id of pending) {
      // A write that was out when this started may have carried the newest state
      // to the file already.
      if (!unsaved.current.has(id)) continue;
      const reported = await persist(id);
      if (failure === null && reported !== null) failure = reported;
    }
    return failure;
  }, [persist, queued, stopTimers]);

  /**
   * `settleOnce`, but one at a time.
   *
   * Two exits can arrive together — leaving the Drafts page unmounts it while the
   * app above it is going away too — and each would otherwise write the same
   * Draft again. A caller that asks while a settle is running joins the one that
   * is already running, which is also the honest answer: what is on disk when it
   * resolves is what that call promised.
   */
  const settle = useCallback((): Promise<string | null> => {
    if (settling.current) return settling.current;
    const run = settleOnce();
    settling.current = run;
    const done = () => {
      if (settling.current === run) settling.current = null;
    };
    void run.then(done, done);
    return run;
  }, [settleOnce]);

  useEffect(() => () => void settle(), [settle]);

  const reload = useCallback(async () => {
    if (!isTauri()) {
      setError("Drafts are read through the desktop app; this preview cannot reach them.");
      setLoading(false);
      return;
    }
    try {
      const read = await invoke<DraftsView>("drafts_load");
      // What is on disk, with anything of ours that has not reached it on top: a
      // reread is not permission to throw away an edit that is still queued.
      const edited = new Map(
        draftsRef.current
          .filter((draft) => unsaved.current.has(draft.id))
          .map((draft) => [draft.id, draft]),
      );
      apply(read.drafts.map((draft) => edited.get(draft.id) ?? draft));
      setProblem(read.problem);
      setMigrationWarning(read.migrationWarning);
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
      unsaved.current.add(id);
      revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1);
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
      unsaved.current.delete(id);
      revisions.current.delete(id);
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
    settle,
  };
}
