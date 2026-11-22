// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  CLEAR_GATE_WORD,
  CLEAR_TARGET_LABEL,
  clearAllSavedData,
  clearGateSatisfied,
  describeClearReport,
  type ClearReport,
  type ClearStorage,
} from "./clearData";
import { subscribePreferenceReset } from "./preferences";
import { DEFAULT_QUIET_LEVEL, LEGACY_BEEP_KEY, QUIET_LEVEL_KEY } from "./quietLevel";
import { LEGACY_STORE_KEY } from "./storage";
import { DEFAULT_TOAST_CORNER, TOAST_CORNER_KEY } from "./toastCorner";
import { fakeBackend } from "../test/dom";

/**
 * The clear-data scope, at the seam the ticket names: which targets are
 * resolved, that no path comes from input, that a refusal names the part, and
 * that the report matches what was removed.
 *
 * The files themselves are the Rust half's, tested against a real temporary
 * directory in `src-tauri/src/clear_data.rs`; here the Rust answer is scripted
 * and what is checked is the join: the two halves as one action, and the
 * sentences the user is left with.
 */

function fileView(
  removed: { target: "libraryFile" | "staleTemp"; path: string; bytes: number }[] = [],
  blocked: { target: "libraryFile" | "staleTemp"; path: string; reason: string } | null = null,
) {
  return { cleared: blocked === null, removed, blocked };
}

/** A storage that holds keys in memory and can be made to misbehave. */
function memoryStorage(initial: Record<string, string> = {}, failures: {
  remove?: string;
  read?: string;
} = {}): ClearStorage & { entries: Map<string, string> } {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem(key) {
      if (failures.read === key) throw new Error("storage is unavailable");
      return entries.get(key) ?? null;
    },
    removeItem(key) {
      if (failures.remove !== key) entries.delete(key);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("the gate", () => {
  it("requires the word, typed exactly", () => {
    expect(CLEAR_GATE_WORD).toBe("clear");
    expect(clearGateSatisfied("clear")).toBe(true);
    // A second click is not the gate, and neither is a near miss: the word is
    // the whole confirmation.
    for (const nearly of ["", "Clear", "CLEAR", " clear", "clear ", "clea", "clearr", "yes"]) {
      expect(clearGateSatisfied(nearly), JSON.stringify(nearly)).toBe(false);
    }
  });
});

describe("clearing everything this app saved", () => {
  it("removes the files the Rust half resolved and the keys this window owns, and reports exactly those", async () => {
    fakeBackend({
      clear_all_saved_data: () =>
        fileView([
          {
            target: "libraryFile",
            path: "/app data/library.json",
            bytes: 2048,
          },
          {
            target: "staleTemp",
            path: "/app data/library.json.tmp",
            bytes: 12,
          },
        ]),
    });
    const storage = memoryStorage({
      [LEGACY_STORE_KEY]: "[{\"id\":\"55 00 84 82 12\"}]",
      [LEGACY_BEEP_KEY]: "0",
      [QUIET_LEVEL_KEY]: "off",
      [TOAST_CORNER_KEY]: "top-left",
      // Somebody else's key, in the same storage.
      "unrelated.key": "keep me",
    });

    const report = await clearAllSavedData({ storage });

    expect(report.cleared).toBe(true);
    expect(report.blocked).toBeNull();
    expect(report.removed).toEqual([
      { target: "libraryFile", detail: "/app data/library.json", bytes: 2048 },
      { target: "staleTemp", detail: "/app data/library.json.tmp", bytes: 12 },
      { target: "legacyStore", detail: LEGACY_STORE_KEY },
      { target: "legacyBeepPreference", detail: LEGACY_BEEP_KEY },
      { target: "quietLevelPreference", detail: QUIET_LEVEL_KEY },
      { target: "toastCornerPreference", detail: TOAST_CORNER_KEY },
    ]);
    // Nothing this action does not own is touched.
    expect([...storage.entries.keys()]).toEqual(["unrelated.key"]);
  });

  it("takes no path from input: the command is sent with no arguments at all", async () => {
    const backend = fakeBackend({ clear_all_saved_data: () => fileView() });

    await clearAllSavedData({ storage: memoryStorage() });

    // The targets are resolved in Rust from the app data directory. There is no
    // argument here through which anything outside that directory could be
    // named — which is the guarantee, not a convention at the call site.
    expect(backend.callsTo("clear_all_saved_data")).toEqual([
      { command: "clear_all_saved_data", args: {} },
    ]);
  });

  it("does not report a preference key that was never stored", async () => {
    fakeBackend({ clear_all_saved_data: () => fileView() });
    const storage = memoryStorage({ [TOAST_CORNER_KEY]: "bottom-left" });

    const report = await clearAllSavedData({ storage });

    expect(report.cleared).toBe(true);
    expect(report.removed).toEqual([
      { target: "toastCornerPreference", detail: TOAST_CORNER_KEY },
    ]);
  });

  it("says there was nothing to clear, and claims nothing", async () => {
    fakeBackend({ clear_all_saved_data: () => fileView() });

    const report = await clearAllSavedData({ storage: memoryStorage() });

    expect(report).toEqual({ cleared: true, removed: [], blocked: null });
    expect(describeClearReport(report)).toEqual({
      // The notice vocabulary's own word for "said, and not news": the report's
      // tone is not a third spelling of the tone scale.
      tone: "muted",
      title: "There was nothing saved to clear.",
      detail:
        "No library file, temporary file or stored preference was found. Nothing was removed.",
    });
  });

  it("leaves the preference keys alone when the file half refuses", async () => {
    fakeBackend({
      clear_all_saved_data: () =>
        fileView([], {
          target: "staleTemp",
          path: "/app data/library.json.tmp",
          reason: "it is a symbolic link, and this action never follows one",
        }),
    });
    const storage = memoryStorage({ [QUIET_LEVEL_KEY]: "off", [LEGACY_STORE_KEY]: "[]" });

    const report = await clearAllSavedData({ storage });

    // A refusal is whole: the half that refused removed nothing, so the other
    // half must not go ahead and remove its targets either.
    expect(report.cleared).toBe(false);
    expect(report.removed).toEqual([]);
    expect(report.blocked).toEqual({
      target: "staleTemp",
      detail: "/app data/library.json.tmp",
      reason: "it is a symbolic link, and this action never follows one",
    });
    expect(storage.entries.get(QUIET_LEVEL_KEY)).toBe("off");
    expect(storage.entries.get(LEGACY_STORE_KEY)).toBe("[]");
    expect(describeClearReport(report).title).toBe(
      "Nothing was cleared: the temporary file a save may have left beside it could not be removed.",
    );
  });

  it("names the preference key that could not be removed, and what had already gone", async () => {
    fakeBackend({
      clear_all_saved_data: () =>
        fileView([{ target: "libraryFile", path: "/app data/library.json", bytes: 10 }]),
    });
    const storage = memoryStorage(
      { [LEGACY_STORE_KEY]: "[]", [QUIET_LEVEL_KEY]: "off" },
      // The key is still there after the remove that was asked for.
      { remove: QUIET_LEVEL_KEY },
    );

    const report = await clearAllSavedData({ storage });

    expect(report.cleared).toBe(false);
    expect(report.blocked).toEqual({
      target: "quietLevelPreference",
      detail: QUIET_LEVEL_KEY,
      reason: "it is still stored after removal",
    });
    // The report is honest about the part that did go, rather than calling the
    // whole action either a success or a no-op.
    expect(report.removed).toEqual([
      { target: "libraryFile", detail: "/app data/library.json", bytes: 10 },
      { target: "legacyStore", detail: LEGACY_STORE_KEY },
    ]);
    const notice = describeClearReport(report);
    expect(notice.tone).toBe("err");
    expect(notice.title).toBe("Clearing stopped: the quiet-level preference could not be removed.");
    expect(notice.detail).toBe(
      "it is still stored after removal. This had already been removed when it stopped:",
    );
  });

  it("refuses without removing anything when the window has no storage", async () => {
    fakeBackend({ clear_all_saved_data: () => fileView() });

    const report = await clearAllSavedData({ storage: null });

    expect(report.cleared).toBe(false);
    expect(report.blocked?.target).toBe("appStorage");
  });

  it("refuses in the preview, where the app's own storage cannot be reached", async () => {
    // No fake backend: `isTauri()` is false here, exactly as in a browser tab.
    const report = await clearAllSavedData({ storage: memoryStorage() });

    expect(report.cleared).toBe(false);
    expect(report.removed).toEqual([]);
    expect(CLEAR_TARGET_LABEL[report.blocked!.target]).toBe("this app's storage");
  });

  it("tells the preferences to fall back to their defaults, without a restart", async () => {
    fakeBackend({ clear_all_saved_data: () => fileView() });
    let resets = 0;
    const unsubscribe = subscribePreferenceReset(() => {
      resets += 1;
    });
    try {
      await clearAllSavedData({ storage: memoryStorage({ [QUIET_LEVEL_KEY]: "off" }) });
    } finally {
      unsubscribe();
    }

    // The keys are gone, so the listeners re-read their defaults rather than
    // keeping a stored value that no longer exists.
    expect(resets).toBe(1);
    expect(DEFAULT_QUIET_LEVEL).toBe("all");
    expect(DEFAULT_TOAST_CORNER).toBe("bottom-right");
  });

  it("does not tell the preferences anything when nothing was removed", async () => {
    fakeBackend({ clear_all_saved_data: () => fileView() });
    let resets = 0;
    const unsubscribe = subscribePreferenceReset(() => {
      resets += 1;
    });
    try {
      await clearAllSavedData({ storage: memoryStorage() });
    } finally {
      unsubscribe();
    }
    expect(resets).toBe(0);
  });
});

describe("the report's words", () => {
  it("leads a success with the list of what went", () => {
    const report: ClearReport = {
      cleared: true,
      removed: [{ target: "libraryFile", detail: "/app data/library.json", bytes: 1 }],
      blocked: null,
    };
    expect(describeClearReport(report)).toEqual({
      tone: "ok",
      title: "Cleared all saved data.",
      detail: "This is exactly what was removed:",
    });
  });

  it("never claims a refusal was a clear", () => {
    const report: ClearReport = {
      cleared: false,
      removed: [],
      blocked: { target: "libraryFile", detail: "/x/library.json", reason: "it is a directory" },
    };
    const notice = describeClearReport(report);
    expect(notice.tone).toBe("err");
    expect(notice.title).toBe("Nothing was cleared: the library file could not be removed.");
    expect(notice.detail).toBe("it is a directory. Everything this app had saved is still there.");
  });
});
