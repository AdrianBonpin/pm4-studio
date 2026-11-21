import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_LEVEL,
  LEGACY_BEEP_KEY,
  QUIET_LEVELS,
  QUIET_LEVEL_KEY,
  QUIET_LEVEL_LABEL,
  audibleAt,
  isQuietLevel,
  loadQuietLevel,
  saveQuietLevel,
  type QuietLevel,
} from "./quietLevel";
import { SIGNAL_SYMBOLS, type SignalSymbol } from "./signal";

/**
 * The quiet level: three settings, one stored choice, and an old preference
 * carried across without being read as the new shape.
 *
 * The storage is handed in rather than reached for, so both what is written and
 * what is done with a key written by an earlier build are stated here instead of
 * being implied by a browser.
 */

/** A stand-in for the webview's localStorage, holding whatever the test puts in. */
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    read: (key: string) => values.get(key) ?? null,
  };
}

/**
 * Which symbols each level lets through, written out rather than derived.
 *
 * `silent` is never audible — it is the absence of a signal, not a signal the
 * level could permit — and "errors and warnings only" is exactly the two symbols
 * those severities produce: two chirps for a warning, three for an error.
 */
const EXPECTED_AUDIBLE: Record<QuietLevel, Record<SignalSymbol, boolean>> = {
  off: { done: false, "needs-you": false, attention: false, silent: false },
  "errors-and-warnings": { done: false, "needs-you": true, attention: true, silent: false },
  all: { done: true, "needs-you": true, attention: true, silent: false },
};

describe("the quiet level", () => {
  it("is three-way, and is all by default", () => {
    expect([...QUIET_LEVELS]).toEqual(["off", "errors-and-warnings", "all"]);
    expect(DEFAULT_QUIET_LEVEL).toBe("all");
    expect(loadQuietLevel(storage())).toBe("all");
  });

  it("names every level in words, for the control that chooses one", () => {
    expect(QUIET_LEVELS.map((level) => QUIET_LEVEL_LABEL[level])).toEqual([
      "Off",
      "Errors and warnings only",
      "All",
    ]);
  });

  it("decides which signals are heard, level by level", () => {
    for (const level of QUIET_LEVELS) {
      for (const symbol of SIGNAL_SYMBOLS) {
        expect(audibleAt(level, symbol), `${level} / ${symbol}`).toBe(
          EXPECTED_AUDIBLE[level][symbol],
        );
      }
    }
  });

  it("keeps silence a symbol rather than something a level can unmute", () => {
    for (const level of QUIET_LEVELS) {
      expect(audibleAt(level, "silent"), level).toBe(false);
    }
  });

  it("survives a restart, because it is written to storage", () => {
    const store = storage();
    saveQuietLevel("off", store);

    expect(store.read(QUIET_LEVEL_KEY)).toBe("off");
    // A fresh read is what a restart does.
    expect(loadQuietLevel(store)).toBe("off");
  });

  it("falls back to the default rather than trusting a value it cannot read", () => {
    expect(loadQuietLevel(storage({ [QUIET_LEVEL_KEY]: "loud" }))).toBe("all");
    expect(loadQuietLevel(storage({ [QUIET_LEVEL_KEY]: "" }))).toBe("all");
    expect(isQuietLevel("loud")).toBe(false);
    for (const level of QUIET_LEVELS) expect(isQuietLevel(level), level).toBe(true);
  });
});

describe("the boolean beep preference, which came before it", () => {
  it("migrates on becomes All and off becomes Off", () => {
    expect(loadQuietLevel(storage({ [LEGACY_BEEP_KEY]: "1" }))).toBe("all");
    expect(loadQuietLevel(storage({ [LEGACY_BEEP_KEY]: "0" }))).toBe("off");
  });

  it("is read only when there is no choice in the new shape yet", () => {
    // Once the new key holds a level, that level is what is stored — the old
    // preference is history, not a competing setting.
    expect(
      loadQuietLevel(
        storage({
          [QUIET_LEVEL_KEY]: "errors-and-warnings",
          [LEGACY_BEEP_KEY]: "0",
        }),
      ),
    ).toBe("errors-and-warnings");
  });

  it("leaves the old key alone when it only reads it, so a failed migration loses nothing", () => {
    const store = storage({ [LEGACY_BEEP_KEY]: "1" });
    loadQuietLevel(store);

    expect(store.read(LEGACY_BEEP_KEY)).toBe("1");
    expect(store.read(QUIET_LEVEL_KEY)).toBeNull();
  });

  it("is not reused for the new shape: the levels are written under a new key", () => {
    const store = storage({ [LEGACY_BEEP_KEY]: "1" });
    expect(QUIET_LEVEL_KEY).not.toBe(LEGACY_BEEP_KEY);

    for (const level of QUIET_LEVELS) {
      saveQuietLevel(level, store);
      // The new shape is not squeezed into the old boolean key...
      expect(store.read(QUIET_LEVEL_KEY)).toBe(level);
      // ...and the old key is retired rather than left to be read again.
      expect(store.read(LEGACY_BEEP_KEY)).toBeNull();
      expect(loadQuietLevel(store)).toBe(level);
    }
  });

  it("ignores a legacy value that is neither of the two it wrote", () => {
    expect(loadQuietLevel(storage({ [LEGACY_BEEP_KEY]: "yes please" }))).toBe("all");
  });
});
