/**
 * Clearing every piece of data this app has saved on this machine.
 *
 * One action, one report, and two halves that live in different processes. The
 * files — the library and the temporary sibling a save stages beside it — are
 * removed by the Rust command `clear_all_saved_data`, which resolves them itself
 * from the app data directory and takes no path from input
 * (`src-tauri/src/clear_data.rs`). The keys — the legacy saved-reads store and
 * this app's preference keys — are removed here, because they live in the
 * webview's own storage and no Rust process can reach them.
 *
 * Neither half takes a name from the user: the targets are written down in this
 * file and in that module, and the action's only input is the gate's typed word.
 * There is no "clear this path" anywhere in the app.
 *
 * If any target cannot be removed the report says so and names the part, and a
 * refusal never pretends to be a partial success: the interface shows exactly
 * what went and exactly what stopped it. The Rust half refuses before it removes
 * anything; the key half is checked the same way, by reading each key back after
 * removing it.
 *
 * This module is not a fallback for a failed save. Nothing in the library's read
 * or write path calls it (see the exception recorded in
 * `src-tauri/src/library.rs`): it runs only from the Settings → Data gate, after
 * the user has typed the word.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";
import { notifyPreferenceReset } from "./preferences";
import { LEGACY_BEEP_KEY, QUIET_LEVEL_KEY } from "./quietLevel";
import { LEGACY_STORE_KEY } from "./storage";
import { resetToastCorner, TOAST_CORNER_KEY } from "./toastCorner";

/** Every target a clear action can name, as the report names it. */
export type ClearTargetId =
  | "libraryFile"
  | "staleTemp"
  | "legacyStore"
  | "legacyBeepPreference"
  | "quietLevelPreference"
  | "toastCornerPreference"
  | "appStorage";

/**
 * The words for each target, in one table.
 *
 * "Exactly what was removed" is only exact if the user can tell what each line
 * is, so the names are here rather than assembled at the call site.
 */
export const CLEAR_TARGET_LABEL: Record<ClearTargetId, string> = {
  libraryFile: "the library file",
  staleTemp: "the temporary file a save may have left beside it",
  legacyStore: "the legacy saved-reads store",
  legacyBeepPreference: "the old on/off beep preference",
  quietLevelPreference: "the quiet-level preference",
  toastCornerPreference: "the message-corner preference",
  appStorage: "this app's storage",
};

/**
 * The webview-side targets, in the order they are reported.
 *
 * This list is the registry: a preference added to this app belongs here, or
 * clearing saved data will leave it behind and grow a stored choice back on the
 * next launch. Both of the quiet level's keys are here for that reason — the
 * level is read from the new key and falls back to the old boolean when the new
 * key is absent, so leaving the boolean behind would let a cleared preference
 * come back on the next launch.
 */
const PREFERENCE_TARGETS: readonly { readonly id: ClearTargetId; readonly key: string }[] = [
  { id: "legacyStore", key: LEGACY_STORE_KEY },
  { id: "legacyBeepPreference", key: LEGACY_BEEP_KEY },
  { id: "quietLevelPreference", key: QUIET_LEVEL_KEY },
  { id: "toastCornerPreference", key: TOAST_CORNER_KEY },
];

/** The word the gate requires. Not a click, not "yes": this word, typed. */
export const CLEAR_GATE_WORD = "clear";

/** Whether what has been typed is the gate's word, exactly. */
export function clearGateSatisfied(typed: string): boolean {
  return typed === CLEAR_GATE_WORD;
}

/** One thing that was removed. */
export interface ClearedItem {
  readonly target: ClearTargetId;
  /** The path or the storage key, shown so the user can see what went. */
  readonly detail: string;
  /** Bytes, for a file. Absent for a storage key. */
  readonly bytes?: number;
}

/** The target that stopped the action, and why it could not be removed. */
export interface ClearBlocked {
  readonly target: ClearTargetId;
  /** The path or the storage key that survived. */
  readonly detail: string;
  readonly reason: string;
}

/** What one clear action did, as the interface reports it. */
export interface ClearReport {
  /** True only when every target that existed was removed. */
  readonly cleared: boolean;
  /** Exactly what was removed. Never a target that was not there. */
  readonly removed: ClearedItem[];
  /** Set when the action refused; names the part that could not be removed. */
  readonly blocked: ClearBlocked | null;
}

/** What the Rust command answers. */
interface ClearFileView {
  readonly cleared: boolean;
  readonly removed: readonly {
    readonly target: "libraryFile" | "staleTemp";
    readonly path: string;
    readonly bytes: number;
  }[];
  readonly blocked: {
    readonly target: "libraryFile" | "staleTemp";
    readonly path: string;
    readonly reason: string;
  } | null;
}

/** The slice of `Storage` this module needs, so a test can hand in its own. */
export interface ClearStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

function defaultStorage(): ClearStorage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

/** One preference key, and what happened to it. */
interface KeySweep {
  readonly removed: ClearedItem[];
  readonly blocked: ClearBlocked | null;
}

/**
 * Remove the preference keys that are stored, reading each one back afterwards.
 *
 * `removeItem` reports nothing on its own, so the answer is read back rather
 * than assumed: a key still present after its removal is a target that could not
 * be removed, and the report must say which one.
 */
function sweepPreferenceKeys(storage: ClearStorage): KeySweep {
  const removed: ClearedItem[] = [];
  for (const { id, key } of PREFERENCE_TARGETS) {
    let present: string | null;
    try {
      present = storage.getItem(key);
    } catch {
      return { removed, blocked: { target: id, detail: key, reason: "its stored value could not be read" } };
    }
    // A key that was never written is not something to claim to have removed.
    if (present === null) continue;
    try {
      storage.removeItem(key);
    } catch {
      return { removed, blocked: { target: id, detail: key, reason: "it could not be removed" } };
    }
    let after: string | null;
    try {
      after = storage.getItem(key);
    } catch {
      return { removed, blocked: { target: id, detail: key, reason: "it could not be read back after removal" } };
    }
    if (after !== null) {
      return { removed, blocked: { target: id, detail: key, reason: "it is still stored after removal" } };
    }
    removed.push({ target: id, detail: key });
  }
  return { removed, blocked: null };
}

/**
 * Clear every saved thing, files first and preference keys second.
 *
 * The file half runs first because it is the half that can refuse before
 * touching anything: if the library or its temporary sibling cannot be removed,
 * nothing is removed anywhere and the preference keys are left exactly as they
 * were. Only once the files are gone are the keys removed, and if one of those
 * cannot go the report says which — along with what had already been removed, so
 * the user is never told a half-done clear was whole.
 *
 * The preferences are told their stored values are gone before this returns, so
 * the window falls back to the documented defaults without a restart.
 */
export async function clearAllSavedData(
  options: { readonly storage?: ClearStorage | null } = {},
): Promise<ClearReport> {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const refused = (blocked: ClearBlocked, removed: ClearedItem[] = []): ClearReport => ({
    cleared: false,
    removed,
    blocked,
  });

  if (!isTauri()) {
    return refused({
      target: "appStorage",
      detail: "the app data directory and this window's storage",
      reason:
        "The app's own storage is only reachable from the desktop app, and this preview cannot reach it",
    });
  }

  let view: ClearFileView;
  try {
    view = await invoke<ClearFileView>("clear_all_saved_data");
  } catch (e) {
    return refused({
      target: "appStorage",
      detail: "the app data directory",
      reason: messageOf(e),
    });
  }

  const removedFiles: ClearedItem[] = view.removed.map((item) => ({
    target: item.target,
    detail: item.path,
    bytes: item.bytes,
  }));

  if (!view.cleared) {
    const blocked = view.blocked;
    return refused(
      blocked === null
        ? {
            target: "appStorage",
            detail: "the app data directory",
            reason: "the clear action refused without naming a target",
          }
        : { target: blocked.target, detail: blocked.path, reason: blocked.reason },
      removedFiles,
    );
  }

  if (storage === null) {
    return refused(
      {
        target: "appStorage",
        detail: "this window's storage",
        reason: "This window has no storage to clear",
      },
      removedFiles,
    );
  }

  const sweep = sweepPreferenceKeys(storage);
  // Whatever went, the preferences it governed fall back to their defaults now:
  // a removed key must not keep governing the window until the next launch.
  if (sweep.removed.length > 0) notifyPreferenceReset();
  // The corner is drawn from what is stored, so the visible corner has to be
  // told too — the key is already gone; this re-reads the default and moves the
  // messages there without a restart.
  if (sweep.removed.some((item) => item.target === "toastCornerPreference")) {
    resetToastCorner();
  }

  if (sweep.blocked) {
    return refused(sweep.blocked, [...removedFiles, ...sweep.removed]);
  }

  return { cleared: true, removed: [...removedFiles, ...sweep.removed], blocked: null };
}

/**
 * A sentence and a tone for the report's header.
 *
 * The tone is the notice vocabulary's own (`lib/noticeTone`), not a third spelling
 * of it: `muted` is what "there was nothing saved to clear" is drawn in, which is
 * the same ink the rest of the app uses for "said, and not news".
 */
export interface ClearNotice {
  readonly tone: "ok" | "err" | "muted";
  readonly title: string;
  readonly detail: string;
}

/**
 * What to say about a clear action, and in what tone.
 *
 * The list of what was removed is rendered from the report itself, so this only
 * has to say which of the three things happened: it cleared, there was nothing
 * to clear, or it stopped — and if it stopped, which part stopped it.
 */
export function describeClearReport(report: ClearReport): ClearNotice {
  if (report.cleared) {
    return report.removed.length === 0
      ? {
          tone: "muted",
          title: "There was nothing saved to clear.",
          detail: "No library file, temporary file or stored preference was found. Nothing was removed.",
        }
      : {
          tone: "ok",
          title: "Cleared all saved data.",
          detail: "This is exactly what was removed:",
        };
  }

  const blocked = report.blocked;
  const part = blocked ? CLEAR_TARGET_LABEL[blocked.target] : "this app's storage";
  const reason = blocked?.reason ?? "the clear action refused";
  if (report.removed.length === 0) {
    return {
      tone: "err",
      title: `Nothing was cleared: ${part} could not be removed.`,
      detail: `${reason}. Everything this app had saved is still there.`,
    };
  }
  return {
    tone: "err",
    title: `Clearing stopped: ${part} could not be removed.`,
    detail: `${reason}. This had already been removed when it stopped:`,
  };
}
