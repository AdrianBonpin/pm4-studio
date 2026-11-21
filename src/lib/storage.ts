/** Saved 125 kHz reads, persisted in localStorage. */

export type SavedTag = {
  id: string; // EM4100 id, e.g. "55 00 84 82 12"
  customer: number;
  data32: number;
  note: string;
  savedAt: string;
};

const KEY = "pm4studio.savedTags";

export function loadSavedTags(): SavedTag[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is SavedTag =>
        t && typeof t.id === "string" && typeof t.data32 === "number",
    );
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
