import { describe, expect, it } from "vitest";
import {
  NdefError,
  decodeNdefMessage,
  decodeRecords,
  encodeNdefMessage,
  encodeRecords,
  encodeTextPayload,
  encodeUrlPayload,
  recordProblem,
  recordSizeBytes,
  recordToNdef,
  recordsByteLength,
  textRecord,
  urlIdentifierCode,
  urlRecord,
} from "./ndef";
import {
  newBluetoothRecord,
  newContactRecord,
  newEmailRecord,
  newExternalRecord,
  newLocationRecord,
  newMimeRecord,
  newPhoneRecord,
  newSmsRecord,
  newWifiRecord,
} from "./drafts";
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
      // A URI no Record type claims stays a URL. `geo:` is claimed by Location,
      // so it is not used here.
      { kind: "url", fields: { url: "urn:example:widget" } },
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

// ---------------------------------------------------------------------------
// Remaining Record types
//
// Each expected array below is written from the wire format, not from this
// encoder. The references used, in addition to NDEF 1.0 and the URI RTD:
//   - Wi-Fi: Wi-Fi Alliance, "Wi-Fi Simple Configuration Technical
//     Specification" v2.0.5, section 10.1.2 (Configuration Token): MIME type
//     "application/vnd.wfa.wsc", one Credential attribute 0x100E wrapping
//     Network Index 0x1026 (1), SSID 0x1045, Authentication Type 0x1003,
//     Encryption Type 0x100F, Network Key 0x1027 and MAC Address 0x1020 (six
//     zero octets here). Attributes are 16-bit type, 16-bit length, value, all
//     big-endian. AOSP's NfcWifiProtectedSetup.java parses exactly this token
//     shape, and ndeflib's WifiSimpleConfigRecord emits it.
//   - Contact: RFC 2426 (vCard 3.0) carried as MIME type "text/vcard", with
//     CRLF between lines and the RFC 2426 backslash escapes.
//   - Bluetooth: NFC Forum "Bluetooth Secure Simple Pairing Using NFC" 1.3,
//     Table 2: MIME type "application/vnd.bluetooth.ep.oob", payload is a
//     2-octet little-endian OOB Data Length that includes the length field and
//     the address (minimum 8), then the 6-octet device address little-endian.
//   - SMS and geo: RFC 5724 (sms: URI) and RFC 5870 (geo: URI), both carried
//     as URI Records (type "U").
// ---------------------------------------------------------------------------

/** UTF-8 of a literal string, for the text bodies whose bytes are ASCII. */
const textBytes = (text: string): number[] => [...new TextEncoder().encode(text)];

describe("a Phone Record", () => {
  it("encodes as a URI Record whose URI is tel: plus the number", () => {
    // "tel:+15550100". The URI RTD table has "tel:" at code 0x05, so the
    // payload is 0x05 then "+15550100" (9 bytes) = 10 bytes.
    const expected = [
      0xd1, // MB, ME, SR, TNF well-known
      0x01, // TYPE LENGTH
      0x0a, // PAYLOAD LENGTH (10)
      0x55, // TYPE "U"
      0x05, // URI identifier code "tel:"
      0x2b, // +
      0x31, // 1
      0x35, // 5
      0x35, // 5
      0x35, // 5
      0x30, // 0
      0x31, // 1
      0x30, // 0
      0x30, // 0
    ];
    expect(encodeRecords([newPhoneRecord("+15550100")])).toEqual(expected);
  });

  it("dials a formatted number the same way, so it writes the same bytes", () => {
    // The visual separators RFC 3966 allows are not part of the dialled number.
    expect(encodeRecords([newPhoneRecord("+1 (555) 010-0")])).toEqual(
      encodeRecords([newPhoneRecord("+15550100")]),
    );
  });

  it("refuses a number that is not a phone number, naming the problem", () => {
    expect(recordProblem(newPhoneRecord(""))).toMatch(/Phone Record/);
    expect(recordProblem(newPhoneRecord("call me"))).toMatch(/Phone Record/);
    // One digit is below the two-digit floor.
    expect(recordProblem(newPhoneRecord("1"))).toMatch(/2 and 15 digits/);
  });

  it("round-trips", () => {
    const record = newPhoneRecord("+15550100");
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });
});

describe("an Email Record", () => {
  it("encodes as a URI Record whose URI is mailto: plus the address", () => {
    // "mailto:someone@example.com": code 0x06 plus 19 address bytes, so the
    // payload is 20 bytes. 0x73 's' through 0x6d 'm' are the ASCII address.
    const expected = [
      0xd1,
      0x01,
      0x14, // PAYLOAD LENGTH (20)
      0x55,
      0x06, // URI identifier code "mailto:"
      0x73, // s
      0x6f, // o
      0x6d, // m
      0x65, // e
      0x6f, // o
      0x6e, // n
      0x65, // e
      0x40, // @
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
    ];
    expect(encodeRecords([newEmailRecord("someone@example.com")])).toEqual(expected);
  });

  it("refuses an address with no @, naming the problem", () => {
    expect(recordProblem(newEmailRecord("someone.example.com"))).toMatch(/Email Record/);
    expect(recordProblem(newEmailRecord("someone.example.com"))).toMatch(/@/);
    expect(recordProblem(newEmailRecord("a b@example.com"))).toMatch(/Email Record/);
  });

  it("round-trips", () => {
    const record = newEmailRecord("someone@example.com");
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });
});

describe("an SMS Record", () => {
  it("encodes as a URI Record whose URI is sms: plus the number and body", () => {
    // "sms:+15550100?body=Hello%20world". No URI RTD prefix matches, so the
    // code is 0x00 and the whole 32-byte URI follows, in a 33-byte payload.
    const expected = [
      0xd1,
      0x01,
      0x21, // PAYLOAD LENGTH (33)
      0x55,
      0x00, // no abbreviation
      0x73, // s
      0x6d, // m
      0x73, // s
      0x3a, // :
      0x2b, // +
      0x31, // 1
      0x35, // 5
      0x35, // 5
      0x35, // 5
      0x30, // 0
      0x31, // 1
      0x30, // 0
      0x30, // 0
      0x3f, // ?
      0x62, // b
      0x6f, // o
      0x64, // d
      0x79, // y
      0x3d, // =
      0x48, // H
      0x65, // e
      0x6c, // l
      0x6c, // l
      0x6f, // o
      0x25, // %
      0x32, // 2
      0x30, // 0
      0x77, // w
      0x6f, // o
      0x72, // r
      0x6c, // l
      0x64, // d
    ];
    expect(encodeRecords([newSmsRecord("+15550100", "Hello world")])).toEqual(expected);
  });

  it("leaves the body out when there is none, and percent-encodes the rest", () => {
    expect(encodeRecords([newSmsRecord("+15550100", "")])).toEqual([
      0xd1, 0x01, 0x0e, 0x55, 0x00,
      ...textBytes("sms:+15550100"),
    ]);
    // "a&b=c" -> "a%26b%3Dc": an ampersand would otherwise end the URI.
    expect(encodeRecords([newSmsRecord("+15550100", "a&b=c")])).toEqual([
      0xd1, 0x01, 0x1d, 0x55, 0x00,
      ...textBytes("sms:+15550100?body=a%26b%3Dc"),
    ]);
  });

  it("round-trips a body with characters the URI has to escape", () => {
    const record = newSmsRecord("+15550100", "Café & bar = 6?");
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });

  it("refuses a number that is not a phone number", () => {
    expect(recordProblem(newSmsRecord("", "Hi"))).toMatch(/Phone Record/);
  });
});

describe("a Location Record", () => {
  it("encodes as a geo: URI Record", () => {
    // "geo:51.5074,-0.1278" is 19 bytes and no URI RTD prefix matches, so the
    // code is 0x00 and the payload is 20 bytes.
    const expected = [
      0xd1,
      0x01,
      0x14, // PAYLOAD LENGTH (20)
      0x55,
      0x00, // no abbreviation
      0x67, // g
      0x65, // e
      0x6f, // o
      0x3a, // :
      0x35, // 5
      0x31, // 1
      0x2e, // .
      0x35, // 5
      0x30, // 0
      0x37, // 7
      0x34, // 4
      0x2c, // ,
      0x2d, // -
      0x30, // 0
      0x2e, // .
      0x31, // 1
      0x32, // 2
      0x37, // 7
      0x38, // 8
    ];
    expect(encodeRecords([newLocationRecord("51.5074", "-0.1278")])).toEqual(expected);
  });

  it("refuses coordinates that are not on Earth, naming the axis", () => {
    expect(recordProblem(newLocationRecord("91", "0"))).toMatch(/latitude/);
    expect(recordProblem(newLocationRecord("0", "181"))).toMatch(/longitude/);
    expect(recordProblem(newLocationRecord("north", "0"))).toMatch(/latitude/);
    expect(recordProblem(newLocationRecord("51,5", "0"))).toMatch(/latitude/);
  });

  it("round-trips", () => {
    const record = newLocationRecord("51.5074", "-0.1278");
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });
});

describe("a Wi-Fi Record", () => {
  // SSID "HomeNet" (7), key "password123" (11), WPA2-Personal (0x0020),
  // AES (0x0008). Inner attributes, each a 16-bit id, 16-bit length, value:
  //   1026 0001 01                                  Network Index     5 bytes
  //   1045 0007 "HomeNet"                           SSID             11 bytes
  //   1003 0002 0020                                Authentication    6 bytes
  //   100F 0002 0008                                Encryption        6 bytes
  //   1027 000B "password123"                       Network Key      15 bytes
  //   1020 0006 000000000000                        MAC, zeroed      10 bytes
  // Inner total 5+11+6+6+15+10 = 53 = 0x35, so the Credential (0x100E) is
  // 4 + 53 = 57 = 0x39 payload bytes. The MIME type name is 23 bytes.
  const expected = [
    0xd2, // MB, ME, SR, TNF media
    0x17, // TYPE LENGTH (23)
    0x39, // PAYLOAD LENGTH (57)
    ...textBytes("application/vnd.wfa.wsc"),
    0x10, 0x0e, 0x00, 0x35, // Credential, length 53
    0x10, 0x26, 0x00, 0x01, 0x01, // Network Index 1
    0x10, 0x45, 0x00, 0x07, 0x48, 0x6f, 0x6d, 0x65, 0x4e, 0x65, 0x74, // SSID
    0x10, 0x03, 0x00, 0x02, 0x00, 0x20, // WPA2-Personal
    0x10, 0x0f, 0x00, 0x02, 0x00, 0x08, // AES
    0x10, 0x27, 0x00, 0x0b,
    0x70, 0x61, 0x73, 0x73, 0x77, 0x6f, 0x72, 0x64, 0x31, 0x32, 0x33, // "password123"
    0x10, 0x20, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // MAC, zeroed
  ];

  it("encodes the WSC Configuration Token a phone reads", () => {
    expect(
      encodeRecords([
        newWifiRecord({
          ssid: "HomeNet",
          networkKey: "password123",
          auth: "wpa2-personal",
          encryption: "aes",
        }),
      ]),
    ).toEqual(expected);
  });

  it("round-trips", () => {
    const record = newWifiRecord({
      ssid: "HomeNet",
      networkKey: "password123",
      auth: "wpa2-personal",
      encryption: "aes",
    });
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });

  it("refuses a Record with no SSID, naming it", () => {
    expect(
      recordProblem(
        newWifiRecord({ ssid: "", networkKey: "password123", auth: "wpa2-personal", encryption: "aes" }),
      ),
    ).toMatch(/SSID/);
  });

  it("refuses an SSID longer than 32 bytes", () => {
    expect(
      recordProblem(
        newWifiRecord({
          ssid: "s".repeat(33),
          networkKey: "password123",
          auth: "wpa2-personal",
          encryption: "aes",
        }),
      ),
    ).toMatch(/32/);
  });

  it("refuses a WPA key that is not 8 to 63 bytes", () => {
    for (const key of ["", "short", "k".repeat(64)]) {
      expect(
        recordProblem(
          newWifiRecord({ ssid: "HomeNet", networkKey: key, auth: "wpa2-personal", encryption: "aes" }),
        ),
      ).toMatch(/8 and 63|8 to 63/);
    }
  });

  it("refuses contradictory security settings instead of writing a bad token", () => {
    // An open network has no key and no encryption.
    expect(
      recordProblem(
        newWifiRecord({ ssid: "Cafe", networkKey: "password123", auth: "open", encryption: "none" }),
      ),
    ).toMatch(/open.*key|key.*open/i);
    expect(
      recordProblem(newWifiRecord({ ssid: "Cafe", networkKey: "", auth: "open", encryption: "aes" })),
    ).toMatch(/open.*encryption|encryption.*open/i);
    // A WPA network without encryption is not a network a phone can join.
    expect(
      recordProblem(
        newWifiRecord({ ssid: "HomeNet", networkKey: "password123", auth: "wpa2-personal", encryption: "none" }),
      ),
    ).toMatch(/encryption/);
  });
});

describe("a Contact Record", () => {
  const fields = {
    name: "Ada Lovelace",
    organization: "Analytical Engines",
    phone: "+15550100",
    email: "ada@example.com",
  };
  // vCard 3.0 with CRLF line endings, 146 bytes:
  //   BEGIN:VCARD\r\n                       13
  //   VERSION:3.0\r\n                       13
  //   N:Ada Lovelace;;;;\r\n                20
  //   FN:Ada Lovelace\r\n                   17
  //   ORG:Analytical Engines\r\n            24
  //   TEL;TYPE=CELL:+15550100\r\n           25
  //   EMAIL:ada@example.com\r\n             23
  //   END:VCARD\r\n                         11
  const body =
    "BEGIN:VCARD\r\n" +
    "VERSION:3.0\r\n" +
    "N:Ada Lovelace;;;;\r\n" +
    "FN:Ada Lovelace\r\n" +
    "ORG:Analytical Engines\r\n" +
    "TEL;TYPE=CELL:+15550100\r\n" +
    "EMAIL:ada@example.com\r\n" +
    "END:VCARD\r\n";

  it("encodes a vCard 3.0 body as text/vcard", () => {
    expect(body.length).toBe(146);
    expect(encodeRecords([newContactRecord(fields)])).toEqual([
      0xd2,
      0x0a, // TYPE LENGTH (10)
      0x92, // PAYLOAD LENGTH (146)
      ...textBytes("text/vcard"),
      ...textBytes(body),
    ]);
  });

  it("escapes the characters RFC 2426 reserves", () => {
    const record = newContactRecord({
      name: "Doe, Jane; Jr.",
      organization: "ACME\\Inc",
      phone: "+15550100",
      email: "jane@example.com",
    });
    const text = String.fromCharCode(...encodeRecords([record]).slice(13));
    expect(text).toContain("N:Doe\\, Jane\\; Jr.;;;;");
    expect(text).toContain("ORG:ACME\\\\Inc");
  });

  it("round-trips a name and organisation that need escaping", () => {
    const record = newContactRecord({
      name: "Doe, Jane; Jr.",
      organization: "ACME\\Inc",
      phone: "+15550100",
      email: "jane@example.com",
    });
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });

  it("refuses a Contact with no name, and a bad email in the card", () => {
    expect(recordProblem(newContactRecord({ ...fields, name: "" }))).toMatch(/Contact Record.*name/i);
    expect(recordProblem(newContactRecord({ ...fields, email: "no-at-sign" }))).toMatch(/Email Record/);
  });

  it("round-trips with the optional fields left empty", () => {
    const record = newContactRecord({ name: "Ada Lovelace" });
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });
});

describe("a Bluetooth Record", () => {
  it("encodes the little-endian OOB block", () => {
    // AA:BB:CC:DD:EE:FF is sent least significant octet first: FF EE DD CC BB
    // AA. OOB Data Length is 8 and little-endian (08 00), and includes the
    // length field itself plus the address, per BTSSP Table 2. The type name
    // "application/vnd.bluetooth.ep.oob" is 32 bytes.
    const expected = [
      0xd2,
      0x20, // TYPE LENGTH (32)
      0x08, // PAYLOAD LENGTH (8)
      ...textBytes("application/vnd.bluetooth.ep.oob"),
      0x08, 0x00, // OOB Data Length, little-endian
      0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, // address, reversed
    ];
    expect(encodeRecords([newBluetoothRecord("AA:BB:CC:DD:EE:FF")])).toEqual(expected);
  });

  it("accepts a lower-case, hyphen-separated address and writes the same bytes", () => {
    expect(encodeRecords([newBluetoothRecord("aa-bb-cc-dd-ee-ff")])).toEqual(
      encodeRecords([newBluetoothRecord("AA:BB:CC:DD:EE:FF")]),
    );
  });

  it("refuses anything that is not six octets, or is the zero address", () => {
    expect(recordProblem(newBluetoothRecord("AA:BB:CC"))).toMatch(/Bluetooth Record/);
    expect(recordProblem(newBluetoothRecord("GG:BB:CC:DD:EE:FF"))).toMatch(/Bluetooth Record/);
    expect(recordProblem(newBluetoothRecord("00:00:00:00:00:00"))).toMatch(/zero address/);
  });

  it("round-trips", () => {
    const record = newBluetoothRecord("AA:BB:CC:DD:EE:FF");
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });
});

describe("a generic MIME Record", () => {
  it("encodes the media type as the type and the payload as bytes", () => {
    // "text/plain" is 10 bytes; 48 65 6C 6C 6F is "Hello".
    expect(encodeRecords([newMimeRecord("text/plain", "48656C6C6F")])).toEqual([
      0xd2,
      0x0a, // TYPE LENGTH (10)
      0x05, // PAYLOAD LENGTH (5)
      ...textBytes("text/plain"),
      0x48, 0x65, 0x6c, 0x6c, 0x6f,
    ]);
  });

  it("round-trips a payload that is not text", () => {
    const record = newMimeRecord("application/octet-stream", "00FF7F");
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });

  it("refuses a type with no subtype, or a payload that is not hex", () => {
    expect(recordProblem(newMimeRecord("text", ""))).toMatch(/MIME Record/);
    expect(recordProblem(newMimeRecord("text/plain", "0"))).toMatch(/hex/);
    expect(recordProblem(newMimeRecord("text/plain", "zz"))).toMatch(/hex/);
  });
});

describe("an External Record", () => {
  it("encodes TNF external with domain:service and the payload bytes", () => {
    // "example.com:do" is 14 bytes; payload 01 02 FF.
    expect(encodeRecords([newExternalRecord("example.com:do", "0102FF")])).toEqual([
      0xd4, // MB, ME, SR, TNF external
      0x0e, // TYPE LENGTH (14)
      0x03, // PAYLOAD LENGTH (3)
      ...textBytes("example.com:do"),
      0x01, 0x02, 0xff,
    ]);
  });

  it("refuses a type that is not domain:service, naming the problem", () => {
    expect(recordProblem(newExternalRecord("example.com", ""))).toMatch(/External Record/);
    expect(recordProblem(newExternalRecord("Example.com:do", ""))).toMatch(/External Record/);
    expect(recordProblem(newExternalRecord("example.com:", ""))).toMatch(/External Record/);
  });

  it("round-trips", () => {
    const record = newExternalRecord("example.com:do", "0102FF");
    expect(decodeRecords(encodeRecords([record]))).toEqual([record]);
  });
});

describe("reading the remaining types back", () => {
  it("reads a tel: URI Record as a Phone Record", () => {
    const message = [
      0xd1, 0x01, 0x0a, 0x55, 0x05,
      0x2b, 0x31, 0x35, 0x35, 0x35, 0x30, 0x31, 0x30, 0x30,
    ];
    expect(decodeRecords(message)).toEqual([newPhoneRecord("+15550100")]);
  });

  it("reads a mailto: URI Record as an Email Record", () => {
    const message = [
      0xd1, 0x01, 0x14, 0x55, 0x06,
      ...textBytes("someone@example.com"),
    ];
    expect(decodeRecords(message)).toEqual([newEmailRecord("someone@example.com")]);
  });

  it("reads an sms: URI Record as an SMS Record, body decoded", () => {
    const message = [
      0xd1, 0x01, 0x21, 0x55, 0x00,
      ...textBytes("sms:+15550100?body=Hello%20world"),
    ];
    expect(decodeRecords(message)).toEqual([newSmsRecord("+15550100", "Hello world")]);
  });

  it("reads a geo: URI Record as a Location Record", () => {
    const message = [
      0xd1, 0x01, 0x14, 0x55, 0x00,
      ...textBytes("geo:51.5074,-0.1278"),
    ];
    expect(decodeRecords(message)).toEqual([newLocationRecord("51.5074", "-0.1278")]);
  });

  it("leaves an SMS URI with an extra parameter as a URL, not as a mangled message", () => {
    // "sms:+15550100?body=Hi&x=1" is 25 bytes; no abbreviation, payload 26.
    const message = [
      0xd1, 0x01, 0x1a, 0x55, 0x00,
      ...textBytes("sms:+15550100?body=Hi&x=1"),
    ];
    expect(decodeRecords(message)).toEqual([
      { kind: "url", fields: { url: "sms:+15550100?body=Hi&x=1" } },
    ]);
  });

  it("leaves a URI with no matching form as a URL Record", () => {
    // "ftp://example.com": code 0x0D, 11 bytes left, payload 12.
    const message = [0xd1, 0x01, 0x0c, 0x55, 0x0d, ...textBytes("example.com")];
    expect(decodeRecords(message)).toEqual([{ kind: "url", fields: { url: "ftp://example.com" } }]);
  });

  it("reads an unknown MIME type as a generic MIME Record with hex bytes", () => {
    const message = [
      0xd2, 0x0a, 0x03, ...textBytes("text/plain"), 0x01, 0x02, 0xff,
    ];
    expect(decodeRecords(message)).toEqual([newMimeRecord("text/plain", "0102FF")]);
  });

  it("refuses a Wi-Fi Record whose token has no Credential", () => {
    const message = encodeNdefMessage([
      {
        tnf: 0x02,
        type: textBytes("application/vnd.wfa.wsc"),
        payload: [0x10, 0x26, 0x00, 0x01, 0x01],
      },
    ]);
    expect(() => decodeRecords(message)).toThrow(/Credential/i);
  });
});

describe("encoded size across the record set", () => {
  const everyKind: DraftRecord[] = [
    { kind: "text", fields: { language: "en", text: "Hello" } },
    { kind: "url", fields: { url: "https://example.com/x" } },
    newPhoneRecord("+15550100"),
    newEmailRecord("someone@example.com"),
    newSmsRecord("+15550100", "Hello world"),
    newLocationRecord("51.5074", "-0.1278"),
    newWifiRecord({
      ssid: "HomeNet",
      networkKey: "password123",
      auth: "wpa2-personal",
      encryption: "aes",
    }),
    newContactRecord({
      name: "Ada Lovelace",
      organization: "Analytical Engines",
      phone: "+15550100",
      email: "ada@example.com",
    }),
    newBluetoothRecord("AA:BB:CC:DD:EE:FF"),
    newMimeRecord("text/plain", "48656C6C6F"),
    newExternalRecord("example.com:do", "0102FF"),
  ];

  it("counts exactly the bytes each Record writes", () => {
    for (const record of everyKind) {
      expect(recordSizeBytes(record), record.kind).toBe(encodeRecords([record]).length);
    }
  });

  it("sums to the message length for a mixed Draft", () => {
    const total = everyKind.reduce((sum, record) => sum + recordSizeBytes(record), 0);
    expect(recordsByteLength(everyKind)).toBe(total);
    expect(total).toBe(encodeRecords(everyKind).length);
  });
});

/**
 * A Tag's own message, on its way into a Draft.
 *
 * Ticket 16's transfer is this codec and nothing else: the Records a read
 * obtained are handed to a Draft unchanged, and the Draft's own encoder is what
 * a later write sends back to a Tag. A Record that loses its kind, one of its
 * fields, or its place among the others is the failure this exists to catch, so
 * the expected value is written out in full and compared against what the codec
 * produced — never against the codec's own idea of what it just did.
 *
 * `recordToNdef` is what a read's Records encode through on the way out, and
 * `decodeRecords` is what they decode through on the way in, so this is the same
 * pair the readout and the Draft both use.
 */
describe("a message carried from a Tag into a Draft", () => {
  /** One of every kind this build authors, in an order that is not its own. */
  const ON_THE_TAG: DraftRecord[] = [
    { kind: "url", fields: { url: "https://devgo.studio/tap" } },
    { kind: "text", fields: { language: "fr", text: "Bonjour, monde" } },
    newPhoneRecord("+15550100"),
    newEmailRecord("front.desk@example.com"),
    newSmsRecord("+15550100", "Bay 3 is open"),
    newLocationRecord("51.5074", "-0.1278"),
    newContactRecord({
      name: "Ada Lovelace",
      organization: "Analytical Engines",
      phone: "+15550100",
      email: "ada@example.com",
    }),
    newWifiRecord({
      ssid: "Front desk",
      networkKey: "password123",
      auth: "wpa2-personal",
      encryption: "aes",
    }),
    newBluetoothRecord("AA:BB:CC:DD:EE:FF"),
    newMimeRecord("text/plain", "48656C6C6F"),
    newExternalRecord("devgo.studio:door", "0102FF"),
  ];

  it("keeps every Record's kind, fields and order exactly", () => {
    const onTheWire = encodeNdefMessage(ON_THE_TAG.map(recordToNdef));

    // The message the Tag holds, read into the Records a Draft would keep.
    expect(decodeRecords(onTheWire)).toEqual(ON_THE_TAG);
  });

  it("encodes back to a message the Tag would accept, and reads the same again", () => {
    const onTheWire = encodeNdefMessage(ON_THE_TAG.map(recordToNdef));
    const drafted = decodeRecords(onTheWire);

    // What the Draft's encoder sends is byte for byte the message that came off
    // the Tag, so a write of the Draft is what the source Tag already accepted.
    expect(encodeRecords(drafted)).toEqual(onTheWire);
    expect(decodeRecords(encodeRecords(drafted))).toEqual(ON_THE_TAG);
  });
});
