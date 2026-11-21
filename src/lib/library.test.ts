import { describe, expect, it } from "vitest";
import { formatCapturedAt, hex, snapshotDetail, snapshotTitle } from "./library";
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
