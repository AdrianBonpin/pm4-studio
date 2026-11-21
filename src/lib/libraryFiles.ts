/**
 * The library as a file: exporting it to one the user chooses, importing one
 * back, and the words for what either would do.
 *
 * The work itself is done by the Rust store (`src-tauri/src/library_io.rs`),
 * which counts the changes before anything is written and merges on the same
 * identity the store already uses. This module is the shape the webview sees
 * plus the pure sentences the user reads, so those are testable without a
 * desktop window.
 */

import type { LibraryView } from "./library";

/** What choosing a file in the system dialog is for. */
export type PickMode = "open" | "save";

/**
 * What an import would do, counted by the store before it writes anything.
 *
 * `conflicting` entries are already in the library: an import adds what is
 * missing and leaves the rest exactly as it is.
 */
export interface ImportPreview {
  snapshotsAdded: number;
  snapshotsConflicting: number;
  draftsAdded: number;
  draftsConflicting: number;
}

/** What an export wrote. `path` is where the user put it. */
export interface ExportResult {
  path: string;
  snapshots: number;
  drafts: number;
}

/** What an import changed, and the library as it now stands. */
export interface ImportResult {
  preview: ImportPreview;
  library: LibraryView;
}

/** The name a new export is offered with: named after the day it was written. */
export function suggestedExportName(at: Date = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `pm4-library-${year}-${month}-${day}.json`;
}

/** True when the file would change nothing. */
export function nothingToAdd(preview: ImportPreview): boolean {
  return preview.snapshotsAdded === 0 && preview.draftsAdded === 0;
}

/** "1 Snapshot", "2 Drafts". */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "a", "a and b", "a, b and c". */
function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function addedParts(preview: ImportPreview): string[] {
  const parts: string[] = [];
  if (preview.snapshotsAdded > 0) {
    parts.push(count(preview.snapshotsAdded, "Snapshot", "Snapshots"));
  }
  if (preview.draftsAdded > 0) parts.push(count(preview.draftsAdded, "Draft", "Drafts"));
  return parts;
}

function leftAloneParts(preview: ImportPreview): string[] {
  const parts: string[] = [];
  if (preview.snapshotsConflicting > 0) {
    parts.push(count(preview.snapshotsConflicting, "Snapshot", "Snapshots"));
  }
  if (preview.draftsConflicting > 0) {
    parts.push(count(preview.draftsConflicting, "Draft", "Drafts"));
  }
  return parts;
}

/**
 * What importing the chosen file would do, before it is applied.
 *
 * Both collections are counted by name: a Draft is not a Snapshot, and the user
 * is told which of each they are about to add.
 */
export function describeImportPreview(preview: ImportPreview): string {
  const added = addedParts(preview);
  const addedSentence =
    added.length === 0 ? "Nothing in this file is new." : `${joinWords(added)} will be added.`;

  const leftAlone = leftAloneParts(preview);
  if (leftAlone.length === 0) {
    return `${addedSentence} Nothing clashes with what is already in the library.`;
  }
  const verb = preview.snapshotsConflicting + preview.draftsConflicting === 1 ? "is" : "are";
  return `${addedSentence} ${joinWords(leftAlone)} ${verb} already in the library and will be left alone.`;
}

/** What importing the file actually did, once it has been applied. */
export function describeImportApplied(preview: ImportPreview): string {
  const added = addedParts(preview);
  const sentences = [
    added.length === 0 ? "Nothing was added." : `Added ${joinWords(added)}.`,
  ];

  const leftAlone = leftAloneParts(preview);
  if (leftAlone.length > 0) {
    const verb = preview.snapshotsConflicting + preview.draftsConflicting === 1 ? "was" : "were";
    sentences.push(`${joinWords(leftAlone)} ${verb} already in the library and left alone.`);
  }
  return sentences.join(" ");
}

/** How much an export wrote. The path is shown separately, in full. */
export function describeExport(result: { snapshots: number; drafts: number }): string {
  if (result.snapshots === 0 && result.drafts === 0) {
    return "Exported an empty library: there were no Snapshots to write.";
  }
  const parts: string[] = [];
  if (result.snapshots > 0) parts.push(count(result.snapshots, "Snapshot", "Snapshots"));
  if (result.drafts > 0) parts.push(count(result.drafts, "Draft", "Drafts"));
  return `Exported ${joinWords(parts)}.`;
}
