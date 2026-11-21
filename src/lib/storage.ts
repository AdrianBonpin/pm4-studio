/** Saved 125 kHz reads, persisted in localStorage. */

export type SavedTag = {
  id: string; // EM4100 id, e.g. "55 00 84 82 12"
  customer: number;
  data32: number;
  /** User-editable title. Falls back to the id when empty. */
  name: string;
  savedAt: string;
};

const KEY = "pm4studio.savedTags";

type LegacyTag = Partial<SavedTag> & { note?: string };

export function loadSavedTags(): SavedTag[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is LegacyTag => !!t && typeof t.id === "string" && typeof t.data32 === "number")
      .map((t) => ({
        id: t.id as string,
        customer: typeof t.customer === "number" ? t.customer : 0,
        data32: t.data32 as number,
        // Older entries had no name; migrate them cleanly.
        name: typeof t.name === "string" ? t.name : "",
        savedAt: typeof t.savedAt === "string" ? t.savedAt : new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

/**
 * The old store exactly as it was written, for the one-time migration into the
 * library file. Unlike `loadSavedTags` this filters nothing: a stored read the
 * old loader would skip is still handed over, so migration can preserve it
 * instead of dropping it. It only ever reads; the old store is never cleared or
 * marked, so a failed migration loses nothing.
 */
export function loadLegacyStore(storage?: Pick<Storage, "getItem">): unknown[] {
  let source = storage;
  if (!source) {
    if (typeof localStorage === "undefined") return [];
    source = localStorage;
  }
  try {
    const raw = source.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Anything but the array the store writes is not a list of stored reads.
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistSavedTags(tags: SavedTag[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(tags));
  } catch {
    // Storage full or blocked; the in-memory list still works for this session.
  }
}

export function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0").toUpperCase();
}

/** Next free "Badge N" title, so a new save always has something to show. */
export function nextDefaultName(tags: SavedTag[]): string {
  const used = new Set(tags.map((t) => t.name));
  let n = tags.length + 1;
  while (used.has(`Badge ${n}`)) n += 1;
  return `Badge ${n}`;
}

/** Compact saved-at label: "just now", "3h ago", "12 Nov". */
export function formatSavedAt(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
