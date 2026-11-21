import { describe, expect, it } from "vitest";
import { loadLegacyStore } from "./storage";
import { migrateLegacyReads } from "./libraryMigration";

// Fixtures are the old store's own bytes: a `pm4studio.savedTags` array as the
// webview held it, including the variants older builds wrote.
const STORED_READS = JSON.stringify([
  {
    id: "55 00 84 82 12",
    customer: 85,
    data32: 8684050,
    name: "Front door",
    savedAt: "2026-11-01T10:00:00.000Z",
  },
  // An older build: no name, no customer, an extra note.
  { id: "56 00 53 C7 B3", data32: 5490611, savedAt: "2026-11-02T10:00:00.000Z", note: "spare" },
]);

/** A storage that records what was done to it, so "left intact" is provable. */
function recordingStorage(value: string | null) {
  const calls: string[] = [];
  return {
    calls,
    storage: {
      getItem(key: string) {
        calls.push(`getItem:${key}`);
        return value;
      },
      setItem(key: string) {
        calls.push(`setItem:${key}`);
      },
      removeItem(key: string) {
        calls.push(`removeItem:${key}`);
      },
    },
  };
}

describe("loadLegacyStore", () => {
  it("returns the stored reads untouched, including entries the old loader would skip", () => {
    const { storage } = recordingStorage(STORED_READS);
    const stored = loadLegacyStore(storage);

    expect(stored).toHaveLength(2);
    // Nothing is normalised or filtered here: mapping is the store's decision.
    expect(stored[1]).toEqual({
      id: "56 00 53 C7 B3",
      data32: 5490611,
      savedAt: "2026-11-02T10:00:00.000Z",
      note: "spare",
    });
  });

  it("only reads, so the old store survives a failed migration", () => {
    const { calls, storage } = recordingStorage(STORED_READS);
    loadLegacyStore(storage);
    // The old bytes live under this exact key, so this is the key migration must read.
    expect(calls).toEqual(["getItem:pm4studio.savedTags"]);
  });

  it("reports nothing for a store that is absent, unparseable, or not a list", () => {
    expect(loadLegacyStore(recordingStorage(null).storage)).toEqual([]);
    expect(loadLegacyStore(recordingStorage("{\"oops\":").storage)).toEqual([]);
    expect(loadLegacyStore(recordingStorage('{"id":"55 00 84 82 12"}').storage)).toEqual([]);
    expect(loadLegacyStore(recordingStorage("[]").storage)).toEqual([]);
  });
});

describe("migrateLegacyReads", () => {
  it("does nothing outside the desktop app, where there is no library file", async () => {
    // Vitest runs in node, so this is the browser-preview path: no invoke, no
    // touching of the old store.
    expect(await migrateLegacyReads()).toBeNull();
  });
});
