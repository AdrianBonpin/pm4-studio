import { describe, expect, it } from "vitest";
import {
  bytesToHex,
  capacitySentence,
  draftMessageHex,
  existingRecords,
  hexToBytes,
  pageRange,
  pagesLabel,
  recordsLabel,
  replacementSentence,
  writeNotice,
  type ExistingNdef,
  type NdefPreview,
  type NdefTagView,
  type NdefWriteResult,
} from "./tagWrite";

/**
 * The message the spike's NTAG215 carried, recorded in docs/PROTOCOL.md:
 * `03 11 D1 01 0D 55 04 "devgo.studio" FE`, i.e. a URL Record for
 * https://devgo.studio behind a 0x11-byte NDEF message.
 */
const RECORDED_MESSAGE_HEX = "D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F";

function tag(existing: ExistingNdef): NdefTagView {
  return {
    uid: "04 43 8A 01 22 09 03",
    reportedTagType: 5,
    capacityBytes: 496,
    userPages: 124,
    existing,
  };
}

const EMPTY: ExistingNdef = { state: "empty", messageHex: null, bytes: 0, reason: null };
const RECORDED: ExistingNdef = {
  state: "message",
  messageHex: RECORDED_MESSAGE_HEX,
  bytes: 17,
  reason: null,
};

function preview(overrides: Partial<NdefPreview> = {}): NdefPreview {
  return {
    tag: tag(EMPTY),
    requiredBytes: 20,
    capacityBytes: 496,
    fits: true,
    refusal: null,
    ...overrides,
  };
}

function result(overrides: Partial<NdefWriteResult> = {}): NdefWriteResult {
  return {
    outcome: "verified",
    message: null,
    before: tag(EMPTY),
    after: tag(RECORDED),
    capacityBytes: 496,
    requiredBytes: 20,
    wrotePages: [4, 5, 6, 7, 8],
    acceptedPages: [4, 5, 6, 7, 8],
    ...overrides,
  };
}

describe("the bytes handed to the backend", () => {
  it("encodes a Draft's Records as one message in space-separated hex", () => {
    // A URL Record for https://devgo.studio encodes to exactly the message the
    // recorded Tag carried, so the round trip is checked against real bytes.
    const hex = draftMessageHex([{ kind: "url", fields: { url: "https://devgo.studio" } }]);
    expect(hex).toBe(RECORDED_MESSAGE_HEX);
  });

  it("round-trips hex without depending on case or spacing", () => {
    expect(hexToBytes("d1010d55")).toEqual([0xd1, 0x01, 0x0d, 0x55]);
    expect(hexToBytes("D1 01 0D 55")).toEqual([0xd1, 0x01, 0x0d, 0x55]);
    expect(bytesToHex([0xd1, 0x01, 0x0d])).toBe("D1 01 0D");
    expect(bytesToHex(hexToBytes(RECORDED_MESSAGE_HEX))).toBe(RECORDED_MESSAGE_HEX);
  });

  it("refuses an odd number of hex digits rather than guessing a byte", () => {
    expect(() => hexToBytes("D10")).toThrow();
  });
});

describe("naming what a write replaces", () => {
  it("says the tag appears empty when it holds no message", () => {
    expect(replacementSentence(preview())).toContain("appears empty");
    expect(replacementSentence(preview())).toContain("nothing is being replaced");
  });

  it("names the Record the tag holds now", () => {
    const sentence = replacementSentence(preview({ tag: tag(RECORDED) }));
    expect(sentence).toContain("https://devgo.studio");
    expect(sentence).toContain("1 Record");
  });

  it("says a message it cannot decode is being replaced, with its size", () => {
    const unknown: ExistingNdef = {
      state: "message",
      messageHex: "80 01 00",
      bytes: 3,
      reason: null,
    };
    const sentence = replacementSentence(preview({ tag: tag(unknown) }));
    expect(sentence).toContain("cannot decode");
    expect(sentence).toContain("3 bytes");
  });

  it("says content it could not read is being replaced, and why", () => {
    const unreadable: ExistingNdef = {
      state: "unreadable",
      messageHex: null,
      bytes: 0,
      reason: "the NDEF TLV declares 17 message bytes and only 5 remain",
    };
    const sentence = replacementSentence(preview({ tag: tag(unreadable) }));
    expect(sentence).toContain("could not read");
    expect(sentence).toContain("only 5 remain");
  });

  it("passes a refusal through when there is no Tag to name", () => {
    const refused = preview({ tag: null, fits: false, refusal: "no 13.56 MHz Tag is in the field" });
    expect(replacementSentence(refused)).toBe("no 13.56 MHz Tag is in the field");
  });
});

describe("capacity", () => {
  it("gives the message size against the tag's own capacity", () => {
    expect(capacitySentence(preview())).toContain("20 of the tag's 496 bytes");
    expect(capacitySentence(preview())).toContain("replaces the whole message");
  });

  it("says capacity is unknown rather than inventing one", () => {
    const sentence = capacitySentence(
      preview({ capacityBytes: null, fits: false, refusal: "capacity could not be read" }),
    );
    expect(sentence).toContain("could not be read");
    expect(sentence).toContain("refused");
    expect(sentence).not.toMatch(/\d+ bytes/);
  });
});

describe("page ranges", () => {
  it("starts at user page 4 and rounds a partial page up", () => {
    expect(pageRange(20)).toEqual([4, 5, 6, 7, 8]);
    expect(pageRange(21)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(pageRange(0)).toEqual([]);
    expect(pagesLabel(pageRange(51))).toBe("pages 4–16 (13 pages)");
  });

  it("collapses a contiguous run and lists a scattered one", () => {
    expect(pagesLabel([4, 5, 6, 7, 8])).toBe("pages 4–8 (5 pages)");
    expect(pagesLabel([4])).toBe("page 4");
    expect(pagesLabel([6, 5, 4])).toBe("pages 4–6 (3 pages)");
    expect(pagesLabel([4, 6])).toBe("2 pages (4, 6)");
    expect(pagesLabel([])).toBe("no pages");
  });
});

describe("what the user is told afterwards", () => {
  it("calls a verified write verified, and says what one request wrote", () => {
    const notice = writeNotice(result());
    expect(notice.tone).toBe("ok");
    expect(notice.text).toContain("Verified");
    expect(notice.text).toContain("pages 4–8 (5 pages)");
  });

  it("calls a write it could not confirm unknown, with instructions", () => {
    const notice = writeNotice(
      result({
        outcome: "unverified",
        after: null,
        message: "the write was sent but the Tag could not be read back",
      }),
    );
    expect(notice.tone).toBe("warn");
    expect(notice.text).toContain("Unknown");
    expect(notice.text).toContain("Read the tag");
    // Never worded as success and never as a definitive failure.
    expect(notice.text).not.toContain("Failed");
    expect(notice.text).not.toContain("Not written");
  });

  it("says a refused write was not written, and why", () => {
    const notice = writeNotice(
      result({
        outcome: "refused",
        wrotePages: [],
        message: "the message needs 1200 bytes and the Tag holds 496",
      }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("Not written");
    expect(notice.text).toContain("1200");
  });

  it("says a write that could not be sent failed, and that the tag is unchanged", () => {
    const notice = writeNotice(
      result({ outcome: "failed", wrotePages: [], message: "USB write failed" }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("could not be sent");
    expect(notice.text).toContain("USB write failed");
    expect(notice.text).toContain("not changed");
  });
});

describe("reading back what a tag holds", () => {
  it("decodes the recorded message into the Record it holds", () => {
    const records = existingRecords(RECORDED);
    expect(records).toEqual([{ kind: "url", fields: { url: "https://devgo.studio" } }]);
    expect(recordsLabel(records!)).toBe("1 Record: URL https://devgo.studio");
  });

  it("has no Records for an empty or unreadable tag", () => {
    expect(existingRecords(EMPTY)).toBeNull();
    expect(
      existingRecords({ state: "unreadable", messageHex: null, bytes: 0, reason: "why" }),
    ).toBeNull();
  });

  it("returns null rather than throwing for a message it cannot decode", () => {
    const garbage: ExistingNdef = {
      state: "message",
      messageHex: "FF FF FF FF",
      bytes: 4,
      reason: null,
    };
    expect(existingRecords(garbage)).toBeNull();
  });

  it("summarises several Records by the first one", () => {
    const records = [
      { kind: "text" as const, fields: { language: "en", text: "hello" } },
      { kind: "url" as const, fields: { url: "https://example.com" } },
    ];
    expect(recordsLabel(records)).toBe("2 Records, starting with Text hello");
  });
});
