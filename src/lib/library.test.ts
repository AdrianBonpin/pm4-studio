import { describe, expect, it } from "vitest";
import {
  draftIsDirty,
  draftOf,
  filterSnapshots,
  formatCapturedAt,
  hex,
  snapshotDetail,
  snapshotTitle,
  sortSnapshots,
} from "./library";
import type { Snapshot } from "./library";

// The library file is written by src-tauri/src/library.rs, so these helpers are
// only about turning a Snapshot into something readable. Expectations here are
// literals from a real saved read, not values the code produced.

const LF_SNAPSHOT: Snapshot = {
  id: "55 00 84 82 12",
  name: "Front door",
  note: "",
  kind: "LF",
  capturedAt: "2026-11-21T09:30:00.000Z",
  writeCount: 0,
  identity: {
    customer: 0x55,
    data32: 0x0084_8212,
    facility: 132,
    card: 33298,
    raw: "00 01 01 00",
  },
};

describe("hex", () => {
  it("pads to the requested width, upper case", () => {
    expect(hex(0x0084_8212, 8)).toBe("00848212");
    expect(hex(0x55, 2)).toBe("55");
    expect(hex(0, 2)).toBe("00");
  });
});

describe("snapshotTitle", () => {
  it("uses the name", () => {
    expect(snapshotTitle(LF_SNAPSHOT)).toBe("Front door");
  });

  it("falls back to the Identity when the name is empty", () => {
    expect(snapshotTitle({ ...LF_SNAPSHOT, name: "" })).toBe("55 00 84 82 12");
  });

  it("falls back to the UID for a 13.56 MHz Snapshot", () => {
    const hf: Snapshot = {
      id: "04 A2 2B 3A 5C 6D 80",
      name: "",
      note: "",
      kind: "HF",
      capturedAt: "2026-11-21T09:30:00.000Z",
      writeCount: 0,
      hf: { uid: "04 A2 2B 3A 5C 6D 80", raw: "00 01 02" },
    };
    expect(snapshotTitle(hf)).toBe("04 A2 2B 3A 5C 6D 80");
  });
});

describe("snapshotDetail", () => {
  it("states facility and card for a 125 kHz Snapshot", () => {
    expect(snapshotDetail(LF_SNAPSHOT, Date.parse("2026-11-21T09:30:30.000Z"))).toBe(
      "facility 132 · card 33298 · just now",
    );
  });

  it("states the band for a Snapshot with no identity to decode", () => {
    const rawOnly: Snapshot = {
      id: "raw-1",
      name: "Unreadable read",
      note: "",
      kind: "LF",
      capturedAt: "2026-11-21T09:30:00.000Z",
      writeCount: 0,
    };
    expect(snapshotDetail(rawOnly, Date.parse("2026-11-21T09:30:00.000Z"))).toBe(
      "125 kHz · raw only · just now",
    );
  });
});

describe("formatCapturedAt", () => {
  const then = Date.parse("2026-11-21T09:30:00.000Z");

  it("is compact for the recent past", () => {
    expect(formatCapturedAt("2026-11-21T09:30:00.000Z", then)).toBe("just now");
    expect(formatCapturedAt("2026-11-21T09:29:00.000Z", then)).toBe("1m ago");
    expect(formatCapturedAt("2026-11-21T06:30:00.000Z", then)).toBe("3h ago");
    expect(formatCapturedAt("2026-11-19T09:30:00.000Z", then)).toBe("2d ago");
  });

  it("falls back to a date once the read is a week old", () => {
    const older = formatCapturedAt("2026-11-01T09:30:00.000Z", then);
    expect(older).toContain("Nov");
    expect(older).not.toContain("ago");
  });

  it("says nothing rather than NaN for a timestamp it cannot read", () => {
    expect(formatCapturedAt("not a date", then)).toBe("");
  });
});

// Ticket 04: finding a Snapshot in a library that has outgrown scrolling.

const HF_SNAPSHOT: Snapshot = {
  id: "04 A2 2B 3A 5C 6D 80",
  name: "Office door",
  note: "",
  kind: "HF",
  capturedAt: "2026-11-20T08:00:00.000Z",
  writeCount: 0,
  hf: { uid: "04 A2 2B 3A 5C 6D 80", raw: "00 01 02" },
};

function snapshot(index: number): Snapshot {
  return {
    id: `55 00 ${hex(index, 2)} 00 00`,
    name: `Snapshot ${index}`,
    note: "",
    kind: "LF",
    capturedAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
    writeCount: 0,
    identity: {
      customer: 0x55,
      data32: index,
      facility: index >> 8,
      card: index & 0xffff,
      raw: "00 01 01 00",
    },
  };
}

describe("filterSnapshots", () => {
  const library = [LF_SNAPSHOT, HF_SNAPSHOT];

  it("keeps everything when nothing has been typed", () => {
    expect(filterSnapshots(library, "")).toEqual(library);
    expect(filterSnapshots(library, "   ")).toEqual(library);
  });

  it("matches a name, whatever the case", () => {
    expect(filterSnapshots(library, "front")).toEqual([LF_SNAPSHOT]);
    expect(filterSnapshots(library, "OFFICE")).toEqual([HF_SNAPSHOT]);
  });

  it("matches a 125 kHz Identity by its id, facility and card", () => {
    expect(filterSnapshots(library, "55 00 84 82 12")).toEqual([LF_SNAPSHOT]);
    expect(filterSnapshots(library, "84 82")).toEqual([LF_SNAPSHOT]);
    expect(filterSnapshots(library, "facility 132")).toEqual([LF_SNAPSHOT]);
    expect(filterSnapshots(library, "33298")).toEqual([LF_SNAPSHOT]);
    expect(filterSnapshots(library, "00848212")).toEqual([LF_SNAPSHOT]);
  });

  it("matches an Identity written without the bytes separated", () => {
    expect(filterSnapshots(library, "5500848212")).toEqual([LF_SNAPSHOT]);
  });

  it("matches a 13.56 MHz UID", () => {
    expect(filterSnapshots(library, "04 a2 2b")).toEqual([HF_SNAPSHOT]);
    expect(filterSnapshots(library, "5c6d80")).toEqual([HF_SNAPSHOT]);
  });

  it("matches a note the user wrote", () => {
    const noted = { ...LF_SNAPSHOT, note: "spare for gate 3" };
    expect(filterSnapshots([noted], "gate 3")).toEqual([noted]);
  });

  it("is empty when nothing matches", () => {
    expect(filterSnapshots(library, "zzzz")).toEqual([]);
  });

  it("hands back the very same Snapshots rather than rebuilt copies", () => {
    // The library is not reloaded or reconstructed to filter it: one pass over
    // the array already in the view, reusing its entries.
    const filtered = filterSnapshots(library, "front");
    expect(filtered[0]).toBe(LF_SNAPSHOT);
    expect(filterSnapshots(library, "")[1]).toBe(HF_SNAPSHOT);
  });

  it("does not touch the library it was given", () => {
    const original = [...library];
    filterSnapshots(library, "front");
    expect(library).toEqual(original);
    expect(library.length).toBe(2);
  });

  it("stays interactive over a library of 500 Snapshots", () => {
    const many = Array.from({ length: 500 }, (_, i) => snapshot(i + 1));
    const started = performance.now();
    let matches = 0;
    // Every keystroke of a typed query, 100 of them.
    for (let i = 0; i < 100; i += 1) matches += filterSnapshots(many, "snapshot 4").length;
    const elapsed = performance.now() - started;

    expect(matches).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("sortSnapshots", () => {
  const outOfOrder = [
    { ...HF_SNAPSHOT, name: "beta", capturedAt: "2026-11-20T08:00:00.000Z" },
    { ...LF_SNAPSHOT, name: "Alpha", capturedAt: "2026-11-21T09:30:00.000Z" },
    { ...LF_SNAPSHOT, id: "55 00 00 00 01", name: "gamma", capturedAt: "2026-11-19T08:00:00.000Z" },
  ];

  it("orders by name, ignoring case", () => {
    expect(sortSnapshots(outOfOrder, "name").map((s) => s.name)).toEqual([
      "Alpha",
      "beta",
      "gamma",
    ]);
  });

  it("puts numbers in a name in numeric order", () => {
    const numbered = [snapshot(10), snapshot(9), snapshot(2)];
    expect(sortSnapshots(numbered, "name").map((s) => s.name)).toEqual([
      "Snapshot 2",
      "Snapshot 9",
      "Snapshot 10",
    ]);
  });

  it("orders by captured time, most recently read first", () => {
    expect(sortSnapshots(outOfOrder, "captured").map((s) => s.name)).toEqual([
      "Alpha",
      "beta",
      "gamma",
    ]);
    expect(sortSnapshots(outOfOrder, "captured")[0].capturedAt).toBe(
      "2026-11-21T09:30:00.000Z",
    );
  });

  it("returns a new array and leaves the library in the order it arrived", () => {
    const before = outOfOrder.map((s) => s.name);
    const sorted = sortSnapshots(outOfOrder, "name");
    expect(sorted).not.toBe(outOfOrder);
    expect(outOfOrder.map((s) => s.name)).toEqual(before);
  });

  it("keeps a Snapshot with an unreadable time behind the readable ones", () => {
    const broken = { ...LF_SNAPSHOT, name: "broken", capturedAt: "not a date" };
    const sorted = sortSnapshots([broken, ...outOfOrder], "captured");
    expect(sorted[sorted.length - 1].name).toBe("broken");
  });
});

describe("editing a Snapshot's name and note", () => {
  it("starts from the stored values", () => {
    expect(draftOf({ ...LF_SNAPSHOT, note: "gate 3" })).toEqual({
      name: "Front door",
      note: "gate 3",
    });
  });

  it("is a copy, so typing cannot change the Snapshot it came from", () => {
    const stored = { ...LF_SNAPSHOT, note: "gate 3" };
    const draft = draftOf(stored);
    draft.name = "Back door";
    draft.note = "something else";
    expect(stored.name).toBe("Front door");
    expect(stored.note).toBe("gate 3");
  });

  it("has nothing to save when the edit was cancelled or unchanged", () => {
    const stored = { ...LF_SNAPSHOT, note: "gate 3" };
    expect(draftIsDirty(stored, draftOf(stored))).toBe(false);
    // Trailing whitespace is not an edit worth a write.
    expect(draftIsDirty(stored, { name: " Front door ", note: "gate 3 " })).toBe(false);
  });

  it("has something to save when the name or the note changed", () => {
    const stored = { ...LF_SNAPSHOT, note: "gate 3" };
    expect(draftIsDirty(stored, { name: "Back door", note: "gate 3" })).toBe(true);
    expect(draftIsDirty(stored, { name: "Front door", note: "gate 4" })).toBe(true);
    expect(draftIsDirty(stored, { name: "Front door", note: "" })).toBe(true);
  });
});
