import { describe, expect, it } from "vitest";
import {
  decodeHfPayload,
  ndefField,
  ndefStatusFor,
  uidMatchesMemory,
} from "./hfDecoder";

/**
 * Seam S5 — the HF decoder.
 *
 * The payload layout asserted here is a HYPOTHESIS (see docs/PROTOCOL.md and
 * the ticket): validity at byte 0, UID at 2..6, ATQA at 14..16, SAK at 17, of a
 * 19-byte reply. No raw capture from this Reader backs it, so every fixture
 * below is synthetic and every expectation is written down from the published
 * ATQA/SAK tables, not from what the code happens to produce.
 *
 * What these tests can settle: offset handling inside the hypothesis, ATQA byte
 * order, UID extraction and every raw fallback. What they cannot settle is
 * whether the hypothesis matches a real Tag — that is ticket 12.
 */

/** 19 bytes, MIFARE Classic 1K with a 4-byte UID.
 *  ATQA 0x0004 and SAK 0x08 are NXP AN10833 Table 3/4; the ATQA arrives here in
 *  the transmission order cardType.ts documents (LSByte first), so 0x0004 is
 *  [0x04, 0x00]. */
const CLASSIC_1K = [
  0x01, 0x01, // 0 validity flag, 1 constant 0x01
  0xde, 0xad, 0xbe, 0xef, // 2..6 UID
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 6..14 unconfirmed tail
  0x04, 0x00, // 14..16 ATQA, NXP 0x0004 (4-byte UID)
  0x00, // 16 unconfirmed single byte
  0x08, // 17 SAK of the last cascade level (MIFARE Classic 1K)
  0x00, // 18 unconfirmed trailing byte
];

/** Same shape, MIFARE Classic 4K: ATQA 0x0002 (AN10833 Table 3), SAK 0x18. */
const CLASSIC_4K = [
  0x01, 0x01,
  0x01, 0x02, 0x03, 0x04,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x02, 0x00,
  0x00,
  0x18,
  0x00,
];

/** A resolvable pair whose ATQA announces a 7-byte UID: ATQA 0x0044 / SAK 0x00
 *  is the MIFARE Ultralight / NTAG21x family (AN10833 section 2.2, NTAG21x data
 *  sheet Tables 24-25), and every chip in it has a 7-byte UID. */
const NTAG_7B_UID = [
  0x01, 0x01,
  0x04, 0x11, 0x22, 0x33,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x44, 0x00,
  0x00,
  0x00,
  0x00,
];

/** A pair no published table assigns: ATQA 0x2211 / SAK 0x5A. */
const UNKNOWN_PAIR = [
  0x01, 0x01,
  0xde, 0xad, 0xbe, 0xef,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x11, 0x22,
  0x00,
  0x5a,
  0x00,
];

/** Flag set, UID field empty — a reply that latched but carries no UID. */
const EMPTY_UID = [
  0x01, 0x01,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x04, 0x00,
  0x00,
  0x08,
  0x00,
];

const hexOf = (bytes: readonly number[]) =>
  bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");

const RAW_CLASSIC_1K = hexOf(CLASSIC_1K);

describe("decodeHfPayload — a resolvable pair", () => {
  it("decodes the UID and the card family the ATQA/SAK pair identifies", () => {
    const r = decodeHfPayload(CLASSIC_1K);

    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.uid).toBe("DE AD BE EF");
    expect(r.atqa).toEqual([0x04, 0x00]);
    expect(r.sak).toBe(0x08);
    // Expectations from AN10833 Tables 3-4, not from the resolver's table.
    expect(r.cardType.family).toBe("MIFARE Classic 1K");
    expect(r.cardType.capacityBytes).toBe(1024);
    expect(r.cardType.technologies).toEqual(["ISO/IEC 14443-3A", "MIFARE Classic"]);
  });

  it("reads the capacity only where the pair determines it", () => {
    const r = decodeHfPayload(CLASSIC_4K);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    expect(r.cardType.family).toBe("MIFARE Classic 4K");
    expect(r.cardType.capacityBytes).toBe(4096);
  });

  it("keeps the raw bytes of the reply", () => {
    const r = decodeHfPayload(CLASSIC_1K);
    expect(r.raw).toBe(RAW_CLASSIC_1K);
  });

  it("marks every decoded value provisional until a capture confirms the offsets", () => {
    const r = decodeHfPayload(CLASSIC_1K);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    // Ticket 12 flips this once a real Tag settles the layout. Until then the
    // readout must not present a decoded field as certain.
    expect(r.provisional).toBe(true);
  });

  it("does not claim to know whether the tag is NDEF formatted", () => {
    const r = decodeHfPayload(CLASSIC_1K);
    expect(r.state).toBe("decoded");
    if (r.state !== "decoded") return;
    // Formatting lives in the tag's memory, not in a poll reply, so a reading
    // taken from a poll alone has no answer — never true or false.
    expect(r.ndef.formatted).toBeNull();
    expect(r.ndef.note).toMatch(/memory/i);
  });

  it("points at the memory read that settles formatting, and never claims the Reader cannot read memory", () => {
    const r = decodeHfPayload(CLASSIC_1K);
    if (r.state !== "decoded") throw new Error("fixture decodes");
    // The Reader reads memory (`0x0081`) and this page already decodes the
    // Capability Container for the erase and write panels. Saying it has no such
    // command is false, and it would tell the user the answer cannot be had.
    expect(r.ndef.note).not.toMatch(/cannot read memory|no command that reads memory/i);
    expect(r.ndef.note).toMatch(/0x0081|memory read/i);
  });
});

describe("NDEF formatting, once the tag's memory has been read", () => {
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

describe("matching a memory read to the reading above it", () => {
  it("matches on the UID bytes the poll splits", () => {
    // The poll's UID field holds the first four bytes of a 7-byte UID, and the
    // memory read reports the whole UID, so the poll's bytes are a prefix.
    expect(uidMatchesMemory("04 43 8A 01", "04 43 8A 01 22 09 03")).toBe(true);
    expect(uidMatchesMemory("04 43 8A 01", "04 43 8A 02 22 09 03")).toBe(false);
    expect(uidMatchesMemory("04 43 8A 01", "04 43 8A 01")).toBe(true);
  });

  it("refuses to match an empty UID rather than matching everything", () => {
    expect(uidMatchesMemory("", "04 43 8A 01 22 09 03")).toBe(false);
    expect(uidMatchesMemory("04 43 8A 01", "")).toBe(false);
  });
});

describe("decodeHfPayload — degradation to raw only", () => {
  it("shows raw bytes and no decoded fields when the length is not the expected shape", () => {
    const short = CLASSIC_1K.slice(0, 18);
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
    const long = [...CLASSIC_1K, 0xc8, 0x42, 0x01, 0x00, 0x00];
    const r = decodeHfPayload(long);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("unexpected-length");
    expect(r.raw).toBe(hexOf(long));
  });

  it("shows raw bytes and no family for an unknown ATQA/SAK pair", () => {
    const r = decodeHfPayload(UNKNOWN_PAIR);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("unknown-card-type");
    expect(r.raw).toBe(hexOf(UNKNOWN_PAIR));
    expect(r.detail).toContain("11 22");
    expect(r.detail).toContain("5A");
  });

  it("shows raw bytes and no UID split when the ATQA announces a 7-byte UID", () => {
    const r = decodeHfPayload(NTAG_7B_UID);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("unsupported-uid-width");
    expect(r.raw).toBe(hexOf(NTAG_7B_UID));
    expect("uid" in r).toBe(false);
  });

  it("shows raw bytes and no UID split when the UID field is empty", () => {
    const r = decodeHfPayload(EMPTY_UID);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("empty-uid");
    expect(r.raw).toBe(hexOf(EMPTY_UID));
  });

  it("treats a clear validity flag as nothing latched", () => {
    const noTag = [0x00, 0x01, ...CLASSIC_1K.slice(2)];
    const r = decodeHfPayload(noTag);
    expect(r.state).toBe("raw");
    if (r.state !== "raw") return;
    expect(r.reason).toBe("not-latched");
    expect(r.raw).toBe(hexOf(noTag));
  });

  it("falls back when a byte is not a byte", () => {
    const broken = [...CLASSIC_1K];
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
    ["decoded Classic 1K", CLASSIC_1K],
    ["unknown pair", UNKNOWN_PAIR],
    ["7-byte UID", NTAG_7B_UID],
    ["empty UID", EMPTY_UID],
    ["short reply", CLASSIC_1K.slice(0, 10)],
    ["empty reply", []],
  ];

  for (const [label, payload] of cases) {
    it(`keeps the raw hex for ${label}`, () => {
      const r = decodeHfPayload(payload);
      expect(r.raw).toBe(hexOf(payload));
    });
  }
});
