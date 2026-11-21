/**
 * The quiet level: how much of the alphabet this user wants to hear.
 *
 * Three settings, not a switch, because "silent except failures" is a real
 * daily setting and a two-way toggle forces a choice between hearing everything
 * and hearing nothing:
 *
 * | Level | Heard |
 * |---|---|
 * | `off` | nothing — every report is on screen only |
 * | `errors-and-warnings` | two chirps and three; completed operations are silent |
 * | `all` | every symbol the outcome seam produces |
 *
 * It is stored in this machine's own storage beside the toast corner, because it
 * is the user's preference and not the Reader's state: it is changeable with the
 * Reader unplugged, and a missing Reader must never take the control away.
 *
 * **The migration.** Before this existed, the preference was a boolean under
 * `pm4studio.beep` (`"1"` on, `"0"` off). That value is carried across — on
 * becomes `all`, off becomes `off` — and it is *read*, never reinterpreted: the
 * old key stays a boolean and is never written with a level, so an older build
 * and this one can never disagree about what `"1"` means. Saving a level writes
 * the new key and retires the old one.
 *
 * Nothing here talks to a Reader, and nothing here decides a symbol: a symbol
 * comes from an outcome's severity, and this module only answers whether that
 * symbol is played.
 */

import { SIGNAL_SYMBOLS, type SignalSymbol } from "./signal";

/**
 * The three levels, quietest first. Off is first so the control reads as a scale
 * from silence to everything.
 */
export const QUIET_LEVELS = ["off", "errors-and-warnings", "all"] as const;

export type QuietLevel = (typeof QUIET_LEVELS)[number];

/**
 * The words for each level, for the control that chooses one.
 *
 * These are the spec's own names: a level called `errors-and-warnings` is a
 * storage value, and it is not what the user is shown.
 */
export const QUIET_LEVEL_LABEL: Record<QuietLevel, string> = {
  off: "Off",
  "errors-and-warnings": "Errors and warnings only",
  all: "All",
};

/**
 * What each level sounds like in the alphabet's own terms, one line. Shown under
 * the control so a level is chosen by what it will do rather than by its name.
 */
export const QUIET_LEVEL_NOTE: Record<QuietLevel, string> = {
  off: "Nothing is sounded. Every report is on screen only.",
  "errors-and-warnings": "Two chirps when a result needs checking, three when something fails. Completed operations are silent.",
  all: `Every report sounds: one chirp for done, two for needs you, three for attention.`,
};

/** The default, which is what an install with no preference hears. */
export const DEFAULT_QUIET_LEVEL: QuietLevel = "all";

/** Where the level is stored. A new key, because the shape is new. */
export const QUIET_LEVEL_KEY = "pm4studio.quietLevel";

/**
 * Where the boolean beep preference was stored before this existed.
 *
 * Read once per launch and then retired on the next save. It is never written
 * with a level: a boolean key that later holds `"all"` is a key two builds read
 * differently, which is exactly the ambiguity the migration avoids.
 */
export const LEGACY_BEEP_KEY = "pm4studio.beep";

/** The slice of `Storage` this module needs, so a test can hand in its own. */
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function storageOrDefault(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

/** Whether a stored value is one of the three levels. */
export function isQuietLevel(value: unknown): value is QuietLevel {
  return typeof value === "string" && (QUIET_LEVELS as readonly string[]).includes(value);
}

/** The level a pre-quiet-level boolean preference stands for. */
function fromLegacy(beep: string | null): QuietLevel | null {
  if (beep === "1") return "all";
  if (beep === "0") return "off";
  return null;
}

/**
 * The stored level, or the level the old preference stands for, or the default.
 *
 * The order matters: a level already chosen in the new shape wins, the old
 * boolean is consulted only when there is no new choice, and anything unreadable
 * is treated as no choice at all rather than coerced into a level nobody asked
 * for. Reading does not write, so a migration that fails loses nothing — the old
 * value is still there for the next launch.
 */
export function loadQuietLevel(storage?: Storage | null): QuietLevel {
  const source = storageOrDefault(storage);
  if (!source) return DEFAULT_QUIET_LEVEL;
  try {
    const stored = source.getItem(QUIET_LEVEL_KEY);
    if (isQuietLevel(stored)) return stored;
    const legacy = fromLegacy(source.getItem(LEGACY_BEEP_KEY));
    return legacy ?? DEFAULT_QUIET_LEVEL;
  } catch {
    return DEFAULT_QUIET_LEVEL;
  }
}

/**
 * Remember the level, and retire the boolean it replaced.
 *
 * A storage that refuses is not worth failing over: the preference is lost, not
 * the app. Removing the old key is best-effort for the same reason.
 */
export function saveQuietLevel(level: QuietLevel, storage?: Storage | null): void {
  const target = storageOrDefault(storage);
  if (!target) return;
  try {
    target.setItem(QUIET_LEVEL_KEY, level);
  } catch {
    // A full or disabled storage loses the preference, not the sound it governs.
    return;
  }
  try {
    target.removeItem(LEGACY_BEEP_KEY);
  } catch {
    // The old key lingering changes nothing: the new key is read first.
  }
}

/**
 * Whether one symbol is played at one level.
 *
 * Silence is never audible — it is the absence of a signal rather than a signal
 * a louder level could permit — and "errors and warnings only" admits exactly
 * the two symbols those severities produce.
 */
export function audibleAt(level: QuietLevel, symbol: SignalSymbol): boolean {
  if (level === "off") return false;
  if (symbol === "silent") return false;
  if (level === "errors-and-warnings") return symbol !== "done";
  return SIGNAL_SYMBOLS.includes(symbol);
}
