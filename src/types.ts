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

export type WriteResult = {
  customer: number;
  data32: number;
  readback: LfCard | null;
  verified: boolean;
};

export type RawResponse = {
  sent: string;
  cmd: number;
  payload: string;
  checksum_ok: boolean;
  raw: string;
};
