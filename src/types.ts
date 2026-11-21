export type DeviceInfo = {
  vid: number;
  pid: number;
  product: string;
  manufacturer: string;
  serial: string;
};

export type LfCard = {
  customer: number;
  data32: number;
  id: string;
  facility: number;
  card: number;
  raw: string;
};

/** One 13.56 MHz poll reply, undecoded.
 *
 * The payload's field offsets are an unverified hypothesis, so the backend hands
 * over the bytes and the frontend decoder (`src/lib/hfDecoder.ts`) decides what
 * — if anything — can be named. */
export type HfCard = {
  /** Payload byte for byte as the Reader reported it. */
  payload: number[];
};

/** What became of one attempted write.
 *
 * Only `verified` is a confirmed copy: `refused` was stopped by the guard before
 * anything was sent, `unverified` was sent but could not be read back (the tag's
 * state is unknown), and `failed` never reached the device.
 *
 * `blanked` belongs to the blanking path: the write was sent with the neutral
 * Identity and the re-read found no Identity at all. It is a destruction, never
 * a copy, and it must not be worded as "verified". */
export type WriteOutcome = "refused" | "verified" | "blanked" | "unverified" | "failed";

export type WriteResult = {
  customer: number;
  data32: number;
  readback: LfCard | null;
  /** What actually happened; see `src/lib/writeOutcome.ts` for the wording. */
  outcome: WriteOutcome;
  /** True only for a verified read-back. */
  verified: boolean;
  /** Why this write did not confirm a copy, when it did not. */
  message: string | null;
  /** Confirmed copies of this Identity after the write; null = no such Snapshot. */
  confirmedCopies: number | null;
  /** Set when the count could not be written to the library file. */
  countProblem: string | null;
};

/** What became of one blanking attempt.
 *
 * `blanked` means the re-read found no Identity, which is the success condition
 * for blanking — a blanked tag reads as empty. `failed` means either the write
 * never reached the device or the tag still presents an Identity afterwards;
 * `unverified` means the write was sent and could not be read back at all. */
export type BlankResult = {
  /** The Identity the user confirmed, which is what was blanked. */
  customer: number;
  data32: number;
  /** See `src/lib/blankTag.ts` for the wording of each outcome. */
  outcome: "refused" | "blanked" | "unverified" | "failed";
  /** True only when the re-read found no Identity. Never a "verified" claim. */
  blanked: boolean;
  /** The Identity the tag still presents, when it still presents one. */
  stillIdentifies: string | null;
  /** Why the tag was not blanked, when it was not. */
  message: string | null;
};

export type RawResponse = {
  sent: string;
  cmd: number;
  payload: string;
  checksum_ok: boolean;
  raw: string;
};
