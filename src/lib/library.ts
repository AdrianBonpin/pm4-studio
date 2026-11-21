/**
 * A Snapshot is one immutable read of one Tag, stored by the Rust library store
 * in a versioned JSON file in the app data directory (see
 * `src-tauri/src/library.rs`). This module is the shape the webview sees, plus
 * the pure formatting the library page needs; the persistence itself is tested
 * in Rust against a real temp directory.
 */

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
  raw: string;
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
