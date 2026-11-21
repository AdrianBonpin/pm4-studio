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

export type HfCard = {
  uid: string;
  raw: string;
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
