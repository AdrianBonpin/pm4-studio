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
 * state is unknown), and `failed` never reached the device. */
export type WriteOutcome = "refused" | "verified" | "unverified" | "failed";

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

export type RawResponse = {
  sent: string;
  cmd: number;
  payload: string;
  checksum_ok: boolean;
  raw: string;
};
