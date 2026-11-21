import { describe, expect, it } from "vitest";
import {
  decodeHfPayload,
  capacityForReading,
  ndefField,
  ndefStatusFor,
  uidMatchesMemory,
} from "./hfDecoder";
import type { CardType } from "./cardType";
import type { TagRecordsRead } from "./tagRecords";

/**
 * Seam S5 — the HF decoder.
 *
 * The layout asserted here is the measured one recorded in the spec ("The
 * verified HF reply layout"), taken off two real tags on this Reader:
 *
 * | byte    | meaning                                             |
 * |---------|-----------------------------------------------------|
 * | 0       | validity, `0x01` = latched                          |
 * | 1       | constant `0x01`                                     |
 * | 2..12   | UID buffer, ten bytes, zero-padded beyond the length |
 * | 12      | UID length in bytes: 4, 7 or 10                     |
 * | 13..15  | ATQA in transmission order                          |
 * | 15      | SAK of the last cascade level                       |
 * | 16      | cascade level count — consistent, not established   |
 * | 17..19  | unexplained                                         |
 *
 * Every ATQA and SAK expectation below is written from the published
 * specifications for that family (NXP AN10833 Tables 3-5, the NTAG21x data
 * sheet Tables 24-25), not from what this implementation produces. That
 * independence is what makes the captures a measurement rather than a fit.
 */

/** MIFARE Classic 1K, UID `31 F3 0E 0A`, captured from this Reader.
 *  ATQA 0x0004 arrives as `04 00` (transmission order, LSByte first) and SAK
 *  is 0x08 — AN10833 Table 3 (ATQA 00 04) and Table 4 (SAK 08, 1 KiB). */
const CLASSIC_CAPTURE = [
  0x01, 0x01, // 0 validity, 1 constant
  0x31, 0xf3, 0x0e, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 2..12 UID buffer
  0x04, // 12 UID length
  0x04, 0x00, // 13..15 ATQA, NXP 0x0004
  0x08, // 15 SAK
  0x01, // 16 cascade level count (4-byte UID)
  0x10, 0x00, // 17..19 unexplained
];

/** NTAG215, UID `04 43 8A 01 22 09 03`, captured from this Reader.
 *  ATQA 0x0044 arrives as `44 00` and SAK is 0x00 — AN10833 section 2.2 and
 *  Tables 3-4, NTAG213/215/216 data sheet Tables 24-25. */
const NTAG_CAPTURE = [
  0x01, 0x01,
  0x04, 0x43, 0x8a, 0x01, 0x22, 0x09, 0x03, 0x1d, 0x00, 0x20, // UID buffer; 9..12 residue
  0x07, // 12 UID length
  0x44, 0x00, // 13..15 ATQA, NXP 0x0044
  0x00, // 15 SAK
  0x02, // 16 cascade level count (7-byte UID)
  0x00, 0x00, // 17..19 unexplained
];

/** A pair no published table assigns: ATQA 0x2211 / SAK 0x5A. */
const UNKNOWN_PAIR = [
  0x01, 0x01,
  0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x04,
  0x11, 0x22,
  0x5a,
  0x01,
  0x00, 0x00,
];

/** Flag set and a stated 4-byte length, but the UID buffer is all zeros. */
const EMPTY_UID = [
  0x01, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x04,
  0x04, 0x00,
  0x08,
  0x01,
  0x00, 0x00,
];

/** A payload built to the offsets this ticket refuted: UID at 2..6, ATQA at
 *  14..16, SAK at 17. Its byte 12 is part of the old "unconfirmed tail". */
const REFUTED_OFFSETS = [
  0x01, 0x01,
  0xde, 0xad, 0xbe, 0xef,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, // 12 was "tail"; under the measured layout this is the length byte
  0x00,
  0x04, 0x00, // old ATQA position
  0x00,
  0x08, // old SAK position
  0x00,
];

const hexOf = (bytes: readonly number[]) =>
  bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");

describe("the measured Classic 1K capture", () => {
  it("decodes as MIFARE Classic 1K with its 4-byte UID, ATQA and SAK", () => {
    const r = decodeHfPayload(CLASSIC_CAPTURE);

    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.uid).toBe("31 F3 0E 0A");
    // Transmission order: the bytes as they left the tag.
    expect(r.atqa).toEqual([0x04, 0x00]);
    expect(r.sak).toBe(0x08);
    // Expectations from AN10833 Tables 3-4, not from the resolver's table.
    expect(r.cardType.family).toBe("MIFARE Classic 1K");
    expect(r.cardType.capacityBytes).toBe(1024);
    expect(r.cardType.technologies).toEqual(["ISO/IEC 14443-3A", "MIFARE Classic"]);
  });

  it("keeps the raw bytes of the reply, residue and all", () => {
    const r = decodeHfPayload(CLASSIC_CAPTURE);
    expect(r.raw).toBe(hexOf(CLASSIC_CAPTURE));
  });

  it("never presents the residue bytes between the UID and the length as UID", () => {
    // The buffer is ten bytes with a stated length of four: bytes 6..12 are
    // stale residue, so the UID is exactly the four bytes the length names.
    const r = decodeHfPayload(CLASSIC_CAPTURE);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.uid).toBe("31 F3 0E 0A");
    expect(r.uid.split(" ")).toHaveLength(4);
  });

  it("ignores nonzero residue rather than reporting debris as content", () => {
    // The same four UID bytes with a dirty buffer behind them. The layout reads
    // the first `length` bytes and nothing else, so the residue cannot leak into
    // the UID.
    const dirty = [...CLASSIC_CAPTURE];
    dirty[6] = 0xaa;
    dirty[7] = 0xbb;
    dirty[8] = 0xcc;
    dirty[9] = 0xdd;
    dirty[10] = 0xee;
    dirty[11] = 0xff;
    const r = decodeHfPayload(dirty);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.uid).toBe("31 F3 0E 0A");
    expect(r.uid).not.toContain("AA");
    // The bytes are still in the raw record; they are just not content.
    expect(r.raw).toBe(hexOf(dirty));
  });

  it("does not mark a measured decode provisional", () => {
    const r = decodeHfPayload(CLASSIC_CAPTURE);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    // The offsets are measured, so there is no provisional claim left to make.
    expect("provisional" in r).toBe(false);
  });
});

describe("the measured NTAG215 capture", () => {
  it("decodes with its full 7-byte UID, ATQA and SAK", () => {
    const r = decodeHfPayload(NTAG_CAPTURE);

    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.uid).toBe("04 43 8A 01 22 09 03");
    expect(r.uid.split(" ")).toHaveLength(7);
    expect(r.atqa).toEqual([0x44, 0x00]);
    expect(r.sak).toBe(0x00);
    // AN10833 section 2.2 and NTAG21x Tables 24-25: the family answers this
    // pair, and only GET_VERSION tells NTAG213 from 215 from 216.
    expect(r.cardType.family).toBe("MIFARE Ultralight / NTAG21x");
    expect(r.cardType.capacityBytes).toBeNull();
    expect(r.cardType.nfcForumTagType).toBe(2);
  });

  it("marks capacity unavailable rather than guessing it from the family", () => {
    const r = decodeHfPayload(NTAG_CAPTURE);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    // Until this Tag's memory is read, nothing has produced a capacity.
    expect(capacityForReading(r.cardType, null)).toBeNull();
  });

  it("does not present the residue bytes 9..12 as part of the UID", () => {
    const r = decodeHfPayload(NTAG_CAPTURE);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.uid).not.toContain("1D");
    expect(r.uid).not.toContain("20");
  });
});

describe("UID width comes from the reply's own length byte", () => {
  /** The NTAG capture with its length byte changed to a 10-byte UID, and ten
   *  real UID bytes in the buffer. */
  const TEN_BYTE = [
    0x01, 0x01,
    0x04, 0x43, 0x8a, 0x01, 0x22, 0x09, 0x03, 0x1d, 0x00, 0x20,
    0x0a,
    0x44, 0x00,
    0x00,
    0x02,
    0x00, 0x00,
  ];

  it("accepts a 10-byte UID", () => {
    const r = decodeHfPayload(TEN_BYTE);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.uid).toBe("04 43 8A 01 22 09 03 1D 00 20");
    expect(r.uid.split(" ")).toHaveLength(10);
  });

  it("splits the width the length byte states, not the width the ATQA implies", () => {
    // ATQA 0x0044 is the pair a 7-byte-UID Ultralight/NTAG answers, but this
    // reply says four bytes. Reading the width out of the ATQA is exactly the
    // inference that padded a short UID with zeros.
    const fourWithWideAtqa = [
      0x01, 0x01,
      0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x04,
      0x44, 0x00,
      0x00,
      0x01,
      0x00, 0x00,
    ];
    const r = decodeHfPayload(fourWithWideAtqa);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.uid).toBe("DE AD BE EF");
  });

  it("splits a 10-byte UID even when the ATQA declares a smaller one", () => {
    // MIFARE Classic 1K's pair says nothing here; the length byte decides.
    const r = decodeHfPayload([
      0x01, 0x01,
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
      0x0a,
      0x04, 0x00,
      0x08,
      0x03,
      0x00, 0x00,
    ]);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.uid).toBe("01 02 03 04 05 06 07 08 09 0A");
  });

  for (const width of [0x00, 0x01, 0x05, 0x06, 0x08, 0x09, 0x0b, 0xff]) {
    it(`refuses a stated UID length of ${width} as its own reason`, () => {
      const payload = [...NTAG_CAPTURE];
      payload[12] = width;
      const r = decodeHfPayload(payload);
      expect(r.state).toBe("raw");
      if (r.state !== "raw") return;
      expect(r.reason).toBe("unsupported-uid-width");
      expect("uid" in r).toBe(false);
      expect("cardType" in r).toBe(false);
      // The refusal names the byte it read, so a firmware change is visible.
      expect(r.detail).toContain(width.toString(16).toUpperCase().padStart(2, "0"));
    });
  }
});

describe("decodeHfPayload — degradation to raw only", () => {
  it("does not decode a reply built to the refuted one-byte-off layout", () => {
    // Its byte 12 is not a UID length, so the refusal is the length refusal
    // rather than a family invented from the wrong offsets.
    const r = decodeHfPayload(REFUTED_OFFSETS);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("unsupported-uid-width");
    expect("cardType" in r).toBe(false);
  });

  it("shows raw bytes and no decoded fields when the length is not the expected shape", () => {
    const short = CLASSIC_CAPTURE.slice(0, 18);
    const r = decodeHfPayload(short);

    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("unexpected-length");
    expect(r.raw).toBe(hexOf(short));
    expect(r.detail).toContain("18");
    expect(r.detail).toContain("19");
    expect("uid" in r).toBe(false);
    expect("cardType" in r).toBe(false);
  });

  it("falls back for a longer reply too, such as a 24-byte 125 kHz shape", () => {
    const long = [...CLASSIC_CAPTURE, 0xc8, 0x42, 0x01, 0x00, 0x00];
    const r = decodeHfPayload(long);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("unexpected-length");
    expect(r.raw).toBe(hexOf(long));
  });

  it("shows raw bytes and no family, capacity or technologies for an unknown pair", () => {
    const r = decodeHfPayload(UNKNOWN_PAIR);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("unknown-card-type");
    expect(r.raw).toBe(hexOf(UNKNOWN_PAIR));
    expect(r.detail).toContain("11 22");
    expect(r.detail).toContain("5A");
    expect("uid" in r).toBe(false);
    expect("cardType" in r).toBe(false);
  });

  it("shows raw bytes and no UID split when the UID field is empty", () => {
    const r = decodeHfPayload(EMPTY_UID);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("empty-uid");
    expect(r.raw).toBe(hexOf(EMPTY_UID));
  });

  it("treats a clear validity flag as nothing latched", () => {
    const noTag = [0x00, 0x01, ...CLASSIC_CAPTURE.slice(2)];
    const r = decodeHfPayload(noTag);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("not-latched");
    expect(r.raw).toBe(hexOf(noTag));
  });

  it("falls back when a byte is not a byte", () => {
    const broken = [...CLASSIC_CAPTURE];
    broken[3] = 0x1ff;
    const r = decodeHfPayload(broken);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("invalid-bytes");
    expect(r.raw).not.toBe("");
  });
});

describe("decodeHfPayload — raw bytes are always available", () => {
  const cases: [string, number[]][] = [
    ["the Classic capture", CLASSIC_CAPTURE],
    ["the NTAG capture", NTAG_CAPTURE],
    ["unknown pair", UNKNOWN_PAIR],
    ["empty UID", EMPTY_UID],
    ["short reply", CLASSIC_CAPTURE.slice(0, 10)],
    ["empty reply", []],
  ];

  for (const [label, payload] of cases) {
    it(`keeps the raw hex for ${label}`, () => {
      const r = decodeHfPayload(payload);
      expect(r.raw).toBe(hexOf(payload));
    });
  }
});

describe("NDEF formatting, once the tag's memory has been read", () => {
  it("does not claim to know whether the tag is NDEF formatted", () => {
    const r = decodeHfPayload(CLASSIC_CAPTURE);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    // Formatting lives in the tag's memory, not in a poll reply, so a reading
    // taken from a poll alone has no answer — never true or false.
    expect(r.ndef.formatted).toBeNull();
    expect(r.ndef.note).toMatch(/memory/i);
  });

  it("points at the memory read that settles formatting, and never claims the Reader cannot read memory", () => {
    const r = decodeHfPayload(CLASSIC_CAPTURE);
    if (r.state !== "decoded") throw new Error("fixture decodes");
    // The Reader reads memory (`0x0081`) and this page already decodes the
    // Capability Container for the erase and write panels. Saying it has no such
    // command is false, and it would tell the user the answer cannot be had.
    expect(r.ndef.note).not.toMatch(/cannot read memory|no command that reads memory/i);
    expect(r.ndef.note).toMatch(/0x0081|memory read/i);
  });

  it("shows no NDEF field at all while the answer is not determined", () => {
    // The per-tag greyed row is the thing user story 56 forbids: a field this
    // Reader cannot produce from a poll must be omitted, not shown as "unknown".
    expect(ndefField(ndefStatusFor(null))).toBeNull();
  });

  it("reports a real yes or no from the Type 2 structure the memory read returned", () => {
    expect(ndefStatusFor("message").formatted).toBe(true);
    expect(ndefStatusFor("empty").formatted).toBe(true);
    expect(ndefStatusFor("missing").formatted).toBe(true);
    expect(ndefField(ndefStatusFor("message"))).toEqual({
      label: "NDEF formatted",
      value: "yes",
    });

    expect(ndefStatusFor("notFormatted").formatted).toBe(false);
    expect(ndefField(ndefStatusFor("notFormatted"))).toEqual({
      label: "NDEF formatted",
      value: "no",
    });
  });

  it("keeps the field off the screen when even the memory read could not say", () => {
    const status = ndefStatusFor("unreadable");
    expect(status.formatted).toBeNull();
    expect(status.note).toMatch(/could not/i);
    expect(ndefField(status)).toBeNull();
  });

  it("always explains the answer it gives", () => {
    for (const outcome of [null, "message", "empty", "missing", "notFormatted", "unreadable"] as const) {
      expect(ndefStatusFor(outcome).note.trim()).not.toBe("");
    }
  });
});

describe("the capacity a readout shows", () => {
  /** A family whose size the published table fixes (MIFARE Classic 1K). */
  const CLASSIC: CardType = {
    family: "MIFARE Classic 1K",
    variants: ["MIFARE Classic 1K"],
    capacityBytes: 1024,
    technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
    nfcForumTagType: null,
  };
  /** The Ultralight/NTAG21x family, whose size only the tag's own CC settles. */
  const NTAG: CardType = {
    family: "MIFARE Ultralight / NTAG21x",
    variants: ["NTAG213/215/216"],
    capacityBytes: null,
    technologies: ["ISO/IEC 14443-3A", "MIFARE Ultralight"],
    nfcForumTagType: 2,
  };

  const memory = (capacityBytes: number | null): TagRecordsRead =>
    ({ ndef: { outcome: "message", capacityBytes } }) as TagRecordsRead;

  it("uses the table's fixed size when the family has one", () => {
    expect(capacityForReading(CLASSIC, null)).toBe(1024);
    expect(capacityForReading(CLASSIC, memory(496))).toBe(1024);
  });

  it("takes the tag's Capability Container once its memory has been read", () => {
    // The recorded NTAG215 read: CC `E1 10 3E 00` is 496 bytes of user memory.
    expect(capacityForReading(NTAG, memory(496))).toBe(496);
  });

  it("reports no number only while nothing has produced one", () => {
    // Not a field the Reader cannot fill: an unread Ultralight is a value still
    // unknown, and one memory read settles it.
    expect(capacityForReading(NTAG, null)).toBeNull();
    expect(capacityForReading(NTAG, memory(null))).toBeNull();
  });
});

describe("matching a memory read to the reading above it", () => {
  it("matches a memory read that names the same Tag", () => {
    // The poll now states its own UID length, so the two reads of one Tag carry
    // the same bytes.
    expect(uidMatchesMemory("04 43 8A 01 22 09 03", "04 43 8A 01 22 09 03")).toBe(true);
    expect(uidMatchesMemory("31 F3 0E 0A", "31 F3 0E 0A")).toBe(true);
  });

  it("still matches when the reading's UID is a prefix of the dump's", () => {
    // A narrower reading must not be applied to a wider Tag it does not name,
    // but a prefix of the same UID is the same Tag.
    expect(uidMatchesMemory("04 43 8A 01", "04 43 8A 01 22 09 03")).toBe(true);
    expect(uidMatchesMemory("04 43 8A 01", "04 43 8A 02 22 09 03")).toBe(false);
  });

  it("refuses to match an empty UID rather than matching everything", () => {
    expect(uidMatchesMemory("", "04 43 8A 01 22 09 03")).toBe(false);
    expect(uidMatchesMemory("04 43 8A 01", "")).toBe(false);
  });
});
