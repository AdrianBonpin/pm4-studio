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
 * The backend hands over the bytes and the frontend decoder
 * (`src/lib/hfDecoder.ts`) decides what — if anything — can be named. The reply
 * layout is measured against two real tags; see docs/PROTOCOL.md. */
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
 * a copy, and it must not be worded as "verified".
 *
 * `erased` belongs to the NDEF erase path: the write was sent and the read-back
 * showed a present tag with a valid empty NDEF message. The tag keeps its UID,
 * its Capability Container and its format; only the content is gone. Like
 * `blanked` it is never a copy and never "verified". */
export type WriteOutcome =
  | "refused"
  | "verified"
  | "blanked"
  | "erased"
  | "unverified"
  | "failed";

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

/** What an authored Identity would be written as, produced before any write.
 *
 * Every field is decided by the Rust codec (`author_identity.rs` on top of
 * `identity.rs`), so the values shown here are the values on the wire: the form
 * never re-derives the bit layout. */
export type IdentityPreview = {
  customer: number;
  data32: number;
  /** The five-byte id as every other surface shows it: `55 00 84 82 12`. */
  id: string;
  /** The same five bytes with no separators, for copying back into the form. */
  hex: string;
  facility: number;
  card: number;
  /** The 24-byte `0x0073` payload, hex: what goes on the wire. */
  payloadHex: string;
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

/** What became of one attempt in a Batch Clone.
 *
 * `skipped` belongs to the batch path: the Tag in the write position already
 * presents the Identity being written, so the guard refused and nothing was
 * written. It is the case a batch hits by leaving a written Tag on the Reader,
 * and it is never a confirmed copy — otherwise one Tag could be counted twice. */
export type BatchAttemptOutcome =
  | "verified"
  | "skipped"
  | "unverified"
  | "refused"
  | "failed";

/** What became of one attempt in a Batch Clone, as the backend reports it.
 *
 * One attempt, not a run: the Identity is held by the webview and passed back in
 * for each Blank, and this is what came of that one write. */
export type BatchAttemptResult = {
  /** The Identity that was written, from the source read once at the start. */
  customer: number;
  data32: number;
  /** See `src/lib/batchClone.ts` for the wording of each outcome. */
  outcome: BatchAttemptOutcome;
  /** Why this attempt did not confirm a copy, when it did not. */
  message: string | null;
  /** What the Tag read as for this attempt, when it read as anything. */
  readback: LfCard | null;
  /** Confirmed copies of this Identity after the attempt; null = no Snapshot. */
  confirmedCopies: number | null;
  /** Set when the count could not be written to the library file. */
  countProblem: string | null;
};

/** One 13.56 MHz Tag as the backend read it, with its NDEF content as far as the
 *  Type 2 TLV could be read. Shared by the write and erase results. */
export type NdefTagSnapshot = {
  /** Space-separated hex, as every other UID in this app is written. */
  uid: string;
  /** What `0x0083` reported. Not the write-path tag selector. */
  reportedTagType: number;
  /** User memory from the Type 2 Capability Container, or null when unreadable. */
  capacityBytes: number | null;
  userPages: number | null;
  existing: {
    state: "empty" | "message" | "unreadable";
    /** The NDEF message itself, hex. Decoded by the webview, not by Rust. */
    messageHex: string | null;
    bytes: number;
    reason: string | null;
  };
};

/** What became of one NDEF erase.
 *
 * `erased` means the read-back showed a present tag with a valid empty NDEF
 * message and an unchanged UID and Capability Container — the expected result,
 * and never a "verified" copy. `failed` means the erase was sent and the tag
 * still reads its content (or its container changed), which is a definite
 * failure on a tag that is still readable; `unverified` means the erase was sent
 * and the tag could not be read back at all. */
export type EraseResult = {
  /** See `src/lib/eraseTag.ts` for the wording of each outcome. */
  outcome: "refused" | "erased" | "unverified" | "failed";
  /** Why the content was not cleared, when it was not. */
  message: string | null;
  /** What the tag held before the erase, from the read that precedes it. */
  before: NdefTagSnapshot | null;
  /** What it read back as afterwards, when it could be re-read. */
  after: NdefTagSnapshot | null;
  capacityBytes: number | null;
  /** Bytes of the old NDEF message the erase cleared. */
  clearedBytes: number;
  /** Pages the request asked the firmware to write. */
  erasePages: number[];
  /** Pages the firmware reported writing. */
  acceptedPages: number[];
  /** UID and Capability Container read identically before and after. */
  identityIntact: boolean | null;
  /** The bytes written over the message area, hex. */
  writtenHex: string;
};

export type RawResponse = {
  sent: string;
  cmd: number;
  payload: string;
  checksum_ok: boolean;
  raw: string;
};

/**
 * What the raw console's build may send. The backend answers this before the
 * console is used, so the console marks itself from the actual capability
 * rather than from an assumption of its own (ADR 0006): a development build
 * must not display the shipped build's read-only warning.
 */
export type ConsoleCapability = {
  /** True in a release build: only `commands` are sent. */
  readOnly: boolean;
  /** The commands a release build sends, by id and name. Empty otherwise. */
  commands: ConsoleCommand[];
};

/** One command a release build's raw console sends. */
export type ConsoleCommand = {
  /** The command id as it appears in a frame, e.g. `0x0081`. */
  cmd: string;
  /** What it does, e.g. `NTAG read`. */
  name: string;
};

/**
 * A frame this build refused to send, as it arrives across the IPC boundary.
 *
 * `kind` is what lets the console show it as a limit of the build. A
 * write-guard refusal arrives as plain text instead, because it is about the
 * Tag in position — the two must not look like one another.
 */
export type BuildRefusal = {
  kind: "refusedByBuild";
  /** The refused command, e.g. `0x0073`. */
  cmd: string;
  /** Why it was refused, in the backend's words. */
  message: string;
};
