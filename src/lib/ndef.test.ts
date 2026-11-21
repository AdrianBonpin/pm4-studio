import { describe, expect, it } from "vitest";
import {
  NdefError,
  decodeNdefMessage,
  decodeRecords,
  encodeNdefMessage,
  encodeRecords,
  encodeTextPayload,
  encodeUrlPayload,
  recordsByteLength,
  textRecord,
  urlIdentifierCode,
  urlRecord,
} from "./ndef";
import type { DraftRecord } from "./drafts";

/**
 * Seam S7 — the NDEF codec.
 *
 * Every expected byte array below was written out by hand from the NDEF
 * specifications, not captured from this encoder. That matters more than usual:
 * a self-consistent but wrong encoder still produces a message that a tag and a
 * phone will accept, and the error only shows up as garbage on someone else's
 * device.
 *
 * The references used for the hand computation:
 *   - NFC Forum, "NDEF 1.0" (the message and record layout): MB/ME/CF/SR/IL
 *     flag bits in the first header byte, TNF in its low three bits, then
 *     TYPE LENGTH, PAYLOAD LENGTH (one byte only when SR is set, otherwise four
 *     bytes big-endian), ID LENGTH when IL is set, then TYPE, ID, PAYLOAD.
 *   - NFC Forum, "Text Record Type Definition 1.0": type "T", payload is a
 *     status byte whose low six bits are the language-code length and whose
 *     bit 7 is the UTF-16 flag (0 = UTF-8), then the language code, then the
 *     text in that encoding.
 *   - NFC Forum, "URI Record Type Definition 1.0": type "U", payload is one
 *     URI identifier code byte followed by the rest of the URI. Code 0x00 is
 *     "no abbreviation"; 0x01 "http://www.", 0x02 "https://www.", 0x03
 *     "http://", 0x04 "https://", 0x05 "tel:", 0x06 "mailto:", 0x08
 *     "ftp://ftp.", 0x0D "ftp://", 0x23 "urn:nfc:".
 */

describe("a Text Record", () => {
  it("encodes to the exact bytes the Text RTD specifies", () => {
    // language "en", text "Hello".
    // payload = status 0x02 (two language bytes, UTF-8) + "en" + "Hello" = 8 bytes.
    // header = MB 0x80 | ME 0x40 | SR 0x10 | TNF 0x01 = 0xD1.
    const expected = [
      0xd1, // flags: MB, ME, SR, TNF well-known
      0x01, // TYPE LENGTH
      0x08, // PAYLOAD LENGTH (8)
      0x54, // TYPE "T"
      0x02, // status: language length 2, UTF-8
      0x65, // "e"
      0x6e, // "n"
      0x48, // "H"
      0x65, // "e"
      0x6c, // "l"
      0x6c, // "l"
      0x6f, // "o"
    ];

    expect(encodeNdefMessage([textRecord("en", "Hello")])).toEqual(expected);
  });

  it("carries the language-code length in the status byte and always encodes UTF-8", () => {
    // language "pt-BR" (5 bytes), text "Ola" -> status 0x05, then the code.
    const payload = encodeTextPayload("pt-BR", "Ola");
    expect(payload).toEqual([
      0x05, // language length 5, UTF-8 flag clear
      0x70, // p
      0x74, // t
      0x2d, // -
      0x42, // B
      0x52, // R
      0x4f, // O
      0x6c, // l
      0x61, // a
    ]);
    expect(payload[0] & 0x80).toBe(0);
  });

  it("refuses a language code the six status bits cannot hold", () => {
    expect(() => encodeTextPayload("x".repeat(64), "text")).toThrow(NdefError);
  });
});

describe("a URL Record", () => {
  it("encodes to the exact bytes the URI RTD specifies, using the shortest prefix", () => {
    // "https://example.com/x" -> code 0x04 ("https://") + "example.com/x" (13)
    // = a 14-byte payload, which is shorter than code 0x02 ("https://www." is
    // not a prefix here) and far shorter than the 23-byte literal form.
    const expected = [
      0xd1, // flags: MB, ME, SR, TNF well-known
      0x01, // TYPE LENGTH
      0x0e, // PAYLOAD LENGTH (14)
      0x55, // TYPE "U"
      0x04, // URI identifier code "https://"
      0x65, // e
      0x78, // x
      0x61, // a
      0x6d, // m
      0x70, // p
      0x6c, // l
      0x65, // e
      0x2e, // .
      0x63, // c
      0x6f, // o
      0x6d, // m
      0x2f, // /
      0x78, // x
    ];

    expect(encodeNdefMessage([urlRecord("https://example.com/x")])).toEqual(expected);
  });

  it("falls back to identifier code 0x00 for a URI no abbreviation shortens", () => {
    // "geo:0,0" matches no prefix in the table, so the whole URI is carried.
    const expected = [
      0xd1,
      0x01,
      0x08, // 1 code byte + 7 URI bytes
      0x55,
      0x00, // no abbreviation
      0x67, // g
      0x65, // e
      0x6f, // o
      0x3a, // :
      0x30, // 0
      0x2c, // ,
      0x30, // 0
    ];

    expect(encodeNdefMessage([urlRecord("geo:0,0")])).toEqual(expected);
  });

  it("picks the abbreviation that leaves the fewest bytes", () => {
    // Both 0x01 ("http://www.", 11 chars) and 0x03 ("http://", 7 chars) match.
    // Code 0x01 leaves "example.com" (11 bytes) -> 12 total; code 0x03 leaves
    // "www.example.com" (15 bytes) -> 16 total. The shorter wins.
    expect(urlIdentifierCode("http://www.example.com")).toBe(0x01);
    // "ftp://ftp.example.com": 0x08 leaves 11 -> 12; 0x0D leaves 15 -> 16.
    expect(urlIdentifierCode("ftp://ftp.example.com")).toBe(0x08);
    // Only 0x0D ("ftp://") matches here.
    expect(urlIdentifierCode("ftp://example.com")).toBe(0x0d);
    expect(urlIdentifierCode("tel:+15551234")).toBe(0x05);
    expect(urlIdentifierCode("mailto:someone@example.com")).toBe(0x06);
    expect(urlIdentifierCode("urn:nfc:ext:example.com:do")).toBe(0x23);
  });

  it("keeps a URI byte for byte when no abbreviation applies", () => {
    const payload = encodeUrlPayload("geo:0,0");
    expect(payload[0]).toBe(0x00);
    expect(String.fromCharCode(...payload.slice(1))).toBe("geo:0,0");
  });
});

describe("the message flags", () => {
  it("sets MB only on the first Record and ME only on the last", () => {
    // Record 1: MB | SR | TNF 1 = 0x91. Record 2: ME | SR | TNF 1 = 0x51.
    const bytes = encodeNdefMessage([
      textRecord("en", "Hello"),
      urlRecord("https://example.com/x"),
    ]);
    const expected = [
      0x91,
      0x01,
      0x08,
      0x54,
      0x02,
      0x65,
      0x6e,
      0x48,
      0x65,
      0x6c,
      0x6c,
      0x6f,
      0x51,
      0x01,
      0x0e,
      0x55,
      0x04,
      0x65,
      0x78,
      0x61,
      0x6d,
      0x70,
      0x6c,
      0x65,
      0x2e,
      0x63,
      0x6f,
      0x6d,
      0x2f,
      0x78,
    ];
    expect(bytes).toEqual(expected);
    expect(bytes[0] & 0x80).toBe(0x80);
    expect(bytes[0] & 0x40).toBe(0);
    expect(bytes[12] & 0x80).toBe(0);
    expect(bytes[12] & 0x40).toBe(0x40);
  });

  it("sets both MB and ME on a single-Record message", () => {
    const bytes = encodeNdefMessage([textRecord("en", "Hi")]);
    expect(bytes[0] & 0xc0).toBe(0xc0);
  });

  it("drops SR and writes a four-byte length once the payload exceeds 255 bytes", () => {
    // payload = 1 status + 2 language + 300 text = 303 = 0x0000012F.
    // header = MB | ME | TNF 1 = 0xC1 (SR clear).
    const bytes = encodeNdefMessage([textRecord("en", "A".repeat(300))]);
    expect(bytes.slice(0, 10)).toEqual([
      0xc1,
      0x01,
      0x00,
      0x00,
      0x01,
      0x2f,
      0x54,
      0x02,
      0x65,
      0x6e,
    ]);
    expect(bytes.length).toBe(1 + 1 + 4 + 1 + 303);
    expect(bytes[bytes.length - 1]).toBe(0x41);
  });

  it("sets IL and writes the ID only when a Record has one", () => {
    // header = MB | ME | SR | IL | TNF 1 = 0xD9.
    // payload = status 0x02 + "en" + "Hi" = 5 bytes; id = 0x01 0x02.
    const expected = [
      0xd9,
      0x01, // TYPE LENGTH
      0x05, // PAYLOAD LENGTH
      0x02, // ID LENGTH
      0x54, // TYPE "T"
      0x01,
      0x02, // ID
      0x02, // status
      0x65,
      0x6e, // "en"
      0x48,
      0x69, // "Hi"
    ];
    expect(
      encodeNdefMessage([
        { tnf: 0x01, type: [0x54], id: [0x01, 0x02], payload: encodeTextPayload("en", "Hi") },
      ]),
    ).toEqual(expected);
  });

  it("refuses to encode an empty message, which is not a message", () => {
    expect(() => encodeNdefMessage([])).toThrow(NdefError);
  });
});

describe("decoding", () => {
  it("returns the same Records in the same order", () => {
    const records: DraftRecord[] = [
      { kind: "text", fields: { language: "en", text: "Hello" } },
      { kind: "url", fields: { url: "https://example.com/x" } },
      { kind: "text", fields: { language: "pt-BR", text: "Ola, mundo" } },
      { kind: "url", fields: { url: "geo:0,0" } },
    ];
    expect(decodeRecords(encodeRecords(records))).toEqual(records);
  });

  it("preserves a hand-written message byte for byte on the round trip", () => {
    const message = [
      0x91, 0x01, 0x08, 0x54, 0x02, 0x65, 0x6e, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x51, 0x01, 0x0e,
      0x55, 0x04, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x2e, 0x63, 0x6f, 0x6d, 0x2f, 0x78,
    ];
    expect(encodeNdefMessage(decodeNdefMessage(message))).toEqual(message);
  });

  it("reads a four-byte length back out of a long Record", () => {
    const text = "B".repeat(400);
    const decoded = decodeRecords(encodeRecords([{ kind: "text", fields: { language: "en", text } }]));
    expect(decoded).toEqual([{ kind: "text", fields: { language: "en", text } }]);
  });

  it("reads a UTF-8 text payload back to the same string", () => {
    const text = "Café — 12 °C";
    const decoded = decodeRecords(
      encodeRecords([{ kind: "text", fields: { language: "fr", text } }]),
    );
    expect(decoded).toEqual([{ kind: "text", fields: { language: "fr", text } }]);
  });

  it("reports a truncated message instead of returning half of it", () => {
    const message = [0xd1, 0x01, 0x08, 0x54, 0x02, 0x65, 0x6e, 0x48];
    expect(() => decodeNdefMessage(message)).toThrow(NdefError);
  });

  it("refuses a chunked Record rather than guessing at the reassembly", () => {
    // CF set: 0xD1 | 0x20 = 0xF1.
    const message = [0xf1, 0x01, 0x08, 0x54, 0x02, 0x65, 0x6e, 0x48, 0x65, 0x6c, 0x6c, 0x6f];
    expect(() => decodeNdefMessage(message)).toThrow(/chunk/i);
  });

  it("refuses a message whose first Record does not begin the message", () => {
    const message = [0x51, 0x01, 0x08, 0x54, 0x02, 0x65, 0x6e, 0x48, 0x65, 0x6c, 0x6c, 0x6f];
    expect(() => decodeNdefMessage(message)).toThrow(NdefError);
  });

  it("refuses a message that claims to end before its last Record", () => {
    const message = [0xd1, 0x01, 0x08, 0x54, 0x02, 0x65, 0x6e, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x01, 0x01, 0x00, 0x54];
    expect(() => decodeNdefMessage(message)).toThrow(NdefError);
  });

  it("refuses a payload length that runs past the end of the message", () => {
    const message = [0xd1, 0x01, 0xff, 0x54, 0x02, 0x65, 0x6e];
    expect(() => decodeNdefMessage(message)).toThrow(NdefError);
  });

  it("refuses a reserved TNF", () => {
    // TNF 0x07 with MB | ME | SR.
    const message = [0xd7, 0x00, 0x00];
    expect(() => decodeNdefMessage(message)).toThrow(/reserved/i);
  });

  it("refuses a well-known Record that names no type", () => {
    // A well-known Record must carry the type its payload is written against.
    const message = [0xd1, 0x00, 0x00];
    expect(() => decodeNdefMessage(message)).toThrow(NdefError);
  });

  it("encodes a Text Record with no language code as status 0x00", () => {
    expect(encodeTextPayload("", "Hi")).toEqual([0x00, 0x48, 0x69]);
  });
});

describe("encoded size", () => {
  it("counts exactly the bytes the encoder writes for each Record", () => {
    const records: DraftRecord[] = [
      { kind: "text", fields: { language: "en", text: "Hello" } },
      { kind: "url", fields: { url: "https://example.com/x" } },
    ];
    const encoded = encodeRecords(records);
    expect(recordsByteLength(records)).toBe(encoded.length);
    // Header, type length, payload length, type, payload: 1+1+1+1+8 and
    // 1+1+1+1+14.
    expect(recordsByteLength([records[0]!])).toBe(12);
    expect(recordsByteLength([records[1]!])).toBe(18);
    expect(recordsByteLength(records)).toBe(30);
    expect(recordsByteLength([])).toBe(0);
  });

  it("counts the four-byte length form for a long Record", () => {
    const record: DraftRecord = { kind: "text", fields: { language: "en", text: "C".repeat(255) } };
    // payload = 1 + 2 + 255 = 258, so the length is four bytes:
    // 1 header + 1 type length + 4 length + 1 type + 258 payload.
    expect(recordsByteLength([record])).toBe(265);
  });
});
