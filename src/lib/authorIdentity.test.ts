import { describe, expect, it } from "vitest";
import {
  AUTHOR_FACTS,
  BLANK_ON_READER_HINT,
  PAYLOAD_FACT_LABEL,
  EMPTY_ENTRY,
  PART_FIELDS,
  RAW_DIGITS,
  RAW_HEX_EXAMPLE,
  RAW_SHAPE_HINT,
  authorConfirmation,
  authorWriteNotice,
  canPreview,
  entryHint,
  hexEntryShape,
  normalizeHexInput,
  previewFacts,
  snapshotDuplicateNote,
  snapshotFailedNote,
  snapshotKeptNote,
} from "./authorIdentity";
import type { IdentityPreview, WriteResult } from "../types";

// The authoring form is the only way an Identity enters the app that a Tag did
// not put there, so its copy and its completeness rules are asserted rather than
// trusted. Every Identity below is one this app has really written or read:
// `55 00 84 82 12` is the tag written by the confirmed `0x0073` capture, and
// `56 00 53 C7 B3` is the stored `0x0072` read capture.

const WRITTEN: IdentityPreview = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  hex: "5500848212",
  facility: 132,
  card: 33298,
  payloadHex: "00 01 01 00 00 00 00 00 55 00 00 00 55 00 00 00 12 82 84 00 00 00 00 00",
};

function writeResult(outcome: WriteResult["outcome"]): WriteResult {
  return {
    customer: WRITTEN.customer,
    data32: WRITTEN.data32,
    readback: outcome === "verified" ? { ...WRITTEN, raw: "" } : null,
    outcome,
    verified: outcome === "verified",
    message: null,
    refusalCause: null,
    confirmedCopies: 0,
    countProblem: null,
  };
}

describe("the ranges the form shows", () => {
  it("names a customer and facility byte and a two-byte card", () => {
    expect(PART_FIELDS.map((f) => f.id)).toEqual(["customer", "facility", "card"]);
    const customer = PART_FIELDS.find((f) => f.id === "customer");
    const facility = PART_FIELDS.find((f) => f.id === "facility");
    const card = PART_FIELDS.find((f) => f.id === "card");
    expect(customer?.range).toContain("0–255");
    expect(customer?.range).toContain("0x00–0xFF");
    expect(facility?.range).toBe(customer?.range);
    // The card field is two bytes, so its maximum is stated as one.
    expect(card?.range).toContain("0–65535");
    expect(card?.range).toContain("0x0000–0xFFFF");
  });

  it("states the 24-bit limit a raw entry runs into, and the fix", () => {
    expect(RAW_SHAPE_HINT).toMatch(/five bytes/i);
    expect(RAW_SHAPE_HINT).toContain(`10 hex digits`);
    expect(RAW_SHAPE_HINT).toMatch(/second byte must be 00/);
    expect(RAW_SHAPE_HINT).toMatch(/24 bits/);
    expect(RAW_DIGITS).toBe(10);
  });

  it("shows an example shaped like an Identity this app writes", () => {
    expect(normalizeHexInput(RAW_HEX_EXAMPLE)).toBe("5500848212");
    expect(hexEntryShape(RAW_HEX_EXAMPLE).complete).toBe(true);
  });
});

describe("normalizeHexInput", () => {
  it("reduces every way of writing five bytes to the same digits", () => {
    for (const text of [
      "55 00 84 82 12",
      "  55  00  84  82  12  ",
      "5500848212",
      "0x5500848212",
      "0X5500848212",
      "55:00:84:82:12",
      "55-00-84-82-12",
      "55_00_84_82_12",
      "5500 8482 12",
    ]) {
      expect(normalizeHexInput(text)).toBe("5500848212");
    }
  });

  it("accepts lower case and keeps the digits, not the case", () => {
    expect(normalizeHexInput("55 00 84 82 12".toLowerCase())).toBe("5500848212");
    expect(normalizeHexInput("ff 00 aa bb cc")).toBe("FF00AABBCC");
  });

  it("keeps a partially typed entry instead of guessing at it", () => {
    expect(normalizeHexInput("55 00 8")).toBe("55008");
  });
});

describe("hexEntryShape", () => {
  it("counts digits while typing, because half a byte is a real state", () => {
    expect(hexEntryShape("")).toEqual({ digits: 0, bytes: 0, complete: false });
    expect(hexEntryShape("55")).toEqual({ digits: 2, bytes: 1, complete: false });
    expect(hexEntryShape("55 0")).toEqual({ digits: 3, bytes: 1, complete: false });
    expect(hexEntryShape("55 00 84")).toEqual({ digits: 6, bytes: 3, complete: false });
  });

  it("is complete at exactly five bytes, and not before or after", () => {
    expect(hexEntryShape("55 00 84 82").complete).toBe(false);
    expect(hexEntryShape("55 00 84 82 12").complete).toBe(true);
    expect(hexEntryShape("55 00 84 82 12 01").complete).toBe(false);
  });
});

describe("canPreview", () => {
  it("needs all three parts fields", () => {
    const full = { ...EMPTY_ENTRY, customer: "85", facility: "132", card: "33298" };
    expect(canPreview("parts", full)).toBe(true);
    expect(canPreview("parts", { ...full, customer: "" })).toBe(false);
    expect(canPreview("parts", { ...full, facility: "  " })).toBe(false);
    expect(canPreview("parts", { ...full, card: "" })).toBe(false);
  });

  it("needs exactly five bytes in the raw field", () => {
    expect(canPreview("hex", { ...EMPTY_ENTRY, hex: "55 00 84 82 12" })).toBe(true);
    expect(canPreview("hex", { ...EMPTY_ENTRY, hex: "55 00 84 82" })).toBe(false);
    expect(canPreview("hex", { ...EMPTY_ENTRY, hex: "" })).toBe(false);
  });

  it("never decides validity, so a complete but impossible entry is still sent", () => {
    // Whether this is in range is the codec's call, and it says so with the
    // range. The form does not guess, and does not hide the refusal behind a
    // disabled button.
    expect(canPreview("hex", { ...EMPTY_ENTRY, hex: "55 01 84 82 12" })).toBe(true);
    expect(canPreview("parts", { ...EMPTY_ENTRY, customer: "999", facility: "0", card: "0" })).toBe(
      true,
    );
  });
});

describe("entryHint", () => {
  it("counts what a raw entry still needs, in hex digits", () => {
    const hint = entryHint("hex", { ...EMPTY_ENTRY, hex: "55 00 84" });
    expect(hint).toContain(`6 of ${RAW_DIGITS} hex digits`);
    expect(hint).toContain(RAW_SHAPE_HINT);
  });

  it("stops counting once the entry is complete", () => {
    const hint = entryHint("hex", { ...EMPTY_ENTRY, hex: "55 00 84 82 12" });
    expect(hint).toBe(RAW_SHAPE_HINT);
  });

  it("says how the parts fields are written", () => {
    expect(entryHint("parts", EMPTY_ENTRY)).toMatch(/decimal/i);
    expect(entryHint("parts", EMPTY_ENTRY)).toMatch(/0x prefix/);
  });
});

describe("previewFacts", () => {
  const facts = previewFacts(WRITTEN);
  const byLabel = (label: string) => facts.find((f) => f.label === label)?.value;

  it("leads with the Identity every other surface shows", () => {
    expect(facts[0]).toEqual({ label: "Identity", value: "55 00 84 82 12" });
  });

  it("shows each field the Identity was built from", () => {
    expect(byLabel("Customer")).toContain("0x55");
    expect(byLabel("Facility")).toContain("132");
    expect(byLabel("Facility")).toContain("0x84");
    expect(byLabel("Card")).toContain("33298");
    expect(byLabel("Card")).toContain("0x8212");
    expect(byLabel("data32")).toBe("0x00848212");
  });

  it("shows the bytes that will go on the wire", () => {
    // The confirmation is not a summary: the payload is the write.
    expect(byLabel(PAYLOAD_FACT_LABEL)).toBe(WRITTEN.payloadHex);
    expect(byLabel(PAYLOAD_FACT_LABEL)?.split(" ")).toHaveLength(24);
  });
});

describe("the authoring confirmation", () => {
  const confirmation = authorConfirmation(WRITTEN, false);
  const copy = [confirmation.title, ...confirmation.facts.map((f) => `${f.title} ${f.detail}`)].join(
    " ",
  );

  it("names the Identity that will be written, before anything is sent", () => {
    expect(confirmation.identity).toBe("55 00 84 82 12");
    expect(confirmation.title).toContain("55 00 84 82 12");
    expect(confirmation.title.toLowerCase()).toContain("write");
    expect(confirmation.action.toLowerCase()).toContain("write");
  });

  it("states that the tag is read first and a blind write is refused", () => {
    expect(copy).toMatch(/read before it is written/i);
    expect(copy).toMatch(/cannot be read is refused/i);
    // ...and that the refusal is not a warning that can be dismissed.
    expect(copy).toMatch(/nothing is sent/i);
  });

  it("states that a tag already carrying this Identity is refused", () => {
    expect(copy).toMatch(/already carrying this Identity is refused/i);
    expect(copy).toMatch(/blank/i);
  });

  it("states that an unconfirmed read-back is unknown, not written", () => {
    expect(copy).toMatch(/read back/i);
    expect(copy).toMatch(/unknown/i);
    expect(copy).toMatch(/never counted as written/i);
  });

  it("keeps as a Snapshot only when asked, and says so when it is", () => {
    expect(confirmation.keepSnapshot).toBe(false);
    expect(copy).not.toMatch(/kept as a Snapshot/i);
    expect(confirmation.facts).toHaveLength(AUTHOR_FACTS.length);

    const keeping = authorConfirmation(WRITTEN, true);
    expect(keeping.keepSnapshot).toBe(true);
    expect(keeping.facts).toHaveLength(AUTHOR_FACTS.length + 1);
    const keptCopy = keeping.facts.map((f) => `${f.title} ${f.detail}`).join(" ");
    expect(keptCopy).toMatch(/kept as a Snapshot/i);
    expect(keptCopy).toMatch(/same step/i);
  });

  it("tells the user what to put on the reader", () => {
    expect(confirmation.blankHint).toBe(BLANK_ON_READER_HINT);
    expect(confirmation.blankHint).toMatch(/Blank/);
    expect(confirmation.blankHint).toMatch(/read before it is written/i);
  });

  it("never uses the words the glossary retired", () => {
    expect(copy).not.toMatch(/badge|fob/i);
    expect(confirmation.blankHint).not.toMatch(/badge|fob/i);
    expect(RAW_SHAPE_HINT).not.toMatch(/badge|fob/i);
  });
});

describe("what a write reports at the authoring seam", () => {
  const TARGET = WRITTEN.id;

  it("reports a verified write as the Identity the tag now reads", () => {
    const notice = authorWriteNotice(writeResult("verified"), TARGET);
    expect(notice.tone).toBe("ok");
    expect(notice.text).toContain("55 00 84 82 12");
    expect(notice.text).toMatch(/verified/i);
  });

  it("reports a transmitted write with no read-back as unknown, with instructions", () => {
    // The requirement in one assertion: unverified, never "failed", and the
    // next step is named.
    const notice = authorWriteNotice(writeResult("unverified"), TARGET);
    expect(notice.tone).toBe("warn");
    expect(notice.text).toMatch(/unknown/i);
    expect(notice.text).toContain(TARGET);
    expect(notice.text).toMatch(/read the tag/i);
    expect(notice.text).toMatch(/write it again/i);
    expect(notice.text).not.toMatch(/failed/i);
    expect(notice.text).not.toMatch(/^not written/i);
  });

  it("reports a refusal as not written, in the guard's own words", () => {
    const notice = authorWriteNotice(
      {
        ...writeResult("refused"),
        message:
          "could not read the tag on the reader, so refusing to write blind. Put a blank 125 kHz tag on the reader and try again.",
      },
      TARGET,
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toMatch(/^not written/i);
    expect(notice.text).toContain("refusing to write blind");
  });

  it("reports a transmission that never happened as not written", () => {
    const notice = authorWriteNotice(
      { ...writeResult("failed"), message: "the device is unplugged" },
      TARGET,
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toMatch(/could not be sent/i);
    expect(notice.text).toContain("the device is unplugged");
  });

  it("never says a count on this screen, because the Snapshot line says it", () => {
    // Stating both would let one view say "no Snapshot carries this Identity"
    // and "kept as a Snapshot" at the same time.
    for (const outcome of ["verified", "refused", "unverified", "failed"] as const) {
      const notice = authorWriteNotice(writeResult(outcome), TARGET);
      expect(notice.text).not.toMatch(/confirmed cop(y|ies)/i);
      expect(notice.text).not.toMatch(/no Snapshot/i);
    }
  });
});

describe("the Snapshot lines", () => {
  it("names the Snapshot a verified write kept", () => {
    expect(snapshotKeptNote("Tag 3")).toContain("Tag 3");
    expect(snapshotKeptNote("Tag 3")).toMatch(/kept as a Snapshot/i);
  });

  it("says why a just-created Snapshot starts at no confirmed copies", () => {
    // The write happened before the Snapshot existed, so nothing counted it.
    // Saying so is better than a Snapshot that looks like it ignored the write.
    const note = snapshotKeptNote("Tag 3");
    expect(note).toMatch(/confirmed-copy count starts at 0/i);
    expect(note).toMatch(/created after the write/i);
    expect(note).toMatch(/read-back/i);
  });

  it("treats a repeat Identity as a repeat, not a fault", () => {
    expect(snapshotDuplicateNote("Tag 1")).toMatch(/already in the library as Tag 1/i);
    expect(snapshotDuplicateNote("Tag 1")).toMatch(/counted/i);
  });

  it("says the tag was written even when the Snapshot could not be saved", () => {
    const note = snapshotFailedNote("disk full");
    expect(note).toMatch(/tag was written/i);
    expect(note).toContain("disk full");
    // The Identity is on the tag: the library problem is not a write failure.
    expect(note).toMatch(/safe on the tag/i);
  });
});
