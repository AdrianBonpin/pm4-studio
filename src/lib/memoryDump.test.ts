import { describe, expect, it } from "vitest";
import {
  describeDump,
  exportedDumpNote,
  formatOffset,
  pageRange,
  type MemoryDump,
} from "./memoryDump";

/** The shape the Rust side sends for the recorded NTAG215 read: 256 pages in
 *  64 rows, 135 of them read-ok. */
function recordedDump(): MemoryDump {
  return {
    status: 0,
    tag: {
      uid: "04 43 8A 01 22 09 03",
      tagType: 5,
      tagLabel: "NTAG215",
      capturedAt: "2026-11-21T09:30:00.000Z",
    },
    pageCount: 256,
    readablePages: 135,
    rows: [],
  };
}

describe("pageRange", () => {
  it("names the first and last page of a row, zero padded", () => {
    expect(pageRange({ firstPage: 0, lastPage: 3 })).toBe("000–003");
    expect(pageRange({ firstPage: 128, lastPage: 131 })).toBe("128–131");
    expect(pageRange({ firstPage: 252, lastPage: 255 })).toBe("252–255");
  });
});

describe("formatOffset", () => {
  it("shows the byte offset in four hex digits", () => {
    expect(formatOffset(0)).toBe("0x0000");
    expect(formatOffset(16)).toBe("0x0010");
    expect(formatOffset(0x200)).toBe("0x0200");
    expect(formatOffset(0x3fc)).toBe("0x03FC");
  });
});

describe("describeDump", () => {
  it("counts the pages that answered instead of claiming the whole tag", () => {
    expect(describeDump(recordedDump())).toBe("135 of 256 pages readable");
  });

  it("says so when no page answered", () => {
    expect(describeDump({ pageCount: 256, readablePages: 0 })).toBe(
      "0 of 256 pages readable",
    );
  });
});

describe("exportedDumpNote", () => {
  it("shows the whole path an export was written to", () => {
    expect(exportedDumpNote("/Users/a/Downloads/pm4-dump-0443.txt")).toBe(
      "Saved to /Users/a/Downloads/pm4-dump-0443.txt",
    );
  });
});
