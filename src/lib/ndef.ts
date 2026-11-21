/**
 * NDEF codec — seam S7.
 *
 * Encoding and decoding for the Record types a Draft can hold today: Text and
 * URL, both written as well-known Records ("T" and "U"). The wire format is the
 * NFC Forum NDEF 1.0 record layout, and the payloads follow the Text and URI
 * Record Type Definitions.
 *
 * Why this lives in TypeScript rather than Rust:
 *   - The Draft editor is in the webview and needs each Record's encoded size
 *     *while the user is typing*. A codec on the other side of the Tauri
 *     boundary would make every keystroke an async round trip, and the size
 *     display (ticket 08) would lag the text.
 *   - It matches where the other pure seams of this app already live:
 *     `cardType.ts`, `hfDecoder.ts` and `readerIdentity.ts` are all webview-side
 *     pure functions with a vitest suite. The Rust side owns the seams that must
 *     exist before the UI does — frames, the write guard, the identity codec.
 *   - Writing a Draft to a Tag (a later, gated ticket) can hand the encoded
 *     bytes across as a hex payload, which is how `send_cmd` already passes
 *     opaque bytes to the Reader. Nothing in Rust needs to understand NDEF for
 *     that to work.
 *
 * Correctness notes, because a wrong message is silently accepted by a tag and
 * by every phone that reads it:
 *   - MB is set on the first Record only, ME on the last only.
 *   - SR is set when the payload fits in one length byte (255 or fewer), and
 *     the length is then one byte; otherwise it is four bytes big-endian.
 *   - IL is set only when a Record carries an ID, and the ID length is one byte.
 *   - A Text payload is status (language-code length in the low six bits, UTF-16
 *     flag clear for UTF-8), then the language code, then the text.
 *   - A URL payload is one URI identifier code, then the part of the URI the
 *     code does not already give. The code with the fewest resulting bytes wins,
 *     so the same URI always encodes to the same bytes; 0x00 (full literal) is
 *     the fallback.
 *
 * There is no chunking here. Encoding never emits it and decoding refuses it,
 * rather than returning a message that is only half reassembled.
 */

import type { DraftRecord } from "./drafts";

/** A malformed message, or a Record this codec cannot represent. */
export class NdefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NdefError";
  }
}

/** Type Name Format values (NDEF 1.0, section 3.2.6). */
export const TNF_EMPTY = 0x00;
export const TNF_WELL_KNOWN = 0x01;
export const TNF_MIME_MEDIA = 0x02;
export const TNF_ABSOLUTE_URI = 0x03;
export const TNF_EXTERNAL_TYPE = 0x04;
export const TNF_UNKNOWN = 0x05;
export const TNF_UNCHANGED = 0x06;

const FLAG_MB = 0x80;
const FLAG_ME = 0x40;
const FLAG_CF = 0x20;
const FLAG_SR = 0x10;
const FLAG_IL = 0x08;
const TNF_MASK = 0x07;

/** The largest payload a one-byte length can carry. */
export const MAX_SHORT_PAYLOAD = 0xff;

/** The Record Type Definition type for a Text Record: "T". */
const TEXT_TYPE = 0x54;
/** The Record Type Definition type for a URI Record: "U". */
const URL_TYPE = 0x55;

/**
 * The URI identifier codes of the URI RTD, table 3, in code order. Code 0x00 is
 * "no abbreviation": the payload then carries the whole URI.
 */
const URL_PREFIXES: readonly string[] = [
  "",
  "http://www.",
  "https://www.",
  "http://",
  "https://",
  "tel:",
  "mailto:",
  "ftp://anonymous:anonymous@",
  "ftp://ftp.",
  "ftps://",
  "sftp://",
  "smb://",
  "nfs://",
  "ftp://",
  "dav://",
  "news:",
  "telnet://",
  "imap:",
  "rtsp://",
  "urn:",
  "pop:",
  "sip:",
  "sips:",
  "tftp:",
  "btspp://",
  "btl2cap://",
  "btgoep://",
  "tcpobex://",
  "irdaobex://",
  "file://",
  "urn:epc:id:",
  "urn:epc:tag:",
  "urn:epc:pat:",
  "urn:epc:raw:",
  "urn:epc:",
  "urn:nfc:",
];

/** One NDEF Record at the wire level, before any Record type is applied. */
export interface NdefRecord {
  tnf: number;
  type: number[];
  /** Absent, or empty, both mean "this Record carries no ID". */
  id?: number[];
  payload: number[];
}

/** The URI identifier code that carries this URI in the fewest bytes. */
export function urlIdentifierCode(url: string): number {
  let best = 0;
  let bestLength = 1 + utf8Length(url);
  for (let code = 1; code < URL_PREFIXES.length; code += 1) {
    const prefix = URL_PREFIXES[code]!;
    if (!url.startsWith(prefix)) continue;
    // One code byte plus whatever the code does not already give.
    const length = 1 + utf8Length(url.slice(prefix.length));
    // Strictly shorter only: on a tie the lowest code wins, so the same URI
    // always produces the same bytes.
    if (length < bestLength) {
      best = code;
      bestLength = length;
    }
  }
  return best;
}

/** A Text Record payload: status, language code, text. */
export function encodeTextPayload(language: string, text: string): number[] {
  const languageBytes = utf8(language);
  if (languageBytes.length > 0x3f) {
    throw new NdefError(
      `a Record's language code cannot exceed 63 bytes; got ${languageBytes.length}`,
    );
  }
  // Bit 7 clear means the text is UTF-8. The top two bits are reserved and zero.
  const status = languageBytes.length;
  return [status, ...languageBytes, ...utf8(text)];
}

/** The language code and text a Text Record payload carries. */
export function decodeTextPayload(payload: readonly number[]): {
  language: string;
  text: string;
} {
  if (payload.length < 1) throw new NdefError("a Text Record carries no status byte");
  const status = payload[0]!;
  if ((status & 0x80) !== 0) {
    throw new NdefError("a UTF-16 Text Record is not supported");
  }
  const languageLength = status & 0x3f;
  if (payload.length < 1 + languageLength) {
    throw new NdefError("a Text Record's language code runs past its payload");
  }
  return {
    language: utf8Decode(payload.slice(1, 1 + languageLength)),
    text: utf8Decode(payload.slice(1 + languageLength)),
  };
}

/** A URL Record payload: URI identifier code, then the rest of the URI. */
export function encodeUrlPayload(url: string): number[] {
  const code = urlIdentifierCode(url);
  const rest = url.slice(URL_PREFIXES[code]!.length);
  return [code, ...utf8(rest)];
}

/** The URI a URL Record payload carries, with its abbreviation restored. */
export function decodeUrlPayload(payload: readonly number[]): string {
  if (payload.length < 1) throw new NdefError("a URL Record carries no identifier code");
  const code = payload[0]!;
  const prefix = URL_PREFIXES[code];
  if (prefix === undefined) {
    throw new NdefError(`a URL Record carries unknown URI identifier code 0x${hex2(code)}`);
  }
  return prefix + utf8Decode(payload.slice(1));
}

/** A well-known Text Record. */
export function textRecord(language: string, text: string): NdefRecord {
  return { tnf: TNF_WELL_KNOWN, type: [TEXT_TYPE], payload: encodeTextPayload(language, text) };
}

/** A well-known URL Record. */
export function urlRecord(url: string): NdefRecord {
  return { tnf: TNF_WELL_KNOWN, type: [URL_TYPE], payload: encodeUrlPayload(url) };
}

/** Encode a sequence of Records as one complete NDEF message. */
export function encodeNdefMessage(records: readonly NdefRecord[]): number[] {
  if (records.length === 0) {
    throw new NdefError("an NDEF message holds at least one Record");
  }
  const bytes: number[] = [];
  records.forEach((record, index) => {
    const id = record.id ?? [];
    if (record.type.length > 0xff) {
      throw new NdefError(`a Record's type cannot exceed 255 bytes; got ${record.type.length}`);
    }
    if (id.length > 0xff) {
      throw new NdefError(`a Record's ID cannot exceed 255 bytes; got ${id.length}`);
    }
    const short = record.payload.length <= MAX_SHORT_PAYLOAD;
    let header = record.tnf & TNF_MASK;
    if (index === 0) header |= FLAG_MB;
    if (index === records.length - 1) header |= FLAG_ME;
    if (short) header |= FLAG_SR;
    if (id.length > 0) header |= FLAG_IL;

    bytes.push(header, record.type.length);
    if (short) {
      bytes.push(record.payload.length);
    } else {
      bytes.push(
        (record.payload.length >>> 24) & 0xff,
        (record.payload.length >>> 16) & 0xff,
        (record.payload.length >>> 8) & 0xff,
        record.payload.length & 0xff,
      );
    }
    if (id.length > 0) bytes.push(id.length);
    bytes.push(...checkBytes(record.type, "type"), ...checkBytes(id, "ID"), ...checkBytes(record.payload, "payload"));
  });
  return bytes;
}

/**
 * Decode one NDEF message into its Records, in order. Anything malformed is
 * reported rather than partly decoded: half a message presented as a message is
 * the failure mode that erases a Tag with confidence.
 */
export function decodeNdefMessage(bytes: readonly number[]): NdefRecord[] {
  if (bytes.length === 0) throw new NdefError("no bytes, so no NDEF message");
  const records: NdefRecord[] = [];
  let at = 0;
  for (;;) {
    if (at >= bytes.length) {
      throw new NdefError("the message ends before its last Record is complete");
    }
    const header = bytes[at]!;
    at += 1;
    const mb = (header & FLAG_MB) !== 0;
    const me = (header & FLAG_ME) !== 0;
    const cf = (header & FLAG_CF) !== 0;
    const short = (header & FLAG_SR) !== 0;
    const il = (header & FLAG_IL) !== 0;
    const tnf = header & TNF_MASK;

    if (cf) {
      throw new NdefError("the message contains a chunked Record, which is not supported");
    }
    if (records.length === 0 && !mb) {
      throw new NdefError("the first Record does not begin the message (MB is clear)");
    }
    if (records.length > 0 && mb) {
      throw new NdefError("a Record inside the message begins a new message (MB is set)");
    }
    if (tnf === TNF_UNCHANGED) {
      throw new NdefError("the message contains a TNF_UNCHANGED Record outside a chunk");
    }

    const typeLength = readByte(bytes, at, "type length");
    at += 1;
    let payloadLength: number;
    if (short) {
      payloadLength = readByte(bytes, at, "payload length");
      at += 1;
    } else {
      if (at + 4 > bytes.length) throw new NdefError("the payload length is cut short");
      payloadLength =
        bytes[at]! * 0x100_0000 + bytes[at + 1]! * 0x1_0000 + bytes[at + 2]! * 0x100 + bytes[at + 3]!;
      at += 4;
    }
    const idLength = il ? readByte(bytes, at, "ID length") : 0;
    if (il) at += 1;

    checkShortForm(tnf, typeLength);

    const type = take(bytes, at, typeLength, "type");
    at += typeLength;
    const id = take(bytes, at, idLength, "ID");
    at += idLength;
    const payload = take(bytes, at, payloadLength, "payload");
    at += payloadLength;

    records.push({ tnf, type, id, payload });

    if (me) {
      if (at !== bytes.length) {
        throw new NdefError(
          `the message claims to end ${bytes.length - at} bytes before the data does`,
        );
      }
      return records;
    }
  }
}

/**
 * How many bytes this Record occupies in an encoded message: header, the type
 * length, the payload length (one or four bytes), the ID length when present,
 * then type, ID and payload.
 */
export function recordByteLength(record: NdefRecord): number {
  const idLength = (record.id ?? []).length;
  const short = record.payload.length <= MAX_SHORT_PAYLOAD;
  return (
    1 + // header
    1 + // TYPE LENGTH
    (short ? 1 : 4) + // PAYLOAD LENGTH
    (idLength > 0 ? 1 : 0) + // ID LENGTH
    record.type.length +
    idLength +
    record.payload.length
  );
}

/** This Draft Record as the NDEF Record it encodes to. */
export function recordToNdef(record: DraftRecord): NdefRecord {
  switch (record.kind) {
    case "text":
      return textRecord(record.fields.language, record.fields.text);
    case "url":
      return urlRecord(record.fields.url);
    default: {
      // A Draft written by a newer build may hold a kind this one cannot encode.
      const kind = (record as { kind?: string }).kind ?? "unknown";
      throw new NdefError(`this build cannot encode a ${kind} Record`);
    }
  }
}

/** The Draft Record an NDEF Record represents. */
export function ndefToRecord(record: NdefRecord): DraftRecord {
  if (record.tnf === TNF_WELL_KNOWN && record.type.length === 1) {
    if (record.type[0] === TEXT_TYPE) {
      const { language, text } = decodeTextPayload(record.payload);
      return { kind: "text", fields: { language, text } };
    }
    if (record.type[0] === URL_TYPE) {
      return { kind: "url", fields: { url: decodeUrlPayload(record.payload) } };
    }
  }
  throw new NdefError(
    `this build cannot read a Record with TNF 0x${hex2(record.tnf)} and type "${ascii(record.type)}"`,
  );
}

/** Encode a Draft's Records as one complete NDEF message. */
export function encodeRecords(records: readonly DraftRecord[]): number[] {
  return encodeNdefMessage(records.map(recordToNdef));
}

/** Decode one NDEF message back into the Draft Records it holds. */
export function decodeRecords(bytes: readonly number[]): DraftRecord[] {
  return decodeNdefMessage(bytes).map(ndefToRecord);
}

/** The encoded size of one Draft Record. */
export function recordSizeBytes(record: DraftRecord): number {
  return recordByteLength(recordToNdef(record));
}

/** The encoded size of every Record in a Draft, headers included. */
export function recordsByteLength(records: readonly DraftRecord[]): number {
  return records.reduce((total, record) => total + recordSizeBytes(record), 0);
}

// ---------------------------------------------------------------------------
// helpers

/**
 * The NFC Forum rules that tie a TNF to its TYPE LENGTH. A well-known, MIME,
 * absolute-URI or external Record names its type; an empty or unknown Record
 * carries none. Getting this wrong produces a message that looks fine and is
 * ignored on the tag.
 */
function checkShortForm(tnf: number, typeLength: number): void {
  switch (tnf) {
    case TNF_EMPTY:
    case TNF_UNKNOWN:
      if (typeLength !== 0) {
        throw new NdefError(`a Record with TNF 0x${hex2(tnf)} carries no type, but names one`);
      }
      return;
    case TNF_WELL_KNOWN:
    case TNF_MIME_MEDIA:
    case TNF_ABSOLUTE_URI:
    case TNF_EXTERNAL_TYPE:
      if (typeLength === 0) {
        throw new NdefError(`a Record with TNF 0x${hex2(tnf)} must name its type`);
      }
      return;
    default:
      throw new NdefError(`TNF 0x${hex2(tnf)} is reserved and cannot appear in a message`);
  }
}

function readByte(bytes: readonly number[], at: number, what: string): number {
  const byte = bytes[at];
  if (byte === undefined) throw new NdefError(`the ${what} is missing`);
  return byte & 0xff;
}

function take(bytes: readonly number[], at: number, length: number, what: string): number[] {
  if (at + length > bytes.length) {
    throw new NdefError(`the ${what} runs past the end of the message`);
  }
  return bytes.slice(at, at + length);
}

function checkBytes(bytes: readonly number[], what: string): number[] {
  for (const byte of bytes) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
      throw new NdefError(`the ${what} contains ${byte}, which is not a byte`);
    }
  }
  return [...bytes];
}

function utf8(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function utf8Decode(bytes: readonly number[]): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}

function ascii(bytes: readonly number[]): string {
  return bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${hex2(b)}`)).join("");
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0").toUpperCase();
}
