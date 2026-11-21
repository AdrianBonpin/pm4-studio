/** HF decoder — seam S5.
 *
 * Turns the payload of one `0x0069` (13.56 MHz poll) reply into either a decoded
 * reading or an explicit raw-only reading. It is pure: bytes in, value out, no
 * hardware and no Reader knowledge.
 *
 * ## The layout is measured
 *
 * Two captures from this Reader, one MIFARE Classic 1K and one NTAG215, settle
 * the offsets below. Their ATQA and SAK values agree with the published NXP
 * assignments, which is what makes this a measurement rather than a fit; the
 * full table and both captures are in the spec ("The verified HF reply
 * layout").
 *
 * | Payload byte | Meaning                                                |
 * |--------------|--------------------------------------------------------|
 * | 0            | validity flag: `0x01` = a Tag is latched               |
 * | 1            | constant `0x01`, carries nothing                       |
 * | 2..12        | UID buffer, ten bytes; only the first `LEN` are the UID  |
 * | 12           | UID length in bytes: `0x04`, `0x07` or `0x0A`          |
 * | 13..15       | ATQA, transmission order (LSByte first)                |
 * | 15           | SAK of the last cascade level                          |
 * | 16           | cascade level count — consistent with both captures,   |
 * |              | not established, so nothing is decoded from it         |
 * | 17..19       | unexplained; no meaning is invented for them           |
 *
 * The previous table read a 4-byte UID at 2..6 with ATQA at 14..16 and SAK at
 * 17. It was one byte off, which is why a real Classic 1K matched nothing.
 *
 * The **UID length byte is what makes the layout self-describing**: the UID is
 * the first `uidLength` bytes of the buffer, never a fixed width and never a
 * width inferred from ATQA bits. Bytes between the UID and the length byte are
 * stale buffer residue — the same Reader returned different values for them
 * across captures of one Tag, and zeros when the buffer was clean — so they are
 * never presented as UID or as content.
 *
 * The reply is 19 bytes and arrives in a single USB report, so nothing needs
 * reassembling here.
 *
 * ## Decode policy
 *
 * Decoded values appear only when the payload is the expected 19-byte shape,
 * the validity flag is set, the stated UID length is one ISO/IEC 14443-3
 * allows (4, 7 or 10 bytes), the UID is not all zeros, and the ATQA/SAK pair
 * resolves in the card type table. Anything else is a raw-only reading with a
 * reason: no card type, no capacity, no technologies, no UID split. A
 * confident wrong field is worse than a byte string, because the user cannot
 * tell it is wrong.
 *
 * Raw bytes are part of every reading, decoded or not.
 */

import { resolveCardType, type CardType } from "./cardType";
import type { TagNdefOutcome, TagRecordsRead } from "./tagRecords";

/** The 13.56 MHz poll reply is 19 payload bytes. */
export const HF_POLL_PAYLOAD_LEN = 19;

/** The UID widths ISO/IEC 14443-3 defines, in bytes. Any other stated length
 *  is refused rather than truncated or padded. */
const UID_WIDTHS: readonly number[] = [4, 7, 10];

/** Offsets, kept in one place so the readout can describe them and so a future
 *  firmware revision has a single table to correct. Ranges are half-open. */
export const HF_POLL_LAYOUT = {
  validity: 0,
  constant: 1,
  uid: [2, 12],
  uidLength: 12,
  atqa: [13, 15],
  sak: 15,
  /** Consistent with a 4-byte (01) and a 7-byte (02) capture, not established.
   *  Recorded so a future capture can settle it; nothing is decoded from it. */
  cascadeLevels: 16,
} as const;

/** Why a reading could not be decoded. Each maps to a message in the readout. */
export type HfRawOnlyReason =
  /** The reply contained something that is not a byte. */
  | "invalid-bytes"
  /** The reply was not 19 bytes, so the offsets cannot be trusted at all. */
  | "unexpected-length"
  /** The validity flag was clear: nothing is latched in the field. */
  | "not-latched"
  /** A Tag is latched but the bytes its length byte claims are all zeros. */
  | "empty-uid"
  /** The reply's own UID length byte is not 4, 7 or 10 bytes. */
  | "unsupported-uid-width"
  /** The ATQA/SAK pair matches nothing in the published table. */
  | "unknown-card-type";

/** Whether a Tag is NDEF formatted, and what settled the answer.
 *
 * A poll reply does not carry it: formatting is in the Tag's memory, in the Type 2
 * Capability Container. The Reader *can* read that memory (`0x0081` — the same
 * command the memory dump and the erase preview use), so the answer is available;
 * it just takes a second command. `formatted` is therefore null on a reading
 * taken from a poll alone, and `true`/`false` once a memory read of the same Tag
 * has settled it (`ndefStatusFor`). It is never filled in from the card family: an
 * NTAG215 can be unformatted, and a MIFARE Classic cannot hold NDEF at all, but a
 * family is still not a reading of the memory. */
export type NdefStatus = {
  formatted: boolean | null;
  /** What is known, and what would settle it. Never empty. */
  note: string;
};

/** A poll reply alone never answers it: the answer is one memory read away. */
const NDEF_NOT_READ_YET: NdefStatus = {
  formatted: null,
  note:
    "A poll reply carries no NDEF information: whether a Tag is formatted lives in its " +
    "memory, in the Type 2 Capability Container. Read the Tag's memory (0x0081) below and " +
    "the answer appears here.",
};

/**
 * The NDEF status a memory read settled, or the honest "read the memory" status
 * when no memory read has been taken (`null`).
 *
 * `outcome` is `tag_records::TagNdef`'s verdict on the Type 2 structure, so this
 * is a wording layer over one determination rather than a second opinion: the
 * erase and load panels read the same field out of the same reply.
 */
export function ndefStatusFor(outcome: TagNdefOutcome | null): NdefStatus {
  switch (outcome) {
    case null:
      return NDEF_NOT_READ_YET;
    case "message":
      return {
        formatted: true,
        note:
          "The Tag's memory was read: its Capability Container is a Type 2 one and its user " +
          "memory holds an NDEF message, so the Tag is NDEF formatted.",
      };
    case "empty":
      return {
        formatted: true,
        note:
          "The Tag's memory was read: it holds an empty NDEF TLV (03 00 FE), so it is NDEF " +
          "formatted and carries no Records.",
      };
    case "missing":
      return {
        formatted: true,
        note:
          "The Tag's memory was read: page 3 is a Type 2 Capability Container, so the Tag is " +
          "NDEF formatted, but its user memory holds no NDEF TLV yet.",
      };
    case "notFormatted":
      return {
        formatted: false,
        note:
          "The Tag's memory was read: page 3 is not a Type 2 Capability Container, so the Tag " +
          "is not NDEF formatted.",
      };
    case "unreadable":
      return {
        formatted: null,
        note:
          "The Tag's memory was read, but the NDEF area could not be parsed, so whether it is " +
          "formatted could not be determined from it. The raw bytes are shown below.",
      };
  }
}

/**
 * The NDEF row a readout shows, or `null` when there is nothing true to show.
 *
 * User story 56: a field this Reader cannot produce for a Tag must be omitted
 * rather than printed as a greyed "not determinable" row on every reading.
 */
export function ndefField(status: NdefStatus): { label: string; value: string } | null {
  if (status.formatted === null) return null;
  return { label: "NDEF formatted", value: status.formatted ? "yes" : "no" };
}

/**
 * The capacity a readout can show, in bytes, or `null` when nothing has produced one.
 *
 * User story 56 again: capacity must not become a permanently greyed row. It is
 * not one of the fields this Reader cannot produce — the published table gives it
 * for a family whose size is fixed, and for the families the table withholds it
 * for (Ultralight/NTAG21x, DESFire) the Tag's own Type 2 Capability Container
 * gives it, in the same memory read that settles NDEF. So a muted "not determined"
 * means "not produced yet", never "impossible", and it is only shown when neither
 * source has answered.
 */
export function capacityForReading(
  cardType: CardType,
  memory: TagRecordsRead | null,
): number | null {
  return cardType.capacityBytes ?? memory?.ndef.capacityBytes ?? null;
}

/**
 * Whether a memory read describes the Tag a reading came from.
 *
 * A poll states its own UID length, so the two reads of one Tag normally carry
 * the same bytes. The reading's bytes are still allowed to be a **prefix** of
 * the dump's: a narrower source must not be applied to a different Tag, but a
 * prefix of the same UID is the same Tag. An empty UID never matches: a memory
 * read of some other Tag must not be applied to a reading that named none.
 */
export function uidMatchesMemory(readingUid: string, dumpUid: string): boolean {
  const reading = readingUid.trim().toUpperCase();
  const dump = dumpUid.trim().toUpperCase();
  if (reading === "" || dump === "") return false;
  return dump === reading || dump.startsWith(`${reading} `);
}

export type HfDecodedReading = {
  state: "decoded";
  /** The reply's payload as hex — always present, decoded or not. */
  raw: string;
  /** The UID the reply carries, e.g. `"DE AD BE EF"`. */
  uid: string;
  /** ATQA in the order the resolver takes it (transmission order). */
  atqa: readonly [number, number];
  /** SAK of the last cascade level. */
  sak: number;
  /** What the pair identifies, straight from the card type table. */
  cardType: CardType;
  ndef: NdefStatus;
};

export type HfRawReading = {
  state: "raw";
  /** The reply's payload as hex — always present, decoded or not. */
  raw: string;
  reason: HfRawOnlyReason;
  /** One sentence naming what failed, safe to show the user. */
  detail: string;
};

export type HfReading = HfDecodedReading | HfRawReading;

function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xff;
}

/** Bytes as upper-case hex separated by spaces, e.g. `"DE AD BE EF"`. A value
 *  that is not a byte shows as `??` rather than a plausible-looking wrong
 *  number, so a broken reply is visible as broken. */
export function hexBytes(bytes: readonly number[]): string {
  return bytes
    .map((b) => (isByte(b) ? b.toString(16).toUpperCase().padStart(2, "0") : "??"))
    .join(" ");
}

function hex2(byte: number): string {
  return isByte(byte) ? byte.toString(16).toUpperCase().padStart(2, "0") : "??";
}

function rawOnly(raw: string, reason: HfRawOnlyReason, detail: string): HfRawReading {
  return { state: "raw", raw, reason, detail };
}

/**
 * Decode one 13.56 MHz poll payload.
 *
 * Never throws on hardware input: a payload of the wrong length, the wrong
 * shape, or with a byte that is not a byte produces a raw-only reading, because
 * the caller still has to show the user what came back.
 */
export function decodeHfPayload(payload: readonly number[]): HfReading {
  const raw = hexBytes(payload);

  if (!payload.every(isByte)) {
    return rawOnly(
      raw,
      "invalid-bytes",
      "The reply contained a value that is not a byte, so it cannot be decoded. " +
        "The raw bytes are shown above; `??` marks the bad one.",
    );
  }

  if (payload.length !== HF_POLL_PAYLOAD_LEN) {
    return rawOnly(
      raw,
      "unexpected-length",
      `Expected a ${HF_POLL_PAYLOAD_LEN}-byte 13.56 MHz reply and got ${payload.length} ` +
        "bytes. Every field offset would be a guess on a different shape, so nothing is decoded.",
    );
  }

  const flag = payload[HF_POLL_LAYOUT.validity];
  if (flag !== 0x01) {
    return rawOnly(
      raw,
      "not-latched",
      `The validity flag is 0x${hex2(flag)}, not 0x01: the Reader latched no Tag in this ` +
        "poll, so the rest of the reply is noise.",
    );
  }

  // The reply states its own UID length. It is never inferred from ATQA bits,
  // and never assumed: a stated width this decoder cannot split is its own
  // refusal rather than a truncated or zero-padded UID.
  const uidLength = payload[HF_POLL_LAYOUT.uidLength];
  if (!UID_WIDTHS.includes(uidLength)) {
    return rawOnly(
      raw,
      "unsupported-uid-width",
      `The reply's UID length byte is 0x${hex2(uidLength)}; ISO/IEC 14443-3 allows ` +
        `${UID_WIDTHS.join(", ")} bytes and nothing else, so no UID is split. A truncated or ` +
        "padded UID would be a serial this Tag does not have.",
    );
  }

  const [uidFrom] = HF_POLL_LAYOUT.uid;
  const uidBytes = payload.slice(uidFrom, uidFrom + uidLength);
  if (uidBytes.every((b) => b === 0)) {
    return rawOnly(
      raw,
      "empty-uid",
      `The validity flag says a Tag is latched and its length byte says ${uidLength} bytes, ` +
        "but those bytes are all zeros. That is not a UID, so none is shown.",
    );
  }

  const [atqaFrom, atqaTo] = HF_POLL_LAYOUT.atqa;
  const atqa = payload.slice(atqaFrom, atqaTo) as [number, number];
  const sak = payload[HF_POLL_LAYOUT.sak];

  const cardType = resolveCardType(atqa, sak);
  if (!cardType) {
    return rawOnly(
      raw,
      "unknown-card-type",
      `ATQA ${hexBytes(atqa)} with SAK ${hex2(sak)} matches no published ATQA/SAK ` +
        "assignment, so the family is not named. A wrong family is worse than none.",
    );
  }

  return {
    state: "decoded",
    raw,
    uid: hexBytes(uidBytes),
    atqa,
    sak,
    cardType,
    ndef: NDEF_NOT_READ_YET,
  };
}
