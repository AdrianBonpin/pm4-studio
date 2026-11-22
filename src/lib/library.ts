/**
 * A Snapshot is one immutable read of one Tag, stored by the Rust library store
 * in a versioned JSON file in the app data directory (see
 * `src-tauri/src/library.rs`). This module is the shape the webview sees, plus
 * the pure formatting the library page needs; the persistence itself is tested
 * in Rust against a real temp directory.
 */

import type { DraftRecord } from "./drafts";

export type SnapshotKind = "LF" | "HF";

/** What a 125 kHz Tag was when it was read. */
export interface SnapshotIdentity {
  customer: number;
  data32: number;
  facility: number;
  card: number;
  /** The payload as the Reader reported it. */
  raw: string;
}

/** What a 13.56 MHz Tag was when it was read. */
export interface SnapshotHf {
  uid: string;
  /** The poll reply as the Reader reported it, kept for an honest raw display. */
  raw: string;
  /**
   * The poll's ATQA, hex, in transmission order. Absent when the Snapshot was
   * written before schema 3, or by a shape that never carried it — the readout
   * then says it was not recorded rather than showing a plausible pair.
   */
  atqa?: string | null;
  /** The SAK of the last cascade level, hex. Absent when never recorded. */
  sak?: string | null;
  /** The family the ATQA/SAK pair resolved to, e.g. `NTAG215`. */
  cardType?: string | null;
  /** Capacity in bytes, from the published table or the Tag's own container. */
  capacityBytes?: number | null;
  /** Whether the Tag is NDEF formatted, as the memory read settled it. */
  ndefFormatted?: boolean | null;
  /**
   * The message's Records, in the order the Tag holds them.
   *
   * `null` or absent means the message was **not read** — never that the Tag
   * holds none. A Tag that was read and held nothing keeps `[]`, so "no
   * Records" and "not fetched" are different values and are shown differently.
   */
  records?: DraftRecord[] | null;
}

export interface Snapshot {
  /** Stable across restarts: the Identity id, the UID, or a generated id. */
  id: string;
  name: string;
  note: string;
  kind: SnapshotKind;
  capturedAt: string;
  /** Confirmed copies, not attempts. */
  writeCount: number;
  identity?: SnapshotIdentity;
  hf?: SnapshotHf;
}

export type LibraryProblemKind =
  | "corrupt"
  | "newerVersion"
  | "olderVersion"
  | "unreadable";

/**
 * Set when the file must not be written to: it could not be parsed, was written
 * by a differing schema version, or could not be read at all. The app reports it
 * and leaves the file exactly as it is, because replacing it would destroy the
 * user's only copy.
 */
export interface LibraryProblem {
  kind: LibraryProblemKind;
  message: string;
  detail?: string | null;
}

export interface LibraryView {
  /** Absolute path of the library file, shown so the user can back it up. */
  path: string;
  /** The schema version this build writes. */
  version: number;
  snapshots: Snapshot[];
  problem: LibraryProblem | null;
  /**
   * Set when a file written by an older schema was lifted to this build's
   * schema but the lift could not be written back. The library in memory is the
   * lifted one and saving is allowed — a save is what corrects the file — so
   * this is a warning, not a lock. Null when there is nothing to say.
   */
  migrationWarning: string | null;
}

/** What a save did. "duplicate" means the read was already in the library. */
export type SaveOutcome = "added" | "duplicate" | "refused";

export interface SaveResult {
  outcome: SaveOutcome;
  library: LibraryView;
  snapshot: Snapshot | null;
}

/** Shown wherever the library is listed: the file is not private by accident. */
export const LIBRARY_PLAINTEXT_NOTICE =
  "The library is local plaintext JSON on this machine. It is never synced, uploaded, or sent anywhere.";

export const EMPTY_LIBRARY_TITLE = "No Snapshots yet";

export const EMPTY_LIBRARY_DETAIL =
  "A Snapshot is the record of one read of one Tag: what it was, what it held, and when you read it. Read a Tag and choose Save to library. Snapshots stay here after you quit, and are browsable with no Reader attached.";

export function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0").toUpperCase();
}

/** The name the user chose, or the Identity/UID when they have not named it. */
export function snapshotTitle(snapshot: Snapshot): string {
  const name = snapshot.name.trim();
  return name.length > 0 ? name : snapshot.id;
}

const BAND_LABEL: Record<SnapshotKind, string> = {
  LF: "125 kHz",
  HF: "13.56 MHz",
};

/** One line of supporting fact: what the Snapshot holds, and when it was read. */
export function snapshotDetail(snapshot: Snapshot, now: number = Date.now()): string {
  const when = formatCapturedAt(snapshot.capturedAt, now);
  const parts: string[] = [];
  if (snapshot.identity) {
    parts.push(`facility ${snapshot.identity.facility}`, `card ${snapshot.identity.card}`);
  } else {
    parts.push(BAND_LABEL[snapshot.kind]);
    if (snapshot.hf?.cardType) parts.push(snapshot.hf.cardType);
    if (!snapshot.hf) parts.push("raw only");
  }
  if (when) parts.push(when);
  return parts.join(" · ");
}

/**
 * Compact captured-at label: "just now", "3h ago", "12 Nov". A Snapshot is a
 * record of when a Tag was read, so the time is never rounded away entirely.
 */
export function formatCapturedAt(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/* ------------------------------------------------------------------------- *
 * Finding a Snapshot once the library is too long to scroll.
 *
 * Filtering and sorting are pure and take the array the view already holds:
 * one pass per keystroke over entries that are reused, never rebuilt. The
 * library file is only read again when it changes on disk, so typing in the
 * search field costs nothing but comparisons.
 *
 * The comparison is only here once. `searchMatches` is the app's one Search
 * rule, and a module whose items hold different facts — the Drafts filter, which
 * searches a Draft by its name, its id and the values authored inside its
 * Records — owns only its fact text and calls this.
 * ------------------------------------------------------------------------- */

const WHITESPACE = /\s+/g;

/**
 * Whether one item's fact text answers the query.
 *
 * A case-insensitive substring, and again with the whitespace compacted out of
 * both sides, so bytes written without their spaces still match. The caller owns
 * the facts; this owns the comparison, and there is no second copy of it.
 */
export function searchMatches(factText: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const text = factText.toLowerCase();
  if (text.includes(needle)) return true;
  const compact = needle.replace(WHITESPACE, "");
  return compact.length > 0 && text.replace(WHITESPACE, "").includes(compact);
}

/** Everything about a Snapshot the user may be typing at, in one string. */
function searchableText(snapshot: Snapshot): string {
  const parts: string[] = [snapshot.name, snapshot.note, snapshot.id];
  if (snapshot.identity) {
    const { customer, data32, facility, card, raw } = snapshot.identity;
    parts.push(
      `facility ${facility}`,
      `card ${card}`,
      String(facility),
      String(card),
      hex(customer, 2),
      hex(data32, 8),
      raw,
    );
  }
  if (snapshot.hf) parts.push(snapshot.hf.uid, snapshot.hf.raw);
  return parts.join(" ");
}

/**
 * Whether a Snapshot answers the query: its name, its Identity (id, facility,
 * card, customer and data bytes) or its UID. Bytes may be typed with or without
 * the spaces between them.
 */
export function snapshotMatches(snapshot: Snapshot, query: string): boolean {
  return searchMatches(searchableText(snapshot), query);
}

/** The Snapshots that answer the query, in the order they were given. */
export function filterSnapshots(snapshots: readonly Snapshot[], query: string): Snapshot[] {
  // Nothing typed: hand back the very array the view holds, so an empty search
  // costs nothing at all.
  if (query.trim().length === 0) return snapshots as Snapshot[];
  return snapshots.filter((snapshot) => snapshotMatches(snapshot, query));
}

/** Name, or the order the Tags were read in. */
export type SnapshotOrder = "name" | "captured";

function capturedTime(snapshot: Snapshot): number {
  const time = new Date(snapshot.capturedAt).getTime();
  // A time this build cannot read sorts behind every time it can, rather than
  // silently jumping to 1970 and claiming to be the oldest read.
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * A sorted copy: by name (numbers inside a name in numeric order) or by when
 * the Tag was read, most recent first. The array handed in is left alone, so
 * the library in the view keeps the order the file was written in.
 */
export function sortSnapshots(
  snapshots: readonly Snapshot[],
  order: SnapshotOrder,
): Snapshot[] {
  const sorted = [...snapshots];
  if (order === "name") {
    sorted.sort(
      (a, b) =>
        NAME_ORDER.compare(snapshotTitle(a), snapshotTitle(b)) || NAME_ORDER.compare(a.id, b.id),
    );
  } else {
    sorted.sort((a, b) => capturedTime(b) - capturedTime(a) || NAME_ORDER.compare(a.id, b.id));
  }
  return sorted;
}

/**
 * The two fields of a Snapshot the user may change. A Draft here is a copy held
 * in the page while the user types: nothing is written until they confirm, so
 * cancelling an edit cannot leave a half-written Snapshot behind.
 */
export interface SnapshotDraft {
  name: string;
  note: string;
}

/** Start editing from what is stored. */
export function draftOf(snapshot: Snapshot): SnapshotDraft {
  return { name: snapshot.name, note: snapshot.note };
}

/** Whether confirming this draft would actually change the stored Snapshot. */
export function draftIsDirty(snapshot: Snapshot, draft: SnapshotDraft): boolean {
  return (
    draft.name.trim() !== snapshot.name.trim() || draft.note.trim() !== snapshot.note.trim()
  );
}
