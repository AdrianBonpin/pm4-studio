import { describe, expect, it } from "vitest";
import { resolveCardType, variantsNote } from "./cardType";
import { unapprovedWords } from "./copyGuard";

// Expectations here are written from the published ATQA/SAK assignments, not
// from the resolver's table. Sources for every row are recorded in
// cardType.ts and restated on each case below.

/** One row of the published table, transcribed by hand from the sources named
 *  on the row. `atqa` is in transmission order (LSByte first). */
type PublishedPair = {
  label: string;
  atqa: readonly [number, number];
  sak: number;
  family: string;
  capacityBytes: number | null;
  technologies: string[];
  nfcForumTagType: 2 | 4 | null;
};

const PUBLISHED_PAIRS: PublishedPair[] = [
  {
    // NXP AN10833 Table 3 (ATQA 00 04) + Table 4 (Classic 1K, SAK 08, 1K)
    label: "MIFARE Classic 1K, 4-byte UID",
    atqa: [0x04, 0x00],
    sak: 0x08,
    family: "MIFARE Classic 1K",
    capacityBytes: 1024,
    technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
    nfcForumTagType: null,
  },
  {
    // AN10833 Table 3 note [1]: the 7-byte UID MIFARE Classic 1K sets bit 7 of
    // the ATQA (1-based ISO numbering, so 0x40) giving 00 44. Table 4: SAK 08.
    label: "MIFARE Classic 1K, 7-byte UID",
    atqa: [0x44, 0x00],
    sak: 0x08,
    family: "MIFARE Classic 1K",
    capacityBytes: 1024,
    technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
    nfcForumTagType: null,
  },
  {
    // AN10833 Table 3 (ATQA 00 02) + Table 4 (Classic 4K, SAK 18, 4K)
    label: "MIFARE Classic 4K, 4-byte UID",
    atqa: [0x02, 0x00],
    sak: 0x18,
    family: "MIFARE Classic 4K",
    capacityBytes: 4096,
    technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
    nfcForumTagType: null,
  },
  {
    // AN10833 Table 3 note [2]: 7-byte UID Classic 4K sets ATQA bit 7, 00 42.
    label: "MIFARE Classic 4K, 7-byte UID",
    atqa: [0x42, 0x00],
    sak: 0x18,
    family: "MIFARE Classic 4K",
    capacityBytes: 4096,
    technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
    nfcForumTagType: null,
  },
  {
    // libnfc target-subr.c const_ca pairs ATQA 0x0004 with SAK 0x09 for "MIFARE
    // Mini 0.3K"; proxmark3 cmdhf14a.c agrees (SAK 0x09 is MTMINI). 5 sectors
    // of 4 blocks of 16 bytes = 320 bytes.
    label: "MIFARE Mini",
    atqa: [0x04, 0x00],
    sak: 0x09,
    family: "MIFARE Mini",
    capacityBytes: 320,
    technologies: ["ISO/IEC 14443-3A", "MIFARE Classic"],
    nfcForumTagType: null,
  },
  {
    // AN10833 section 2.2 (whole Ultralight family shares ATQA and SAK),
    // Table 3/4 (00 44 / 00) and NTAG213/215/216 Tables 24-25 (00 44 / 00).
    // Memory differs per chip, so no capacity is claimed.
    label: "MIFARE Ultralight / NTAG21x",
    atqa: [0x44, 0x00],
    sak: 0x00,
    family: "MIFARE Ultralight / NTAG21x",
    capacityBytes: null,
    technologies: ["ISO/IEC 14443-3A", "MIFARE Ultralight"],
    nfcForumTagType: 2,
  },
  {
    // libnfc target-subr.c const_ca: ATQA 0x0344 is "MIFARE DESFire" (SAK 0x20
    // per AN10833 Table 5), and NXP NT4H2421Gx (NTAG 424 DNA) section 9.1 gives
    // ATQA 0344h with final SAK 20h. Sizes range 2K-8K, so no capacity.
    label: "MIFARE DESFire",
    atqa: [0x44, 0x03],
    sak: 0x20,
    family: "MIFARE DESFire",
    capacityBytes: null,
    technologies: ["ISO/IEC 14443-3A", "ISO/IEC 14443-4", "MIFARE DESFire"],
    nfcForumTagType: 4,
  },
];

// ATQA is given in the order the two bytes leave the PICC: the LSByte first,
// so the pair [0x04, 0x00] is the 0x0004 that NXP datasheets quote.
describe("resolveCardType", () => {
  it("resolves MIFARE Classic 1K from its transmitted ATQA and SAK", () => {
    // NXP AN10833 Table 3 (ATQA 00 04) and Table 4 (SAK 08, memory 1K).
    const card = resolveCardType([0x04, 0x00], 0x08);

    expect(card).not.toBeNull();
    expect(card?.family).toBe("MIFARE Classic 1K");
    expect(card?.capacityBytes).toBe(1024);
  });

  it("treats the ATQA pair as transmitted, not as the quoted big-endian value", () => {
    // The same 0x0004 written big-endian is not an ATQA any tag sends.
    expect(resolveCardType([0x00, 0x04], 0x08)).toBeNull();
  });

  it("names the Ultralight family but withholds capacity it cannot know", () => {
    // NXP AN10833 section 2.2: "The whole MIFARE Ultralight family uses the
    // same ATQA and SAK". NTAG213/215/216 answer 0x0044/0x00 as well and differ
    // only in memory size (144/504/888 bytes), which needs GET_VERSION.
    const card = resolveCardType([0x44, 0x00], 0x00);

    expect(card?.family).toBe("MIFARE Ultralight / NTAG21x");
    expect(card?.capacityBytes).toBeNull();
    expect(card?.variants.length).toBeGreaterThan(1);
  });

  it("returns nothing for a pair no published table assigns", () => {
    expect(resolveCardType([0x00, 0x00], 0x00)).toBeNull();
    expect(resolveCardType([0xff, 0xff], 0xff)).toBeNull();
  });

  describe("the pairs the two hardware captures presented", () => {
    it("names the MIFARE Classic 1K the 0x0069 capture came from", () => {
      // The capture carries ATQA 04 00 (transmission order) and SAK 08 at the
      // measured offsets. AN10833 Table 3 gives 00 04 for the 4-byte-UID part
      // and Table 4 gives SAK 08 with 1 KiB of memory.
      const card = resolveCardType([0x04, 0x00], 0x08);
      expect(card?.family).toBe("MIFARE Classic 1K");
      expect(card?.capacityBytes).toBe(1024);
    });

    it("names the NTAG21x family the other capture came from, without a size", () => {
      // ATQA 44 00 and SAK 00: AN10833 section 2.2 and the NTAG213/215/216 data
      // sheet Tables 24-25. The pair does not say which NTAG it is.
      const card = resolveCardType([0x44, 0x00], 0x00);
      expect(card?.family).toBe("MIFARE Ultralight / NTAG21x");
      expect(card?.capacityBytes).toBeNull();
    });

    it("reports no UID width, because a pair does not determine one", () => {
      // The resolver is handed a pair, never a UID, and its answer carries no
      // width field for a caller to read. The poll reply's own length byte is
      // the only source of UID width in this codebase.
      const card = resolveCardType([0x04, 0x00], 0x08);
      expect(card).not.toBeNull();
      for (const key of ["uid", "uidLength", "uidWidth", "serial"]) {
        expect(key in (card as object)).toBe(false);
      }
    });
  });

  it("returns nothing for a plausible-looking pair rather than a nearest guess", () => {
    // Classic 1K's ATQA with an ISO/IEC 14443-4 SAK: a MIFARE Plus in SL3 can
    // look like this, but the pair alone does not name a chip.
    expect(resolveCardType([0x04, 0x00], 0x20)).toBeNull();
    // DESFire's ATQA with Ultralight's SAK is not a published tag either.
    expect(resolveCardType([0x44, 0x03], 0x00)).toBeNull();
  });

  for (const expected of PUBLISHED_PAIRS) {
    it(`matches the published row for ${expected.label}`, () => {
      const card = resolveCardType(expected.atqa, expected.sak);

      expect(card).not.toBeNull();
      expect(card?.family).toBe(expected.family);
      expect(card?.capacityBytes).toBe(expected.capacityBytes);
      expect(card?.technologies).toEqual(expected.technologies);
      expect(card?.nfcForumTagType).toBe(expected.nfcForumTagType);
    });
  }

  it("states technologies for every family and withholds capacity where chips differ", () => {
    for (const expected of PUBLISHED_PAIRS) {
      const card = resolveCardType(expected.atqa, expected.sak);

      expect(card?.technologies.length).toBeGreaterThan(0);
      if (expected.capacityBytes === null) {
        // The pair covers several chips, so it must also say so.
        expect(card?.variants.length).toBeGreaterThan(1);
      } else {
        expect(card?.capacityBytes).toBeGreaterThan(0);
      }
    }
  });

  it("never throws on bytes a hardware payload can carry, it returns nothing", () => {
    expect(resolveCardType([0xffff, 0x00], 0x08)).toBeNull();
    expect(resolveCardType([0x04, 0x00], 0x100)).toBeNull();
    expect(resolveCardType([0.5, 0x00], 0x08)).toBeNull();
  });

  describe("the note under a readout whose pair covers more than one family member", () => {
    const note = variantsNote(["MIFARE Ultralight (MF0ICU1)", "MIFARE Ultralight C (MF0ICU2)"]);

    it("names them as card types, in approved vocabulary", () => {
      // The sentence used to read "This pair covers several chips", and "chip"
      // is retired as a name for a Tag. What the pair actually covers is several
      // *card types* — the derived family labels — not several pieces of silicon
      // the user is holding, so the approved term is the accurate one rather than
      // a compromise.
      expect(unapprovedWords(note)).toEqual([]);
      expect(note).toContain("card types");
    });

    it("lists every member it was given, so the note cannot undercount", () => {
      expect(note).toContain("MIFARE Ultralight (MF0ICU1)");
      expect(note).toContain("MIFARE Ultralight C (MF0ICU2)");
    });
  });
});
