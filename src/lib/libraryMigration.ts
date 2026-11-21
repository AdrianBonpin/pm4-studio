/**
 * The one-time move of the old webview store's saved reads into the library file.
 *
 * The old store lived in the webview's `localStorage`; the library is a JSON file
 * in the app data directory that only the Rust store writes. The two cannot be
 * moved across by the store itself, so the webview reads the old store and hands
 * the parsed entries over, and the store maps them onto Snapshots. The mapping —
 * which field becomes which, and what happens to a stored read that cannot be
 * decoded — is `src-tauri/src/library_migration.rs`, where it is tested against a
 * real temp directory.
 *
 * Two things here are deliberate and must stay:
 *
 * - **The old store is only read.** No `removeItem`, no `setItem`, no "migrated"
 *   flag: if migration fails, or the library file is later removed, the stored
 *   reads are still there to migrate again.
 * - **The store decides whether migration runs.** It runs only while its file
 *   does not exist, so calling this on every launch neither duplicates nor
 *   overwrites anything.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";
import { loadLegacyStore } from "./storage";
import type { LibraryView } from "./library";

/** What the store did with the old store's saved reads. */
export interface MigrationReport {
  /** "migrated" | "libraryExists" | "nothingToMigrate" | "refused" */
  status: "migrated" | "libraryExists" | "nothingToMigrate" | "refused";
  /** Snapshots this run wrote. */
  migrated: number;
  /** Of those, the ones preserved without an Identity because they could not be decoded. */
  rawOnly: number;
  /** Stored reads the library already held, so they were not added twice. */
  alreadyPresent: number;
  /** Array elements that were not stored reads at all. */
  skipped: number;
  /** Snapshot fields the old store never recorded, so the copy is honest. */
  missing: string[];
  /** Old-store keys this app has no home for. */
  unmapped: string[];
  /** The library as it now stands. */
  library: LibraryView;
}

/**
 * Hand the old store's saved reads to the library, once.
 *
 * Returns `null` when there is nothing to hand over or no desktop app to hand it
 * to. Errors are left to the caller: a failed migration leaves the old store
 * untouched, so the next launch simply tries again.
 */
export async function migrateLegacyReads(): Promise<MigrationReport | null> {
  if (!isTauri()) return null;
  const entries = loadLegacyStore();
  if (entries.length === 0) return null;
  return invoke<MigrationReport>("library_migrate_legacy", {
    entries,
    // Stands in for a stored read the oldest store versions saved without a
    // timestamp, exactly as the old loader did when it read them.
    now: new Date().toISOString(),
  });
}
