import { describe, expect, it } from "vitest";
import {
  describeExport,
  describeImportApplied,
  describeImportPreview,
  nothingToAdd,
  suggestedExportName,
} from "./libraryFiles";
import type { ImportPreview } from "./libraryFiles";

// The counts come from the Rust store (src-tauri/src/library_io.rs); these
// helpers only turn them into the sentence the user reads, so every expectation
// here is a literal sentence, not something the code produced.

const NOTHING: ImportPreview = {
  snapshotsAdded: 0,
  snapshotsConflicting: 0,
  draftsAdded: 0,
  draftsConflicting: 0,
};

describe("suggestedExportName", () => {
  it("names the file after the day it was written", () => {
    expect(suggestedExportName(new Date(2026, 10, 21))).toBe("pm4-library-2026-11-21.json");
  });

  it("pads a single digit month and day", () => {
    expect(suggestedExportName(new Date(2026, 0, 5))).toBe("pm4-library-2026-01-05.json");
  });
});

describe("describeImportPreview", () => {
  it("says how many Snapshots will be added", () => {
    expect(describeImportPreview({ ...NOTHING, snapshotsAdded: 2 })).toBe(
      "2 Snapshots will be added. Nothing clashes with what is already in the library.",
    );
  });

  it("says how many Drafts will be added, counted separately from Snapshots", () => {
    expect(describeImportPreview({ ...NOTHING, snapshotsAdded: 1, draftsAdded: 1 })).toBe(
      "1 Snapshot and 1 Draft will be added. Nothing clashes with what is already in the library.",
    );
  });

  it("says what is already here and will be left alone", () => {
    expect(
      describeImportPreview({
        snapshotsAdded: 2,
        snapshotsConflicting: 1,
        draftsAdded: 0,
        draftsConflicting: 3,
      }),
    ).toBe(
      "2 Snapshots will be added. 1 Snapshot and 3 Drafts are already in the library and will be left alone.",
    );
  });

  it("speaks of one left-alone entry in the singular", () => {
    expect(describeImportPreview({ ...NOTHING, snapshotsConflicting: 1 })).toBe(
      "Nothing in this file is new. 1 Snapshot is already in the library and will be left alone.",
    );
  });

  it("says when the file has nothing new in it", () => {
    expect(describeImportPreview({ ...NOTHING, snapshotsConflicting: 4 })).toBe(
      "Nothing in this file is new. 4 Snapshots are already in the library and will be left alone.",
    );
  });

  it("knows when a file would add nothing at all", () => {
    expect(nothingToAdd({ ...NOTHING, snapshotsConflicting: 1 })).toBe(true);
    expect(nothingToAdd({ ...NOTHING, draftsAdded: 1 })).toBe(false);
  });
});

describe("describeImportApplied", () => {
  it("says what was added, in the past tense", () => {
    expect(describeImportApplied({ ...NOTHING, snapshotsAdded: 2, draftsAdded: 1 })).toBe(
      "Added 2 Snapshots and 1 Draft.",
    );
  });

  it("says what was left alone", () => {
    expect(
      describeImportApplied({
        snapshotsAdded: 1,
        snapshotsConflicting: 1,
        draftsAdded: 0,
        draftsConflicting: 2,
      }),
    ).toBe(
      "Added 1 Snapshot. 1 Snapshot and 2 Drafts were already in the library and left alone.",
    );
  });

  it("says so when nothing was added", () => {
    expect(describeImportApplied({ ...NOTHING, snapshotsConflicting: 2 })).toBe(
      "Nothing was added. 2 Snapshots were already in the library and left alone.",
    );
  });

  it("says only that for an empty file", () => {
    expect(describeImportApplied(NOTHING)).toBe("Nothing was added.");
  });
});

describe("describeExport", () => {
  it("says how much was written", () => {
    expect(describeExport({ snapshots: 3, drafts: 1 })).toBe("Exported 3 Snapshots and 1 Draft.");
  });

  it("says so when the library was empty", () => {
    expect(describeExport({ snapshots: 0, drafts: 0 })).toBe(
      "Exported an empty library: there were no Snapshots to write.",
    );
  });
});
