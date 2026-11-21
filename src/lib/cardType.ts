/** Card type resolver — seam S6.
 *
 * Turns the ATQA/SAK pair a 13.56 MHz Tag presents into the card family that
 * pair identifies, plus whatever else the pair alone determines. It reads no
 * hardware and knows nothing about the Reader.
 *
 * ATQA byte order: bytes are supplied in transmission order. ISO/IEC 14443-3
 * sends the ATQA LSByte first, so the two bytes a PICC sends for NXP's 0x0044
 * arrive as [0x44, 0x00]. NXP AN10833 Rev. 3.9 section 2.3 note 2 says the
 * same, and calls out that 0x00 44 is "often received as 0x44 00".
 *
 * SAK is the SAK of the last cascade level, per AN10833 section 2.4 ("In case
 * of double size UIDs or triple size UIDs always only the last SAK shall be
 * used to distinguish the chip type").
 *
 * Unknown pairs return null. There is deliberately no mask, no nearest match
 * and no default, because a confident wrong family is worse than no family.
 *
 * Capacity is null wherever the pair covers chips that differ in memory size.
 * Getting the size would need GET_VERSION, which this Reader does not expose;
 * a guessed size is worse than a missing one, because the size decides how
 * many bytes a write would send.
 *
 * Sources for the table (all consulted while writing the rows):
 *   - NXP AN10833 Rev. 3.9, "MIFARE type identification procedure",
 *     Tables 3 and 4 (ATQA and SAK for the chips that predate GET_VERSION),
 *     Table 5 (DESFire SAK 0x20), and section 2.2 (the Ultralight family
 *     shares one ATQA and SAK).
 *   - NXP NTAG213/215/216 data sheet Rev. 3.2, section 9.4, Tables 24-25
 *     (ATQA 00 44, SAK 00 for the whole NTAG21x range).
 *   - NXP NT4H2421Gx (NTAG 424 DNA) data sheet, section 9.1 (ATQA 0344h,
 *     final SAK 20h).
 *   - libnfc `libnfc/target-subr.c`, the published ATQA/SAK list
 *     (`const_ca` / `const_cs`), for ATQA 0x0344 = MIFARE DESFire and
 *     SAK 0x09 = MIFARE Mini 0.3K.
 *   - proxmark3 `client/src/cmdhf14a.c` (`detect_nxp_card_*`), which agrees on
 *     SAK 0x09 = MIFARE Mini and on reading ATQA as `(atqa[1] << 8) + atqa[0]`,
 *     i.e. first-received byte is the low byte.
 *
 * Deliberate omissions, because the pair does not identify them:
 *   - MIFARE Plus. In SL1 it is byte-for-byte a MIFARE Classic on the air, and
 *     in SL3 it answers with a generic SAK; AN10833 Table 4 separates the Plus
 *     variants only through ATS/GET_VERSION guidance this Reader does not have.
 *   - Any chip whose assignment is vendor-specific or unconfirmed. A missing
 *     row shows raw bytes; a wrong row mislabels the user's Tag.
 */

/** What the ATQA/SAK pair says about a 13.56 MHz Tag. */
export type CardType = {
  /** The tag family the pair identifies, e.g. "MIFARE Classic 1K". */
  family: string;
  /** Chips published with this exact pair. More than one means family only. */
  variants: readonly string[];
  /** Total memory in bytes — the whole EEPROM, not the user or NDEF payload
   *  area — or null when the pair does not determine it. */
  capacityBytes: number | null;
  /** Protocols plausible for this family. */
  technologies: readonly Technology[];
  /** NFC Forum tag type the family implements, or null when it has none. */
  nfcForumTagType: 2 | 4 | null;
};

/** A protocol or command set a tag family is known to speak. */
export type Technology =
  | "ISO/IEC 14443-3A"
  | "ISO/IEC 14443-4"
  | "MIFARE Classic"
  | "MIFARE Ultralight"
  | "MIFARE DESFire";

const key = (atqa: number, sak: number) => atqa * 0x100 + sak;

const TABLE = new Map<number, CardType>();

function define(atqa: number, sak: number, card: CardType): void {
  TABLE.set(key(atqa, sak), card);
}

// MIFARE Classic 1K. AN10833 Table 3 gives ATQA 00 04 (4-byte UID) and 00 44
// (7-byte UID, note [1]: bit 7 of the ATQA is set); Table 4 gives SAK 08 with
// 1K of memory. 16 sectors of 4 blocks of 16 bytes = 1024 bytes total.
// MIFARE Plus in SL1 answers with the same pair — see the omissions above.
define(0x0004, 0x08, {
  family: "MIFARE Classic 1K",
  variants: ["MIFARE Classic 1K"],
  capacityBytes: 1024,
  technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
  nfcForumTagType: null,
});
define(0x0044, 0x08, {
  family: "MIFARE Classic 1K",
  variants: ["MIFARE Classic 1K"],
  capacityBytes: 1024,
  technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
  nfcForumTagType: null,
});

// MIFARE Classic 4K. AN10833 Table 3 gives 00 02 (4-byte UID) and 00 42
// (7-byte UID, note [2]); Table 4 gives SAK 18 with 4K of memory. 4096 bytes.
define(0x0002, 0x18, {
  family: "MIFARE Classic 4K",
  variants: ["MIFARE Classic 4K"],
  capacityBytes: 4096,
  technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
  nfcForumTagType: null,
});
define(0x0042, 0x18, {
  family: "MIFARE Classic 4K",
  variants: ["MIFARE Classic 4K"],
  capacityBytes: 4096,
  technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
  nfcForumTagType: null,
});

// MIFARE Mini 0.3K. libnfc's published list pairs ATQA 0x0004 with SAK 0x09 for
// "MIFARE Mini 0.3K"; proxmark3 reads SAK 0x09 as MIFARE Mini too. 5 sectors of
// 4 blocks of 16 bytes = 320 bytes total.
define(0x0004, 0x09, {
  family: "MIFARE Mini",
  variants: ["MIFARE Mini (MF1S20)"],
  capacityBytes: 320,
  technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
  nfcForumTagType: null,
});

// MIFARE Ultralight family and NTAG21x, which all answer 00 44 / 00 (AN10833
// section 2.2 and Tables 3-4; NTAG213/215/216 Tables 24-25). Ultralight,
// Ultralight C, Ultralight EV1 and NTAG210/212/213/215/216 differ in memory
// (NTAG21x alone is 144/504/888 bytes of user memory) and only GET_VERSION
// separates them, so the family is named and capacity is withheld.
define(0x0044, 0x00, {
  family: "MIFARE Ultralight / NTAG21x",
  variants: [
    "MIFARE Ultralight (MF0ICU1)",
    "MIFARE Ultralight C (MF0ICU2)",
    "MIFARE Ultralight EV1 (MF0UL11/21/H21)",
    "NTAG210/212/213/215/216",
  ],
  capacityBytes: null,
  technologies: ["ISO/IEC 14443-3A", "MIFARE Ultralight"],
  nfcForumTagType: 2,
});

// MIFARE DESFire family. AN10833 Table 5 gives SAK 0x20 for DESFire, libnfc's
// published list pairs ATQA 0x0344 with it, and NTAG 424 DNA (NT4H2421Gx,
// section 9.1) answers the same pair with final SAK 0x20. Sizes run from 2K to
// 8K within EV1 alone, so capacity is withheld. AN10833 section 2.2 warns that
// newer generations may configure these values, which is one more reason not to
// derive anything beyond the family.
define(0x0344, 0x20, {
  family: "MIFARE DESFire",
  variants: [
    "MIFARE DESFire EV1 2K/4K/8K",
    "MIFARE DESFire EV2",
    "MIFARE DESFire EV3",
    "MIFARE DESFire Light",
    "NTAG 4xx (e.g. NTAG 424 DNA)",
  ],
  capacityBytes: null,
  technologies: ["ISO/IEC 14443-3A", "ISO/IEC 14443-4", "MIFARE DESFire"],
  nfcForumTagType: 4,
});

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xff;
}

/** Resolve the pair a 13.56 MHz Tag presented.
 *
 *  `atqa` is the two bytes in transmission order — LSByte first, so
 *  [0x44, 0x00] is NXP's 0x0044. `sak` is the SAK of the last cascade level.
 *  Returns null for any pair the published table does not assign, and for
 *  values that are not bytes, because hardware payloads are not trustworthy
 *  input and a resolver must not throw on them.
 */
export function resolveCardType(
  atqa: readonly [number, number],
  sak: number,
): CardType | null {
  if (!isByte(atqa[0]) || !isByte(atqa[1]) || !isByte(sak)) return null;
  const atqaValue = atqa[0] | (atqa[1] << 8);
  return TABLE.get(key(atqaValue, sak)) ?? null;
}
