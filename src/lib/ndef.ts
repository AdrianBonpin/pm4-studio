/**
 * NDEF codec — seam S7.
 *
 * Encoding and decoding for the Record types a Draft can hold. Text and URL are
 * written as well-known Records ("T" and "U"); Phone, Email, SMS and Location
 * are URI Records under their own schemes; Contact, Wi-Fi and Bluetooth are
 * MIME Records under the media types the platform reads; MIME and External are
 * the escape hatch for anything else. The wire format is the NFC Forum NDEF 1.0
 * record layout, and each payload follows the Record Type or media type named
 * on it.
 *
 * Why this lives in TypeScript rather than Rust:
 *   - The Draft editor is in the webview and needs each Record's encoded size
 *     *while the user is typing*. A codec on the other side of the Tauri
 *     boundary would make every keystroke an async round trip, and the size
 *     display would lag the text.
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
 *   - A Wi-Fi Record is a WSC Configuration Token: one Credential attribute
 *     (0x100E) wrapping Network Index, SSID, authentication, encryption, the
 *     network key and a zeroed MAC address, each attribute a 16-bit type, a
 *     16-bit length and its value, all big-endian.
 *   - A Bluetooth Record's payload is the BR/EDR OOB block: a two-octet
 *     little-endian length that includes the length field itself and the
 *     address (8), then the six address octets least significant first.
 *   - A Contact Record is a vCard 3.0 body with CRLF line endings and the RFC
 *     2426 backslash escapes.
 *
 * URI-shaped Record types are URI Records on the wire, because NDEF has no
 * Phone or Email type. Decoding therefore maps a URI back to the specific form
 * by scheme only when the rest of the URI fits that form exactly; anything else
 * stays a URL Record, so reading a tag never mangles an unrepresented URI.
 *
 * There is no chunking here. Encoding never emits it and decoding refuses it,
 * rather than returning a message that is only half reassembled.
 */

import type {
  BluetoothRecordFields,
  ContactRecordFields,
  DraftRecord,
  LocationRecordFields,
  SmsRecordFields,
  WifiAuth,
  WifiEncryption,
  WifiRecordFields,
} from "./drafts";

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

/** The schemes that carry the Phone, Email, SMS and Location forms. */
const PHONE_SCHEME = "tel:";
const EMAIL_SCHEME = "mailto:";
const SMS_SCHEME = "sms:";
const LOCATION_SCHEME = "geo:";

/** The media types the platform reads as a Contact, Wi-Fi or Bluetooth Record. */
const MIME_WIFI = "application/vnd.wfa.wsc";
const MIME_VCARD = "text/vcard";
const MIME_BLUETOOTH = "application/vnd.bluetooth.ep.oob";

/** Wi-Fi Simple Configuration attribute ids, NFC Configuration Token form. */
const WSC_CREDENTIAL = 0x100e;
const WSC_NETWORK_INDEX = 0x1026;
const WSC_SSID = 0x1045;
const WSC_AUTH_TYPE = 0x1003;
const WSC_ENCRYPTION_TYPE = 0x100f;
const WSC_NETWORK_KEY = 0x1027;
const WSC_MAC_ADDRESS = 0x1020;

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

// ---------------------------------------------------------------------------
// Phone, Email, SMS and Location
//
// These are URI Records on the wire. Each form canonicalises what it carries so
// the same value always produces the same URI, and refuses what it cannot
// represent rather than writing a plausible-looking URI that a phone will not
// dial.
// ---------------------------------------------------------------------------

/**
 * The digits of a phone number, with the visual separators a human types
 * removed. RFC 3966 allows separators in a `tel:` URI but does not make them
 * part of the number, so removing them keeps one number to one byte string.
 */
export function canonicalPhoneNumber(number: string): string {
  const trimmed = number.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) {
    throw new NdefError(
      "A Phone Record needs a telephone number: digits, optionally starting with +, with spaces, dots, dashes or brackets.",
    );
  }
  const digits = trimmed.replace(/[\s().-]/g, "");
  if (!/^\+?\d{2,15}$/.test(digits)) {
    throw new NdefError(
      `A Phone Record's number needs between 2 and 15 digits; this one has ${digits.replace("+", "").length}.`,
    );
  }
  return digits;
}

/**
 * An email address as `mailto:` can carry it. `?` and `#` are refused because
 * they begin other URI components, and a space would need escaping.
 */
export function canonicalEmailAddress(address: string): string {
  const trimmed = address.trim();
  if (!/^[^\s@?#]+@[^\s@?#]+\.[^\s@?#]+$/.test(trimmed)) {
    throw new NdefError(
      "An Email Record needs an address of the form name@example.com, with no spaces, ? or #.",
    );
  }
  return trimmed;
}

/** One coordinate of a Location Record, trimmed and range-checked. */
function canonicalCoordinate(
  value: string,
  limit: number,
  axis: "latitude" | "longitude",
): string {
  const trimmed = value.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    throw new NdefError(
      `A Location Record needs a ${axis} as a decimal number, such as 51.5074.`,
    );
  }
  const parsed = Number(trimmed);
  if (parsed < -limit || parsed > limit) {
    throw new NdefError(`A Location Record's ${axis} must be between -${limit} and ${limit}.`);
  }
  return trimmed;
}

/** A Phone Record: a URI Record whose URI is `tel:` plus the number. */
export function phoneRecord(number: string): NdefRecord {
  return urlRecord(`${PHONE_SCHEME}${canonicalPhoneNumber(number)}`);
}

/** An Email Record: a URI Record whose URI is `mailto:` plus the address. */
export function emailRecord(address: string): NdefRecord {
  return urlRecord(`${EMAIL_SCHEME}${canonicalEmailAddress(address)}`);
}

/** An SMS Record: a URI Record whose URI is `sms:`, with an optional body. */
export function smsRecord(number: string, message: string): NdefRecord {
  const canonical = canonicalPhoneNumber(number);
  if (message.length === 0) return urlRecord(`${SMS_SCHEME}${canonical}`);
  let body: string;
  try {
    body = encodeURIComponent(message);
  } catch {
    throw new NdefError("An SMS Record's message cannot be encoded as a URI.");
  }
  return urlRecord(`${SMS_SCHEME}${canonical}?body=${body}`);
}

/** A Location Record: a URI Record whose URI is a `geo:` latitude,longitude. */
export function locationRecord(latitude: string, longitude: string): NdefRecord {
  const lat = canonicalCoordinate(latitude, 90, "latitude");
  const lon = canonicalCoordinate(longitude, 180, "longitude");
  return urlRecord(`${LOCATION_SCHEME}${lat},${lon}`);
}

// ---------------------------------------------------------------------------
// Wi-Fi
// ---------------------------------------------------------------------------

const WIFI_AUTH_CODES: Record<WifiAuth, number> = {
  open: 0x0001,
  "wpa-personal": 0x0002,
  "wpa2-personal": 0x0020,
};

const WIFI_ENCRYPTION_CODES: Record<WifiEncryption, number> = {
  none: 0x0001,
  tkip: 0x0004,
  aes: 0x0008,
};

/**
 * A Wi-Fi Record: a WSC Configuration Token a phone reads as a network to join.
 *
 * The token is a Credential attribute wrapping the credential attributes. The
 * deprecation of Network Index does not make it optional: the specification
 * requires it set to 1, and tags that phones (and Android's token parser) accept
 * carry it. MAC Address is required and is written zeroed, because this app
 * issues a shareable credential rather than one bound to a device.
 */
export function wifiRecord(fields: WifiRecordFields): NdefRecord {
  const auth = WIFI_AUTH_CODES[fields.auth];
  const encryption = WIFI_ENCRYPTION_CODES[fields.encryption];
  if (auth === undefined || encryption === undefined) {
    throw new NdefError(
      "A Wi-Fi Record has an authentication or encryption type this build does not know.",
    );
  }

  const ssid = utf8(fields.ssid);
  if (ssid.length === 0) throw new NdefError("A Wi-Fi Record needs an SSID.");
  if (ssid.length > 32) {
    throw new NdefError(`A Wi-Fi Record's SSID cannot exceed 32 bytes; this one is ${ssid.length}.`);
  }

  const key = utf8(fields.networkKey);
  if (fields.auth === "open") {
    if (key.length > 0) throw new NdefError("An open Wi-Fi Record carries no network key.");
    if (fields.encryption !== "none") {
      throw new NdefError("An open Wi-Fi Record uses no encryption.");
    }
  } else {
    if (fields.encryption === "none") {
      throw new NdefError("A WPA Wi-Fi Record needs an encryption type.");
    }
    if (key.length < 8 || key.length > 63) {
      throw new NdefError(
        `A WPA Wi-Fi Record needs a network key of 8 to 63 bytes; this one is ${key.length}.`,
      );
    }
  }

  const credential = [
    ...wscAttribute(WSC_NETWORK_INDEX, [0x01]),
    ...wscAttribute(WSC_SSID, ssid),
    ...wscAttribute(WSC_AUTH_TYPE, u16(auth)),
    ...wscAttribute(WSC_ENCRYPTION_TYPE, u16(encryption)),
    ...wscAttribute(WSC_NETWORK_KEY, key),
    ...wscAttribute(WSC_MAC_ADDRESS, [0, 0, 0, 0, 0, 0]),
  ];

  return {
    tnf: TNF_MIME_MEDIA,
    type: asciiBytes(MIME_WIFI, "a Wi-Fi Record's type"),
    payload: wscAttribute(WSC_CREDENTIAL, credential),
  };
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/**
 * A Contact Record: a vCard 3.0 body under `text/vcard`. The form carries the
 * five fields a phone shows, so the card is built from them in a fixed order.
 * Values are escaped per RFC 2426: backslash, newline, comma and semicolon have
 * no literal meaning inside a vCard value.
 */
export function contactRecord(fields: ContactRecordFields): NdefRecord {
  const name = fields.name.trim();
  if (name.length === 0) throw new NdefError("A Contact Record needs a name.");

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vcardEscape(name)};;;;`,
    `FN:${vcardEscape(name)}`,
  ];
  const organization = fields.organization.trim();
  if (organization.length > 0) lines.push(`ORG:${vcardEscape(organization)}`);
  const phone = fields.phone.trim();
  if (phone.length > 0) lines.push(`TEL;TYPE=CELL:${vcardEscape(canonicalPhoneNumber(phone))}`);
  const email = fields.email.trim();
  if (email.length > 0) lines.push(`EMAIL:${vcardEscape(canonicalEmailAddress(email))}`);
  lines.push("END:VCARD");

  return {
    tnf: TNF_MIME_MEDIA,
    type: asciiBytes(MIME_VCARD, "a Contact Record's type"),
    payload: utf8(`${lines.join("\r\n")}\r\n`),
  };
}

// ---------------------------------------------------------------------------
// Bluetooth
// ---------------------------------------------------------------------------

/** A Bluetooth device address in the display form AA:BB:CC:DD:EE:FF. */
export function canonicalBluetoothAddress(address: string): string {
  const trimmed = address.trim();
  const parts = trimmed.split(/[:-]/);
  if (parts.length !== 6 || parts.some((part) => !/^[0-9a-fA-F]{2}$/.test(part))) {
    throw new NdefError(
      "A Bluetooth Record needs a device address of six hex octets, such as AA:BB:CC:DD:EE:FF.",
    );
  }
  if (parts.every((part) => part === "00")) {
    throw new NdefError("A Bluetooth Record cannot use the zero address; it names no device.");
  }
  return parts.map((part) => part.toUpperCase()).join(":");
}

/**
 * A Bluetooth Record: the BR/EDR Secure Simple Pairing OOB block under
 * `application/vnd.bluetooth.ep.oob`. The OOB Data Length counts the length
 * field itself and the address (minimum 8), and both it and the address are
 * little-endian.
 */
export function bluetoothRecord(address: string): NdefRecord {
  const canonical = canonicalBluetoothAddress(address);
  const octets = canonical.split(":").map((part) => Number.parseInt(part, 16));
  return {
    tnf: TNF_MIME_MEDIA,
    type: asciiBytes(MIME_BLUETOOTH, "a Bluetooth Record's type"),
    payload: [0x08, 0x00, ...octets.reverse()],
  };
}

// ---------------------------------------------------------------------------
// Generic MIME and external type
// ---------------------------------------------------------------------------

/** RFC 2046 type/subtype, restricted to the characters that need no escaping. */
const MIME_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;

/** A MIME Record: a media type and an arbitrary byte payload given as hex. */
export function mimeRecord(type: string, payloadHex: string): NdefRecord {
  const trimmed = type.trim();
  if (!MIME_TYPE_PATTERN.test(trimmed)) {
    throw new NdefError(
      "A MIME Record needs a media type of the form type/subtype, such as text/plain.",
    );
  }
  if (utf8Length(trimmed) > 0xff) {
    throw new NdefError(`A MIME Record's type cannot exceed 255 bytes; this one is ${utf8Length(trimmed)}.`);
  }
  return {
    tnf: TNF_MIME_MEDIA,
    type: asciiBytes(trimmed, "a MIME Record's type"),
    payload: parseHexBytes(payloadHex, "A MIME Record's payload"),
  };
}

/**
 * An External Record: TNF external, whose type is `domain:service` with the
 * `urn:nfc:ext:` prefix the NDEF specification removes. The domain must be a
 * lower-case DNS name, because a phone resolves the type against it.
 */
export function externalRecord(type: string, payloadHex: string): NdefRecord {
  const trimmed = type.trim();
  const colon = trimmed.indexOf(":");
  const domain = trimmed.slice(0, colon);
  const service = trimmed.slice(colon + 1);
  const domainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  const valid =
    colon > 0 &&
    colon === trimmed.lastIndexOf(":") &&
    service.length > 0 &&
    domainPattern.test(domain) &&
    /^[!-~]+$/.test(service);
  if (!valid) {
    throw new NdefError(
      "An External Record needs a type of the form domain:service, such as example.com:door.",
    );
  }
  if (utf8Length(trimmed) > 0xff) {
    throw new NdefError(
      `An External Record's type cannot exceed 255 bytes; this one is ${utf8Length(trimmed)}.`,
    );
  }
  return {
    tnf: TNF_EXTERNAL_TYPE,
    type: asciiBytes(trimmed, "an External Record's type"),
    payload: parseHexBytes(payloadHex, "An External Record's payload"),
  };
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
    case "phone":
      return phoneRecord(record.fields.number);
    case "email":
      return emailRecord(record.fields.address);
    case "contact":
      return contactRecord(record.fields);
    case "sms":
      return smsRecord(record.fields.number, record.fields.message);
    case "location":
      return locationRecord(record.fields.latitude, record.fields.longitude);
    case "wifi":
      return wifiRecord(record.fields);
    case "bluetooth":
      return bluetoothRecord(record.fields.address);
    case "mime":
      return mimeRecord(record.fields.type, record.fields.payloadHex);
    case "external":
      return externalRecord(record.fields.type, record.fields.payloadHex);
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
      return draftRecordFromUri(decodeUrlPayload(record.payload));
    }
  }
  if (record.tnf === TNF_MIME_MEDIA) {
    return draftRecordFromMime(asciiDecode(record.type, "Record type"), record.payload);
  }
  if (record.tnf === TNF_EXTERNAL_TYPE) {
    return {
      kind: "external",
      fields: {
        type: asciiDecode(record.type, "Record type"),
        payloadHex: hexBytes(record.payload),
      },
    };
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

/**
 * Why this Record cannot be encoded yet, or null when it can. The editor shows
 * this instead of a size, so a malformed field is named rather than silently
 * encoded into something a phone will ignore.
 */
export function recordProblem(record: DraftRecord): string | null {
  try {
    recordToNdef(record);
    return null;
  } catch (error) {
    return error instanceof NdefError ? error.message : String(error);
  }
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
// reading the URI-shaped and MIME-shaped Record types back
// ---------------------------------------------------------------------------

/** The form a URI Record represents, if one of them represents it exactly. */
function draftRecordFromUri(uri: string): DraftRecord {
  if (uri.startsWith(PHONE_SCHEME)) {
    const number = uri.slice(PHONE_SCHEME.length);
    if (/^\+?\d{2,15}$/.test(number)) return { kind: "phone", fields: { number } };
  }
  if (uri.startsWith(EMAIL_SCHEME)) {
    const address = uri.slice(EMAIL_SCHEME.length);
    if (/^[^\s@?#]+@[^\s@?#]+\.[^\s@?#]+$/.test(address)) {
      return { kind: "email", fields: { address } };
    }
  }
  if (uri.startsWith(SMS_SCHEME)) {
    const sms = smsFieldsFromUri(uri);
    if (sms) return { kind: "sms", fields: sms };
  }
  if (uri.startsWith(LOCATION_SCHEME)) {
    const location = locationFieldsFromUri(uri);
    if (location) return { kind: "location", fields: location };
  }
  return { kind: "url", fields: { url: uri } };
}

function smsFieldsFromUri(uri: string): SmsRecordFields | null {
  const rest = uri.slice(SMS_SCHEME.length);
  const question = rest.indexOf("?");
  const number = question < 0 ? rest : rest.slice(0, question);
  if (!/^\+?\d{2,15}$/.test(number)) return null;
  if (question < 0) return { number, message: "" };
  const query = rest.slice(question + 1);
  const prefix = "body=";
  if (!query.startsWith(prefix)) return null;
  const body = query.slice(prefix.length);
  // A literal ampersand begins another parameter. Folding it into the message
  // would rewrite the URI, so an SMS the form cannot represent stays a URL.
  if (body.includes("&")) return null;
  try {
    return { number, message: decodeURIComponent(body) };
  } catch {
    // A percent escape that does not decode is not a message this build can
    // show; leaving it as a URL Record keeps the bytes intact.
    return null;
  }
}

function locationFieldsFromUri(uri: string): LocationRecordFields | null {
  const parts = uri.slice(LOCATION_SCHEME.length).split(",");
  if (parts.length !== 2) return null;
  const [latitude, longitude] = parts;
  if (!latitude || !longitude) return null;
  const decimal = /^[+-]?\d+(\.\d+)?$/;
  if (!decimal.test(latitude) || !decimal.test(longitude)) return null;
  if (Math.abs(Number(latitude)) > 90 || Math.abs(Number(longitude)) > 180) return null;
  return { latitude, longitude };
}

/** The form a MIME Record represents, decided by its media type. */
function draftRecordFromMime(type: string, payload: readonly number[]): DraftRecord {
  switch (type.toLowerCase()) {
    case MIME_WIFI:
      return { kind: "wifi", fields: decodeWifiPayload(payload) };
    case MIME_VCARD:
      return { kind: "contact", fields: decodeVcardPayload(payload) };
    case MIME_BLUETOOTH:
      return { kind: "bluetooth", fields: decodeBluetoothPayload(payload) };
    default:
      return { kind: "mime", fields: { type, payloadHex: hexBytes(payload) } };
  }
}

function decodeWifiPayload(payload: readonly number[]): WifiRecordFields {
  const credential = findWscAttribute(payload, WSC_CREDENTIAL);
  if (credential === null) throw new NdefError("a Wi-Fi Record carries no Credential attribute");
  const ssid = findWscAttribute(credential.value, WSC_SSID);
  if (ssid === null) throw new NdefError("a Wi-Fi Record's Credential carries no SSID");
  const key = findWscAttribute(credential.value, WSC_NETWORK_KEY);
  if (key === null) throw new NdefError("a Wi-Fi Record's Credential carries no network key");
  const mac = findWscAttribute(credential.value, WSC_MAC_ADDRESS);
  if (mac === null || mac.value.length !== 6) {
    throw new NdefError("a Wi-Fi Record's Credential carries no six-byte MAC address");
  }
  return {
    ssid: utf8Decode(ssid.value),
    networkKey: utf8Decode(key.value),
    auth: wifiAuthFromCode(wscCode(findWscAttribute(credential.value, WSC_AUTH_TYPE), "authentication type")),
    encryption: wifiEncryptionFromCode(
      wscCode(findWscAttribute(credential.value, WSC_ENCRYPTION_TYPE), "encryption type"),
    ),
  };
}

function wifiAuthFromCode(code: number): WifiAuth {
  const entry = Object.entries(WIFI_AUTH_CODES).find(([, value]) => value === code);
  if (entry === undefined) {
    throw new NdefError(
      `a Wi-Fi Record carries authentication type 0x${hex4(code)}, which this build does not know`,
    );
  }
  return entry[0] as WifiAuth;
}

function wifiEncryptionFromCode(code: number): WifiEncryption {
  const entry = Object.entries(WIFI_ENCRYPTION_CODES).find(([, value]) => value === code);
  if (entry === undefined) {
    throw new NdefError(
      `a Wi-Fi Record carries encryption type 0x${hex4(code)}, which this build does not know`,
    );
  }
  return entry[0] as WifiEncryption;
}

function decodeVcardPayload(payload: readonly number[]): ContactRecordFields {
  const lines = utf8Decode(payload).split(/\r\n|\r|\n/);
  if (lines[0] !== "BEGIN:VCARD") {
    throw new NdefError("a Contact Record's payload does not begin with BEGIN:VCARD");
  }
  if (!lines.includes("END:VCARD")) {
    throw new NdefError("a Contact Record's vCard does not end with END:VCARD");
  }
  let name = "";
  let organization = "";
  let phone = "";
  let email = "";
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const property = line.slice(0, colon).split(";")[0]!.toUpperCase();
    const value = vcardUnescape(line.slice(colon + 1));
    if (property === "FN" && name.length === 0) name = value;
    if (property === "ORG" && organization.length === 0) organization = value;
    if (property === "TEL" && phone.length === 0) phone = value;
    if (property === "EMAIL" && email.length === 0) email = value;
  }
  if (name.length === 0) throw new NdefError("a Contact Record's vCard carries no FN (formatted name)");
  return { name, organization, phone, email };
}

function decodeBluetoothPayload(payload: readonly number[]): BluetoothRecordFields {
  if (payload.length < 8) {
    throw new NdefError("a Bluetooth Record's payload is shorter than its device address");
  }
  if (payload.length > 8) {
    throw new NdefError("a Bluetooth Record with optional EIR data is not supported by this build");
  }
  const declared = payload[0]! | (payload[1]! << 8);
  if (declared !== 8) {
    throw new NdefError(
      `a Bluetooth Record declares ${declared} bytes of OOB data, but its payload is 8`,
    );
  }
  return {
    address: payload
      .slice(2, 8)
      .reverse()
      .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
      .join(":"),
  };
}

// ---------------------------------------------------------------------------
// helpers

/** A 16-bit integer, big-endian, as the WSC attributes write it. */
function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

/** One Wi-Fi Simple Configuration attribute: type, length, value. */
function wscAttribute(id: number, value: readonly number[]): number[] {
  return [...u16(id), ...u16(value.length), ...value];
}

/** The first matching WSC attribute at this level, or null. */
function findWscAttribute(
  bytes: readonly number[],
  wanted: number,
): { value: number[] } | null {
  let at = 0;
  let found: { value: number[] } | null = null;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) throw new NdefError("a Wi-Fi Record's attributes are cut short");
    const id = (bytes[at]! << 8) | bytes[at + 1]!;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    at += 4;
    if (at + length > bytes.length) {
      throw new NdefError("a Wi-Fi Record's attribute runs past its payload");
    }
    if (id === wanted && found === null) found = { value: bytes.slice(at, at + length) };
    at += length;
  }
  return found;
}

/** A two-byte WSC value, or a named problem. */
function wscCode(attribute: { value: readonly number[] } | null, what: string): number {
  if (attribute === null || attribute.value.length !== 2) {
    throw new NdefError(`a Wi-Fi Record's ${what} is missing or not two bytes`);
  }
  return (attribute.value[0]! << 8) | attribute.value[1]!;
}

/** Printable ASCII bytes for a type name, or a named problem. */
function asciiBytes(text: string, what: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code > 0x7e) throw new NdefError(`the ${what} is not printable ASCII`);
    bytes.push(code);
  }
  return bytes;
}

/** A printable-ASCII type name, or a named problem. */
function asciiDecode(bytes: readonly number[], what: string): string {
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) {
      throw new NdefError(`the ${what} is not printable ASCII`);
    }
  }
  return bytes.map((byte) => String.fromCharCode(byte)).join("");
}

/** Hexadecimal digits as bytes. Whitespace is ignored, so 48 65 reads. */
function parseHexBytes(hex: string, what: string): number[] {
  const compact = hex.replace(/\s+/g, "");
  if (compact.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(compact)) {
    throw new NdefError(`${what} must be an even number of hex digits, such as 48656C6C6F.`);
  }
  const bytes: number[] = [];
  for (let at = 0; at < compact.length; at += 2) {
    bytes.push(Number.parseInt(compact.slice(at, at + 2), 16));
  }
  return bytes;
}

/** Bytes as compact upper-case hex, the form a decoded MIME Record shows. */
function hexBytes(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("");
}

/** A four-digit hexadecimal number, for a WSC attribute value. */
function hex4(value: number): string {
  return value.toString(16).padStart(4, "0").toUpperCase();
}

/** Escape a vCard value per RFC 2426: backslash, newline, comma, semicolon. */
function vcardEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Undo the RFC 2426 escapes this codec writes. */
function vcardUnescape(value: string): string {
  let out = "";
  for (let at = 0; at < value.length; at += 1) {
    const char = value[at]!;
    if (char === "\\" && at + 1 < value.length) {
      at += 1;
      const escaped = value[at]!;
      out += escaped === "n" || escaped === "N" ? "\n" : escaped;
    } else {
      out += char;
    }
  }
  return out;
}

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
